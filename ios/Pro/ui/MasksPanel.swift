import RawBoyEngine
import SwiftUI

/** Size slider 0..100 <-> brush radius (fraction of the long side), exponential so small brushes are easy to set. */
func sizeToRadius(_ v: Float) -> Float {
    Masks.minBrushRadius * powf(Masks.maxBrushRadius / Masks.minBrushRadius, v / 100)
}

func radiusToSize(_ r: Float) -> Float {
    100 * logf(r / Masks.minBrushRadius) / logf(Masks.maxBrushRadius / Masks.minBrushRadius)
}

private func subtitle(_ l: MaskLayer) -> String {
    Masks.name(l.shape) + (!l.strokes.isEmpty && !l.shape.isBrush ? " + brush" : "")
}

/** What the masks panel can do; mask layers live in the params, the rest is UI state. */
struct MaskPanelActions {
    let onSelect: (String) -> Void
    let onAdd: (MaskKind) -> Void
    let onUpdate: (String, (inout MaskLayer) -> Void) -> Void
    let onRemove: (String) -> Void
    let onTool: (MaskTool) -> Void
    let onBrush: (BrushSettings) -> Void
    /** The Size slider moved (show the brush size over the photo for a moment). */
    let onSizeChanging: () -> Void
    let onShowMask: (Bool) -> Void
    let onUndoStroke: (String) -> Void
    let onClearBrush: (String) -> Void
    let onToggleZoom: () -> Void
    let onDone: () -> Void
}

/**
 * Mask layers (gradients and brush), each with its own adjustments (Capture One style). A top-bar mode like
 * Crop & rotate: layer chips (long-press for rename / hide / delete), then the selected layer's mask tools and its
 * adjustments on two small tabs.
 */
struct MasksPanel: View {
    let layers: [MaskLayer]
    let selectedId: String?
    let tool: MaskTool
    let brush: BrushSettings
    let showMask: Bool
    let zoomed: Bool
    let actions: MaskPanelActions

    @State private var tab = 0
    @State private var renaming: MaskLayer?
    @State private var renameText = ""

    var body: some View {
        let layer = layers.first { $0.id == selectedId }
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Masks").font(.headline)
                Spacer()
                Button(zoomed ? "Fit" : "100%", action: actions.onToggleZoom)
                Button("Done", action: actions.onDone).fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(layers, id: \.id) { l in chip(l) }
                    if layers.count < Masks.maxLayers {
                        Menu {
                            Button("Linear gradient") { actions.onAdd(.linear) }
                            Button("Radial gradient") { actions.onAdd(.radial) }
                            Button("Brush") { actions.onAdd(.brush) }
                        } label: {
                            Text("+ Add").font(.subheadline).padding(.horizontal, 10).padding(.vertical, 6)
                                .overlay(Capsule().stroke(Color.secondary.opacity(0.5)))
                        }
                    }
                }
                .padding(.horizontal, 12)
            }
            .scrollIndicators(.hidden)
            if let layer {
                Picker("", selection: $tab) {
                    Text("Mask · \(subtitle(layer))").tag(0)
                    Text("Adjust").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if tab == 0 { maskTab(layer) } else { adjustTab(layer) }
                    }
                    .padding(.horizontal, 16)
                }
            } else {
                Note("Add a linear gradient (a graduated filter, e.g. for the sky), a radial one (a soft ellipse) or a brush layer, then shape it on the photo and adjust only that area. Up to \(Masks.maxLayers) layers; masks reset for each new photo.")
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 6)
        .alert("Rename layer", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") {
                if let l = renaming {
                    let n = renameText.trimmingCharacters(in: .whitespaces)
                    actions.onUpdate(l.id) { $0.name = n.isEmpty ? Masks.name(l.shape) : n }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func chip(_ l: MaskLayer) -> some View {
        let selected = l.id == selectedId
        return Text(l.enabled ? l.name : "\(l.name) (off)")
            .font(.subheadline)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Capsule().fill(selected ? Color.accentColor.opacity(0.3) : Color.clear))
            .overlay(Capsule().stroke(selected ? Color.accentColor : Color.secondary.opacity(0.5)))
            .onTapGesture { actions.onSelect(l.id) }
            .contextMenu {
                Button("Rename") {
                    renameText = l.name
                    renaming = l
                }
                Button(l.enabled ? "Hide" : "Show") { actions.onUpdate(l.id) { $0.enabled.toggle() } }
                Button("Delete", role: .destructive) { actions.onRemove(l.id) }
            }
    }

    @ViewBuilder
    private func maskTab(_ layer: MaskLayer) -> some View {
        Picker("", selection: Binding(get: { tool }, set: { actions.onTool($0) })) {
            Text(layer.shape.isBrush ? "Select" : "Move").tag(MaskTool.move)
            Text("Brush").tag(MaskTool.brush)
            Text("Erase").tag(MaskTool.erase)
        }
        .pickerStyle(.segmented)
        .padding(.vertical, 4)
        if tool != .move {
            ParamSlider(label: "Size", value: radiusToSize(brush.radius), range: 0...100, defaultValue: radiusToSize(0.03),
                        format: { _ in String(format: brush.radius < 0.05 ? "%.1f%%" : "%.0f%%", brush.radius * 200) }) { v in
                var b = brush
                b.radius = sizeToRadius(v)
                actions.onBrush(b)
                actions.onSizeChanging()
            }
            ParamSlider(label: "Hardness", value: brush.hardness, range: 0...100, defaultValue: 50, format: formatPlain) { v in
                var b = brush
                b.hardness = v
                actions.onBrush(b)
            }
            ParamSlider(label: "Flow", value: brush.flow, range: 1...100, defaultValue: 100, format: formatPlain) { v in
                var b = brush
                b.flow = v
                actions.onBrush(b)
            }
            Toggle("Auto mask: only colours like the one under the brush", isOn: Binding(get: { brush.auto }, set: { v in
                var b = brush
                b.auto = v
                actions.onBrush(b)
            }))
            .font(.caption)
            HStack {
                Button("Undo stroke") { actions.onUndoStroke(layer.id) }.disabled(layer.strokes.isEmpty)
                Button("Clear brush") { actions.onClearBrush(layer.id) }.disabled(layer.strokes.isEmpty)
            }
            .font(.subheadline)
            .padding(.vertical, 4)
        }
        Toggle("Show mask", isOn: Binding(get: { showMask }, set: actions.onShowMask)).font(.caption)
        Toggle("Invert", isOn: Binding(get: { layer.invert }, set: { v in actions.onUpdate(layer.id) { $0.invert = v } }))
            .font(.caption)
        ParamSlider(label: "Opacity", value: layer.opacity, range: 0...100, defaultValue: 100,
                    format: { "\(Int($0.rounded()))%" }) { v in actions.onUpdate(layer.id) { $0.opacity = v } }
        switch layer.shape {
        case let .linear(_, _, _, _, curve):
            ParamSlider(label: "Curvature", value: curve, range: -100...100, defaultValue: 0) { v in
                actions.onUpdate(layer.id) { l in
                    if case let .linear(x0, y0, x1, y1, _) = l.shape { l.shape = .linear(x0: x0, y0: y0, x1: x1, y1: y1, curve: v) }
                }
            }
        case let .radial(_, _, _, _, _, feather):
            ParamSlider(label: "Feather", value: feather, range: 0...100, defaultValue: 50, format: formatPlain) { v in
                actions.onUpdate(layer.id) { l in
                    if case let .radial(cx, cy, rx, ry, angle, _) = l.shape {
                        l.shape = .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: v)
                    }
                }
            }
        case .brush:
            EmptyView()
        }
        Note(hint(layer))
        if !layer.strokes.isEmpty { Note("Brush strokes belong to this photo: presets keep gradients only.") }
    }

    private func hint(_ layer: MaskLayer) -> String {
        if tool != .move { return "Paint with one finger, pan the 100% view with two." }
        switch layer.shape {
        case .linear:
            return "Solid line: full effect. Dashed line: no effect. Drag the middle line to move the gradient, an outer line to change its width and angle, the square to bend it."
        case .radial:
            return "Drag the centre to move, the dots to resize, the outer knob to rotate. The effect fades between the dashed and the solid ellipse."
        case .brush:
            return "Pick Brush to paint this layer's mask."
        }
    }

    @ViewBuilder
    private func adjustTab(_ layer: MaskLayer) -> some View {
        let a = layer.adjust
        let set = { (kp: WritableKeyPath<LayerAdjust, Float>) in { (v: Float) in actions.onUpdate(layer.id) { $0.adjust[keyPath: kp] = v } } }
        ParamSlider(label: "Exposure", value: a.exposure, range: -5...5, defaultValue: 0, format: formatEv, onChange: set(\.exposure))
        ParamSlider(label: "Contrast", value: a.contrast, range: -100...100, defaultValue: 0, onChange: set(\.contrast))
        ParamSlider(label: "Highlights", value: a.highlights, range: -100...100, defaultValue: 0, onChange: set(\.highlights))
        ParamSlider(label: "Shadows", value: a.shadows, range: -100...100, defaultValue: 0, onChange: set(\.shadows))
        ParamSlider(label: "Temperature", value: a.temperature, range: -100...100, defaultValue: 0, onChange: set(\.temperature))
        ParamSlider(label: "Tint", value: a.tint, range: -100...100, defaultValue: 0, onChange: set(\.tint))
        ParamSlider(label: "Saturation", value: a.saturation, range: -100...100, defaultValue: 0, onChange: set(\.saturation))
        ParamSlider(label: "Clarity", value: a.clarity, range: -100...100, defaultValue: 0, onChange: set(\.clarity))
    }
}
