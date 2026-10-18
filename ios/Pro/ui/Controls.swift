import RawBoyEngine
import SwiftUI

/** The slider tabs: Light, Color, Detail, LUTs, Lens (Android's ControlsPanel). */
struct ControlsPanel: View {
    let params: DevelopParams
    let defaults: DevelopParams
    let onChange: (DevelopParams) -> Void
    let luts: LutLibrary
    let lutLoading: Bool
    let onSelectLut: (String?) -> Void
    let filmLoading: Bool
    let onToneMapper: (ToneMapper) -> Void
    let onFilm: () -> Void
    let onSelectFilm: (String) -> Void
    let onLutsTabShown: () -> Void
    let lens: LensInfo
    let skin: SkinState
    let blemish: BlemishState
    /** White balance picker armed: the next tap on the photo sets temperature and tint. */
    var pickingWhite = false
    var onPickWhite: () -> Void = {}
    /** Lens tab: saves its settings as the lens preset of that name; with true, also sends it to RawBoy Auto. */
    var onSaveLensPreset: (_ name: String, _ sendToAuto: Bool) -> Void = { _, _ in }

    @AppStorage("pro.tab") private var chosenTab = 0
    @State private var grainOpen = false

    private static let tabNames = ["Light", "Color", "Detail", "LUTs", "Lens"]
    private static let lutsTab = 3

    // Film replaces the tone mapper and the user LUT (kept, but not rendered), so the LUTs tab hides while Film is
    // on. Tabs keep their index whether or not LUTs is shown.
    private var tab: Int { params.film != nil && chosenTab == Self.lutsTab ? 0 : chosenTab }
    private var shownTabs: [Int] { Self.tabNames.indices.filter { !(params.film != nil && $0 == Self.lutsTab) } }

    private func set(_ change: (inout DevelopParams) -> Void) {
        var p = params
        change(&p)
        onChange(p)
    }

    private func slider(_ label: String, _ kp: WritableKeyPath<DevelopParams, Float>, _ range: ClosedRange<Float>,
                        format: @escaping (Float) -> String = formatSigned, defaultValue: Float? = nil) -> some View {
        ParamSlider(label: label, value: params[keyPath: kp], range: range,
                    defaultValue: defaultValue ?? defaults[keyPath: kp], format: format) { v in set { $0[keyPath: kp] = v } }
    }

    /** A primaries slider whose track shows the colour it gives at each position. */
    private func primaries(_ label: String, _ kp: WritableKeyPath<DevelopParams, Float>, _ which: PrimariesSlider,
                           _ range: ClosedRange<Float>, format: @escaping (Float) -> String = formatSigned) -> some View {
        let colors = PrimariesTrack.colors(params, which, range).map { Color(.sRGB, red: $0[0], green: $0[1], blue: $0[2]) }
        return ParamSlider(label: label, value: params[keyPath: kp], range: range, defaultValue: 0, format: format,
                           trackGradient: colors) { v in set { $0[keyPath: kp] = v } }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: Binding(get: { tab }, set: { chosenTab = $0 })) {
                ForEach(shownTabs, id: \.self) { i in
                    Text(Self.tabNames[i]).tag(i)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch tab {
                    case 0: light
                    case 1: color
                    case 2: detail
                    case Self.lutsTab: LutPanel(params: params, luts: luts, loading: lutLoading, onChange: onChange, onSelect: onSelectLut)
                    default: lensPanel
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            .id(tab)  // one scroll position per tab
        }
        .onChange(of: tab) { _, t in if t == Self.lutsTab { onLutsTabShown() } }  // rescan the user's folder
        .onAppear { if tab == Self.lutsTab { onLutsTabShown() } }
    }

    @ViewBuilder private var light: some View {
        HStack {
            Text("Tone mapper").font(.subheadline)
            // nil = Film: negative + print on a stock, in place of the tone mapper (also what Auto's Film mode sets).
            Picker("", selection: Binding<ToneMapper?>(
                get: { params.film == nil ? params.toneMapper : nil },
                set: { t in if let t { onToneMapper(t) } else { onFilm() } })) {
                ForEach(ToneMapper.allCases, id: \.self) { Text($0.label).tag(Optional($0)) }
                Text("Film").tag(ToneMapper?.none)
            }
            .pickerStyle(.segmented)
        }
        .padding(.vertical, 4)
        if let film = params.film {
            HStack {
                Text("Stock").font(.subheadline)
                Spacer()
                if filmLoading { ProgressView().controlSize(.small) }
                Picker("Stock", selection: Binding(get: { film }, set: { onSelectFilm($0) })) {
                    ForEach(FilmLooks.all.filter { $0.film != nil }) { Text($0.name).tag($0.film!) }
                }
                .pickerStyle(.menu)
            }
            if params.lut != nil {
                Text("Your LUT is off while Film is on; it returns with another tone mapper.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            slider("Film strength", \.filmAmount, 0...100, format: formatPlain, defaultValue: 100)
            slider("Film grain", \.filmGrain, 0...200, format: formatPlain, defaultValue: 100)
            slider("Halation", \.halation, 0...200, format: formatPlain, defaultValue: 100)
        }
        slider("Exposure", \.exposure, -5...5, format: formatEv)
        slider("Contrast", \.contrast, -100...100)
        slider("Highlights", \.highlights, -100...100)
        slider("Shadows", \.shadows, -100...100)
        slider("Whites", \.whites, -100...100)
        slider("Blacks", \.blacks, -100...100)
        SectionLabel("Curves")
        CurvesPanel(curves: params.curves) { c in set { $0.curves = c } }
    }

    @ViewBuilder private var color: some View {
        Button(action: onPickWhite) {
            Label(pickingWhite ? "Tap something neutral grey" : "Pick white balance", systemImage: "eyedropper")
                .font(.subheadline)
        }
        .buttonStyle(.bordered)
        .tint(pickingWhite ? .accentColor : .secondary)
        .padding(.vertical, 4)
        TemperatureSlider(kelvin: params.temperature, defaultValue: defaults.temperature) { k in set { $0.temperature = k } }
        slider("Tint", \.tint, -Float(WhiteBalance.maxTint)...Float(WhiteBalance.maxTint))
        slider("Saturation", \.saturation, -100...100)
        SectionLabel("RGB primaries")
        let degrees = { (v: Float) in String(format: "%+.1f°", v) }
        primaries("Red hue", \.redHue, .redHue, -30...30, format: degrees)
        primaries("Red purity", \.redPurity, .redPurity, -100...100)
        primaries("Green hue", \.greenHue, .greenHue, -30...30, format: degrees)
        primaries("Green purity", \.greenPurity, .greenPurity, -100...100)
        primaries("Blue hue", \.blueHue, .blueHue, -30...30, format: degrees)
        primaries("Blue purity", \.bluePurity, .bluePurity, -100...100)
        primaries("Tint hue", \.tintHue, .tintHue, -180...180, format: degrees)
        primaries("Tint purity", \.tintPurity, .tintPurity, 0...100, format: formatPlain)
        Note("Hue: red → yellow, green → cyan, blue → magenta for positive values.")
    }

    @ViewBuilder private var detail: some View {
        // Colour denoise follows luma until set (edits and presets from before the split); moving luma pins it.
        ParamSlider(label: "Luma denoise", value: params.denoise, range: 0...100, defaultValue: defaults.denoise,
                    format: formatPlain) { v in set { $0.colorDenoise = $0.effectiveColorDenoise; $0.denoise = v } }
        ParamSlider(label: "Color denoise", value: params.effectiveColorDenoise, range: 0...100,
                    defaultValue: defaults.effectiveColorDenoise, format: formatPlain) { v in set { $0.colorDenoise = v } }
        slider("Sharpening", \.sharpening, 0...100, format: formatPlain)
        slider("Local contrast", \.localContrast, -100...100)
        slider("High-pass contrast", \.highpassContrast, -100...100)
        slider("Skin retouch", \.skinRetouch, 0...100, format: formatPlain)
        if params.skinRetouch > 0, let note = skinNote { Note(note) }
        slider("Blemish removal", \.blemishRemoval, 0...100, format: formatPlain)
        if params.blemishRemoval > 0 {
            if let note = skinNote {
                Note(note)
            } else {
                Note(blemish.working ? "Removing blemishes…" : blemish.healed == 1 ? "1 spot removed" : "\(blemish.healed) spots removed")
            }
        }
        slider("Bloom", \.bloom, 0...100, format: formatPlain)
        grainSliders
    }

    /**
     * Grain, whose name opens Size, Roughness and Color under it (shown open while any of them is changed, so an
     * edit is never hidden). As Controls.kt's GrainSliders.
     */
    @ViewBuilder private var grainSliders: some View {
        let changed = params.grainSize != defaults.grainSize || params.grainRoughness != defaults.grainRoughness
            || params.grainColor != defaults.grainColor
        let shown = grainOpen || changed
        ParamSlider(label: shown ? "Grain ▾" : "Grain ▸", value: params.grain, range: 0...100, defaultValue: defaults.grain,
                    format: formatPlain, onLabelTap: { grainOpen = !shown }) { v in set { $0.grain = v } }
        if shown {
            Group {
                slider("Size", \.grainSize, 0...100, format: formatPlain)
                slider("Roughness", \.grainRoughness, 0...100, format: formatPlain)
                slider("Color", \.grainColor, 0...100, format: formatPlain)
            }
            .padding(.leading, 16)
        }
    }

    private var skinNote: String? {
        switch skin {
        case .computing: "Finding skin…"
        case .failed: "Skin detection failed"
        case let .ready(mask) where !mask.hasSkin: "No skin found in this photo"
        default: nil
        }
    }

    @ViewBuilder private var lensPanel: some View {
        SectionLabel("Lens profile")
        Text(lens.lensName.trimmingCharacters(in: .whitespaces).isEmpty ? "Unknown lens" : lens.lensName).font(.subheadline)
        Note(lens.profileSummary.map { "Embedded in file: \($0)" } ?? "No lens correction data in this file")
        Toggle("Use embedded profile", isOn: Binding(get: { params.lensProfile && lens.hasProfile },
                                                    set: { v in set { $0.lensProfile = v } }))
            .font(.subheadline)
            .disabled(!lens.hasProfile)
            .padding(.vertical, 4)
        SectionLabel("Manual")
        slider("Distortion", \.lensDistortion, -100...100)
        slider("Vignetting", \.vignetteAmount, -100...100)
        slider("Vignette radius", \.vignetteMidpoint, 0...100, format: formatPlain)
        Note("Distortion crops automatically so no empty edges show.")
        SectionLabel("Lens preset")
        LensPresetSave(lensName: lens.lensName, onSave: onSaveLensPreset).id(lens.lensName)
    }
}

private struct LutPanel: View {
    let params: DevelopParams
    let luts: LutLibrary
    let loading: Bool
    let onChange: (DevelopParams) -> Void
    let onSelect: (String?) -> Void

    var body: some View {
        if params.lut != nil {
            ParamSlider(label: "Strength", value: params.lutAmount, range: 0...100, defaultValue: 100, format: formatPlain) { v in
                var p = params
                p.lutAmount = v
                onChange(p)
            }
        }
        LutRow(name: "No LUT", selected: params.lut == nil, loading: false) { onSelect(nil) }
        SectionLabel("Included")
        ForEach(luts.bundled, id: \.id) { e in
            LutRow(name: e.name, selected: params.lut == e.id, loading: loading && params.lut == e.id) { onSelect(e.id) }
        }
        SectionLabel("Your LUTs · Files › RawBoy › LUTs")
        if luts.user.isEmpty {
            Note("Put .cube or HaldCLUT .png files into RawBoy's LUTs folder in the Files app.")
        }
        ForEach(luts.user, id: \.id) { e in
            LutRow(name: e.name, selected: params.lut == e.id, loading: loading && params.lut == e.id) { onSelect(e.id) }
        }
    }
}

private struct LutRow: View {
    let name: String
    let selected: Bool
    let loading: Bool
    let onTap: () -> Void

    var body: some View {
        HStack {
            Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(selected ? Color.accentColor : .secondary)
            Text(name).font(.subheadline)
            Spacer()
            if loading { ProgressView().controlSize(.small) }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

struct SectionLabel: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor).padding(.top, 12).padding(.bottom, 2)
    }
}

struct Note: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View { Text(text).font(.caption).foregroundStyle(.secondary).padding(.vertical, 2) }
}

/**
 * Rotate in 90 degree steps, flip, straighten the horizon (auto-cropped) and crop, optionally to a fixed aspect ratio.
 */
struct GeometryPanel: View {
    let params: DevelopParams
    let onChange: (DevelopParams) -> Void
    let onRotate: (Int) -> Void
    let onFlip: (_ vertical: Bool) -> Void
    let aspect: CropAspect
    let portrait: Bool
    let onAspect: (CropAspect, Bool) -> Void
    let onResetCrop: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Crop & rotate").font(.headline)
                Spacer()
                Button("Reset crop", action: onResetCrop).disabled(params.crop.isFull && aspect == .free)
                Button("Done", action: onDone).fontWeight(.semibold)
            }
            HStack(spacing: 12) {
                Button("↺  Left") { onRotate(-1) }.buttonStyle(.bordered)
                Button("Right  ↻") { onRotate(1) }.buttonStyle(.bordered)
                Button(portrait ? "Portrait" : "Landscape") { onAspect(aspect, !portrait) }
                    .buttonStyle(.bordered)
                    .disabled(aspect == .free || aspect == .square)
            }
            HStack(spacing: 12) {
                Button("⇆  Flip") { onFlip(false) }.buttonStyle(.bordered)
                Button("⇅  Flip") { onFlip(true) }.buttonStyle(.bordered)
            }
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(CropAspect.allCases, id: \.self) { a in
                        Button(a.label(portrait: portrait)) { onAspect(a, portrait) }
                            .buttonStyle(.bordered)
                            .tint(a == aspect ? .accentColor : .gray)
                    }
                }
            }
            .scrollIndicators(.hidden)
            ParamSlider(label: "Straighten", value: params.straighten, range: -45...45, defaultValue: 0,
                        format: { String(format: "%+.1f°", $0) }) { v in
                var p = params
                p.straighten = Float((v * 10).rounded()) / 10
                onChange(p)
            }
            Note("Drag the corners, edges or inside of the frame to crop. Straightening crops automatically so no empty corners show. Resets for each new photo.")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

/**
 * One compact row: label, slider, value. Tap the value or double-tap the slider to reset it to its default.
 */
struct ParamSlider: View {
    let label: String
    let value: Float
    let range: ClosedRange<Float>
    let defaultValue: Float
    var format: (Float) -> String = formatSigned
    /** Colours painted across the whole track instead of the system track (e.g. a colour gradient). */
    var trackGradient: [Color]? = nil
    /** Makes the label tappable (e.g. to show more controls under the slider). */
    var onLabelTap: (() -> Void)? = nil
    let onChange: (Float) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(label).font(.subheadline).lineLimit(1).minimumScaleFactor(0.8).frame(width: 104, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { onLabelTap?() }
                .allowsHitTesting(onLabelTap != nil)
            slider
            Text(format(value))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(value == defaultValue ? Color.secondary : Color.accentColor)
                .lineLimit(1)
                .frame(width: 74, alignment: .trailing)
                .contentShape(Rectangle())
                .onTapGesture { onChange(defaultValue) }
        }
        .frame(height: 40)
    }

    private var clamped: Float { min(max(value, range.lowerBound), range.upperBound) }

    @ViewBuilder private var slider: some View {
        let native = Slider(value: Binding(get: { Double(clamped) }, set: { onChange(Float($0)) }),
                            in: Double(range.lowerBound)...Double(range.upperBound))
            .simultaneousGesture(TapGesture(count: 2).onEnded { onChange(defaultValue) })
        if let colors = trackGradient {
            // The system slider still takes the touches (and scrolls like the others); it's just not drawn.
            native.opacity(0.02).background {
                GeometryReader { g in
                    let t = CGFloat((clamped - range.lowerBound) / (range.upperBound - range.lowerBound))
                    let inset: CGFloat = 12 // roughly where the system thumb's centre stops
                    ZStack(alignment: .leading) {
                        Capsule().fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
                            .frame(height: 6)
                        Capsule().fill(Color.accentColor)
                            .frame(width: 4, height: 22)
                            .offset(x: inset + t * (g.size.width - 2 * inset) - 2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else if range.lowerBound < 0 && range.upperBound > 0 {
            // Filled from 0, not from the left end (see SignedSliderTrack).
            native.opacity(0.02).background { SignedSliderTrack(value: value, range: range) }
        } else {
            native
        }
    }
}

/** Log-scaled Kelvin slider: equal travel per ratio of temperature. */
private struct TemperatureSlider: View {
    let kelvin: Float
    let defaultValue: Float
    let onChange: (Float) -> Void

    private static let lo = WhiteBalance.minKelvin
    private static let hi = WhiteBalance.maxKelvin
    private static func toPosition(_ k: Float) -> Float {
        Float(log(min(max(Double(k), lo), hi) / lo) / log(hi / lo))
    }
    private static func fromPosition(_ t: Float) -> Float { Float(lo * pow(hi / lo, Double(t))) }

    var body: some View {
        ParamSlider(label: "Temperature", value: Self.toPosition(kelvin), range: 0...1,
                    defaultValue: Self.toPosition(defaultValue),
                    format: { "\(Int((Self.fromPosition($0) / 10).rounded()) * 10) K" }) { t in
            onChange(t == Self.toPosition(defaultValue) ? defaultValue : Self.fromPosition(t))
        }
    }
}

func formatSigned(_ v: Float) -> String { String(format: "%+d", Int(v.rounded())) }
func formatPlain(_ v: Float) -> String { "\(Int(v.rounded()))" }
func formatEv(_ v: Float) -> String { String(format: "%+.2f EV", v) }

/**
 * The Lens tab's lens preset name (the lens by default) and Save / Send to Auto buttons. Manual lenses record no lens
 * name: their presets are named here and picked by name in RawBoy Auto.
 */
private struct LensPresetSave: View {
    let lensName: String
    let onSave: (_ name: String, _ sendToAuto: Bool) -> Void
    @State private var name: String

    init(lensName: String, onSave: @escaping (_ name: String, _ sendToAuto: Bool) -> Void) {
        self.lensName = lensName
        self.onSave = onSave
        _name = State(initialValue: lensName.trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        let lens = lensName.trimmingCharacters(in: .whitespaces)
        TextField(lens.isEmpty ? "Name, e.g. Helios 44-2" : lens, text: $name)
            .textFieldStyle(.roundedBorder)
            .font(.subheadline)
            .padding(.top, 4)
        Note(lens.isEmpty
             ? "This photo records no lens (a manual lens?): in RawBoy Auto, pick the preset by name for the photos taken with it."
             : "RawBoy Auto applies these settings to every photo taken with \(lens), on top of its look; only the lens settings change.")
        HStack {
            Button("Save lens preset") { onSave(name, false) }.buttonStyle(.bordered)
            Button("Send to Auto") { onSave(name, true) }.buttonStyle(.bordered)
        }
        .font(.subheadline)
        .padding(.vertical, 8)
    }
}
