import RawBoyEngine
import SwiftUI

/** Exponential slider 0..100 <-> [lo]..[hi], so small sizes are easy to set. */
private struct ExpSlider {
    let lo: Float
    let hi: Float

    func to(_ r: Float) -> Float { 100 * logf(r.clamped(lo, hi) / lo) / logf(hi / lo) }
    func from(_ v: Float) -> Float { lo * powf(hi / lo, v / 100) }
}

/** The effect's mean radius (fraction of the long side). */
private let sizeSlider = ExpSlider(lo: 0.03, hi: 1.5)
private func sizeOf(_ e: LightEffect) -> Float { (e.rx * e.ry).squareRoot() }

/** Stretch slider -100..100 <-> rx / ry, 1/4..4. */
private func stretchOf(_ rx: Float, _ ry: Float) -> Float { 100 * logf(rx / ry) / logf(4) }

private func percent(_ r: Float) -> String { "\(Int((r * 200).rounded()))%" }

private func fxColor(_ hue: Float) -> Color {
    let c = LightEffects.color(hue)
    return Color(red: Double(c[0]), green: Double(c[1]), blue: Double(c[2]))
}

/** The full hue circle for the Colour slider. */
private let hueTrack: [Color] = [0, 60, 120, 180, 240, 300, 360].map { fxColor(Float($0)) }

private func hueName(_ h: Float) -> String {
    let d = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    switch d {
    case ..<15: return "Red"
    case ..<45: return "Orange"
    case ..<70: return "Yellow"
    case ..<160: return "Green"
    case ..<200: return "Cyan"
    case ..<250: return "Blue"
    case ..<290: return "Violet"
    case ..<335: return "Magenta"
    default: return "Red"
    }
}

private func amountName(_ k: FxKind) -> String {
    switch k {
    case .lightning: "Branches"
    case .sparks: "Sparks"
    case .trails, .swirl: "Strands"
    }
}

/** What the light effects panel can do; the effects live in the params, the selection is UI state. */
struct FxPanelActions {
    let onSelect: (String) -> Void
    let onAdd: (FxKind) -> Void
    /** A slider ([force] false) or a button ([force] true). */
    let onUpdate: (String, Bool, (inout LightEffect) -> Void) -> Void
    let onRemove: (String) -> Void
    /** Switches to the light leaks tool (they share one top-bar button). */
    let onLeaks: () -> Void
    let onToggleZoom: () -> Void
    let onDone: () -> Void
}

/**
 * Light effects, "lomo" (mirrors Android's FxPanel and RawBoy Web's): lightning, electric sparks, light trails and
 * neon swirls, generated at random and dragged into place on the photo like light leaks. A top-bar mode like Leaks:
 * effect chips (long-press to hide or delete), then the selected effect's sliders; its box is also moved, sized and
 * turned on the photo.
 */
struct FxPanel: View {
    let effects: [LightEffect]
    let selectedId: String?
    /** The photo's width / height: Size and Stretch reset to the box that covers it. */
    let aspect: Float
    let zoomed: Bool
    let actions: FxPanelActions

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Picker("", selection: Binding(get: { true }, set: { if !$0 { actions.onLeaks() } })) {
                    Text("Light leaks").tag(false)
                    Text("Effects").tag(true)
                }
                .pickerStyle(.segmented)
                Button(zoomed ? "Fit" : "100%", action: actions.onToggleZoom)
                Button("Done", action: actions.onDone).fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(effects.enumerated()), id: \.element.id) { i, e in chip(e, i) }
                    if effects.count < LightEffects.maxEffects {
                        ForEach(FxKind.allCases, id: \.self) { k in
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
            if let fx = effects.first(where: { $0.id == selectedId }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { sliders(fx) }
                        .padding(.horizontal, 16)
                }
            } else {
                Note("Add lightning, electric sparks, light trails or a neon swirl: each press makes a new random one. Drag it over the photo, size and turn it with its dots, and press New random until you like it. The light glows into the photo like a double exposure and the grain stays on top. Up to \(LightEffects.maxEffects); effects reset for each new photo.")
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 6)
    }

    private func chip(_ e: LightEffect, _ i: Int) -> some View {
        let selected = e.id == selectedId
        return HStack(spacing: 6) {
            Circle().fill(fxColor(e.hue)).frame(width: 10, height: 10)
            Text(e.enabled ? "\(e.kind.label) \(i + 1)" : "\(e.kind.label) \(i + 1) (off)")
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(selected ? Color.accentColor.opacity(0.3) : Color.clear))
        .overlay(Capsule().stroke(selected ? Color.accentColor : Color.secondary.opacity(0.5)))
        .onTapGesture { actions.onSelect(e.id) }
        .contextMenu {
            Button(e.enabled ? "Hide" : "Show") { actions.onUpdate(e.id, true) { $0.enabled.toggle() } }
            Button("Delete", role: .destructive) { actions.onRemove(e.id) }
        }
    }

    /** A slider's change to [fx] ([force] false), or a button's (true). */
    private func set(_ fx: LightEffect, _ force: Bool = false, _ change: (inout LightEffect) -> Void) {
        actions.onUpdate(fx.id, force, change)
    }

    @ViewBuilder
    private func sliders(_ fx: LightEffect) -> some View {
        let cover = LightEffects.coverSize(aspect: aspect)
        Button { set(fx, true) { $0.seed = LightEffects.newSeed() } } label: {
            Label("New random", systemImage: "dice")
        }
        .font(.subheadline)
        .padding(.vertical, 4)
        Picker("", selection: Binding(get: { fx.kind }, set: { k in set(fx, true) { $0 = $0.withKind(k) } })) {
            ForEach(FxKind.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .padding(.vertical, 4)
        ParamSlider(label: "Intensity", value: fx.intensity, range: 0...100, defaultValue: 100,
                    format: { "\(Int($0.rounded()))%" }) { v in set(fx) { $0.intensity = v } }
        ParamSlider(label: amountName(fx.kind), value: fx.amount, range: 0...100, defaultValue: fx.kind.amount,
                    format: formatPlain) { v in set(fx) { $0.amount = v } }
        ParamSlider(label: "Size", value: sizeSlider.to(sizeOf(fx)), range: 0...100,
                    defaultValue: sizeSlider.to((cover.rx * cover.ry).squareRoot()),
                    format: { percent(sizeSlider.from($0)) }) { v in
            set(fx) { e in
                let k = sizeSlider.from(v) / sizeOf(e)
                e.rx *= k
                e.ry *= k
            }
        }
        ParamSlider(label: "Stretch", value: stretchOf(fx.rx, fx.ry), range: -100...100,
                    defaultValue: stretchOf(cover.rx, cover.ry),
                    format: { String(format: "%.2f:1", powf(4, $0 / 100)) }) { v in
            set(fx) { e in
                let s = sizeOf(e)
                let ratio = powf(4, v / 100).squareRoot()
                e.rx = s * ratio
                e.ry = s / ratio
            }
        }
        ParamSlider(label: "Rotation", value: fx.angle, range: -180...180, defaultValue: fx.kind.angle,
                    format: { "\(Int($0.rounded()))°" }) { v in set(fx) { $0.angle = v } }
        ParamSlider(label: "Thickness", value: fx.thickness, range: 0...100, defaultValue: fx.kind.thickness,
                    format: formatPlain) { v in set(fx) { $0.thickness = v } }
        ParamSlider(label: "Glow", value: fx.glow, range: 0...100, defaultValue: fx.kind.glow, format: formatPlain) { v in
            set(fx) { $0.glow = v }
        }
        ParamSlider(label: "Colour", value: fx.hue, range: 0...360, defaultValue: fx.kind.hue, format: hueName,
                    trackGradient: hueTrack) { v in set(fx) { $0.hue = v } }
        ParamSlider(label: "Colour mix", value: fx.spread, range: 0...100, defaultValue: fx.kind.spread,
                    format: formatPlain) { v in set(fx) { $0.spread = v } }
        Note("Drag inside the box to move the effect, the dots to size it along and across, the round knob to turn it. New random draws a new pattern with the same settings. Colour mix lets each line drift from the colour (sparks in blue, violet and green). Effects aren't saved in presets: they belong to this photo.")
    }
}
