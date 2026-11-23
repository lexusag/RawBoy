import RawBoyEngine
import SwiftUI

/** The editor's top-bar tools; at most one replaces the slider tabs. */
enum EditorMode { case none, geometry, masks, leaks, fx, heal, presets }

/** Frame around the photo in the fit view, points (tap outside the photo to change its colour). */
private let frameWidthPt: CGFloat = 12
/** Empty space around the frame while masking or placing light leaks: handles can sit beyond the photo. */
private let maskMarginPt: CGFloat = 16
/** Slider panels' height cap under the photo (portrait): the rest of the screen goes to the photo. */
private let panelMax: CGFloat = 320
/** The histogram above the slider tabs. */
private let histogramHeight: CGFloat = 56

struct EditorScreen: View {
    @ObservedObject var vm: EditorViewModel
    @ObservedObject var session: PhotoSession
    /** nil (RawBoy Desktop): there is only one place to open from. */
    let openFromPhotos: (() -> Void)?
    let openFromFiles: () -> Void
    /** Menu, keyboard and export hooks of RawBoy Desktop; unused on iOS. */
    @ObservedObject var commands = EditorCommands()

    @Environment(\.displayScale) private var scale
    @State private var showExport = false
    @State private var showHelp = false
    @State private var showOriginal = false
    /** Before/after slider (RawBoy Desktop): the divider's place as a fraction of the picture's width; nil = off. */
    @State private var splitAt: CGFloat?
    /** The drag's previous translation; a local var would reset on every redraw and make pans accelerate. */
    @State private var panLast = CGSize.zero
    /** The pinch's magnification at its last change, while two fingers zoom. */
    @State private var pinchLast: CGFloat?
    @State private var mode = EditorMode.none
    /** White balance picker: armed from the Color tab, the next tap on the photo picks. */
    @State private var pickingWhite = false
    /** Auto WB's area is on the photo (fit view), and where it is (fractions of the picture shown). */
    @State private var autoWb = false
    @State private var autoWbRect = CropRect(0.15, 0.15, 0.85, 0.85)
    /** Look selector: armed from the bar, the next click on the photo opens it there (preview points). */
    @State private var looksArmed = false
    @State private var looksAt: CGPoint?
    @State private var looksPage = LookSelector.PageStep()
    // Masks (UI state; the layers themselves are in the params).
    @State private var selectedLayer: String?
    @State private var maskTool = MaskTool.move
    @State private var showMask = false
    @State private var paintAt: CGPoint?
    @State private var sizeRingAt = Date.distantPast
    // Light leaks (UI state; the leaks are in the params). The overlay draws and drags them as radial shapes.
    @State private var selectedLeak: String?
    @State private var selectedFilmLeak: String?
    // Light effects, the same way: radial shapes (an ellipse round the effect's box, no feather ring).
    @State private var selectedFx: String?
    // Healing brush (UI state; the strokes are in the params): the stroke picked in the list, and what new strokes start with.
    @State private var selectedHeal: String?
    @State private var healBrush = HealBrush()
    // Crop shape lock (UI only; the crop itself is in the params). Portrait nil = follow the frame.
    /** The shape chosen in Crop & rotate for this photo; nil = [defaultCropAspect]. */
    @State private var chosenCropAspect: CropAspect?
    @State private var cropPortrait: Bool?
    /** Extend: the tool shows the frame with room around the chosen sides and the crop may reach into it (the canvas is filled). */
    @State private var cropSides = ExtendSides.off
    private var sidesNow: ExtendSides { cropSides.union(state.params.crop.sides) }
    private var extendOn: Bool { sidesNow.any }
    @State private var viewSize = CGSize.zero
    /** RawBoy Desktop's focus mode (Tab, F): the bar and the panel hide and the photo takes the window. */
    @State private var photoOnly = false

    private var state: EditorState { vm.state }
    private var layers: [MaskLayer] { state.params.masks }
    private var selectedId: String? {
        selectedLayer.flatMap { id in layers.contains { $0.id == id } ? id : nil } ?? layers.first?.id
    }
    private var leaks: [LightLeak] { state.params.leaks }
    private var filmLeaks: [FilmLeak] { state.params.filmLeaks }
    private var selectedFilmId: String? {
        if let id = selectedFilmLeak, filmLeaks.contains(where: { $0.id == id }) { return id }
        if let id = selectedLeak, leaks.contains(where: { $0.id == id }) { return nil }
        return filmLeaks.last?.id
    }
    private var selectedLeakId: String? {
        if selectedFilmId != nil { return nil }
        return selectedLeak.flatMap { id in leaks.contains { $0.id == id } ? id : nil } ?? leaks.last?.id
    }
    private var leakShapes: [MaskLayer] { leaks.map { MaskLayer(id: $0.id, name: "", enabled: $0.enabled, shape: $0.shape) } }
    private var leakForms: [String: LeakForm] {
        Dictionary(uniqueKeysWithValues: leaks.map { ($0.id, LeakForm(kind: $0.kind, bend: $0.bend, taper: $0.taper, radii: $0.radii)) })
    }
    private var effects: [LightEffect] { state.params.fx }
    private var selectedFxId: String? {
        selectedFx.flatMap { id in effects.contains { $0.id == id } ? id : nil } ?? effects.last?.id
    }
    private var fxShapes: [MaskLayer] { effects.map { MaskLayer(id: $0.id, name: "", enabled: $0.enabled, shape: $0.shape) } }
    /** The photo's width / height (a new effect covers it). */
    private var photoAspect: Float {
        let l = frameLens
        return Float(l.width) / Float(max(1, l.height))
    }
    private var healSpots: [HealSpot] { state.params.healSpots }
    private var healId: String? { healSpots.contains { $0.id == selectedHeal } ? selectedHeal : nil }
    private var framePx: Int { Int(frameWidthPt * scale) }
    private var marginPx: Int { mode == .masks || mode == .leaks || mode == .fx || mode == .heal ? Int(maskMarginPt * scale) : 0 }

    var body: some View {
        VStack(spacing: 0) {
            if !photoOnly {
                EditorTopBar(fileName: state.fileName, info: state.info, enabled: state.hasImage && !state.busy, mode: mode,
                             canOpen: !state.busy, openFromPhotos: openFromPhotos, openFromFiles: openFromFiles,
                             onMode: { m in
                                 if m == .geometry { vm.exitZoom() }  // the crop tool works on the fit view
                                 mode = m
                                 pickingWhite = false
                                 autoWb = false
                                 closeLooks()
                             },
                             onReset: vm.reset, onAuto: vm.applyAuto,
                             canUndo: state.canUndo, canRedo: state.canRedo, onUndo: vm.undo, onRedo: vm.redo,
                             onExport: { showExport = true }, onSendToAuto: commands.sendToAuto,
                             onCopyPrevious: copyPreviousAction, canCopyPrevious: vm.canCopyPrevious,
                             looksArmed: looksArmed, onLooks: toggleLooks, helpShown: $showHelp)
                    .interfaceScaled()  // RawBoy Desktop's interface size (1 on the phones)
            }
            // Controls under the photo in portrait, beside it in landscape.
            PhotoWithControls(hidden: photoOnly) {
                VStack(spacing: 0) {
                    previewArea
                    // RawBoy Desktop's filmstrip: the other photos in the folder, hidden with the panels.
                    if !photoOnly, let filmstrip = commands.filmstrip { filmstrip.interfaceScaled() }
                }
            } controls: { beside in panel(beside: beside) }
        }
        .background(Color(white: 0.07))
        .sheet(isPresented: $showExport) {
            // RawBoy Desktop: the photos picked in the filmstrip, when two or more are.
            let batch = commands.exportBatch?() ?? []
            let count = max(1, batch.count)
            ExportDialog(initial: vm.exportSettings, sourceName: batch.first ?? state.fileName ?? "image",
                         destination: commands.exportDestination, destinationNote: commands.exportNote?(commands.exportFolder),
                         filmLook: count > 1 || (state.params.film != nil && state.params.filmAmount > 0), count: count) {
                if let handler = commands.exportHandler { handler($0) } else { vm.export($0) }
            }
        }
        .onChange(of: commands.serial) { _, _ in if let a = commands.action { perform(a) } }
        .onChange(of: state.fileName) { _, _ in
            chosenCropAspect = nil
            cropPortrait = nil
            cropSides = .off
            selectedLayer = nil
            selectedLeak = nil
            selectedFx = nil
            selectedHeal = nil
            pickingWhite = false
            autoWb = false
        }
    }

    /** RawBoy Desktop's bar button (nil elsewhere: the host sets `sendToAuto` only on the Mac). */
    private var copyPreviousAction: (() -> Void)? {
        if commands.sendToAuto == nil { return nil }
        return { vm.copyPrevious() }
    }

    // MARK: - Menu and keyboard actions (RawBoy Desktop)

    private func perform(_ action: EditorAction) {
        guard state.hasImage || action == .done || action == .help || action == .toggleMode(.presets) else { return }
        switch action {
        case .export:
            if !state.busy { showExport = true }
        case let .toggleMode(m):
            if state.busy { return }
            if m == .geometry { vm.exitZoom() }  // the crop tool works on the fit view
            mode = mode == m ? .none : m
            pickingWhite = false
            autoWb = false
            closeLooks()
        case .copyPrevious:
            vm.copyPrevious()
        case .toggleCompare:
            showOriginal.toggle()
        case .toggleSplit:
            splitAt = splitAt == nil ? 0.5 : nil
        case .togglePhotoOnly:
            Motion.animate { photoOnly.toggle() }
        case .zoom100AtPointer:
            guard mode != .geometry else { return }
            if session.zoomCenter != nil {
                vm.exitZoom()
            } else {
                let at = commands.pointer ?? CGPoint(x: viewSize.width / 2, y: viewSize.height / 2)
                vm.toggleZoom(Float(at.x * scale), Float(at.y * scale), extra: marginPx)
            }
        case .zoomFit:
            vm.exitZoom()
        case .cycleFrame:
            vm.cycleFrame()
        case let .maskTool(tool):
            if mode != .masks {
                // B opens (or closes) the healing brush from any other tool, as on the web; inside Masks it stays that tool's brush.
                guard tool == .brush, !state.busy else { return }
                mode = mode == .heal ? .none : .heal
                pickingWhite = false
                autoWb = false
                return
            }
            if tool == .brush && selectedId == nil, let id = vm.addLayer(.brush) { selectedLayer = id }
            maskTool = tool
        case let .brushSize(direction):
            if mode == .heal {
                let size = (HealSpots.sizeValue(healBrush.radius) + (direction > 0 ? 5 : -5)).clamped(0, 100)
                healBrush.radius = HealSpots.sizeRadius(size).clamped(HealSpots.radiusMin, HealSpots.radiusMax)
                return
            }
            var b = vm.brush
            b.radius = min(max(b.radius * (direction > 0 ? 1.15 : 1 / 1.15), Masks.minBrushRadius), Masks.maxBrushRadius)
            vm.setBrush(b)
            sizeRingAt = Date()
        case .deleteSelection:
            if mode == .heal, let id = healId {
                vm.removeHeal(id)
                selectedHeal = nil
            }
        case .done:
            if looksArmed {
                closeLooks()
                return
            }
            if mode == .none && photoOnly { Motion.animate { photoOnly = false } }
            mode = .none
            pickingWhite = false
            autoWb = false
        case .help:
            showHelp = true
        case let .openLooks(point):
            if !looksArmed { toggleLooks() }
            looksAt = point ?? CGPoint(x: viewSize.width / 2, y: viewSize.height / 2)
        case let .looksPage(delta):
            looksPage = LookSelector.PageStep(serial: looksPage.serial + 1, delta: delta)
        }
    }

    /** The bar's Looks button: arms the selector (the next click on the photo opens it), or puts it away. */
    private func toggleLooks() {
        if looksArmed {
            closeLooks()
            return
        }
        vm.refreshLuts()
        mode = .none
        pickingWhite = false
        autoWb = false
        looksArmed = true
        commands.looksOpen = true
    }

    private func closeLooks() {
        looksArmed = false
        looksAt = nil
        commands.looksOpen = false
    }

    // MARK: - Preview

    /** The as-shot render with the edit's rotation, flips and crop, so the frame doesn't jump (Compare, the slider). */
    private var originalParams: DevelopParams {
        var d = state.defaults
        d.rotation = state.params.rotation
        d.flipHorizontal = state.params.flipHorizontal
        d.flipVertical = state.params.flipVertical
        d.straighten = state.params.straighten
        d.perspectiveVertical = state.params.perspectiveVertical
        d.perspectiveHorizontal = state.params.perspectiveHorizontal
        d.scale = state.params.scale
        return d.withCrop(state.params.crop)
    }

    private var shownParams: DevelopParams {
        // Compare keeps the current rotation, flips and crop so the frame doesn't jump.
        let edited = showOriginal ? originalParams : state.params
        // The crop tool shows the whole frame with the crop drawn over it.
        return mode == .geometry ? edited.withCrop(CropMath.extendedView(sidesNow)) : edited
    }

    private var previewArea: some View {
        GeometryReader { geo in
            let maskView = mode == .masks && showMask && !showOriginal ? selectedId : nil
            let shader = session.hasImage ? session.shaderParams(shownParams, defaults: state.defaults, maskView: maskView) : nil
            ZStack {
                #if os(macOS)
                PointerSurface(
                    onMove: { commands.pointer = $0 },
                    onZoom: { p, factor in
                        guard mode != .geometry, session.hasImage else { return }
                        vm.zoomBy(Float(p.x * scale), Float(p.y * scale), factor: Float(factor), extra: marginPx)
                    },
                    onPan: { d in if session.zoomCenter != nil { vm.pan(Float(d.width * scale), Float(d.height * scale)) } })
                #endif
                DevelopPreview(image: session.preview, params: shader, zoomCenter: session.zoomCenter,
                               detail: session.detail, frameWidth: framePx, frameColor: vm.frameColor, margin: marginPx,
                               clipWarning: vm.clipWarning && !showOriginal && maskView == nil,
                               zoomScale: session.zoomScale)
                    .gesture(previewGestures)
                if let splitAt, session.preview != nil, !showOriginal, !looksArmed, mode == .none || mode == .presets {
                    CompareSplit(session: session, original: originalParams, defaults: state.defaults,
                                 frame: frameWidthPt, fraction: Binding(get: { splitAt }, set: { self.splitAt = $0 }))
                }
                if let shader, mode == .masks, session.preview != nil, !showOriginal {
                    let frame = framePx + marginPx
                    MaskOverlay(lens: shader.lens, layers: layers, selectedId: selectedId, frame: frame,
                                zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                                tool: selectedId != nil ? maskTool : .move, brush: vm.brush, paintAt: paintAt,
                                sizeRing: Date().timeIntervalSince(sizeRingAt) < 0.9)
                    MaskTouchLayer(inputs: MaskInputs(
                        lens: shader.lens, layers: layers, selectedId: selectedId, frame: frame,
                        zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                        tool: selectedId != nil ? maskTool : .move, brush: vm.brush,
                        actions: MaskActions(
                            onSelect: { selectedLayer = $0 },
                            onChange: { id, shape in vm.updateLayer(id) { $0.shape = shape } },
                            onStrokeBegin: vm.beginStroke, onStrokeExtend: vm.extendStroke,
                            onStrokeCancel: vm.cancelStroke, onPan: vm.pan, onZoom: pinchZoom),
                        onPaintAt: { paintAt = $0 }))
                }
                if let shader, mode == .leaks, session.preview != nil, !showOriginal {
                    let frame = framePx + marginPx
                    if !leaks.isEmpty {
                        MaskOverlay(lens: shader.lens, layers: leakShapes, selectedId: selectedLeakId, frame: frame,
                                    zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                                    tool: .move, brush: vm.brush, paintAt: nil, sizeRing: false,
                                    leaks: leakForms)
                        MaskTouchLayer(inputs: MaskInputs(
                            lens: shader.lens, layers: leakShapes, selectedId: selectedLeakId, frame: frame,
                            zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                            tool: .move, brush: vm.brush,
                            actions: MaskActions(
                                onSelect: { selectedLeak = $0; selectedFilmLeak = nil },
                                onChange: { id, shape in vm.updateLeak(id) { $0 = $0.withShape(shape) } },
                                onStrokeBegin: { _, _ in }, onStrokeExtend: { _, _, _ in }, onStrokeCancel: { _ in },
                                onPan: vm.pan, onZoom: pinchZoom),
                            onPaintAt: { _ in },
                            grabInside: true, leaks: leakForms,
                            onBend: { id, bend in vm.updateLeak(id) { $0.bend = bend } },
                            onReshape: { id, radii in vm.updateLeak(id) { $0.radii = radii } }))
                    }
                    if !filmLeaks.isEmpty {
                        FilmLeakOverlay(
                            lens: shader.lens, leaks: filmLeaks, selectedId: selectedFilmId, frame: frame,
                            zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                            onSelect: { selectedFilmLeak = $0; selectedLeak = nil },
                            onChange: { id, change in vm.updateFilmLeak(id, change) })
                    }
                }
                if let shader, mode == .fx, session.preview != nil, !showOriginal {
                    let frame = framePx + marginPx
                    MaskOverlay(lens: shader.lens, layers: fxShapes, selectedId: selectedFxId, frame: frame,
                                zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                                tool: .move, brush: vm.brush, paintAt: nil, sizeRing: false)
                    MaskTouchLayer(inputs: MaskInputs(
                        lens: shader.lens, layers: fxShapes, selectedId: selectedFxId, frame: frame,
                        zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                        tool: .move, brush: vm.brush,
                        actions: MaskActions(
                            onSelect: { selectedFx = $0 },
                            onChange: { id, shape in vm.updateEffect(id) { $0 = $0.withShape(shape) } },
                            onStrokeBegin: { _, _ in }, onStrokeExtend: { _, _, _ in }, onStrokeCancel: { _ in },
                            onPan: vm.pan, onZoom: pinchZoom),
                        onPaintAt: { _ in },
                        grabInside: true))
                }
                if let shader, mode == .heal, session.preview != nil, !showOriginal {
                    HealOverlay(
                        lens: shader.lens, spots: healSpots, selectedId: healId, brush: healBrush, frame: framePx + marginPx,
                        zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                        actions: HealOverlayActions(
                            onBegin: { x, y in
                                var source: [Float]?
                                if healBrush.chooseSource {
                                    source = [(x + healBrush.offset[0]).clamped(0, 1), (y + healBrush.offset[1]).clamped(0, 1)]
                                }
                                let spot = HealSpot(x: x, y: y, radius: healBrush.radius, source: source, feather: healBrush.feather)
                                guard let id = vm.addHeal(spot) else { return nil }
                                selectedHeal = id
                                return id
                            },
                            onExtend: vm.extendHeal,
                            onEnd: {},
                            onSource: { id, x, y in
                                if let s = healSpots.first(where: { $0.id == id }) { healBrush.offset = [x - s.x, y - s.y] }
                                vm.updateHeal(id) { $0.source = [x, y] }
                            },
                            onPan: { dx, dy in if session.zoomCenter != nil { vm.pan(dx, dy) } },
                            onZoom: pinchZoom),
                        panning: { commands.spaceHeld })
                }
                if let shader, mode == .geometry, session.zoomCenter == nil, session.preview != nil {
                    CropOverlay(frameWidth: shader.lens.outputWidth, frameHeight: shader.lens.outputHeight,
                                crop: CropMath.toView(state.params.crop, sidesNow),
                                ratio: cropRatio, framePx: framePx,
                                snapTo: extendOn ? CropMath.toView(CropMath.full, sidesNow) : nil,
                                onCropChange: { r in
                                    // Keep the shape the drag started with: the default follows whether a crop is set.
                                    if chosenCropAspect == nil { chosenCropAspect = defaultCropAspect }
                                    vm.setCrop(CropMath.fromView(r, sidesNow))
                                },
                                rotate: (angle: state.params.straighten, onChange: { d in vm.update { $0.straighten = d } }))
                }
                if let shader, autoWb, mode == .none, session.zoomCenter == nil, session.preview != nil, !showOriginal {
                    CropOverlay(frameWidth: shader.lens.outputWidth, frameHeight: shader.lens.outputHeight,
                                crop: autoWbRect, ratio: nil, framePx: framePx,
                                onCropChange: { r in
                                    autoWbRect = r
                                    vm.autoWhiteBalance(r)
                                },
                                shadeOpacity: 0.35, gridLines: 3)
                }
                if looksArmed, let at = looksAt, mode == .none, !showOriginal, session.preview != nil {
                    LookSelector(vm: vm, session: session, frame: frameWidthPt, at: at, onClose: closeLooks,
                                 pageStep: looksPage)
                        .id(state.fileName ?? "")
                }
                if state.loading {
                    ProgressView()
                } else if session.preview == nil {
                    if let openFromPhotos {
                        Menu {
                            Button("From Photos", systemImage: "photo.on.rectangle", action: openFromPhotos)
                            Button("From Files", systemImage: "folder", action: openFromFiles)
                        } label: {
                            Text("Open a photo").padding(.horizontal, 20).padding(.vertical, 10)
                                .background(Capsule().fill(Color.accentColor)).foregroundStyle(.black)
                        }
                    } else {
                        Button(action: openFromFiles) {
                            Text("Open a photo (⌘O), or drop one here").padding(.horizontal, 20).padding(.vertical, 10)
                                .background(Capsule().fill(Color.accentColor)).foregroundStyle(.black)
                        }
                        .buttonStyle(.plain)
                    }
                }
                labels(maskView: maskView)
                if state.exporting {
                    ProgressView(value: Double(state.exportProgress)).frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
            .onAppear { updateViewSize(geo.size) }
            .onChange(of: geo.size) { _, s in updateViewSize(s) }
        }
    }

    @ViewBuilder
    private func labels(maskView: String?) -> some View {
        let text = showOriginal && session.preview != nil ? "Original"
            : looksArmed && looksAt == nil && session.preview != nil ? "Click the photo to compare looks"
            : [session.zoomCenter != nil ? ZoomMath.label(session.zoomScale) : nil, maskView != nil ? "Mask" : nil].compactMap { $0 }.joined(separator: " · ")
        if !text.isEmpty {
            OverlayLabel(text).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).allowsHitTesting(false)
        }
    }

    /** Two fingers on the mask or leak handles' layer pinched (view pixels). */
    private func pinchZoom(_ x: Float, _ y: Float, _ factor: Float) {
        vm.zoomBy(x, y, factor: factor, extra: marginPx)
    }

    private func updateViewSize(_ s: CGSize) {
        viewSize = s
        vm.setViewSize(Int(s.width * scale), Int(s.height * scale), frame: framePx)
    }

    /**
     * Double tap: 100% at that point / back to fit. Pinch: zoom from fit up to 400% around where it started (stopping
     * once at 100%). Tap outside the photo: frame colour. Drag: pan while zoomed. Press and hold: compare with the
     * as-shot render (delayed so taps and drags don't flash it; never during a pinch).
     */
    private var previewGestures: some Gesture {
        let doubleTap = SpatialTapGesture(count: 2).onEnded { e in
            // Zoom works on the cropped view; the crop tool shows the whole frame.
            if mode != .geometry && !autoWb { vm.toggleZoom(Float(e.location.x * scale), Float(e.location.y * scale), extra: marginPx) }
        }
        let tap = SpatialTapGesture().onEnded { e in
            guard mode != .geometry && mode != .masks && mode != .leaks && mode != .fx && mode != .heal else { return }
            let x = Float(e.location.x * scale)
            let y = Float(e.location.y * scale)
            if looksArmed {
                looksAt = e.location
            } else if pickingWhite {
                pickingWhite = false
                vm.pickWhite(x, y)
            } else {
                vm.onPreviewTap(x, y)
            }
        }
        let hold = LongPressGesture(minimumDuration: 0.25)
            .onEnded { _ in if pinchLast == nil { showOriginal = true } }
            .sequenced(before: DragGesture(minimumDistance: 0).onEnded { _ in showOriginal = false })
        let pan = DragGesture(minimumDistance: 1)
            .onChanged { v in
                let d = CGSize(width: v.translation.width - panLast.width, height: v.translation.height - panLast.height)
                panLast = v.translation
                // While pinching, the zoom keeps the photo under the fingers; a drag's single finger would fight it.
                if pinchLast == nil { vm.pan(Float(d.width * scale), Float(d.height * scale)) }
            }
            .onEnded { _ in panLast = .zero }
        let pinch = MagnifyGesture()
            .onChanged { v in
                // Zoom works on the cropped view; the crop tool shows the whole frame.
                guard mode != .geometry else { return }
                showOriginal = false
                let factor = v.magnification / (pinchLast ?? 1)
                pinchLast = v.magnification
                vm.zoomBy(Float(v.startLocation.x * scale), Float(v.startLocation.y * scale), factor: Float(factor),
                          extra: marginPx)
            }
            .onEnded { _ in pinchLast = nil }
        return doubleTap.exclusively(before: tap).simultaneously(with: hold.simultaneously(with: pan))
            .simultaneously(with: pinch)
    }

    // MARK: - Panels

    private var frameLens: LensTransform { vm.lensFor(state.params.withoutCrop()) }
    private var portrait: Bool { cropPortrait ?? (frameLens.frameHeight > frameLens.frameWidth) }
    /**
     * The crop tool starts locked to the photo's own shape and orientation (Original), so a drag keeps it; a photo that
     * already has a crop opens Free, so the tool never reshapes a crop made earlier.
     */
    private var defaultCropAspect: CropAspect { state.params.crop.isFull ? .original : .free }
    private var cropAspect: CropAspect { chosenCropAspect ?? defaultCropAspect }
    private var cropRatio: Double? {
        cropAspect.ratio(frameWidth: frameLens.frameWidth, frameHeight: frameLens.frameHeight, portrait: portrait)
    }

    /** [beside]: in the side panel (landscape), where the panel fills the height instead of the cap under the photo. */
    @ViewBuilder
    private func panel(beside: Bool) -> some View {
        let maxHeight = beside ? CGFloat.infinity : panelMax
        if state.hasImage {
            switch mode {
            case .geometry:
                GeometryPanel(
                    params: state.params, onChange: vm.update,
                    onRotate: { q in
                        vm.rotate(q)
                        cropPortrait = cropPortrait.map { !$0 }  // a locked shape turns with the picture
                    },
                    onFlip: vm.flip,
                    aspect: cropAspect, portrait: portrait,
                    sides: sidesNow,
                    onSides: { next in
                        cropSides = next
                        if next != sidesNow { vm.setCrop(CropMath.within(state.params.crop, next)) }
                    },
                    onAspect: { aspect, toPortrait in
                        chosenCropAspect = aspect
                        cropPortrait = toPortrait
                        let f = frameLens
                        let ratio = aspect.ratio(frameWidth: f.frameWidth, frameHeight: f.frameHeight, portrait: toPortrait)
                        vm.setCrop(CropMath.withAspect(state.params.crop, ratio: ratio, frameWidth: f.frameWidth,
                                                       frameHeight: f.frameHeight, sides: sidesNow))
                    },
                    onResetCrop: {
                        cropSides = .off
                        chosenCropAspect = nil
                        cropPortrait = nil
                        vm.setCrop(CropMath.full)
                    },
                    onDone: { mode = .none })
            case .masks:
                MasksPanel(
                    layers: layers, selectedId: selectedId, tool: maskTool, brush: vm.brush, showMask: showMask,
                    zoomed: session.zoomCenter != nil,
                    actions: MaskPanelActions(
                        onSelect: { selectedLayer = $0 },
                        onAdd: { kind in
                            if let id = vm.addLayer(kind) { selectedLayer = id }
                            maskTool = kind == .brush ? .brush : .move
                        },
                        onUpdate: { id, change in vm.updateLayer(id, change) },
                        onRemove: vm.removeLayer,
                        onTool: { maskTool = $0 },
                        onBrush: vm.setBrush,
                        onSizeChanging: { sizeRingAt = Date() },
                        onShowMask: { showMask = $0 },
                        onUndoStroke: vm.undoStroke,
                        onClearBrush: vm.clearBrush,
                        onToggleZoom: {
                            if session.zoomCenter != nil {
                                vm.exitZoom()
                            } else {
                                vm.toggleZoom(Float(viewSize.width * scale / 2), Float(viewSize.height * scale / 2), extra: marginPx)
                            }
                        },
                        onDone: { mode = .none }))
                .frame(maxHeight: maxHeight)
            case .leaks:
                LeaksPanel(
                    leaks: leaks, selectedId: selectedLeakId,
                    filmLeaks: filmLeaks, selectedFilmId: selectedFilmId,
                    zoomed: session.zoomCenter != nil,
                    actions: LeakPanelActions(
                        onSelect: { selectedLeak = $0; selectedFilmLeak = nil },
                        onAdd: { kind in if let id = vm.addLeak(kind) { selectedLeak = id; selectedFilmLeak = nil } },
                        onUpdate: { id, force, change in vm.updateLeak(id, force: force, change) },
                        onRemove: vm.removeLeak,
                        onSelectFilm: { selectedFilmLeak = $0; selectedLeak = nil },
                        onAddFilm: { type, shortSideSprockets in
                            if let id = vm.addFilmLeak(type, aspect: photoAspect, shortSideSprockets: shortSideSprockets) {
                                selectedFilmLeak = id; selectedLeak = nil
                            }
                        },
                        onRandomRoll: { shortSideSprockets in
                            if let id = vm.randomFilmRoll(aspect: photoAspect, shortSideSprockets: shortSideSprockets) {
                                selectedFilmLeak = id; selectedLeak = nil
                            }
                        },
                        onRandomFilm: { type, shortSideSprockets in
                            if let id = vm.rollFilmLeak(type, aspect: photoAspect, selectedId: selectedFilmLeak, shortSideSprockets: shortSideSprockets) {
                                selectedFilmLeak = id; selectedLeak = nil
                            }
                        },
                        onUpdateFilm: { id, force, change in vm.updateFilmLeak(id, force: force, change) },
                        onRemoveFilm: vm.removeFilmLeak,
                        onFx: { mode = .fx },
                        onToggleZoom: {
                            if session.zoomCenter != nil {
                                vm.exitZoom()
                            } else {
                                vm.toggleZoom(Float(viewSize.width * scale / 2), Float(viewSize.height * scale / 2), extra: marginPx)
                            }
                        },
                        onDone: { mode = .none }))
                .frame(maxHeight: maxHeight)
            case .fx:
                FxPanel(
                    effects: effects, selectedId: selectedFxId, aspect: photoAspect, zoomed: session.zoomCenter != nil,
                    actions: FxPanelActions(
                        onSelect: { selectedFx = $0 },
                        onAdd: { kind in if let id = vm.addEffect(kind, aspect: photoAspect) { selectedFx = id } },
                        onUpdate: { id, force, change in vm.updateEffect(id, force: force, change) },
                        onRemove: vm.removeEffect,
                        onLeaks: { mode = .leaks },
                        onToggleZoom: {
                            if session.zoomCenter != nil {
                                vm.exitZoom()
                            } else {
                                vm.toggleZoom(Float(viewSize.width * scale / 2), Float(viewSize.height * scale / 2), extra: marginPx)
                            }
                        },
                        onDone: { mode = .none }))
                .frame(maxHeight: maxHeight)
            case .heal:
                HealPanel(
                    spots: healSpots, selectedId: healId, brush: healBrush, working: session.blemish.working,
                    zoomed: session.zoomCenter != nil,
                    actions: HealPanelActions(
                        onSelect: { selectedHeal = $0 },
                        onBrush: { healBrush = $0 },
                        onUpdate: { id, force, change in vm.updateHeal(id, force: force, change) },
                        onRemove: { id in
                            vm.removeHeal(id)
                            if id == selectedHeal { selectedHeal = nil }
                        },
                        onClear: {
                            vm.clearHeal()
                            selectedHeal = nil
                        },
                        onToggleZoom: {
                            if session.zoomCenter != nil {
                                vm.exitZoom()
                            } else {
                                vm.toggleZoom(Float(viewSize.width * scale / 2), Float(viewSize.height * scale / 2), extra: marginPx)
                            }
                        },
                        onDone: { mode = .none }))
                .frame(maxHeight: maxHeight)
            case .presets:
                PresetsPanel(vm: vm, onDone: { mode = .none }, hasStrokes: layers.contains { !$0.strokes.isEmpty })
                    .frame(maxHeight: maxHeight)
            case .none:
                // Tap: clipped highlights red and crushed shadows blue on the photo.
                HistogramView(histogram: vm.histogram, active: vm.clipWarning, onTap: vm.toggleClipWarning)
                    .frame(height: histogramHeight)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                ControlsPanel(
                    params: state.params, defaults: state.defaults, onChange: vm.update, luts: vm.luts,
                    lutLoading: state.params.lut != nil && session.lutData?.id != state.params.lut,
                    onSelectLut: vm.selectLut,
                    filmLoading: state.params.film != nil && session.filmData?.stock.id != state.params.film,
                    onToneMapper: vm.setToneMapper, onFilm: vm.useFilm, onSelectFilm: vm.selectFilm,
                    onLutsTabShown: vm.refreshLuts, lens: session.lensInfo,
                    skin: session.skin, blemish: session.blemish, retouchWorking: session.retouchWorking,
                    retouchReady: session.retouchMap != nil,
                    pickingWhite: pickingWhite,
                    onPickWhite: {
                        pickingWhite.toggle()
                        if pickingWhite { autoWb = false }
                    },
                    autoWb: autoWb,
                    onAutoWb: {
                        autoWb.toggle()
                        if autoWb {
                            pickingWhite = false
                            mode = .none
                            vm.exitZoom()
                            vm.autoWhiteBalance(autoWbRect, force: true)
                        }
                    },
                    onResetWb: {
                        autoWb = false
                        pickingWhite = false
                        vm.resetWhiteBalance()
                    },
                    onSaveLensPreset: { name, send in
                        let preset = vm.saveLensPreset(name: name)
                        if send { vm.sendPresetToAuto(preset) }
                    },
                    lensfun: vm.lensfun, depthMap: session.depthMap, depthState: session.depthState)
                .frame(maxHeight: maxHeight)
            }
        } else if mode == .presets {
            // Without a photo the presets can still be imported, exported, renamed and deleted.
            PresetsPanel(vm: vm, onDone: { mode = .none }, hasStrokes: false, hasImage: false)
                .frame(maxHeight: maxHeight)
        }
    }
}

/**
 * Two short rows: every action as an icon, then the file name and the shot info (camera, ISO, shutter, aperture,
 * focal length) in small type, with Reset all, Undo and Redo at its end (the first row is full on a small iPhone).
 */
struct EditorTopBar: View {
    let fileName: String?
    let info: String?
    let enabled: Bool
    let mode: EditorMode
    let canOpen: Bool
    let openFromPhotos: (() -> Void)?
    let openFromFiles: () -> Void
    let onMode: (EditorMode) -> Void
    let onReset: () -> Void
    let onAuto: () -> Void
    let canUndo: Bool
    let canRedo: Bool
    let onUndo: () -> Void
    let onRedo: () -> Void
    let onExport: () -> Void
    /** RawBoy Desktop: "Send to Auto" in the bar (nil: no button). */
    var onSendToAuto: (() -> Void)? = nil
    /** RawBoy Desktop: "Copy" (the previous photo's settings, ⇧C) in the bar (nil: no button). */
    var onCopyPrevious: (() -> Void)? = nil
    var canCopyPrevious = false
    /** RawBoy Desktop: the Look selector's button (nil: no button) and whether it is armed. */
    var looksArmed = false
    var onLooks: (() -> Void)? = nil
    @Binding var helpShown: Bool

    /** The full name of the tool being long-pressed, shown under the bar for a moment. */
    @State private var tip: String?

    var body: some View {
        rows
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
        .overlay(alignment: .bottom) {
            if let tip {
                Text(tip)
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .offset(y: 30)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .task(id: tip) {
            guard tip != nil else { return }
            try? await Task.sleep(for: .seconds(1.5))
            Motion.animate { tip = nil }
        }
        .zIndex(1)
    }

    #if os(macOS)
    /**
     * The Mac's bar is one row: the photo on the left (name, then camera and exposure), the tools in the middle, and
     * what acts on the whole photo on the right, Export last. The phones' second row (name, Reset all, Undo, Redo)
     * went into it; the window is wide enough.
     */
    private var rows: some View {
        HStack(spacing: 14) {
            Button(action: openFromFiles) { ToolLabel(icon: "folder", label: "Open") }
                .disabled(!canOpen)
                .help("Open a photo (⌘O)")
                .accessibilityLabel("Open")
                .buttonStyle(BarButtonStyle())
            VStack(alignment: .leading, spacing: 1) {
                Text(fileName ?? "No photo").font(.subheadline.weight(.medium)).lineLimit(1).truncationMode(.middle)
                Text(info ?? " ").font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
            .frame(minWidth: 60, maxWidth: 300, alignment: .leading)
            .help([fileName, info].compactMap { $0 }.joined(separator: "\n"))
            Spacer(minLength: 8)
            modeButton(.geometry, "crop.rotate", "Crop", "Crop & rotate (C)")
            modeButton(.masks, "square.stack.3d.down.forward", "Masks", "Masks")
            lightButton
            modeButton(.heal, "bandage", "Heal", "Healing brush (B)")
            modeButton(.presets, "bookmark", "Presets", "Presets", withoutPhoto: true)
            if let onLooks {
                Button(action: onLooks) {
                    ToolLabel(icon: "rectangle.split.3x1", label: "Looks")
                        .foregroundStyle(looksArmed ? Color.accentColor : Color.primary)
                }
                .buttonStyle(ToolButtonStyle(name: "Looks", tip: $tip))
                .disabled(!enabled)
                .help("Looks: click the photo to see that area in every LUT and film stock")
                .accessibilityLabel("Looks")
                .accessibilityAddTraits(looksArmed ? .isSelected : [])
            }
            Spacer(minLength: 8)
            tool("wand.and.stars", "Auto Dev", "Auto light and colour (keeps the LUT)", action: onAuto)
            if let onSendToAuto { tool("square.stack.3d.up", "To Auto", "Send this photo to Auto's batch (⇧⌘A)", action: onSendToAuto) }
            if let onCopyPrevious {
                tool("doc.on.doc", "Copy", "Copy the previous photo's settings (⇧C)", disabled: !canCopyPrevious, action: onCopyPrevious)
            }
            tool("clock.arrow.circlepath", "Reset", "Reset all edits", action: onReset)
            tool("arrow.uturn.backward", "Undo", "Undo (⌘Z)", disabled: !canUndo, action: onUndo)
            tool("arrow.uturn.forward", "Redo", "Redo (⇧⌘Z)", disabled: !canRedo, action: onRedo)
            tool("square.and.arrow.down", "Export", "Export (⌘E)", primary: true, action: onExport)
            HelpButton("RawBoy", sections: proHelp, licences: true, isPresented: $helpShown)
                .font(.title3)
                .buttonStyle(BarButtonStyle())
        }
        .frame(height: 48)
    }
    #else
    private var rows: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                if let openFromPhotos {
                    Menu {
                        Button("From Photos", systemImage: "photo.on.rectangle", action: openFromPhotos)
                        Button("From Files", systemImage: "folder", action: openFromFiles)
                    } label: { ToolLabel(icon: "folder", label: "Open") }
                    .disabled(!canOpen)
                    .accessibilityLabel("Open")
                    .buttonStyle(BarButtonStyle())
                } else {
                    Button(action: openFromFiles) { ToolLabel(icon: "folder", label: "Open") }
                        .disabled(!canOpen)
                        .accessibilityLabel("Open")
                        .buttonStyle(BarButtonStyle())
                }
                modeButton(.geometry, "crop.rotate", "Crop", "Crop & rotate")
                modeButton(.masks, "square.stack.3d.down.forward", "Masks", "Masks")
                lightButton
                modeButton(.presets, "bookmark", "Presets", "Presets", withoutPhoto: true)
                tool("wand.and.stars", "Auto Dev", "Auto light and colour (keeps the LUT)", action: onAuto)
                Spacer(minLength: 0)
                tool("square.and.arrow.down", "Export", "Export", action: onExport)
                HelpButton("RawBoy", sections: proHelp, licences: true, isPresented: $helpShown)
                    .font(.title3)
                    .buttonStyle(BarButtonStyle())
            }
            .menuStyle(.button)
            .frame(height: 44)
            HStack(spacing: 18) {
                // Scrolls sideways when it doesn't fit, rather than ending in an ellipsis.
                ScrollView(.horizontal, showsIndicators: false) {
                    (Text(fileName ?? "RawBoy")
                        + Text(info.map { $0.isEmpty ? "" : "  ·  \($0)" } ?? "").foregroundColor(.secondary))
                        .font(.caption2)
                        .lineLimit(1)
                        .fixedSize()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // Reset all sits here since Light leaks joined the full row above.
                Button(action: onReset) { Image(systemName: "clock.arrow.circlepath") }
                    .disabled(!enabled)
                    .accessibilityLabel("Reset all")
                Button(action: onUndo) { Image(systemName: "arrow.uturn.backward") }
                    .disabled(!enabled || !canUndo)
                    .accessibilityLabel("Undo")
                Button(action: onRedo) { Image(systemName: "arrow.uturn.forward") }
                    .disabled(!enabled || !canRedo)
                    .accessibilityLabel("Redo")
            }
            .font(.body)
            .buttonStyle(BarButtonStyle())
            .frame(minHeight: 28)
        }
    }
    #endif

    /** Light leaks and light effects share one button (the phone's row is full); each panel has a switch to the other. */
    private var lightButton: some View {
        Button { onMode(mode == .leaks || mode == .fx ? .none : .leaks) } label: {
            ToolLabel(icon: "rays", label: "Light")
                .foregroundStyle(mode == .leaks || mode == .fx ? Color.accentColor : Color.primary)
        }
        .buttonStyle(ToolButtonStyle(name: "Light leaks and effects", tip: $tip))
        .disabled(!enabled)
        .accessibilityLabel("Light leaks and effects")
        .accessibilityAddTraits(mode == .leaks || mode == .fx ? .isSelected : [])
    }

    /** [withoutPhoto]: the tool works with no photo open too (Presets: import, export and manage them). */
    private func modeButton(_ target: EditorMode, _ icon: String, _ label: String, _ name: String,
                            withoutPhoto: Bool = false) -> some View {
        Button { onMode(mode == target ? .none : target) } label: {
            ToolLabel(icon: icon, label: label).foregroundStyle(mode == target ? Color.accentColor : Color.primary)
        }
        .buttonStyle(ToolButtonStyle(name: name, tip: $tip))
        .disabled(withoutPhoto ? !canOpen : !enabled)
        .accessibilityLabel(name)
        .accessibilityAddTraits(mode == target ? .isSelected : [])
        #if os(macOS)
        .help(name)
        #endif
    }

    private func tool(_ icon: String, _ label: String, _ name: String, primary: Bool = false, disabled: Bool = false,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            #if os(macOS)
            ToolLabel(icon: icon, label: label).foregroundStyle(primary ? Color.accentColor : Color.primary)
            #else
            ToolLabel(icon: icon, label: label)
            #endif
        }
            .buttonStyle(ToolButtonStyle(name: name, tip: $tip))
            .disabled(!enabled || disabled)
            .accessibilityLabel(name)
            #if os(macOS)
            .help(name)
            #endif
    }

    /**
     * The bar's icons: amber on the phones (their tint), white on the Mac, where amber marks only the open tool and
     * Export: with every icon amber nothing stood out.
     */
    #if os(macOS)
    private static let barForeground = AnyShapeStyle(Color.primary)
    #else
    private static let barForeground = AnyShapeStyle(.tint)
    #endif

    /**
     * An icon with a word under it: the icons alone weren't obvious, and arrow.counterclockwise read as reload.
     */
    private struct ToolLabel: View {
        let icon: String
        let label: String

        var body: some View {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.title3).frame(height: 24)
                Text(label).font(.system(size: 10, weight: .medium)).lineLimit(1).fixedSize()
            }
        }
    }

    /**
     * [BarButtonStyle] plus a long press that shows the tool's full name instead of acting: a tap and a long press
     * are separate gestures, so holding never also triggers the tool.
     */
    private struct ToolButtonStyle: PrimitiveButtonStyle {
        let name: String
        @Binding var tip: String?
        @Environment(\.isEnabled) private var enabled
        @State private var pressed = false

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(EditorTopBar.barForeground)
                .opacity(!enabled ? 0.35 : pressed ? 0.5 : 1)
                .contentShape(Rectangle())
                .onTapGesture { configuration.trigger() }
                .onLongPressGesture(minimumDuration: 0.5) {
                    Motion.animate { tip = name }
                } onPressingChanged: { pressed = $0 }
        }
    }

    /**
     * Plain tinted icons. The system styles add a capsule behind each button when the phone has Accessibility ›
     * Button Shapes on, which pushed the row past both screen edges.
     */
    private struct BarButtonStyle: ButtonStyle {
        @Environment(\.isEnabled) private var enabled

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(EditorTopBar.barForeground)
                .opacity(!enabled ? 0.35 : configuration.isPressed ? 0.5 : 1)
                .contentShape(Rectangle())
        }
    }
}
