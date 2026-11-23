import Foundation

/**
 * One photo's complete edit as JSON (port of Android's Edits.kt and web's Edits.ts, the same format): what RawBoy
 * Desktop keeps in the photo's XMP sidecar (`rawboy:Develop`, see `XmpSidecar`). Unlike a preset it holds every field:
 * geometry (rotation, flips, straighten, perspective, crop), mask layers with their brush strokes and lens blur, light
 * leaks and light effects. Only fields that differ from the photo's as-shot defaults are kept: absolute values, but a
 * small sidecar.
 *
 * The web writes a few fields this engine has no counterpart for (heal spots, portrait retouch, luma contrast): they
 * come back in `Decoded.extras` and go out again through `encode(extras:)`, so saving a photo edited on the web doesn't
 * lose them.
 */
public enum Edits {
    public static let format = "rawboy-edit"
    public static let version = 1

    /** Every preset group's fields; masks are written with their strokes (below), not as a preset keeps them. */
    private static let sliders: [String] = (PresetGroup.allCases.flatMap(\.fields) + ["depthFocus"]).filter { $0 != "masks" }

    private static let geometry = [
        "rotation", "flipHorizontal", "flipVertical", "straighten", "perspectiveVertical", "perspectiveHorizontal", "scale",
        "cropLeft", "cropTop", "cropRight", "cropBottom", "masks", "leaks", "filmLeaks", "fx", "healSpots", "disabled",
    ]
    private static let known = Set(sliders + geometry)

    /** A decoded edit: the parameters, and the values this engine doesn't know (kept verbatim, JSON objects). */
    public struct Decoded {
        public var params: DevelopParams
        public var extras: [String: Any]
    }

    private static func values(_ p: DevelopParams) -> [String: Any] {
        var out: [String: Any] = [:]
        for f in sliders {
            switch Presets.get(p, f) {
            case let .number(n): out[f] = Masks.num(n)
            case let .text(s): out[f] = s.map { $0 as Any } ?? NSNull()
            case let .flag(b): out[f] = b
            case let .curves(c): out[f] = c.toJson()
            case .layers, .filmLeaks: break
            }
        }
        out["rotation"] = p.rotation
        out["flipHorizontal"] = p.flipHorizontal
        out["flipVertical"] = p.flipVertical
        out["straighten"] = Masks.num(p.straighten)
        out["perspectiveVertical"] = Masks.num(p.perspectiveVertical)
        out["perspectiveHorizontal"] = Masks.num(p.perspectiveHorizontal)
        out["scale"] = Masks.num(p.scale)
        out["cropLeft"] = Masks.num(p.cropLeft)
        out["cropTop"] = Masks.num(p.cropTop)
        out["cropRight"] = Masks.num(p.cropRight)
        out["cropBottom"] = Masks.num(p.cropBottom)
        out["masks"] = Masks.toJson(p.masks, strokes: true)
        out["leaks"] = LightLeaks.toJson(p.leaks)
        out["filmLeaks"] = FilmLeaks.toJson(p.filmLeaks)
        out["fx"] = LightEffects.toJson(p.fx)
        out["healSpots"] = HealSpots.toJson(p.healSpots)
        out["disabled"] = p.disabledSections.sorted()
        return out
    }

    /** A value's canonical text, to tell whether an edit differs from the default. */
    private static func canonical(_ v: Any?) -> String {
        guard let v, let data = try? JSONSerialization.data(withJSONObject: [v], options: [.sortedKeys]) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /**
     * [params] as edits JSON, or nil when they are the photo's [defaults] (nothing to keep); with [keepEmpty] an edit
     * with no values then. [extras] (from `decode`) are written as they came.
     */
    public static func encode(_ params: DevelopParams, defaults: DevelopParams, keepEmpty: Bool = false,
                              extras: [String: Any] = [:]) -> String? {
        let base = values(defaults)
        var changed: [String: Any] = [:]
        for (k, v) in values(params) where canonical(v) != canonical(base[k]) { changed[k] = v }
        for (k, v) in extras where changed[k] == nil && !known.contains(k) { changed[k] = v }
        if changed.isEmpty && !keepEmpty { return nil }
        let json: [String: Any] = ["format": format, "version": version, "values": changed]
        guard let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys, .withoutEscapingSlashes])
        else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /**
     * The photo's [defaults] with the edits in [text]; fields missing from it (unedited, or newer than the RawBoy that
     * wrote it) keep their defaults and values of the wrong type are skipped. nil when [text] isn't RawBoy edits.
     */
    public static func decode(_ text: String, defaults: DevelopParams) -> DevelopParams? {
        decodeAll(text, defaults: defaults)?.params
    }

    /** As `decode`, keeping the values this engine doesn't know (web-only fields) for `encode(extras:)`. */
    public static func decodeAll(_ text: String, defaults: DevelopParams) -> Decoded? {
        guard let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              json["format"] as? String == format else { return nil }
        let v = json["values"] as? [String: Any] ?? [:]
        var p = defaults
        for f in sliders {
            guard let raw = v[f] else { continue }
            let value: PresetValue
            if f == "curves" {
                guard let c = ToneCurves.parse(raw) else { continue }
                value = .curves(c)
            } else if raw is NSNull {
                value = .text(nil)
            } else if let n = raw as? NSNumber {
                value = CFGetTypeID(n) == CFBooleanGetTypeID() ? .flag(n.boolValue) : .number(n.floatValue)
            } else if let s = raw as? String {
                value = .text(s)
            } else {
                continue
            }
            p = Presets.set(p, f, value)
        }
        func number(_ k: String) -> NSNumber? {
            guard let n = v[k] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            return n
        }
        func f(_ k: String, _ lo: Float, _ hi: Float) -> Float? {
            guard let n = number(k), n.floatValue.isFinite else { return nil }
            return n.floatValue.clamped(lo, hi)
        }
        let left = f("cropLeft", 0, 1) ?? p.cropLeft
        let top = f("cropTop", 0, 1) ?? p.cropTop
        let right = f("cropRight", 0, 1) ?? p.cropRight
        let bottom = f("cropBottom", 0, 1) ?? p.cropBottom
        let cropOk = right > left && bottom > top
        if let n = number("rotation"), n.doubleValue.isFinite {
            p.rotation = ((Int(n.doubleValue.rounded()) % 4) + 4) % 4
        }
        p.flipHorizontal = v["flipHorizontal"] as? Bool ?? p.flipHorizontal
        p.flipVertical = v["flipVertical"] as? Bool ?? p.flipVertical
        p.straighten = f("straighten", -45, 45) ?? p.straighten
        p.perspectiveVertical = f("perspectiveVertical", -100, 100) ?? p.perspectiveVertical
        p.perspectiveHorizontal = f("perspectiveHorizontal", -100, 100) ?? p.perspectiveHorizontal
        p.scale = f("scale", 100, 200) ?? p.scale
        if cropOk {
            p.cropLeft = left
            p.cropTop = top
            p.cropRight = right
            p.cropBottom = bottom
        }
        if v["masks"] != nil { p.masks = Masks.parseLayers(v["masks"], strokes: true) }
        if v["leaks"] != nil { p.leaks = LightLeaks.parseLeaks(v["leaks"]) }
        if v["filmLeaks"] != nil { p.filmLeaks = FilmLeaks.parseLeaks(v["filmLeaks"]) }
        if v["fx"] != nil { p.fx = LightEffects.parseEffects(v["fx"]) }
        if v["healSpots"] != nil { p.healSpots = HealSpots.parse(v["healSpots"]) }
        if let ids = v["disabled"] as? [String] { p.disabledSections = Set(ids.filter { EditSection(rawValue: $0) != nil }) }
        return Decoded(params: p, extras: v.filter { !known.contains($0.key) })
    }
}
