import RawBoyEngine
import SwiftUI

/** What new healing strokes start with: Size and Feather set this and never touch strokes already painted. */
struct HealBrush: Equatable {
    var radius: Float = 0.008
    var feather: Float = HealSpots.defaultFeather
    /** New strokes clone from a source circle you place (otherwise the engine picks the texture donor). */
    var chooseSource = false
    /** Where a new stroke's source lies relative to its start (image fractions), when [chooseSource]. */
    var offset: [Float] = [0.04, 0]
}

/** What the healing panel can do; the strokes live in the params, the selection and the brush are UI state. */
struct HealPanelActions {
    let onSelect: (String?) -> Void
    let onBrush: (HealBrush) -> Void
    /** A slider ([force] false) or a button ([force] true) changing one stroke. */
    let onUpdate: (String, Bool, (inout HealSpot) -> Void) -> Void
    let onRemove: (String) -> Void
    let onClear: () -> Void
    let onToggleZoom: () -> Void
    let onDone: () -> Void
}

/**
 * Healing brush (port of web's HealPanel): paint over a dust spot, blemish or small object on the photo (HealOverlay)
 * and it is healed away: seamless cloning, the tone from around it, the detail borrowed from a nearby clean area the
 * engine picks, or from a source you drag into place (clone-stamp style). A top-bar mode like Masks and Light leaks.
 */
struct HealPanel: View {
    let spots: [HealSpot]
    let selectedId: String?
    let brush: HealBrush
    /** The photo is being healed (the full-resolution image is redone and its previews rebuilt). */
    let working: Bool
    let zoomed: Bool
    let actions: HealPanelActions

    private var spot: HealSpot? { spots.first { $0.id == selectedId } }
    private var chooseSource: Bool { spot.map { $0.source != nil } ?? brush.chooseSource }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Healing brush").font(.headline)
                Spacer()
                Button(zoomed ? "Fit" : "100%", action: actions.onToggleZoom)
                Button("Done", action: actions.onDone).fontWeight(.semibold)
            }
            .padding(.horizontal, 16)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if spots.isEmpty {
                        Note("Paint over a dust spot, blemish or small object on the photo to heal it away: click for one spot, drag to paint a stroke (zoom to 100% for the fine ones: double-click or Z; hold Space and drag to pan). The tone is filled in from around it and the detail borrowed from a nearby clean area. Up to \(HealSpots.maxSpots) strokes; they belong to this photo and aren't kept in presets.")
                    }
                    ParamSlider(label: "Size", value: HealSpots.sizeValue(brush.radius), range: 0...100,
                                defaultValue: HealSpots.sizeValue(0.008),
                                format: { String(format: "%.1f%%", HealSpots.sizeRadius($0) * 200) }) { v in
                        var b = brush
                        b.radius = HealSpots.sizeRadius(v)
                        actions.onBrush(b)
                    }
                    ParamSlider(label: "Feather", value: brush.feather, range: 0...100, defaultValue: HealSpots.defaultFeather,
                                format: formatPlain) { v in
                        var b = brush
                        b.feather = v
                        actions.onBrush(b)
                    }
                    Picker("Texture from", selection: Binding(get: { chooseSource }, set: setChoose)) {
                        Text("Auto source").tag(false)
                        Text("Choose source").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .neutralSegments()
                    .padding(.vertical, 4)
                    if working { Note("Healing…") }
                    if spots.count >= HealSpots.maxSpots { Note("That is the most strokes a photo takes; delete one to add another.") }
                    ForEach(Array(spots.enumerated()), id: \.element.id) { i, s in row(s, i) }
                    if !spots.isEmpty {
                        Button("Clear all", action: actions.onClear).padding(.vertical, 4)
                        Note("Pick a stroke in the list to change its source. With Choose source, drag the dashed copy onto clean skin, sky or background of the same kind as the surroundings; new strokes keep that offset. Undo removes the last stroke, Delete the selected one, [ and ] change the size.")
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 6)
    }

    private func setChoose(_ choose: Bool) {
        var b = brush
        b.chooseSource = choose
        actions.onBrush(b)
        guard let s = spot else { return }
        let offset = brush.offset
        actions.onUpdate(s.id, true) {
            $0.source = choose ? [($0.x + offset[0]).clamped(0, 1), ($0.y + offset[1]).clamped(0, 1)] : nil
        }
    }

    private func row(_ s: HealSpot, _ i: Int) -> some View {
        let selected = s.id == selectedId
        return HStack {
            Button { actions.onSelect(selected ? nil : s.id) } label: {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(s.path.isEmpty ? "Spot" : "Stroke") \(i + 1)").font(.subheadline)
                    Text("\(s.source != nil ? "Chosen source" : "Auto source") · \(String(format: "%.1f%%", s.radius * 200))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { actions.onRemove(s.id) } label: { Image(systemName: "xmark") }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Color.accentColor.opacity(0.3) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? Color.accentColor : Color.secondary.opacity(0.4)))
        .padding(.vertical, 2)
    }
}
