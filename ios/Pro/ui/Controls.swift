import RawBoyEngine
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

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
    /** Portrait retouch: its map is being made / there is one (none on a ready mask = no face to size it by). */
    var retouchWorking = false
    var retouchReady = false
    /** White balance picker armed: the next tap on the photo sets temperature and tint. */
    var pickingWhite = false
    var onPickWhite: () -> Void = {}
    /** Auto WB's area is shown on the photo: dragging it sets temperature and tint from what is inside. */
    var autoWb = false
    var onAutoWb: () -> Void = {}
    var onResetWb: () -> Void = {}
    /** Lens tab: saves its settings as the lens preset of that name; with true, also sends it to RawBoy Auto. */
    var onSaveLensPreset: (_ name: String, _ sendToAuto: Bool) -> Void = { _, _ in }
    /** Lens tab: lens corrections from the Lensfun database (nil = not offered). */
    var lensfun: LensfunStore? = nil
    /** The photo's depth map from RawBoy Camera (Portrait blur); the sliders are offered only when there is one. */
    var depthMap: DepthMap? = nil
    var depthState: DepthState = .none

    @AppStorage("pro.tab") private var chosenTab = 0
    #if os(macOS)
    /** The Mac inspector's closed sections, by title, comma separated (kept between launches). */
    @AppStorage("pro.closedSections") private var closedSections = "Primaries,Portrait,Effects,LUT,Lens,Curve"
    #endif
    @State private var anamorphicOpen: Bool?
    @State private var grainOpen = false
    @State private var fisheyeOpen = false

    private static let tabNames = ["Light", "Colour", "Detail", "LUTs", "Lens"]
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
        #if os(macOS)
        inspector
        #else
        tabs
        #endif
    }

    /** The phones' panel: one tab of sliders at a time. */
    private var tabs: some View {
        VStack(spacing: 0) {
            Picker("", selection: Binding(get: { tab }, set: { chosenTab = $0 })) {
                ForEach(shownTabs, id: \.self) { i in
                    Text(Self.tabNames[i]).tag(i)
                }
            }
            .pickerStyle(.segmented)
            .neutralSegments()
            .reportsWidth("tabs picker")
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    switch tab {
                    case 0: light
                    case 1: color
                    case 2: detail
                    case Self.lutsTab: LutPanel(params: params, luts: luts, loading: lutLoading, onChange: onChange, onSelect: onSelectLut,
                                 onLutsChanged: onLutsTabShown)
                    default: lensPanel
                    }
                }
                .reportsWidth("tab content")
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            .id(tab)  // one scroll position per tab
        }
        .onChange(of: tab) { _, t in if t == Self.lutsTab { onLutsTabShown() } }  // rescan the user's folder
        .onAppear { if tab == Self.lutsTab { onLutsTabShown() } }
    }

    /** nil = Film: negative + print on a stock, in place of the tone mapper (also what Auto's Film mode sets). */
    private var toneMapperPicker: some View {
        Picker("Tone mapper", selection: Binding<ToneMapper?>(
            get: { params.film == nil ? params.toneMapper : nil },
            set: { t in if let t { onToneMapper(t) } else { onFilm() } })) {
            ForEach(ToneMapper.allCases, id: \.self) { Text($0.label).tag(Optional($0)) }
            Text("Film").tag(ToneMapper?.none)
        }
        .labelsHidden()
        .pickerStyle(.segmented)
        .neutralSegments()
        #if os(macOS)
        .controlSize(.small)
        #endif
        .frame(maxWidth: .infinity)
        .stockWheel(film: params.film, onSelect: onSelectFilm)
    }

    @ViewBuilder private var lightSliders: some View {
        // The label beside the segments when they fit, else above them: a segmented control can't go below its natural width,
        // and a row wider than the panel made every slider track and the curve box as wide, running off the panel's edge.
        ViewThatFits(in: .horizontal) {
            HStack {
                // A fixed label width (as the sliders') so the row doesn't re-flow when the segments or the stock name change.
                Text("Tone mapper").font(.subheadline).lineLimit(1).minimumScaleFactor(0.8).frame(width: 88, alignment: .leading)
                toneMapperPicker
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Tone mapper").font(.subheadline).lineLimit(1)
                toneMapperPicker
            }
        }
        .reportsWidth("tone mapper row")
        if let film = params.film {
            HStack {
                Text("Stock").font(.subheadline).frame(width: 104, alignment: .leading)
                Spacer()
                if filmLoading { ProgressView().controlSize(.small) }
                Picker("Stock", selection: Binding(get: { film }, set: { onSelectFilm($0) })) {
                    ForEach(FilmLooks.all.filter { $0.film != nil }) { Text($0.name).tag($0.film!) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 190, alignment: .trailing)
            }
            .frame(height: 32)
            .stockWheel(film: film, onSelect: onSelectFilm)
            if params.lut != nil {
                Text("Your LUT is off while Film is on; it returns with another tone mapper.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            slider("Film strength", \.filmAmount, 0...100, format: formatPlain, defaultValue: 100)
            slider("Film grain", \.filmGrain, 0...200, format: formatPlain, defaultValue: 75)
            slider("Halation", \.halation, 0...200, format: formatPlain, defaultValue: 100)
        }
        slider("Exposure", \.exposure, -5...5, format: formatEv)
        slider("Contrast", \.contrast, -100...100)
        slider("Luma contrast", \.lumaContrast, -100...100)
        slider("Highlights", \.highlights, -100...100)
        slider("Shadows", \.shadows, -100...100)
        slider("Whites", \.whites, -100...100)
        slider("Blacks", \.blacks, -100...100)
    }

    @ViewBuilder private var light: some View {
        lightSliders
        SectionLabel("Curves")
        curves
    }

    private var curves: some View { CurvesPanel(curves: params.curves) { c in set { $0.curves = c } } }

    @ViewBuilder private var color: some View {
        whiteBalance
        SectionLabel("RGB primaries")
        primariesSliders
    }

    #if os(macOS)
    private static let pickWhitePrompt = "Click something neutral grey"
    #else
    private static let pickWhitePrompt = "Tap something neutral grey"
    #endif

    @ViewBuilder private var whiteBalance: some View {
        Button(action: onPickWhite) {
            Label(pickingWhite ? Self.pickWhitePrompt : "Pick white balance", systemImage: "eyedropper")
                .font(.subheadline)
        }
        .buttonStyle(.bordered)
        .tint(pickingWhite ? .accentColor : .secondary)
        .padding(.vertical, 4)
        HStack {
            Button("Auto WB", action: onAutoWb).tint(autoWb ? .accentColor : .secondary)
            Button("Reset WB", action: onResetWb).tint(.secondary)
                .disabled(params.temperature == defaults.temperature && params.tint == defaults.tint)
        }
        .buttonStyle(.bordered)
        .font(.subheadline)
        .padding(.bottom, 4)
        if autoWb { Note("Drag the frame on the photo over something that should be neutral.") }
        TemperatureSlider(kelvin: params.temperature, defaultValue: defaults.temperature) { k in set { $0.temperature = k } }
        slider("Tint", \.tint, -Float(WhiteBalance.maxTint)...Float(WhiteBalance.maxTint))
        slider("Saturation", \.saturation, -100...100)
    }

    @ViewBuilder private var primariesSliders: some View {
        let degrees = { (v: Float) in String(format: "%+.1f°", v) }
        primaries("Red hue", \.redHue, .redHue, -45...45, format: degrees)
        primaries("Red purity", \.redPurity, .redPurity, -200...200)
        primaries("Green hue", \.greenHue, .greenHue, -45...45, format: degrees)
        primaries("Green purity", \.greenPurity, .greenPurity, -200...200)
        primaries("Blue hue", \.blueHue, .blueHue, -45...45, format: degrees)
        primaries("Blue purity", \.bluePurity, .bluePurity, -200...200)
        primaries("Tint hue", \.tintHue, .tintHue, -180...180, format: degrees)
        primaries("Tint purity", \.tintPurity, .tintPurity, 0...100, format: formatPlain)
        Note("Hue: red → yellow, green → cyan, blue → magenta for positive values.")
    }

    @ViewBuilder private var detail: some View {
        sharpness
        portrait
        effects
    }

    /** Denoise, sharpening and the two contrasts (the Mac's Detail section). */
    @ViewBuilder private var sharpness: some View {
        // Colour denoise follows luma until set (edits and presets from before the split); moving luma pins it.
        ParamSlider(label: "Luma denoise", value: params.denoise, range: 0...100, defaultValue: defaults.denoise,
                    format: formatPlain) { v in set { $0.colorDenoise = $0.effectiveColorDenoise; $0.denoise = v } }
        ParamSlider(label: "Colour denoise", value: params.effectiveColorDenoise, range: 0...100,
                    defaultValue: defaults.effectiveColorDenoise, format: formatPlain) { v in set { $0.colorDenoise = v } }
        slider("Sharpening", \.sharpening, 0...100, format: formatPlain)
        slider("Local contrast", \.localContrast, -100...100)
        slider("High-pass contrast", \.highpassContrast, -100...100)
    }

    /** What works on skin (the Mac's Portrait section). */
    @ViewBuilder private var portrait: some View {
        portraitBlur
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
        #if !canImport(MediaPipeTasksVision)
        // The Mac's Vision-based skin mask carries the face landmarks Portrait retouch needs; iOS's MediaPipe path doesn't hand them over yet (FaceShape(mesh:) is ready for it).
        slider("Portrait retouch", \.portraitRetouch, 0...100, format: formatPlain)
        if params.portraitRetouch > 0 {
            if let note = skinNote {
                Note(note)
            } else if retouchWorking {
                Note("Retouching…")
            } else if skin.mask != nil && !retouchReady {
                Note("No face found to size the retouch by")
            }
        }
        #endif
    }

    /**
     * Portrait blur from the depth map RawBoy Camera saved in the DNG: Focus depth, Falloff and Edge softness open when
     * the slider is raised or one of them is changed. Dimmed, with a hint, on photos without a depth map. As web's DepthBlurSliders.
     */
    @ViewBuilder private var portraitBlur: some View {
        if depthMap != nil || (DepthEstimator.isAvailable && depthState != .failed) {
            let changed = params.depthFocus != defaults.depthFocus || params.depthFalloff != defaults.depthFalloff
                || params.depthEdge != defaults.depthEdge
            let shown = params.depthBlur > 0 || changed
            slider("Portrait blur", \.depthBlur, 0...100, format: formatPlain)
            if shown {
                Group {
                    slider("Focus depth", \.depthFocus, 0...100, format: formatPlain)
                    slider("Depth falloff", \.depthFalloff, 0...100, format: formatPlain)
                    slider("Edge softness", \.depthEdge, 0...100, format: formatPlain)
                    Note(depthNote)
                }
                .padding(.leading, 16)
            }
        } else {
            // Shown dimmed so the control can be found; it needs a photo with a depth map.
            Group {
                slider("Portrait blur", \.depthBlur, 0...100, format: formatPlain)
                Note(depthState == .failed ? "The depth estimate failed for this photo"
                     : "Needs a photo with a depth map (a RawBoy Camera DNG saved with Save depth map)")
            }
            .disabled(true)
            .opacity(0.45)
        }
    }

    private var depthNote: String {
        switch depthState {
        case .estimating: return "Estimating depth from the picture…"
        case .estimated: return "Depth estimated from the picture"
        case .failed: return "The depth estimate failed for this photo"
        default:
            return depthMap?.millimetres != nil ? "Camera depth map from the DNG, with distances" : "Camera depth map from the DNG"
        }
    }

    /** Bloom, flare and grain (the Mac's Effects section). */
    @ViewBuilder private var effects: some View {
        slider("Bloom", \.bloom, 0...100, format: formatPlain)
        anamorphicSliders
        grainSliders
    }

    /**
     * Anamorphic lens flare, whose colour choices (Neutral, Blue, Golden, Magenta) and Ghosts open when the slider is raised or when a
     * non-default colour is picked, and can also be toggled from the slider's label. As Controls.kt's AnamorphicSliders.
     */
    @ViewBuilder private var anamorphicSliders: some View {
        let active = params.anamorphic > 0 || params.anamorphicColor != defaults.anamorphicColor
            || params.anamorphicGhosts != defaults.anamorphicGhosts
        let shown = anamorphicOpen ?? active
        ParamSlider(label: shown ? "Anamorphic ▾" : "Anamorphic ▸", value: params.anamorphic, range: 0...100,
                    defaultValue: defaults.anamorphic, format: formatPlain, onLabelTap: { anamorphicOpen = !shown }) { v in
            if v == 0, anamorphicOpen == false { anamorphicOpen = nil }
            set { $0.anamorphic = v }
        }
        if shown {
            Picker("Flare color", selection: Binding(
                get: { params.anamorphicColor },
                set: { c in set { $0.anamorphicColor = c } })) {
                ForEach(AnamorphicColor.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .neutralSegments()
            .padding(.leading, 16)
            .padding(.vertical, 4)
            Toggle("Ghosts", isOn: Binding(
                get: { params.anamorphicGhosts },
                set: { g in set { $0.anamorphicGhosts = g } }))
            .padding(.leading, 16)
        }
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
                slider("Colour", \.grainColor, 0...100, format: formatPlain)
            }
            .padding(.leading, 16)
        }
    }

    /**
     * Straighten fisheye, whose name opens the lens's field of view, image circle size and centre under it (shown
     * open while any of them is changed, so an edit is never hidden). As `grainSliders`.
     */
    @ViewBuilder private var fisheyeSliders: some View {
        let changed = params.lensFisheyeAuto != defaults.lensFisheyeAuto || params.lensFisheyeFov != defaults.lensFisheyeFov || params.lensFisheyeCircle != defaults.lensFisheyeCircle
            || params.lensFisheyeX != defaults.lensFisheyeX || params.lensFisheyeY != defaults.lensFisheyeY
        let shown = fisheyeOpen || changed
        ParamSlider(label: shown ? "Fisheye ▾" : "Fisheye ▸", value: params.lensFisheye, range: 0...100, defaultValue: defaults.lensFisheye,
                    format: formatPlain, onLabelTap: { fisheyeOpen = !shown }) { v in set { $0.lensFisheye = v } }
        if shown {
            Group {
                slider("Lens field of view", \.lensFisheyeFov, 90...220, format: { "\(Int($0.rounded()))°" })
                Toggle("Find the circle automatically", isOn: Binding(get: { params.lensFisheyeAuto },
                                                                      set: { v in set { $0.lensFisheyeAuto = v } }))
                    .font(.subheadline)
                if params.lensFisheyeAuto, let found = lens.fisheyeCircle {
                    Note("Found a circle of \(Int((found.radius * 100).rounded()))% at \(Int((found.offsetX * 100).rounded())), \(Int((found.offsetY * 100).rounded())).")
                } else {
                    if params.lensFisheyeAuto { Note("No circle found (the picture fills the frame), so the sliders below are used.") }
                    slider("Image circle size", \.lensFisheyeCircle, 20...100, format: formatPlain)
                    slider("Circle centre X", \.lensFisheyeX, -50...50, format: formatPlain)
                    slider("Circle centre Y", \.lensFisheyeY, -50...50, format: formatPlain)
                }
                Note("Assumes an equidistant fisheye. For a circular fisheye, set the circle size and centre so the lens's real picture is the circle; Crop below 0 shows more of it.")
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
        Note(lens.lensfunLabel.map { "Lensfun: \($0)" }
             ?? lens.profileSummary.map { "Embedded in file: \($0)" } ?? "No lens correction data in this file")
        Toggle(lens.lensfunLabel != nil ? "Use Lensfun / embedded profile" : "Use embedded profile", isOn: Binding(get: { params.lensProfile && lens.hasProfile },
                                                    set: { v in set { $0.lensProfile = v } }))
            .font(.subheadline)
            .disabled(!lens.hasProfile)
            .padding(.vertical, 4)
        if let lensfun {
            LensfunPanel(store: lensfun, params: params, onChange: onChange,
                         hasFileProfile: lens.lensfunLabel != nil && lens.profileSummary != nil)
        }
        SectionLabel("Manual")
        slider("Distortion", \.lensDistortion, -100...100)
        slider("Horizontal distortion", \.lensAnamorphic, -100...100)
        slider("Crop", \.lensCrop, -100...100)
        fisheyeSliders
        slider("Vignetting", \.vignetteAmount, -100...100)
        slider("Vignette radius", \.vignetteMidpoint, 0...100, format: formatPlain)
        Note("At Crop 0, distortion crops automatically so no empty edges show; negative shows the curved edges, positive crops tighter.")
        SectionLabel("Chromatic aberration")
        slider("Red/Cyan", \.caRed, -100...100)
        slider("Blue/Yellow", \.caBlue, -100...100)
        Note("Line up the colour fringes on edges near the corners, in the 100% view.")
        SectionLabel("Lens preset")
        LensPresetSave(lensName: lens.lensName, onSave: onSaveLensPreset).id(lens.lensName)
    }
}

#if os(macOS)
/**
 * The Mac's inspector: every slider in one scrolling column of sections that open and close (Light, Curve, Colour,
 * Primaries, Detail, Portrait, Effects, LUT, Lens) instead of the phones' tabs, so related controls are seen together
 * and nothing is two clicks away. A section with edits shows an amber dot and a reset for just that section, so what
 * was changed can be found with the sections closed.
 */
extension ControlsPanel {
    fileprivate var inspector: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                section(.light) { lightSliders }
                section(.curve) { curves }
                section(.colour) { whiteBalance }
                section(.primaries) { primariesSliders }
                section(.detail) { sharpness }
                section(.portrait) { portrait }
                section(.effects) { effects }
                // Film replaces the user LUT (kept, not rendered), so the section goes while Film is on, as the phones' tab.
                if params.film == nil {
                    section(.lut) {
                        LutPanel(params: params, luts: luts, loading: lutLoading, onChange: onChange, onSelect: onSelectLut,
                                 onLutsChanged: onLutsTabShown)
                            .onAppear(perform: onLutsTabShown)  // rescan the user's folder when opened
                    }
                }
                section(.lens) { lensPanel }
            }
            .reportsWidth("tab content")
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    private func toggle(_ title: String) {
        Motion.animate { closedSections = InspectorSections.toggled(closedSections, title) }
    }

    /**
     * A section: its header (chevron, name, the edited dot, a switch, reset) and, while open, its controls. Reset puts the
     * section's fields back to the photo's defaults (and switches it on); the section counts as edited when that would
     * change anything, so a switched-off section keeps its switch. The switch keeps the values and renders the defaults.
     */
    private func section<Content: View>(_ section: EditSection, @ViewBuilder content: () -> Content) -> some View {
        let title = section.title
        var restored = params
        section.restore(&restored, from: defaults)
        restored.disabledSections.remove(section.rawValue)
        let off = params.disabledSections.contains(section.rawValue)
        return InspectorSection(title, open: !InspectorSections.closed(closedSections).contains(title), edited: restored != params,
                                onToggle: { toggle(title) }, onReset: { onChange(restored) },
                                enabled: (on: !off, set: { on in
                                    var p = params
                                    if on { p.disabledSections.remove(section.rawValue) } else { p.disabledSections.insert(section.rawValue) }
                                    onChange(p)
                                }), content: content)
    }
}
#endif

private struct LutPanel: View {
    let params: DevelopParams
    let luts: LutLibrary
    let loading: Bool
    let onChange: (DevelopParams) -> Void
    let onSelect: (String?) -> Void
    /** Rescans the user's folder (after an import or a new folder). */
    var onLutsChanged: () -> Void = {}
    #if os(macOS)
    // Not private: a private stored property would make the memberwise init private too.
    @State var dropping = false
    @State var note: String?
    #endif

    var body: some View {
        #if os(macOS)
        VStack(alignment: .leading, spacing: 0) { list }
            .overlay {
                if dropping {
                    RoundedRectangle(cornerRadius: 6).strokeBorder(Color.accentColor, lineWidth: 2).allowsHitTesting(false)
                }
            }
            .onDrop(of: [.fileURL], isTargeted: $dropping) { providers in
                Task { @MainActor in importLuts(await LutDrop.urls(providers)) }
                return !providers.isEmpty
            }
        #else
        list
        #endif
    }

    @ViewBuilder private var list: some View {
        if params.lut != nil {
            ParamSlider(label: "Strength", value: params.lutAmount, range: 0...100, defaultValue: 100, format: formatPlain) { v in
                var p = params
                p.lutAmount = v
                onChange(p)
            }
        }
        LutRow(name: "No LUT", selected: params.lut == nil, loading: false) { onSelect(nil) }
        ForEach(LookGroup.allCases, id: \.self) { group in
            let list = luts.bundled.filter { Looks.lutGroup($0.id) == group }
            if !list.isEmpty {
                SectionLabel("Included · \(group.label)")
                ForEach(list, id: \.id) { e in
                    LutRow(name: e.name, selected: params.lut == e.id, loading: loading && params.lut == e.id) { onSelect(e.id) }
                }
            }
        }
        #if os(macOS)
        SectionLabel("Your LUTs")
        if luts.user.isEmpty {
            Note("Add .cube or HaldCLUT .png files, drop them here or on the window, or put them in the folder below.")
        }
        ForEach(luts.user, id: \.id) { e in
            LutRow(name: e.name, selected: params.lut == e.id, loading: loading && params.lut == e.id) { onSelect(e.id) }
                .contextMenu {
                    if let folder = luts.folder {
                        Button("Show in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting([folder.appendingPathComponent(String(e.id.dropFirst("file:".count)))])
                        }
                    }
                }
        }
        folderControls
        #else
        SectionLabel("Your LUTs · Files › RawBoy › LUTs")
        if luts.user.isEmpty {
            Note("Put .cube or HaldCLUT .png files into RawBoy's LUTs folder in the Files app.")
        }
        ForEach(luts.user, id: \.id) { e in
            LutRow(name: e.name, selected: params.lut == e.id, loading: loading && params.lut == e.id) { onSelect(e.id) }
        }
        #endif
    }

    #if os(macOS)
    /** Where the user's LUTs live, with Add files, Show in Finder and Choose folder (the web's Add files / Choose folder). */
    @ViewBuilder private var folderControls: some View {
        if let folder = luts.folder {
            Text((folder.path as NSString).abbreviatingWithTildeInPath)
                .font(.caption).foregroundStyle(.secondary).lineLimit(2).truncationMode(.middle)
                .textSelection(.enabled)
                .help(folder.path)
                .padding(.top, 6)
        }
        if let note {
            Note(note)
        }
        HStack(spacing: 8) {
            Button("Add files…", action: addFiles)
                .help("Copies .cube or HaldCLUT .png files into the LUT folder")
            Button("Show in Finder") {
                NSWorkspace.shared.activateFileViewerSelecting([LutRepository.userFolder])
            }
            .help("Opens the LUT folder: files put there show up here")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.top, 4)
        HStack(spacing: 8) {
            Button(LutRepository.customFolder == nil ? "Choose folder…" : "Change folder…", action: chooseFolder)
                .help("Reads your LUTs from a folder of your own instead")
            if LutRepository.customFolder != nil {
                Button("Use RawBoy's folder") {
                    LutRepository.setUserFolder(nil)
                    note = nil
                    onLutsChanged()
                }
                .help((LutRepository.defaultUserFolder.path as NSString).abbreviatingWithTildeInPath)
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.top, 4)
    }

    private func addFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = LutDrop.types
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Choose .cube or HaldCLUT .png files to add to your LUTs"
        panel.prompt = "Add"
        if panel.runModal() == .OK { importLuts(panel.urls) }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = LutRepository.userFolder
        panel.message = "Choose the folder RawBoy reads your .cube and HaldCLUT .png files from"
        panel.prompt = "Use Folder"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        LutRepository.setUserFolder(url)
        note = nil
        onLutsChanged()
    }

    private func importLuts(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        let added = LutRepository.importFiles(urls)
        note = added == 0 ? "No .cube or .png files there." : "Added \(added) LUT\(added == 1 ? "" : "s")."
        onLutsChanged()
    }
    #endif
}

#if os(macOS)
/** Dropped or picked LUT files: the content types the panels take and the file URLs a drop carries. */
enum LutDrop {
    static let types: [UTType] = [UTType(filenameExtension: "cube") ?? .data, .png]

    static func urls(_ providers: [NSItemProvider]) async -> [URL] {
        var urls: [URL] = []
        for provider in providers {
            let url: URL? = await withCheckedContinuation { continuation in
                _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
            }
            if let url { urls.append(url) }
        }
        return urls
    }
}
#endif

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
        .tapButton(selected: selected, hint: "Applies this LUT", action: onTap)
    }
}

struct SectionLabel: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        #if os(macOS)
        // Small caps in ash, as the Viewer's details panel heads its sections: amber headings competed with the values.
        Text(text).font(.caption.weight(.semibold)).textCase(.uppercase).tracking(0.6).foregroundStyle(.secondary)
            .padding(.top, 14).padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
        #else
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor).padding(.top, 12).padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
        #endif
    }
}

struct Note: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View { Text(text).font(.caption).foregroundStyle(.secondary).padding(.vertical, 2) }
}

/**
 * Rotate in 90 degree steps, flip, straighten the horizon, correct perspective (both auto-cropped) and crop, optionally to a fixed aspect ratio.
 */
struct GeometryPanel: View {
    let params: DevelopParams
    let onChange: (DevelopParams) -> Void
    let onRotate: (Int) -> Void
    let onFlip: (_ vertical: Bool) -> Void
    let aspect: CropAspect
    let portrait: Bool
    let sides: ExtendSides
    let onSides: (ExtendSides) -> Void
    let onAspect: (CropAspect, Bool) -> Void
    let onResetCrop: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Crop & rotate").font(.headline)
                Spacer()
                Button("Reset crop", action: onResetCrop).disabled(params.crop.isFull && aspect == .original && !sides.any)
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
            ExtendChips(sides: sides, onSides: onSides)
            ParamSlider(label: "Straighten", value: params.straighten, range: -45...45, defaultValue: 0,
                        format: { String(format: "%+.1f°", abs($0) < 0.05 ? 0 : $0) }) { v in
                var p = params
                p.straighten = v
                onChange(p)
            }
            ParamSlider(label: "Vertical", value: params.perspectiveVertical, range: -100...100, defaultValue: 0) { v in
                var p = params
                p.perspectiveVertical = v.rounded()
                onChange(p)
            }
            ParamSlider(label: "Horizontal", value: params.perspectiveHorizontal, range: -100...100, defaultValue: 0) { v in
                var p = params
                p.perspectiveHorizontal = v.rounded()
                onChange(p)
            }
            ParamSlider(label: "Scale", value: params.scale, range: 100...200, defaultValue: 100,
                        format: { "\(Int(round($0)))%" }) { v in
                var p = params
                p.scale = v
                onChange(p)
            }
            Note("Drag the corners, edges or inside of the frame to crop. Vertical and Horizontal correct perspective: Vertical below 0 widens the top (buildings shot looking up), Horizontal above 0 widens the right side. Straightening and perspective crop automatically so no empty corners show. Resets for each new photo.")
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
                .accessibilityHidden(true)  // the slider carries the label
            slider.sliderWheel(range, value: { value }, onChange)
                .reportsWidth("Pro \(label)")
                .accessibilityLabel(label)
                .accessibilityValue(format(value))
                #if os(macOS)
                .accessibilityHint("Double-click the slider or use Reset to go back to \(format(defaultValue))")
                #else
                .accessibilityHint("Double-tap the slider or use Reset to go back to \(format(defaultValue))")
                #endif
                .accessibilityAction(named: "Reset") { onChange(defaultValue) }
            Text(format(value))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(value == defaultValue ? Color.secondary : changedValueColor)
                .lineLimit(1)
                .frame(width: 74, alignment: .trailing)
                .tapButton(hint: "Resets \(label)") { onChange(defaultValue) }
                .accessibilityLabel("Reset \(label), now \(format(value))")
        }
        #if os(macOS)
        .frame(height: 30)  // a pointer needs less than a finger: more of the panel fits without scrolling
        #else
        .frame(height: 40)
        #endif
    }

    private var clamped: Float { min(max(value, range.lowerBound), range.upperBound) }

    @ViewBuilder private var slider: some View {
        #if os(macOS)
        // The system slider with RawBoy's drawing: filled from the default, quiet when untouched (MacSlider).
        MacSlider(value: value, range: range, defaultValue: defaultValue, gradient: trackGradient, onChange: onChange)
        #else
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
        #endif
    }
}

extension View {
    /** The wheel over this row steps through the film stocks, one per click (RawBoy Desktop; off while Film is). */
    @ViewBuilder func stockWheel(film: String?, onSelect: @escaping (String) -> Void) -> some View {
        #if os(macOS)
        background(StepWheel(enabled: film != nil) { steps in
            let ids = FilmLooks.all.compactMap(\.film)
            if let film, let next = WheelStepper.target(in: ids, current: film, steps: steps) { onSelect(next) }
        })
        #else
        self
        #endif
    }

    /** The wheel over this slider moves it (RawBoy Desktop). */
    @ViewBuilder func sliderWheel(_ range: ClosedRange<Float>, value: @escaping () -> Float, _ onChange: @escaping (Float) -> Void) -> some View {
        #if os(macOS)
        background(SliderWheel(range: range, value: value, onChange: onChange))
        #else
        self
        #endif
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
