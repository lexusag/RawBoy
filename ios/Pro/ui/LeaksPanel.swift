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

private func paletteColor(_ p: FilmPalette) -> Color {
    let c = p.rgb
    return Color(red: c.0, green: c.1, blue: c.2)
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
    let onSelectFilm: (String) -> Void
    let onAddFilm: (FilmLeakType?) -> Void
    let onRandomRoll: () -> Void
    let onUpdateFilm: (String, Bool, (inout FilmLeak) -> Void) -> Void
    let onRemoveFilm: (String) -> Void
    /** Switches to the light effects tool (they share one top-bar button). */
    let onFx: () -> Void
    let onToggleZoom: () -> Void
    let onDone: () -> Void
}

/**
 * Light leaks (mirrors Android's LeaksPanel and RawBoy Web's): film-style light (streaks, glows, triangles) and
 * generated film leaks/damage dragged into place on the photo. Up to LightLeaks.maxLeaks layers total.
 */
struct LeaksPanel: View {
    let leaks: [LightLeak]
    let selectedId: String?
    let filmLeaks: [FilmLeak]
    let selectedFilmId: String?
    let zoomed: Bool
    let actions: LeakPanelActions
    @State private var genType: FilmLeakType? = nil

    private var budgetLeft: Bool { leaks.count + filmLeaks.count < LightLeaks.maxLeaks }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Picker("", selection: Binding(get: { false }, set: { if $0 { actions.onFx() } })) {
                    Text("Light leaks").tag(false)
                    Text("Effects").tag(true)
                }
                .pickerStyle(.segmented)
                .neutralSegments()
                Button(zoomed ? "Fit" : "100%", action: actions.onToggleZoom)
                Button("Done", action: actions.onDone).fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(leaks.enumerated()), id: \.element.id) { i, l in chip(l, i) }
                    ForEach(Array(filmLeaks.enumerated()), id: \.element.id) { i, fl in filmChip(fl, i) }
                    if budgetLeft {
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
            generateBar
            if let fl = filmLeaks.first(where: { $0.id == selectedFilmId }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { filmSliders(fl) }
                        .padding(.horizontal, 16)
                }
            } else if let leak = leaks.first(where: { $0.id == selectedId }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { sliders(leak) }
                        .padding(.horizontal, 16)
                }
            } else {
                Note("Add a hand-drawn light leak (+ Streak/Glow/Triangle) or generate a procedural film leak/damage below (up to \(LightLeaks.maxLeaks) total). Generated leaks can be saved in presets under Light leaks.")
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
        .chipStyle(selected: selected)
        .tapButton(selected: selected, hint: "Selects this light leak") { actions.onSelect(l.id) }
        .contextMenu {
            Button(l.enabled ? "Hide" : "Show") { actions.onUpdate(l.id, true) { $0.enabled.toggle() } }
            Button("Delete", role: .destructive) { actions.onRemove(l.id) }
        }
    }

    private func filmChip(_ fl: FilmLeak, _ i: Int) -> some View {
        let selected = fl.id == selectedFilmId
        return HStack(spacing: 6) {
            Circle().fill(paletteColor(fl.palette)).frame(width: 10, height: 10)
            Text(fl.enabled ? "\(fl.type.label) \(i + 1)" : "\(fl.type.label) \(i + 1) (off)")
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .chipStyle(selected: selected)
        .tapButton(selected: selected, hint: "Selects this generated film leak") { actions.onSelectFilm(fl.id) }
        .contextMenu {
            Button(fl.enabled ? "Hide" : "Show") { actions.onUpdateFilm(fl.id, true) { $0.enabled.toggle() } }
            Button("Delete", role: .destructive) { actions.onRemoveFilm(fl.id) }
        }
    }

    private var generateBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    Text("Any")
                        .font(.caption)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .chipStyle(selected: genType == nil)
                        .tapButton(selected: genType == nil, hint: "Random type") { genType = nil }
                    ForEach(FilmLeakType.allCases, id: \.self) { t in
                        Text(t.label)
                            .font(.caption)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .chipStyle(selected: genType == t)
                            .tapButton(selected: genType == t, hint: "Select \(t.label)") { genType = t }
                    }
                }
                .padding(.horizontal, 12)
            }
            .scrollIndicators(.hidden)
            HStack(spacing: 8) {
                Button("🎲 Random") { actions.onAddFilm(genType) }
                    .font(.subheadline).fontWeight(.medium)
                    .disabled(!budgetLeft)
                Button("Roll") { actions.onRandomRoll() }
                    .font(.subheadline)
                    .disabled(leaks.count >= LightLeaks.maxLeaks)
                if let fl = filmLeaks.first(where: { $0.id == selectedFilmId }) {
                    Button("New variation") {
                        actions.onUpdateFilm(fl.id, true) { $0 = FilmLeaks.newVariation($0, seed: Float(FilmLeaks.newSeed())) }
                    }
                    .font(.subheadline)
                }
                if budgetLeft, let t = genType {
                    Button("+ Add \(t.label)") { actions.onAddFilm(t) }
                        .font(.subheadline)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
        }
    }

    private func setFilm(_ fl: FilmLeak, _ force: Bool = false, _ change: (inout FilmLeak) -> Void) {
        actions.onUpdateFilm(fl.id, force, change)
    }

    @ViewBuilder
    private func filmSliders(_ fl: FilmLeak) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(FilmPalette.allCases, id: \.self) { p in
                    HStack(spacing: 4) {
                        Circle().fill(paletteColor(p)).frame(width: 10, height: 10)
                        Text(p.label).font(.caption)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .chipStyle(selected: fl.palette == p)
                    .tapButton(selected: fl.palette == p, hint: "Palette \(p.label)") { setFilm(fl, true) { $0.palette = p } }
                }
            }
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
        HStack(spacing: 6) {
            if fl.type == .streak || fl.type == .scratches {
                Button("↔ Horizontal") { setFilm(fl, true) { $0.turn = 0 } }.font(.caption)
                Button("↕ Vertical") { setFilm(fl, true) { $0.turn = 1 } }.font(.caption)
            } else if fl.type != .dust && fl.type != .fog && fl.type != .stain {
                ForEach([(0, "←"), (1, "↑"), (2, "→"), (3, "↓")], id: \.0) { t, arrow in
                    Button(arrow) { setFilm(fl, true) { $0 = FilmLeaks.sideMove($0, turn: t) } }
                        .font(.caption)
                        .fontWeight(fl.turn == t ? .bold : .regular)
                }
            }
            Button(fl.mirror ? "Flipped" : "Flip") { setFilm(fl, true) { $0.mirror.toggle() } }
                .font(.caption)
            Spacer()
        }
        .padding(.vertical, 2)
        ParamSlider(label: "Intensity", value: fl.intensity, range: 0...100, defaultValue: 80,
                    format: { "\(Int($0.rounded()))%" }) { v in setFilm(fl) { $0.intensity = v } }
        ParamSlider(label: "Softness", value: fl.softness, range: 0...100, defaultValue: 50,
                    format: formatPlain) { v in setFilm(fl) { $0.softness = v } }
        ParamSlider(label: "Texture", value: fl.texture, range: 0...100, defaultValue: 65,
                    format: formatPlain) { v in setFilm(fl) { $0.texture = v } }
        ParamSlider(label: "Amount", value: fl.amount, range: 0...100, defaultValue: 55,
                    format: formatPlain) { v in setFilm(fl) { $0.amount = v } }
        ParamSlider(label: "Variant", value: fl.variant, range: 0...100, defaultValue: 50,
                    format: formatPlain) { v in setFilm(fl) { $0.variant = v } }
        ParamSlider(label: "Warmth", value: fl.warmth, range: -100...100, defaultValue: 0,
                    format: formatPlain) { v in setFilm(fl) { $0.warmth = v } }
        ParamSlider(label: "Tint", value: fl.tint, range: -100...100, defaultValue: 0,
                    format: formatPlain) { v in setFilm(fl) { $0.tint = v } }
        ParamSlider(label: "Fade", value: fl.fade, range: 0...100, defaultValue: 0,
                    format: formatPlain) { v in setFilm(fl) { $0.fade = v } }
        ParamSlider(label: "Contrast", value: fl.contrast, range: -100...100, defaultValue: 0,
                    format: formatPlain) { v in setFilm(fl) { $0.contrast = v } }
        Note("Drag inside the box to move, or drag any of its 8 handles to stretch along X/Y. The bright edge marks where light enters or the film ends.")
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
        .neutralSegments()
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
        ParamSlider(label: "Texture", value: leak.texture, range: 0...100, defaultValue: 0, format: formatPlain) { v in
            set(leak) { $0.texture = v }
        }
        ParamSlider(label: "Cover", value: leak.cover, range: 0...100, defaultValue: 0,
                    format: { "\(Int($0.rounded()))%" }) { v in set(leak) { $0.cover = v } }
        ParamSlider(label: "Softness", value: leak.softness, range: 0...100, defaultValue: leak.kind.softness,
                    format: formatPlain) { v in set(leak) { $0.softness = v } }
        ParamSlider(label: "Glow", value: leak.glow, range: 0...100, defaultValue: leak.kind.glow, format: formatPlain) { v in
            set(leak) { $0.glow = v }
        }
        ParamSlider(label: "Colour", value: leak.hue, range: LightLeaks.hueMin...LightLeaks.hueMax,
                    defaultValue: LightLeaks.hue, format: hueName, trackGradient: hueTrack) { v in set(leak) { $0.hue = v } }
        if leak.warp > 0 || leak.texture > 0 {
            Button("New pattern") { set(leak, true) { $0.seed = LightLeaks.newSeed() } }
                .font(.subheadline)
                .padding(.vertical, 4)
        }
        if LightLeaks.reshaped(leak) {
            Button("Round outline") { set(leak, true) { $0.radii = LightLeaks.roundRadii } }
                .font(.subheadline)
                .padding(.vertical, 4)
        }
        Note("Drag the leak to move it, the dots to resize (" +
             (leak.kind == .streak ? "side dots: width, end dots: length" : "along and across") +
             (leak.kind == .glow ? "), the hollow dots to reshape its outline around what it should hide, the round knob to turn it, the square to bend it."
                 : "), the round knob to turn it, the square to bend it.") +
             " Inside the dashed line it is pure white at full intensity; the glow around it is added in Screen mode. Leaks aren't saved in presets: they belong to this photo.")
    }
}
