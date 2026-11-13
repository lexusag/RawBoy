import AVKit
import RawBoyEngine
import SwiftUI

/** Viewfinder with the look controls, shutter and the last photo. */
struct CameraScreen: View {
    @ObservedObject var vm: CameraViewModel
    @State private var showSettings = false
    @State private var showHelp = false
    @State private var blink = 0.0
    @State private var shutterScale = 1.0
    @State private var holding = false
    /** The focus point when the ring's drag began. */
    @State private var dragStart: CGPoint?
    /** Landscape: what the tall slider changes; Brightness first. */
    @State private var adjust: Adjust = .brightness
    @StateObject private var orientation = InterfaceOrientation()

    /** Width of the landscape controls column (look menu, S/B/W picker and the tall slider) beside the shutter column. */
    private static let landscapeControlsWidth: CGFloat = 232

    private static let viewfinderSpace = "viewfinder"
    /** Grab area around the focus ring (the ring is 72 pt). */
    private static let focusHandleSize: CGFloat = 96
    /** Focus loupe: its side, its distance from the point (clear of the finger) and its magnification. */
    private static let loupeSize: CGFloat = 128
    private static let loupeGap: CGFloat = 64
    private static let loupeZoom: Float = 3

    var body: some View {
        // Portrait: the bar, viewfinder, controls and shutter row stacked. Landscape (the phone turned sideways): the
        // bar's buttons in a column at the left, the viewfinder, then the S/B/W picker with one tall slider and the
        // shutter column at the right edge, all under the right thumb. One layout, so the Metal view stays on a turn.
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            let turns = viewfinderTurns(orientation.value)
            CameraLayout(landscape: landscape, controlsWidth: Self.landscapeControlsWidth) {
                Group {
                    if landscape {
                        VStack(spacing: 0) { barButtons.frame(maxHeight: .infinity) }
                            .frame(width: 52)
                            .padding(.vertical, 8)
                    } else {
                        topBar
                    }
                }
                viewfinder(turns: turns)
                Group {
                    if landscape {
                        landscapeControls
                    } else {
                        // A menu instead of a strip of chips, and one row per slider: the viewfinder keeps the screen.
                        VStack(spacing: 0) {
                            lookPicker
                            ValueSlider("Brightness", value: vm.settings.brightness, range: -100...100, defaultValue: 0,
                                        onChange: vm.setBrightness)
                            if vm.settings.monoMode {
                                FilterRow(selected: vm.settings.filter, onSelect: vm.setFilter)
                            } else {
                                ValueSlider("Warmth", value: vm.settings.warmth, range: -100...100, defaultValue: 0,
                                            onChange: vm.setWarmth)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                    }
                }
                Group {
                    if landscape {
                        // The switch above, the shutter at the middle of the edge, the last photo below.
                        VStack(spacing: 0) {
                            switchButton
                            Spacer()
                            shutterButton
                            Spacer()
                            lastPhoto
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    } else {
                        bottomBar
                    }
                }
            }
        }
        .onAppear { orientation.start() }
        .background(Color.black)
        .foregroundStyle(.white)
        .toast($vm.message)
        .sheet(isPresented: $showSettings) { SettingsSheet(vm: vm) }
        .modifier(HardwareShutter(enabled: !showSettings && !showHelp, action: vm.shutter))
        .onChange(of: vm.shutterCount) { _, _ in
            // Shutter feedback: the viewfinder blinks dark, the shutter button dips, and a haptic tick.
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            shutterScale = 0.85
            withAnimation(.easeOut(duration: 0.22)) { shutterScale = 1 }
            blink = 0.85
            withAnimation(.easeOut(duration: 0.2)) { blink = 0 }
        }
    }

    private var topBar: some View {
        HStack(spacing: 18) {
            Text(statusText).font(.caption).foregroundStyle(Color.cameraAccent)
            Spacer()
            barButtons
        }
        .font(.title3)
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    private var statusText: String { vm.pending > 0 ? "Saving \(vm.pending)…" : "" }

    /** RAW, flash, help and Settings: a row on top in portrait, a column at the left in landscape. */
    @ViewBuilder private var barButtons: some View {
        Group {
            Button { vm.setKeepDng(!vm.settings.keepDng) } label: {
                Text("RAW").font(.caption.bold()).strikethrough(!vm.settings.keepDng)
                    .foregroundStyle(vm.settings.keepDng ? Color.cameraAccent : .white.opacity(0.6))
            }
            .accessibilityLabel("Keep RAW (DNG)")
            Button(action: vm.togglePhotoFrame) {
                Image(systemName: "photo.artframe")
                    .foregroundStyle(vm.settings.photoFrame != .none ? Color.cameraAccent : .white.opacity(0.6))
            }
            .accessibilityLabel("Frames")
            .accessibilityValue(vm.settings.photoFrame != .none ? vm.settings.photoFrame.label : "Off")
            if vm.flashAvailable {
                Button(action: vm.toggleFlash) {
                    Image(systemName: vm.settings.flash == .on ? "bolt.fill" : "bolt.slash")
                        .foregroundStyle(vm.settings.flash == .on ? Color.cameraAccent : .white)
                }
                .accessibilityLabel(vm.settings.flash == .on ? "Flash on" : "Flash off")
            }
            HelpButton(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "RawBoy Camera",
                       sections: cameraHelp, isPresented: $showHelp)
            Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
        }
        .font(.title3)
        .frame(minWidth: 32, minHeight: 44)
    }

    /**
     * Where the focus ring at `p` can be grabbed: a drag moves the point (with a loupe) and focuses there on release, a
     * tap focuses at the tap as anywhere else. It sits above the viewfinder's own gestures, so a drag here doesn't also
     * start the press-and-hold comparison.
     */
    private func focusHandle(_ p: CGPoint, _ size: CGSize) -> some View {
        Color.clear
            .frame(width: Self.focusHandleSize, height: Self.focusHandleSize)
            .contentShape(Circle())
            .gesture(SpatialTapGesture(coordinateSpace: .named(Self.viewfinderSpace)).onEnded { tap in
                vm.focusAt(tap.location.x / size.width, tap.location.y / size.height)
            })
            .simultaneousGesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .named(Self.viewfinderSpace))
                    .onChanged { drag in
                        // From where the point was, not where the finger landed on the ring.
                        guard let start = dragStart ?? vm.focusPoint else { return }
                        if dragStart == nil { dragStart = start }
                        let point = CGPoint(x: start.x + drag.translation.width / size.width,
                                            y: start.y + drag.translation.height / size.height)
                        vm.dragFocus(point.x, point.y, loupe: Self.loupe(at: point, in: size))
                    }
                    .onEnded { _ in
                        dragStart = nil
                        vm.endDragFocus()
                    }
            )
            .position(x: p.x * size.width, y: p.y * size.height)
    }

    /**
     * The loupe for a drag at `p` (normalised) of a viewfinder of `size`: a square loupeGap above the point (under the
     * finger otherwise), or below it near the top, kept inside the view.
     */
    private static func loupe(at p: CGPoint, in size: CGSize) -> ViewfinderRenderer.Loupe? {
        guard size.width > 0, size.height > 0 else { return nil }
        let s = min(loupeSize, size.width, size.height)
        let above = p.y * size.height - loupeGap - s / 2
        let cy = above >= s / 2 ? above : p.y * size.height + loupeGap + s / 2
        let cx = min(max(p.x * size.width, s / 2), size.width - s / 2)
        return ViewfinderRenderer.Loupe(
            x: Float(p.x), y: Float(p.y), centerX: Float(cx / size.width),
            centerY: Float(min(max(cy, s / 2), size.height - s / 2) / size.height), size: Float(s / size.width),
            zoom: loupeZoom)
    }

    // Viewfinder, at the raw's aspect ratio, in whatever height the controls leave.
    private func viewfinder(turns: Int) -> some View {
        ZStack {
            Color.black
            ZStack {
                Color(white: 0.04)
                // The picture, taps, focus ring and loupe in the upright picture's coordinates, turned with it.
                Turned(turns: turns) {
                    ZStack {
                        Viewfinder(renderer: vm.renderer)
                        GeometryReader { geo in
                            Color.clear.contentShape(Rectangle())
                                // Tap: focus lock at that point (a new tap moves it; the AF LOCK badge releases it).
                                .onTapGesture { p in vm.focusAt(p.x / geo.size.width, p.y / geo.size.height) }
                                // Press and hold: the auto develop without the look.
                                .onLongPressGesture(minimumDuration: 0.25, perform: {}, onPressingChanged: { pressing in
                                    if pressing {
                                        holding = true
                                        Task {
                                            try? await Task.sleep(nanoseconds: 250_000_000)
                                            if holding { vm.setCompare(true) }
                                        }
                                    } else {
                                        holding = false
                                        if vm.compare { vm.setCompare(false) }
                                    }
                                })
                            // While the ring is dragged it shows there, with a loupe; it focuses on release.
                            if let p = vm.dragPoint ?? vm.focusPoint {
                                let state = vm.controller.frames
                                FocusRing(scanning: vm.dragPoint == nil && state.focusing,
                                          box: CGFloat(state.focusBox) * min(geo.size.width, geo.size.height))
                                    .position(x: p.x * geo.size.width, y: p.y * geo.size.height)
                                focusHandle(p, geo.size)
                                if vm.dragPoint != nil, let l = Self.loupe(at: p, in: geo.size) {
                                    let side = CGFloat(l.size) * geo.size.width
                                    LoupeFrame(box: CGFloat(state.focusBox) * min(geo.size.width, geo.size.height) * CGFloat(l.zoom))
                                        .frame(width: side, height: side)
                                        .position(x: CGFloat(l.centerX) * geo.size.width, y: CGFloat(l.centerY) * geo.size.height)
                                }
                            }
                        }
                        .coordinateSpace(.named(Self.viewfinderSpace))
                        if vm.settings.showLevel, let tilt = vm.tilt { LevelOverlay(tilt: tilt) }
                    }
                }
                switch vm.status {
                case .needsPermission:
                    Button("Allow camera") { vm.openSettingsApp() }.buttonStyle(.borderedProminent)
                case .opening:
                    ProgressView()
                case .failed:
                    Text("Camera unavailable").foregroundStyle(.red)
                case .ready:
                    EmptyView()
                }
                if vm.lenses.count > 1 {
                    LensSelector(labels: vm.lenses.map(\.label), selected: vm.settings.lens, onSelect: vm.selectLens)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 16)
                }
                // Above the lens selector, out of the way of the focus ring and the top badges.
                if let code = vm.qrCode {
                    QrBar(code: code, onOpen: { vm.openQr(code) }, onDismiss: vm.dismissQr)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.horizontal, 16)
                        .padding(.bottom, vm.lenses.count > 1 ? 84 : 16)
                }
                if vm.focusPoint != nil {
                    Button { vm.releaseFocus() } label: {
                        Text(vm.tracking ? "TRACKING  ✕" : "AF LOCK  ✕")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color(red: 1, green: 0.84, blue: 0.31)))
                            .frame(minWidth: 120, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 8)
                }
                if vm.compare {
                    OverlayLabel("Without look").frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
                // Top right: the histogram (Settings), then the raw format when it isn't the chosen one.
                VStack(alignment: .trailing, spacing: 0) {
                    if vm.settings.showHistogram {
                        HistogramView(histogram: vm.histogram)
                            .frame(width: 120, height: 48)
                            .padding([.top, .trailing], 12)
                            .allowsHitTesting(false)
                    }
                    if vm.recording != vm.settings.rawFormat {
                        OverlayLabel(vm.recording == .proRaw ? "ProRAW" : "RAW")
                            .padding(.top, vm.settings.showHistogram ? -6 : 0)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                if vm.settings.showGrid { GridOverlay() }
                Color.black.opacity(blink).allowsHitTesting(false)
            }
            .aspectRatio(turns % 2 == 1 ? 1 / vm.aspect : vm.aspect, contentMode: .fit)
        }
    }

    private var bottomBar: some View {
        HStack {
            lastPhoto
            Spacer()
            shutterButton
            Spacer()
            switchButton
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 8)
    }

    private var lastPhoto: some View {
        Group {
            if let shot = vm.lastShot {
                Image(uiImage: shot).resizable().scaledToFill()
                    .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 8))
                    // The photo is in Photos; open the app there.
                    .onTapGesture { if let url = URL(string: "photos-redirect://") { UIApplication.shared.open(url) } }
            } else {
                Color.clear
            }
        }
        .frame(width: 56, height: 56)
    }

    private var shutterButton: some View {
        Button(action: vm.shutter) {
            Circle().fill(vm.status == .ready ? Color.white : .gray).padding(8)
                .overlay(Circle().stroke(vm.status == .ready ? Color.white : .gray, lineWidth: 4))
                .frame(width: 76, height: 76)
        }
        .disabled(vm.status != .ready)
        .scaleEffect(shutterScale)
        .accessibilityLabel("Shutter")
    }

    private var switchButton: some View {
        Group {
            if vm.frontAvailable {
                Button(action: vm.switchFacing) {
                    Image(systemName: "arrow.triangle.2.circlepath.camera").font(.title2)
                        .frame(width: 56, height: 56)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Color(white: 0.16)))
                }
                .disabled(vm.status == .opening)
                .accessibilityLabel(vm.settings.front ? "Back camera" : "Selfie camera")
            } else {
                Color.clear
            }
        }
        .frame(width: 56, height: 56)
    }

    // B&W mode lists only the mono stocks (Film on or not) and has Filter where Warmth is. Film mode lists the film stocks.
    private var lookPicker: some View {
        LookPicker(looks: vm.settings.monoMode ? Edition.monoLooks : vm.settings.filmMode ? Edition.filmLooks : Edition.looks,
                   selectedId: vm.settings.look.id, onSelect: vm.setLook,
                   film: vm.settings.film,
                   onFilm: vm.setFilm,
                   mono: Edition.monoLooks.isEmpty ? nil : vm.settings.monoMode,
                   onMono: vm.setMono)
    }

    /**
     * Landscape controls, all within the right thumb's reach: the status line and the look row on top; below, round
     * B / W chips (F, the filter, in B&W mode) pick what the tall slider beside the shutter changes. With F picked
     * the filters stand there instead of the slider. A double tap on a chip or the slider resets that setting.
     */
    private var landscapeControls: some View {
        let s = vm.settings
        return VStack(alignment: .leading, spacing: 0) {
            Text(statusText).font(.caption).foregroundStyle(Color.cameraAccent).frame(height: 16)
            lookPicker
            HStack(spacing: 8) {
                VStack(spacing: 12) {
                    AdjustChip(letter: "B", name: "Brightness", value: Self.signed(s.brightness), selected: adjust == .brightness,
                               onSelect: { adjust = .brightness }, onReset: { vm.setBrightness(0) })
                    if s.monoMode {
                        AdjustChip(letter: "F", name: "Filter", value: s.filter.label, selected: adjust == .warmth,
                                   onSelect: { adjust = .warmth }, onReset: { vm.setFilter(.off) })
                    } else {
                        AdjustChip(letter: "W", name: "Warmth", value: Self.signed(s.warmth), selected: adjust == .warmth,
                                   onSelect: { adjust = .warmth }, onReset: { vm.setWarmth(0) })
                    }
                }
                .frame(maxWidth: .infinity)
                if adjust == .warmth && s.monoMode {
                    FilterColumn(selected: s.filter, onSelect: vm.setFilter)
                } else {
                    switch adjust {
                    case .brightness:
                        VerticalSlider(label: "Brightness", value: s.brightness, range: -100...100, defaultValue: 0, onChange: vm.setBrightness)
                    case .warmth:
                        VerticalSlider(label: "Warmth", value: s.warmth, range: -100...100, defaultValue: 0, onChange: vm.setWarmth)
                    }
                }
            }
            .frame(maxHeight: .infinity)
            .padding(.top, 8)
        }
        .padding(.leading, 4)
        .padding(.vertical, 8)
    }

    /** Whole numbers, + on positive values (Android's formatSliderValue). */
    private static func signed(_ v: Float) -> String {
        let n = Int(v.rounded())
        return n > 0 ? "+\(n)" : "\(n)"
    }
}

/** UW · W · T: the selected lens in a filled circle. */
/**
 * A QR code the viewfinder sees, as the system camera shows it: what it holds and what a tap does
 * ("example.com  Open"), with ✕ to hide it until the code leaves the view.
 */
private struct QrBar: View {
    let code: QrPayload
    let onOpen: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onOpen) {
                HStack(spacing: 8) {
                    Image(systemName: "qrcode").font(.subheadline)
                    Text(code.label).font(.subheadline).lineLimit(1).truncationMode(.tail)
                    Text(code.verb).font(.subheadline.weight(.semibold)).foregroundStyle(Color.accentColor)
                }
                .padding(.leading, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("QR code: \(code.label), \(code.verb)")
            Button(action: onDismiss) {
                Text("✕").font(.subheadline).foregroundStyle(.white.opacity(0.7))
                    .frame(width: 44, height: 40)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Hide QR code")
        }
        // Plain: Button Shapes would draw a capsule behind each half.
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .background(Capsule().fill(Color.black.opacity(0.8)))
        .frame(maxWidth: 360)
    }
}

private struct LensSelector: View {
    let labels: [String]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(labels, id: \.self) { label in
                let isSelected = label == selected
                Text(label).font(.subheadline.weight(.semibold))
                    .foregroundStyle(isSelected ? .black : .white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(isSelected ? Color(white: 0.82) : .clear))
                    .contentShape(Circle())
                    .onTapGesture { onSelect(label) }
            }
        }
        .padding(4)
        .background(Capsule().fill(Color.black.opacity(0.6)))
    }
}

/**
 * Focus lock ring: pulsing while focusing. The ring is about the metered spot; the square inside it is the AF box
 * (`box` points: the focus rectangle on iOS 26); a dot when AF uses about the ring's area.
 */
private struct FocusRing: View {
    let scanning: Bool
    let box: CGFloat
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle().stroke(Color.white, lineWidth: 2).frame(width: 72, height: 72)
            if box < 56 {
                Rectangle().stroke(Color.white, lineWidth: 1.5).frame(width: box, height: box)
            } else {
                Circle().fill(Color.white).frame(width: 6, height: 6)  // AF uses about the ring
            }
        }
        .opacity(scanning && pulse ? 0.4 : 1)
        .onAppear { withAnimation(.easeInOut(duration: 0.35).repeatForever()) { pulse = true } }
        .allowsHitTesting(false)
    }
}

/** The focus loupe's frame (the renderer draws the image inside it), with the AF box magnified at its centre. */
private struct LoupeFrame: View {
    let box: CGFloat

    var body: some View {
        ZStack {
            Rectangle().stroke(Color.white, lineWidth: 2)
            Rectangle().stroke(Color.white, lineWidth: 1).frame(width: box, height: box)
        }
        .allowsHitTesting(false)
    }
}

/**
 * Colour / black and white switch: "B&W", filled while B&W mode is on. B&W mode keeps its own stock and filter, and
 * colour mode its look and warmth, so the two can be swapped back and forth. Mirrors Android's MonoToggle.
 */
private struct MonoToggle: View {
    let on: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button { onChange(!on) } label: {
            Text("B&W").font(.caption.weight(.semibold))
                .foregroundStyle(on ? Color.black : Color.white)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? Color.white : Color(white: 0.16)))
        }
        .accessibilityLabel("Black and white")
        .accessibilityValue(on ? "On" : "Off")
    }
}

/**
 * The Film toggle (a film strip, filled while Film mode is on): the film stocks or the LUT looks. Each mode keeps its own
 * pick, so the two can be swapped back and forth. It sits next to B&W, left of the Look menu; turning it on in B&W mode
 * leaves B&W. Mirrors Android's FilmToggle.
 */
private struct FilmToggle: View {
    let on: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button { onChange(!on) } label: {
            Image(systemName: "film").font(.system(size: 17, weight: .semibold))
                .foregroundStyle(on ? Color.black : Color.white)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? Color.white : Color(white: 0.16)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Film stocks")
        .accessibilityValue(on ? "On" : "Off")
    }
}

/** B&W mode's colour filter: one capsule per BwFilter, a dot of its colour before the name; scrolls on narrow screens. */
private struct FilterRow: View {
    let selected: BwFilter
    let onSelect: (BwFilter) -> Void

    static func dot(_ f: BwFilter) -> Color? {
        switch f {
        case .off: return nil
        case .yellow: return Color(red: 0.91, green: 0.77, blue: 0)
        case .orange: return Color(red: 0.94, green: 0.54, blue: 0)
        case .red: return Color(red: 0.82, green: 0.13, blue: 0.13)
        case .green: return Color(red: 0.13, green: 0.67, blue: 0.13)
        }
    }

    var body: some View {
        // A menu like the Look picker above it: the chips ran off the edge on phones. Turned sideways, FilterColumn
        // shows them all.
        HStack(spacing: 8) {
            Text("Filter").font(.subheadline).frame(width: 88, alignment: .leading)
            Picker("Filter", selection: Binding(get: { selected }, set: { onSelect($0) })) {
                ForEach(BwFilter.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            .tint(Color.cameraAccent)
            Spacer()
        }
        .frame(height: ValueSlider.rowHeight)
    }
}

/** The look, picked from a menu (Pro's stock picker). */
private struct LookPicker: View {
    let looks: [Look]
    let selectedId: String
    let onSelect: (String) -> Void
    /** The Film and B&W toggles' states, side by side in the label's place; nil = no such toggle. */
    var film: Bool? = nil
    var onFilm: (Bool) -> Void = { _ in }
    var mono: Bool? = nil
    var onMono: (Bool) -> Void = { _ in }

    var body: some View {
        HStack(spacing: 8) {
            if film == nil && mono == nil {
                Text("Look").font(.subheadline).frame(width: 88, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    if let film { FilmToggle(on: film, onChange: onFilm) }
                    if let mono { MonoToggle(on: mono, onChange: onMono) }
                }
                .frame(width: 88, alignment: .leading)
            }
            Picker("Look", selection: Binding(get: { selectedId }, set: { onSelect($0) })) {
                // Colour, experimental and black and white looks under their own headings, when the list has several.
                let sections = Looks.sections(looks)
                if sections.count < 2 {
                    ForEach(looks) { Text($0.name).tag($0.id) }
                } else {
                    ForEach(sections) { s in
                        Section(s.group.label) { ForEach(s.looks) { Text($0.name).tag($0.id) } }
                    }
                }
            }
            .pickerStyle(.menu)
            .tint(Color.cameraAccent)
            Spacer()
        }
        .frame(height: ValueSlider.rowHeight)
    }
}

private struct SettingsSheet: View {
    @ObservedObject var vm: CameraViewModel

    /** A switch with a one-line hint; same rows and wording as Android's Settings. */
    private func row(_ title: String, _ hint: String?, _ isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func slider(_ title: String, value: Double, range: ClosedRange<Double>, set: @escaping (Double) -> Void) -> some View {
        HStack {
            Text(title)
            Slider(value: Binding(get: { value }, set: { set($0.rounded()) }), in: range, step: 1)
            Text("\(Int(value))").foregroundStyle(Color.cameraAccent).monospacedDigit().frame(width: 36, alignment: .trailing)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Photo") {
                    slider("JPEG quality", value: Double(vm.settings.jpegQuality), range: Double(CameraSettings.minQuality)...100) {
                        vm.setJpegQuality(Int($0))
                    }
                    slider("Look strength", value: Double(vm.settings.strength), range: 0...100) { vm.setStrength(Float($0)) }
                    row("Smaller photos", "\(CameraSettings.smallLongSide) px long side; off saves full size",
                        Binding(get: { vm.settings.smallExport }, set: vm.setSmallExport))
                    row("Keep raw (DNG)", "Saved to Photos › RawBoy Camera RAW",
                        Binding(get: { vm.settings.keepDng }, set: vm.setKeepDng))
                    Picker("Raw format", selection: Binding(get: { vm.settings.rawFormat }, set: vm.setRawFormat)) {
                        Text("ProRAW: cleaner in low light").tag(RawFormat.proRaw)
                        Text("RAW: single exposure").tag(RawFormat.bayer)
                    }
                    NavigationLink {
                        FramesSettingsView(vm: vm)
                    } label: {
                        HStack {
                            Text("Frames")
                            Spacer()
                            Text(vm.settings.photoFrame.label).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Capture") {
                    // Where the law requires the click, iOS plays it anyway: shown on and locked.
                    row("Shutter sound", vm.shutterSoundRequired ? "Required on this iPhone" : nil,
                        Binding(get: { vm.settings.shutterSound || vm.shutterSoundRequired }, set: vm.setShutterSound))
                        .disabled(vm.shutterSoundRequired)
                    row("Geotag", "GPS position in the JPEG and DNG", Binding(get: { vm.settings.geotag }, set: vm.setGeotag))
                    row("Track subject after tap", "Focus follows what you tapped",
                        Binding(get: { vm.settings.trackFocus }, set: vm.setTrackFocus))
                    row("QR codes", "Tap to open a link or copy the text or Wi-Fi password",
                        Binding(get: { vm.settings.scanQr }, set: vm.setScanQr))
                }
                Section("Viewfinder") {
                    row("Grid", nil, Binding(get: { vm.settings.showGrid }, set: vm.setShowGrid))
                    row("Level", nil, Binding(get: { vm.settings.showLevel }, set: vm.setShowLevel))
                    row("Histogram", nil, Binding(get: { vm.settings.showHistogram }, set: vm.setShowHistogram))
                }
                Section("Opening the camera") {
                    row("Remember camera & settings", "Off: each start uses W, Yellow Portrait 400, default sliders",
                        Binding(get: { vm.settings.rememberLast }, set: vm.setRememberLast))
                }
                Section {
                    ForEach(Edition.credits, id: \.self) { line in
                        Text(line).font(.caption).foregroundStyle(.secondary)
                    }
                    NavigationLink("Open-source licences") { LicensesView() }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

private struct FramesSettingsView: View {
    @ObservedObject var vm: CameraViewModel

    var body: some View {
        Form {
            Section {
                Picker("Frame", selection: Binding(get: { vm.settings.photoFrame }, set: vm.setPhotoFrame)) {
                    ForEach(PhotoFrame.allCases, id: \.self) { frame in
                        Text(frame.label).tag(frame)
                    }
                }
                .pickerStyle(.inline)
            } footer: {
                switch vm.settings.photoFrame {
                case .none:
                    Text("Choose either a film frame or a date stamp.")
                case .dateStamp:
                    Text("Imprints today's date in the bottom-right corner.")
                case .pentax645:
                    Text("Adds a black film rebate with today's frame #, mode (FILM / LOOK / BW), shutter speed, aperture, EV, metering, and focal length.")
                }
            }
            if vm.settings.photoFrame == .dateStamp {
                Section {
                    Picker("Date format", selection: Binding(
                        get: { vm.settings.dateStampFormat == .mmmYy ? .dmy : vm.settings.dateStampFormat },
                        set: vm.setDateStampFormat
                    )) {
                        ForEach([DateStampFormat.dmy, .ymd, .mdy], id: \.self) { fmt in
                            Text(fmt.label).tag(fmt)
                        }
                    }
                }
            }
            if vm.settings.photoFrame == .pentax645 {
                Section {
                    Toggle(isOn: Binding(get: { vm.settings.pentax645Flip }, set: vm.setPentax645Flip)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Flip info upside down")
                            Text("Rotate shoot info 180° like on real film").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tint(Color.cameraAccent)
                    if vm.settings.pentax645Fields.contains(.date) {
                        Picker("Date format", selection: Binding(get: { vm.settings.dateStampFormat }, set: vm.setDateStampFormat)) {
                            ForEach(DateStampFormat.allCases, id: \.self) { fmt in
                                Text(fmt.label).tag(fmt)
                            }
                        }
                    }
                    if vm.settings.pentax645Fields.contains(.time) {
                        Picker("Time format", selection: Binding(get: { vm.settings.timeStampFormat }, set: vm.setTimeStampFormat)) {
                            ForEach(TimeStampFormat.allCases, id: \.self) { fmt in
                                Text(fmt.label).tag(fmt)
                            }
                        }
                    }
                }
                Section("Shoot info (drag to reorder)") {
                    ForEach(vm.settings.pentax645Order, id: \.self) { field in
                        Toggle(field.label, isOn: Binding(
                            get: { vm.settings.pentax645Fields.contains(field) },
                            set: { vm.setPentax645Field(field, $0) }
                        ))
                        .tint(Color.cameraAccent)
                    }
                    .onMove { source, destination in
                        vm.movePentax645Fields(fromOffsets: source, toOffset: destination)
                    }
                }
                .environment(\.editMode, .constant(.active))
            }
        }
        .navigationTitle("Frames")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/**
 * Volume up / down and the Camera Control button take a photo (one per press, on release), as Android's volume keys;
 * no volume change while the camera runs. Not while the settings or the help are open. iOS 18+ (the SwiftUI capture event).
 */
private struct HardwareShutter: ViewModifier {
    let enabled: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onCameraCaptureEvent(isEnabled: enabled) { event in
                if event.phase == .ended { action() }
            }
        } else {
            content
        }
    }
}

/** What the landscape slider changes: Brightness or Warmth (Filter in B&W mode). */
private enum Adjust { case brightness, warmth }

/** A round picker chip: the setting's letter with its value under it; filled while its setting is on the slider. */
private struct AdjustChip: View {
    let letter: String
    let name: String
    let value: String
    let selected: Bool
    let onSelect: () -> Void
    let onReset: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text(letter).font(.subheadline.bold())
            Text(value).font(.caption2).lineLimit(1).minimumScaleFactor(0.7).opacity(0.8)
        }
        .foregroundStyle(selected ? Color.black : .white)
        .frame(width: 48, height: 48)
        .background(Circle().fill(selected ? Color.cameraAccent : Color(white: 0.16)))
        .contentShape(Circle())
        .onTapGesture(count: 2) {
            onSelect()
            onReset()
        }
        .onTapGesture(perform: onSelect)
        // VoiceOver: the setting's name and value; a tap puts it on the slider, an action resets it (the double tap).
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue(value)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { onSelect() }
        .accessibilityAction(named: "Reset") {
            onSelect()
            onReset()
        }
    }
}

/** B&W filters as a column beside the shutter (landscape's F): a dot of each filter's colour before its name. */
private struct FilterColumn: View {
    let selected: BwFilter
    let onSelect: (BwFilter) -> Void

    var body: some View {
        VStack(spacing: 6) {
            ForEach(BwFilter.allCases, id: \.self) { f in
                let on = f == selected
                Button { onSelect(f) } label: {
                    HStack(spacing: 4) {
                        if let c = FilterRow.dot(f) { Circle().fill(c).frame(width: 8, height: 8) }
                        Text(f.label).font(.footnote)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .frame(width: 92, height: 30)
                    .foregroundStyle(on ? Color.black : Color.white)
                    .background(Capsule().fill(on ? Color.white : Color(white: 0.16)))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

/**
 * A tall slider for the thumb: dragging moves the value by the distance dragged (it doesn't jump to where the finger
 * lands), a double tap resets it to `defaultValue`. A signed range fills from 0. Port of Android's `VerticalSlider`.
 */
private struct VerticalSlider: View {
    let label: String
    let value: Float
    let range: ClosedRange<Float>
    let defaultValue: Float
    let onChange: (Float) -> Void
    @State private var dragFrom: Float?

    private static let thumb: CGFloat = 24
    private static let track: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            let span = range.upperBound - range.lowerBound
            let travel = max(geo.size.height - Self.thumb, 1)
            let y = { (v: Float) -> CGFloat in Self.thumb / 2 + travel * CGFloat(1 - (v - range.lowerBound) / span) }
            let at = y(min(max(value, range.lowerBound), range.upperBound))
            let signed = range.lowerBound < 0 && range.upperBound > 0
            let from = signed ? y(0) : y(range.lowerBound)
            ZStack(alignment: .topLeading) {
                Capsule().fill(Color(white: 0.33))
                    .frame(width: Self.track, height: travel)
                    .position(x: geo.size.width / 2, y: Self.thumb / 2 + travel / 2)
                Rectangle().fill(Color.cameraAccent)
                    .frame(width: Self.track, height: abs(from - at))
                    .position(x: geo.size.width / 2, y: (from + at) / 2)
                if signed {
                    Rectangle().fill(Color.white.opacity(0.6))
                        .frame(width: Self.track * 2, height: 2)
                        .position(x: geo.size.width / 2, y: from)
                }
                Circle().fill(Color.cameraAccent)
                    .frame(width: Self.thumb, height: Self.thumb)
                    .position(x: geo.size.width / 2, y: at)
            }
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { onChange(defaultValue) }
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { g in
                        let start = dragFrom ?? value
                        if dragFrom == nil { dragFrom = start }
                        let v = start - Float(g.translation.height / travel) * span
                        onChange(min(max(v, range.lowerBound), range.upperBound).rounded())
                    }
                    .onEnded { _ in dragFrom = nil }
            )
        }
        .frame(width: 48)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(value.rounded()))")
        .accessibilityAction(named: "Reset") { onChange(defaultValue) }
        .accessibilityAdjustableAction { direction in
            let step: Float = direction == .increment ? 5 : -5
            onChange(min(max(value + step, range.lowerBound), range.upperBound))
        }
    }
}

/**
 * Lays the content out at this view's size turned by `turns` clockwise quarter turns and turns it: in its own
 * coordinates it stays upright-portrait, so the viewfinder's tap points, focus ring and loupe need no change. Port of
 * Android's `Modifier.turned`.
 */
private struct Turned<Content: View>: View {
    let turns: Int
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { geo in
            let odd = turns % 2 == 1
            content
                .frame(width: odd ? geo.size.height : geo.size.width, height: odd ? geo.size.width : geo.size.height)
                .rotationEffect(.degrees(Double(turns) * 90))
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

/**
 * Clockwise quarter turns from the upright viewfinder picture (as the portrait screen shows it) to the window for an
 * interface `orientation`. The camera turns with the phone, so the picture stays put on the glass while the UI turns:
 * landscapeRight (phone turned anticlockwise) turns it back anticlockwise (3). The selfie picture turns the same way
 * (the other way showed it upside down on the Pixel). Port of Android's `viewfinderTurns`.
 */
private func viewfinderTurns(_ orientation: UIInterfaceOrientation) -> Int {
    let r: Int
    switch orientation {
    case .landscapeRight: r = 1 // Android's ROTATION_90
    case .portraitUpsideDown: r = 2
    case .landscapeLeft: r = 3
    default: r = 0
    }
    return (4 - r) % 4
}

/** The window scene's interface orientation, kept up to date (a turn from one landscape to the other changes no size). */
@MainActor
private final class InterfaceOrientation: ObservableObject {
    @Published private(set) var value: UIInterfaceOrientation = .portrait
    private var observation: NSKeyValueObservation?

    func start() {
        guard observation == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        value = scene.effectiveGeometry.interfaceOrientation
        observation = scene.observe(\.effectiveGeometry, options: [.new]) { [weak self] scene, _ in
            let o = scene.effectiveGeometry.interfaceOrientation
            Task { @MainActor in self?.value = o }
        }
    }
}

/**
 * The camera screen's four parts in one layout, so the viewfinder's Metal view stays when the phone turns. Portrait:
 * the bar on top, then the viewfinder in the height the others leave, the controls and the shutter row under it.
 * Landscape: the bar a column at the left edge, the viewfinder, the controls a `controlsWidth` column and the shutter
 * column at the right edge, where the right thumb is. Port of Android's `CameraLayout`.
 */
private struct CameraLayout: Layout {
    let landscape: Bool
    let controlsWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        proposal.replacingUnspecifiedDimensions()
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 4 else { return }
        let bar = subviews[0], viewfinder = subviews[1], controls = subviews[2], shutter = subviews[3]
        let w = bounds.width, h = bounds.height
        if landscape {
            let barW = bar.sizeThatFits(ProposedViewSize(width: nil, height: h)).width
            let shutterW = shutter.sizeThatFits(ProposedViewSize(width: nil, height: h)).width
            let cw = min(controlsWidth, w * 0.3)
            let vw = max(w - barW - cw - shutterW, 0)
            bar.place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: barW, height: h))
            viewfinder.place(at: CGPoint(x: bounds.minX + barW, y: bounds.minY), proposal: ProposedViewSize(width: vw, height: h))
            controls.place(at: CGPoint(x: bounds.maxX - shutterW - cw, y: bounds.minY), proposal: ProposedViewSize(width: cw, height: h))
            shutter.place(at: CGPoint(x: bounds.maxX - shutterW, y: bounds.minY), proposal: ProposedViewSize(width: shutterW, height: h))
        } else {
            let barH = bar.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            let shutterH = shutter.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            let controlsH = controls.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            let vh = max(h - barH - shutterH - controlsH, 0)
            bar.place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: w, height: barH))
            viewfinder.place(at: CGPoint(x: bounds.minX, y: bounds.minY + barH), proposal: ProposedViewSize(width: w, height: vh))
            controls.place(at: CGPoint(x: bounds.minX, y: bounds.minY + barH + vh), proposal: ProposedViewSize(width: w, height: controlsH))
            shutter.place(at: CGPoint(x: bounds.minX, y: bounds.maxY - shutterH), proposal: ProposedViewSize(width: w, height: shutterH))
        }
    }
}

/// Thin lines at the thirds of the viewfinder; they take no touches.
private struct GridOverlay: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            for i in 1...2 {
                let x = size.width * CGFloat(i) / 3, y = size.height * CGFloat(i) / 3
                path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: size.height))
                path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: size.width, y: y))
            }
            context.stroke(path, with: .color(.white.opacity(0.45)), lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}

/// A horizon line through the middle of the viewfinder, turned against the phone's tilt (continuous degrees clockwise
/// from upright portrait). Yellow within one degree of the nearest 90° upright, with a short fixed mark each side
/// along that axis to compare it with.
private struct LevelOverlay: View {
    let tilt: Double
    /// Straight is entered within one degree and left past 1.5, so the colour doesn't flicker on the edge.
    @State private var level = false

    var body: some View {
        let colour: Color = level ? Color(red: 1, green: 0.84, blue: 0.31) : .white.opacity(0.7)
        let nearest = (tilt / 90).rounded() * 90
        // The line is a view turned with rotationEffect (a Canvas redraws without interpolating), so the spring can animate it.
        GeometryReader { geo in
            let half = min(geo.size.width, geo.size.height) * 0.22
            ZStack {
                Canvas { context, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    var marks = Path()
                    marks.move(to: CGPoint(x: c.x - half * 1.5, y: c.y)); marks.addLine(to: CGPoint(x: c.x - half * 1.25, y: c.y))
                    marks.move(to: CGPoint(x: c.x + half * 1.25, y: c.y)); marks.addLine(to: CGPoint(x: c.x + half * 1.5, y: c.y))
                    var turned = context
                    turned.translateBy(x: c.x, y: c.y)
                    turned.rotate(by: .degrees(-nearest))
                    turned.translateBy(x: -c.x, y: -c.y)
                    turned.stroke(marks, with: .color(colour.opacity(0.5)), lineWidth: 2)
                }
                Rectangle().fill(colour).frame(width: half * 2, height: 2)
                    .rotationEffect(.degrees(-tilt))
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .animation(.spring(response: 0.25, dampingFraction: 1), value: tilt)
        .animation(.easeInOut(duration: 0.15), value: level)
        .onChange(of: tilt, initial: true) { _, t in
            let nearest = (t / 90).rounded() * 90
            level = abs(t - nearest) <= (level ? 1.5 : 1)
        }
        .allowsHitTesting(false)
    }
}
