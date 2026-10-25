import RawBoyEngine
import SwiftUI

/** Exponential slider 0..100 <-> [lo]..[hi], so small sizes are easy to set. */
private struct ExpSlider {
    let lo: Float
    let hi: Float

    func to(_ r: Float) -> Float { 100 * logf(r.clamped(lo, hi) / lo) / logf(hi / lo) }
    func from(_ v: Float) -> Float { lo * powf(hi / lo, v / 100) }
}

/** A glow's or triangle's mean radius; a streak's half width and half length (fractions of the long side). */
private let sizeSlider = ExpSlider(lo: 0.02, hi: 0.8)
private let widthSlider = ExpSlider(lo: 0.003, hi: 0.3)
private let lengthSlider = ExpSlider(lo: 0.1, hi: 1.5)
private func sizeOf(_ l: LightLeak) -> Float { (l.rx * l.ry).squareRoot() }

/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
private func stretchOf(_ rx: Float, _ ry: Float) -> Float { 100 * logf(rx / ry) / logf(4) }

private func percent(_ r: Float) -> String { String(format: r < 0.05 ? "%.1f%%" : "%.0f%%", r * 200) }

private func leakColor(_ hue: Float) -> Color {
    let c = LightLeaks.color(hue)
    return Color(red: Double(c[0]), green: Double(c[1]), blue: Double(c[2]))
}

/** Inner glow colours across the Colour slider. */
private let hueTrack: [Color] = [LightLeaks.hueMin, -20, 0, 20, 40, LightLeaks.hueMax].map(leakColor)

private func hueName(_ h: Float) -> String {
    h < -15 ? "Magenta" : h < 10 ? "Red" : h < 45 ? "Orange" : "Amber"
}

/** What the light leaks panel can do; the leaks live in the params, the selection is UI state. */
struct LeakPanelActions {
    let onSelect: (String) -> Void
    let onAdd: (LeakKind) -> Void
    /** A slider ([force] false) or a button ([force] true). */
    let onUpdate: (String, Bool, (inout LightLeak) -> Void) -> Void
    let onRemove: (String) -> Void
    let onToggleZoom: () -> Void
    let onDone: () -> Void
}

/**
 * Light leaks (mirrors Android's LeaksPanel and RawBoy Web's): film-style light (streaks, glows, triangles) dragged
 * into place on the photo, e.g. to tastefully cover part of a nude. A top-bar mode like Masks: leak chips (long-press
 * to hide or delete), then the selected leak's sliders; the shape is also moved, sized, turned and bent on the photo.
 */
struct LeaksPanel: View {
    let leaks: [LightLeak]
    let selectedId: String?
    let zoomed: Bool
    let actions: LeakPanelActions

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Light leaks").font(.headline)
                Spacer()
                Button(zoomed ? "Fit" : "100%", action: actions.onToggleZoom)
                Button("Done", action: actions.onDone).fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(leaks.enumerated()), id: \.element.id) { i, l in chip(l, i) }
                    if leaks.count < LightLeaks.maxLeaks {
                        ForEach(LeakKind.allCases, id: \.self) { k in
                            Button { actions.onAdd(k) } label: {
                                Text("+ \(k.label)").font(.subheadline).padding(.horizontal, 10).padding(.vertical, 6)
                                    .overlay(Capsule().stroke(Color.secondary.opacity(0.5)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 12)
            }
            .scrollIndicators(.hidden)
            if let leak = leaks.first(where: { $0.id == selectedId }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { sliders(leak) }
                        .padding(.horizontal, 16)
                }
            } else {
                Note("Add a film-style light leak (a streak of light, a round glow or a triangle), then drag it over the photo. It is added in Screen mode, so the photo shows through its glow; at full intensity its white middle (inside the dashed line) hides what is under it, so it can cover part of a photo. The grain stays on top. Up to \(LightLeaks.maxLeaks); leaks reset for each new photo.")
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 6)
    }

    private func chip(_ l: LightLeak, _ i: Int) -> some View {
        let selected = l.id == selectedId
        return HStack(spacing: 6) {
            Circle().fill(leakColor(l.hue)).frame(width: 10, height: 10)
            Text(l.enabled ? "\(l.kind.label) \(i + 1)" : "\(l.kind.label) \(i + 1) (off)")
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(selected ? Color.accentColor.opacity(0.3) : Color.clear))
        .overlay(Capsule().stroke(selected ? Color.accentColor : Color.secondary.opacity(0.5)))
        .onTapGesture { actions.onSelect(l.id) }
        .contextMenu {
            Button(l.enabled ? "Hide" : "Show") { actions.onUpdate(l.id, true) { $0.enabled.toggle() } }
            Button("Delete", role: .destructive) { actions.onRemove(l.id) }
        }
    }

    /** A slider's change to [leak] ([force] false), or a button's (true). */
    private func set(_ leak: LightLeak, _ force: Bool = false, _ change: (inout LightLeak) -> Void) {
        actions.onUpdate(leak.id, force, change)
    }

    @ViewBuilder
    private func sliders(_ leak: LightLeak) -> some View {
        Picker("", selection: Binding(get: { leak.kind }, set: { k in set(leak, true) { $0 = $0.withKind(k) } })) {
            ForEach(LeakKind.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.vertical, 4)
        ParamSlider(label: "Intensity", value: leak.intensity, range: 0...100, defaultValue: 100,
                    format: { "\(Int($0.rounded()))%" }) { v in set(leak) { $0.intensity = v } }
        if leak.kind == .streak {
            ParamSlider(label: "Width", value: widthSlider.to(leak.ry), range: 0...100,
                        defaultValue: widthSlider.to(LeakKind.streak.ry),
                        format: { percent(widthSlider.from($0)) }) { v in set(leak) { $0.ry = widthSlider.from(v) } }
            ParamSlider(label: "Length", value: lengthSlider.to(leak.rx), range: 0...100,
                        defaultValue: lengthSlider.to(LeakKind.streak.rx),
                        format: { percent(lengthSlider.from($0)) }) { v in set(leak) { $0.rx = lengthSlider.from(v) } }
        } else {
            ParamSlider(label: "Size", value: sizeSlider.to(sizeOf(leak)), range: 0...100,
                        defaultValue: sizeSlider.to((leak.kind.rx * leak.kind.ry).squareRoot()),
                        format: { percent(sizeSlider.from($0)) }) { v in
                set(leak) { l in
                    let k = sizeSlider.from(v) / sizeOf(l)
                    l.rx *= k
                    l.ry *= k
                }
            }
            ParamSlider(label: "Stretch", value: stretchOf(leak.rx, leak.ry), range: -100...100,
                        defaultValue: stretchOf(leak.kind.rx, leak.kind.ry),
                        format: { String(format: "%.2f:1", powf(4, $0 / 100)) }) { v in
                set(leak) { l in
                    let s = sizeOf(l)
                    let ratio = powf(4, v / 100).squareRoot()
                    l.rx = s * ratio
                    l.ry = s / ratio
                }
            }
        }
        ParamSlider(label: "Rotation", value: leak.angle, range: -180...180, defaultValue: leak.kind.angle,
                    format: { "\(Int($0.rounded()))°" }) { v in set(leak) { $0.angle = v } }
        ParamSlider(label: "Bend", value: leak.bend, range: -100...100, defaultValue: 0) { v in set(leak) { $0.bend = v } }
        ParamSlider(label: "Taper", value: leak.taper, range: -100...100, defaultValue: 0) { v in set(leak) { $0.taper = v } }
        ParamSlider(label: "Warp", value: leak.warp, range: 0...100, defaultValue: 0, format: formatPlain) { v in
            set(leak) { $0.warp = v }
        }
        ParamSlider(label: "Softness", value: leak.softness, range: 0...100, defaultValue: leak.kind.softness,
                    format: formatPlain) { v in set(leak) { $0.softness = v } }
        ParamSlider(label: "Glow", value: leak.glow, range: 0...100, defaultValue: leak.kind.glow, format: formatPlain) { v in
            set(leak) { $0.glow = v }
        }
        ParamSlider(label: "Colour", value: leak.hue, range: LightLeaks.hueMin...LightLeaks.hueMax,
                    defaultValue: LightLeaks.hue, format: hueName, trackGradient: hueTrack) { v in set(leak) { $0.hue = v } }
        if leak.warp > 0 {
            Button("New warp") { set(leak, true) { $0.seed = LightLeaks.newSeed() } }
                .font(.subheadline)
                .padding(.vertical, 4)
        }
        Note("Drag the leak to move it, the dots to resize (" +
             (leak.kind == .streak ? "side dots: width, end dots: length" : "along and across") +
             "), the round knob to turn it, the square to bend it. Inside the dashed line it is pure white at full intensity; the glow around it is added in Screen mode. Leaks aren't saved in presets: they belong to this photo.")
    }
}
