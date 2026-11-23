import Foundation

/**
 * The edits ⌘C took, for ⌘V (RawBoy Desktop; web's EditClipboard.ts). It is a preset made of the chosen groups, by default
 * the ones a new preset ticks (not Lens, Masks, Denoise, Detail or generated leaks; geometry is never in a group), so
 * pasting is applying a preset. Pro and Auto share it: edits copied in one can be pasted in the other.
 */
@MainActor
public enum EditClipboard {
    public static let name = "Copied edits"

    /** What was copied last; nil before the first copy. */
    public private(set) static var preset: Preset?

    /** Copies [params]' [groups] (the preset defaults when omitted); nil when no group is chosen. */
    @discardableResult
    public static func copy(_ params: DevelopParams, _ groups: Set<PresetGroup> = PresetGroup.defaultGroups) -> Preset? {
        guard !groups.isEmpty else { return nil }
        let copied = Presets.capture(name, params, groups)
        preset = copied
        return copied
    }

    public static func clear() { preset = nil }

    /** "Copied 5 groups of edits": the toast after a copy. */
    public static func summary(_ preset: Preset?) -> String {
        guard let preset else { return "Nothing to copy: no group chosen" }
        return "Copied \(preset.groups.count == 1 ? "1 group" : "\(preset.groups.count) groups") of edits"
    }

    public static let nothingCopied = "Nothing copied yet: press ⌘C on a photo first"

    /**
     * [under] (a photo's own preset) with [over]'s fields on top, for a partial paste onto a photo that already has a
     * preset: the groups of both, [over]'s values winning (web's layerPreset).
     */
    public static func layer(_ under: Preset, _ over: Preset) -> Preset {
        Preset(
            id: Presets.newId(), name: "\(under.name) + \(over.name)", groups: under.groups.union(over.groups),
            values: under.values.merging(over.values) { _, new in new }, lens: under.lens
        )
    }
}
