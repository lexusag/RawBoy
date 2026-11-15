import Foundation

/** Which strip the Look tab shows: the LUT looks ([Looks]) or film stocks rendered as negative + print ([FilmLooks]). */
public enum LookMode: String, Sendable { case looks, film }

/**
 * A photo's RawBoy Auto settings as kept in its XMP sidecar (`rawboy:Auto`), so the photo comes back to Auto as it was
 * left. Port of web's `ui/auto/AutoSidecar.ts`, the same JSON. The analysis isn't kept: it is made again from the raw.
 */
public struct SavedAuto: @unchecked Sendable {
    public var mode: LookMode
    public var look: Look
    public var filmLook: Look
    public var strength: Float
    public var adjust: Adjustments
    /** Web's `retouch` and `lumaContrast` adjustments, which this engine has no slider for: kept and written back. */
    public var webAdjust: [String: Float]
    /** The preset itself (name, groups, values), so it doesn't depend on this machine's preset list. */
    public var preset: Preset?
    /** RawBoy edits (web's "Back to Auto"), edits JSON kept as it was: this engine's Auto has no counterpart. */
    public var edits: [String: Any]?
    /** The lens preset choice: nil = by lens, `Presets.noLensPreset`, or a picked preset's id. */
    public var lensChoice: String?
    /** The picked lens preset itself (kept with `lensChoice` = its id), else nil. */
    public var lensPreset: Preset?
    /** Added "As is" (web's plain): kept and written back. */
    public var plain: Bool
    /** Auto denoise given to a photo added "As is" (web's autoDenoise): kept and written back. */
    public var autoDenoise: Bool

    public init(mode: LookMode = .looks, look: Look = Looks.natural, filmLook: Look = FilmLooks.portra400,
                strength: Float = 100, adjust: Adjustments = .none, webAdjust: [String: Float] = [:], preset: Preset? = nil,
                edits: [String: Any]? = nil, lensChoice: String? = nil, lensPreset: Preset? = nil, plain: Bool = false,
                autoDenoise: Bool = false) {
        self.mode = mode
        self.look = look
        self.filmLook = filmLook
        self.strength = strength
        self.adjust = adjust
        self.webAdjust = webAdjust
        self.preset = preset
        self.edits = edits
        self.lensChoice = lensChoice
        self.lensPreset = lensPreset
        self.plain = plain
        self.autoDenoise = autoDenoise
    }
}

public enum AutoSidecar {
    public static let format = "rawboy-auto"
    public static let version = 1

    private static func number(_ v: Float) -> Double { Masks.num(v) }

    /** [s] as the JSON text kept in the sidecar. */
    public static func encode(_ s: SavedAuto) -> String {
        var adjust: [String: Any] = [
            "brightness": number(s.adjust.brightness), "warmth": number(s.adjust.warmth), "tint": number(s.adjust.tint),
            "contrast": number(s.adjust.contrast), "saturation": number(s.adjust.saturation), "grain": number(s.adjust.grain),
            "denoise": number(s.adjust.denoise), "rotation": s.adjust.rotation, "straighten": number(s.adjust.straighten),
            "lumaContrast": number(s.webAdjust["lumaContrast"] ?? 0), "retouch": number(s.webAdjust["retouch"] ?? 0),
        ]
        if let c = s.adjust.crop {
            adjust["crop"] = ["left": number(c.left), "top": number(c.top), "right": number(c.right), "bottom": number(c.bottom)]
        } else {
            adjust["crop"] = NSNull()
        }
        var o: [String: Any] = [
            "format": format, "version": version, "mode": s.mode.rawValue, "look": s.look.id, "filmLook": s.filmLook.id,
            "strength": number(s.strength), "adjust": adjust,
            "preset": s.preset.map(presetJson) ?? NSNull(), "edits": s.edits ?? NSNull(),
        ]
        // By lens is the default and isn't kept: the photo's lens finds its preset again.
        if s.plain { o["plain"] = true }
        if s.autoDenoise { o["autoDenoise"] = true }
        if s.lensChoice == Presets.noLensPreset {
            o["lens"] = Presets.noLensPreset
        } else if s.lensChoice != nil, let p = s.lensPreset {
            o["lens"] = presetJson(p)
        }
        return text(o)
    }

    private static func text(_ o: Any) -> String {
        let data = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes])
        return data.map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }

    /** A preset as the JSON value it has inside a preset file (the file holds an array of them). */
    private static func presetJson(_ p: Preset) -> Any {
        let data = Data(Presets.encode([p]).utf8)
        let parsed = try? JSONSerialization.jsonObject(with: data)
        if let a = parsed as? [Any], let first = a.first { return first }
        return parsed ?? NSNull()
    }

    private static func preset(from v: Any?) -> Preset? {
        guard let v, !(v is NSNull), JSONSerialization.isValidJSONObject(["x": v]) else { return nil }
        // `Presets.decode` takes a preset file: one preset object or an array of them.
        guard let data = try? JSONSerialization.data(withJSONObject: v), let t = String(data: data, encoding: .utf8) else { return nil }
        return (try? Presets.decode(t))?.first
    }

    private static func num(_ v: Any?, _ lo: Float, _ hi: Float, _ fallback: Float) -> Float {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.floatValue.isFinite else { return fallback }
        return min(hi, max(lo, n.floatValue))
    }

    /** A saved crop: four edges in 0..1 with something left between them, else none. */
    private static func crop(_ v: Any?) -> CropRect? {
        guard let c = v as? [String: Any] else { return nil }
        let r = CropRect(num(c["left"], 0, 1, 0), num(c["top"], 0, 1, 0), num(c["right"], 0, 1, 1), num(c["bottom"], 0, 1, 1))
        return r.right - r.left > 0.001 && r.bottom - r.top > 0.001 && !r.isFull ? r : nil
    }

    /** The settings in [text]; unknown or broken parts fall back to Auto's defaults. nil when it isn't Auto's JSON. */
    public static func decode(_ text: String) -> SavedAuto? {
        guard let o = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
              o["format"] as? String == format else { return nil }
        let a = o["adjust"] as? [String: Any] ?? [:]
        var adjust = Adjustments.none
        adjust.brightness = num(a["brightness"], -100, 100, 0)
        adjust.warmth = num(a["warmth"], -100, 100, 0)
        adjust.tint = num(a["tint"], -100, 100, 0)
        adjust.contrast = num(a["contrast"], -100, 100, 0)
        adjust.saturation = num(a["saturation"], -100, 100, 0)
        adjust.grain = num(a["grain"], -100, 100, 0)
        adjust.denoise = num(a["denoise"], -100, 100, 0)
        adjust.straighten = num(a["straighten"], -45, 45, 0)
        adjust.rotation = Int(num(a["rotation"], 0, 3, 0).rounded())
        adjust.crop = crop(a["crop"])
        let webAdjust = ["lumaContrast": num(a["lumaContrast"], -100, 100, 0), "retouch": num(a["retouch"], 0, 100, 0)]
            .filter { $0.value != 0 }
        var lensPreset: Preset?
        if let l = o["lens"], !(l is String) { lensPreset = preset(from: l).flatMap { $0.isLensPreset ? $0 : nil } }
        let lensString = o["lens"] as? String
        return SavedAuto(
            mode: o["mode"] as? String == "film" ? .film : .looks,
            look: Looks.byId(o["look"] as? String ?? ""), filmLook: FilmLooks.byId(o["filmLook"] as? String ?? ""),
            strength: num(o["strength"], 0, 100, 100), adjust: adjust, webAdjust: webAdjust,
            preset: preset(from: o["preset"]), edits: o["edits"] as? [String: Any],
            lensChoice: lensString == Presets.noLensPreset ? Presets.noLensPreset : lensPreset?.id, lensPreset: lensPreset,
            plain: o["plain"] as? Bool == true, autoDenoise: o["autoDenoise"] as? Bool == true)
    }
}
