import RawBoyEngine
import SwiftUI

/** The editor's top-bar tools; at most one replaces the slider tabs. */
enum EditorMode { case none, geometry, masks, leaks, presets }

/** Frame around the photo in the fit view, points (tap outside the photo to change its colour). */
private let frameWidthPt: CGFloat = 12
/** Empty space around the frame while masking or placing light leaks: handles can sit beyond the photo. */
private let maskMarginPt: CGFloat = 16
/** Slider panels' height cap: the rest of the screen goes to the photo. */
private let panelMax: CGFloat = 320
/** The histogram above the slider tabs. */
private let histogramHeight: CGFloat = 56

struct EditorScreen: View {
    @ObservedObject var vm: EditorViewModel
    @ObservedObject var session: PhotoSession
    let openFromPhotos: () -> Void
    let openFromFiles: () -> Void

    @Environment(\.displayScale) private var scale
    @State private var showExport = false
    @State private var showOriginal = false
    /** The drag's previous translation; a local var would reset on every redraw and make pans accelerate. */
    @State private var panLast = CGSize.zero
    /** The pinch's magnification at its last change, while two fingers zoom. */
    @State private var pinchLast: CGFloat?
    @State private var mode = EditorMode.none
    /** White balance picker: armed from the Color tab, the next tap on the photo picks. */
    @State private var pickingWhite = false
    // Masks (UI state; the layers themselves are in the params).
    @State private var selectedLayer: String?
    @State private var maskTool = MaskTool.move
    @State private var showMask = false
    @State private var paintAt: CGPoint?
    @State private var sizeRingAt = Date.distantPast
    // Light leaks (UI state; the leaks are in the params). The overlay draws and drags them as radial shapes.
    @State private var selectedLeak: String?
    // Crop shape lock (UI only; the crop itself is in the params). Portrait nil = follow the frame.
    @State private var cropAspect = CropAspect.free
    @State private var cropPortrait: Bool?
    @State private var viewSize = CGSize.zero

    private var state: EditorState { vm.state }
    private var layers: [MaskLayer] { state.params.masks }
    private var selectedId: String? {
        selectedLayer.flatMap { id in layers.contains { $0.id == id } ? id : nil } ?? layers.first?.id
    }
    private var leaks: [LightLeak] { state.params.leaks }
    private var selectedLeakId: String? {
        selectedLeak.flatMap { id in leaks.contains { $0.id == id } ? id : nil } ?? leaks.last?.id
    }
    private var leakShapes: [MaskLayer] { leaks.map { MaskLayer(id: $0.id, name: "", enabled: $0.enabled, shape: $0.shape) } }
    private var leakForms: [String: LeakForm] {
        Dictionary(uniqueKeysWithValues: leaks.map { ($0.id, LeakForm(kind: $0.kind, bend: $0.bend, taper: $0.taper)) })
    }
    private var framePx: Int { Int(frameWidthPt * scale) }
    private var marginPx: Int { mode == .masks || mode == .leaks ? Int(maskMarginPt * scale) : 0 }

    var body: some View {
        VStack(spacing: 0) {
            EditorTopBar(fileName: state.fileName, info: state.info, enabled: state.hasImage && !state.busy, mode: mode,
                         canOpen: !state.busy, openFromPhotos: openFromPhotos, openFromFiles: openFromFiles,
                         onMode: { m in
                             if m == .geometry { vm.exitZoom() }  // the crop tool works on the fit view
                             mode = m
                             pickingWhite = false
                         },
                         onReset: vm.reset, onAuto: vm.applyAuto,
                         canUndo: state.canUndo, canRedo: state.canRedo, onUndo: vm.undo, onRedo: vm.redo,
                         onExport: { showExport = true })
            previewArea
            panel
        }
        .background(Color(white: 0.07))
        .sheet(isPresented: $showExport) {
            ExportDialog(initial: vm.exportSettings, sourceName: state.fileName ?? "image") { vm.export($0) }
        }
        .onChange(of: state.fileName) { _, _ in
            cropAspect = .free
            cropPortrait = nil
            selectedLayer = nil
            selectedLeak = nil
            pickingWhite = false
        }
    }

    // MARK: - Preview

    private var shownParams: DevelopParams {
        // Compare keeps the current rotation, flips and crop so the frame doesn't jump.
        var edited = state.params
        if showOriginal {
            var d = state.defaults
            d.rotation = state.params.rotation
            d.flipHorizontal = state.params.flipHorizontal
            d.flipVertical = state.params.flipVertical
            d.straighten = state.params.straighten
            edited = d.withCrop(state.params.crop)
        }
        // The crop tool shows the whole frame with the crop drawn over it.
        return mode == .geometry ? edited.withoutCrop() : edited
    }

    private var previewArea: some View {
        GeometryReader { geo in
            let maskView = mode == .masks && showMask && !showOriginal ? selectedId : nil
            let shader = session.hasImage ? session.shaderParams(shownParams, defaults: state.defaults, maskView: maskView) : nil
            ZStack {
                DevelopPreview(image: session.preview, params: shader, zoomCenter: session.zoomCenter,
                               detail: session.detail, frameWidth: framePx, frameColor: vm.frameColor, margin: marginPx,
                               clipWarning: vm.clipWarning && !showOriginal && maskView == nil,
                               zoomScale: session.zoomScale)
                    .gesture(previewGestures)
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
                    MaskOverlay(lens: shader.lens, layers: leakShapes, selectedId: selectedLeakId, frame: frame,
                                zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                                tool: .move, brush: vm.brush, paintAt: nil, sizeRing: false,
                                leaks: leakForms)
                    MaskTouchLayer(inputs: MaskInputs(
                        lens: shader.lens, layers: leakShapes, selectedId: selectedLeakId, frame: frame,
                        zoomCenter: session.zoomCenter, zoomScale: session.zoomScale, zoomFrame: framePx,
                        tool: .move, brush: vm.brush,
                        actions: MaskActions(
                            onSelect: { selectedLeak = $0 },
                            onChange: { id, shape in vm.updateLeak(id) { $0 = $0.withShape(shape) } },
                            onStrokeBegin: { _, _ in }, onStrokeExtend: { _, _, _ in }, onStrokeCancel: { _ in },
                            onPan: vm.pan, onZoom: pinchZoom),
                        onPaintAt: { _ in },
                        grabInside: true, leaks: leakForms,
                        onBend: { id, bend in vm.updateLeak(id) { $0.bend = bend } }))
                }
                if let shader, mode == .geometry, session.zoomCenter == nil, session.preview != nil {
                    CropOverlay(frameWidth: shader.lens.outputWidth, frameHeight: shader.lens.outputHeight,
                                crop: state.params.crop, ratio: cropRatio, framePx: framePx, onCropChange: vm.setCrop)
                }
                if state.loading {
                    ProgressView()
                } else if session.preview == nil {
                    Menu {
                        Button("From Photos", systemImage: "photo.on.rectangle", action: openFromPhotos)
                        Button("From Files", systemImage: "folder", action: openFromFiles)
                    } label: {
                        Text("Open a photo").padding(.horizontal, 20).padding(.vertical, 10)
                            .background(Capsule().fill(Color.accentColor)).foregroundStyle(.black)
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
            if mode != .geometry { vm.toggleZoom(Float(e.location.x * scale), Float(e.location.y * scale), extra: marginPx) }
        }
        let tap = SpatialTapGesture().onEnded { e in
            guard mode != .geometry && mode != .masks && mode != .leaks else { return }
            let x = Float(e.location.x * scale)
            let y = Float(e.location.y * scale)
            if pickingWhite {
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
    private var cropRatio: Double? {
        cropAspect.ratio(frameWidth: frameLens.frameWidth, frameHeight: frameLens.frameHeight, portrait: portrait)
    }

    @ViewBuilder
    private var panel: some View {
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
                    onAspect: { aspect, toPortrait in
                        cropAspect = aspect
                        cropPortrait = toPortrait
                        let f = frameLens
                        let ratio = aspect.ratio(frameWidth: f.frameWidth, frameHeight: f.frameHeight, portrait: toPortrait)
                        vm.setCrop(CropMath.withAspect(state.params.crop, ratio: ratio, frameWidth: f.frameWidth,
                                                       frameHeight: f.frameHeight))
                    },
                    onResetCrop: {
                        cropAspect = .free
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
                .frame(maxHeight: panelMax)
            case .leaks:
                LeaksPanel(
                    leaks: leaks, selectedId: selectedLeakId, zoomed: session.zoomCenter != nil,
                    actions: LeakPanelActions(
                        onSelect: { selectedLeak = $0 },
                        onAdd: { kind in if let id = vm.addLeak(kind) { selectedLeak = id } },
                        onUpdate: { id, force, change in vm.updateLeak(id, force: force, change) },
                        onRemove: vm.removeLeak,
                        onToggleZoom: {
                            if session.zoomCenter != nil {
                                vm.exitZoom()
                            } else {
                                vm.toggleZoom(Float(viewSize.width * scale / 2), Float(viewSize.height * scale / 2), extra: marginPx)
                            }
                        },
                        onDone: { mode = .none }))
                .frame(maxHeight: panelMax)
            case .presets:
                PresetsPanel(vm: vm, onDone: { mode = .none }, hasStrokes: layers.contains { !$0.strokes.isEmpty })
                    .frame(maxHeight: panelMax)
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
                    skin: session.skin, blemish: session.blemish,
                    pickingWhite: pickingWhite, onPickWhite: { pickingWhite.toggle() },
                    onSaveLensPreset: { name, send in
                        let preset = vm.saveLensPreset(name: name)
                        if send { vm.sendPresetToAuto(preset) }
                    })
                .frame(maxHeight: panelMax)
            }
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
    let openFromPhotos: () -> Void
    let openFromFiles: () -> Void
    let onMode: (EditorMode) -> Void
    let onReset: () -> Void
    let onAuto: () -> Void
    let canUndo: Bool
    let canRedo: Bool
    let onUndo: () -> Void
    let onRedo: () -> Void
    let onExport: () -> Void

    /** The full name of the tool being long-pressed, shown under the bar for a moment. */
    @State private var tip: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                Menu {
                    Button("From Photos", systemImage: "photo.on.rectangle", action: openFromPhotos)
                    Button("From Files", systemImage: "folder", action: openFromFiles)
                } label: { ToolLabel(icon: "folder", label: "Open") }
                .disabled(!canOpen)
                .accessibilityLabel("Open")
                .buttonStyle(BarButtonStyle())
                modeButton(.geometry, "crop.rotate", "Crop", "Crop & rotate")
                modeButton(.masks, "square.stack.3d.down.forward", "Masks", "Masks")
                modeButton(.leaks, "rays", "Leaks", "Light leaks")
                modeButton(.presets, "bookmark", "Presets", "Presets")
                tool("wand.and.stars", "Auto", "Auto light and colour (keeps the LUT)", action: onAuto)
                Spacer(minLength: 0)
                tool("square.and.arrow.down", "Export", "Export", action: onExport)
                HelpButton("RawBoy", sections: proHelp, licences: true)
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
            withAnimation { tip = nil }
        }
        .zIndex(1)
    }

    private func modeButton(_ target: EditorMode, _ icon: String, _ label: String, _ name: String) -> some View {
        Button { onMode(mode == target ? .none : target) } label: {
            ToolLabel(icon: icon, label: label).foregroundStyle(mode == target ? Color.accentColor : Color.primary)
        }
        .buttonStyle(ToolButtonStyle(name: name, tip: $tip))
        .disabled(!enabled)
        .accessibilityLabel(name)
    }

    private func tool(_ icon: String, _ label: String, _ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { ToolLabel(icon: icon, label: label) }
            .buttonStyle(ToolButtonStyle(name: name, tip: $tip))
            .disabled(!enabled)
            .accessibilityLabel(name)
    }

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
                .foregroundStyle(.tint)
                .opacity(!enabled ? 0.35 : pressed ? 0.5 : 1)
                .contentShape(Rectangle())
                .onTapGesture { configuration.trigger() }
                .onLongPressGesture(minimumDuration: 0.5) {
                    withAnimation { tip = name }
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
                .foregroundStyle(.tint)
                .opacity(!enabled ? 0.35 : configuration.isPressed ? 0.5 : 1)
                .contentShape(Rectangle())
        }
    }
}
