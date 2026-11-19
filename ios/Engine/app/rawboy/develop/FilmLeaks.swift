import Foundation

/**
 * Film leaks (Pro & Auto, generated): procedural film light and damage, made by a generator rather than drawn by hand
 * (shaders/film_leak.glsl). Port of web/src/engine/develop/FilmLeaks.ts.
 *
 * Each layer sits in an axis-aligned box: centre (cx, cy) and size (w, h) in fractions of the decoded image's width and
 * height, dragged and stretched along x and y only. `turn` (0..3) says which side of the box the pattern comes from
 * (left, top, right, bottom); `mirror` flips it along that side. The pattern is drawn from `seed` (0..1).
 */
public enum FilmLeakType: String, CaseIterable, Codable, Sendable {
    case edge, blob, streak, sprocket, fog, rebate, flare, start, end, tear, dust, stain, scratches

    public var label: String {
        switch self {
        case .edge: "Edge burn"
        case .blob: "Blob"
        case .streak: "Streak"
        case .sprocket: "Sprocket holes"
        case .fog: "Fog"
        case .rebate: "Rebate glow"
        case .flare: "Flare"
        case .start: "Start of roll"
        case .end: "End of roll"
        case .tear: "Film tear"
        case .dust: "Dust & scratches"
        case .stain: "Chemical stain"
        case .scratches: "Scratches"
        }
    }

    /** Order matches FL_* constants in shaders/film_leak.glsl. */
    public var shaderId: Float {
        switch self {
        case .edge: 0
        case .blob: 1
        case .streak: 2
        case .sprocket: 3
        case .fog: 4
        case .rebate: 5
        case .flare: 6
        case .start: 7
        case .end: 8
        case .tear: 9
        case .dust: 10
        case .stain: 11
        case .scratches: 12
        }
    }
}

public enum FilmPalette: String, CaseIterable, Codable, Sendable {
    case warm, amber, red, magenta, cool, green, mono

    public var label: String {
        switch self {
        case .warm: "Warm"
        case .amber: "Amber"
        case .red: "Red"
        case .magenta: "Magenta"
        case .cool: "Cool"
        case .green: "Green"
        case .mono: "Mono"
        }
    }

    /** Primary exposure ratio per channel (and stain dye). */
    public var a: (Float, Float, Float) {
        switch self {
        case .warm: (1.0, 0.55, 0.18)
        case .amber: (1.0, 0.82, 0.28)
        case .red: (1.0, 0.22, 0.08)
        case .magenta: (1.0, 0.25, 0.6)
        case .cool: (0.25, 0.65, 1.0)
        case .green: (0.45, 1.0, 0.5)
        case .mono: (1.0, 0.95, 0.88)
        }
    }

    /** Secondary colour the light drifts towards. */
    public var b: (Float, Float, Float) {
        switch self {
        case .warm: (1.0, 0.25, 0.08)
        case .amber: (1.0, 0.55, 0.18)
        case .red: (1.0, 0.15, 0.35)
        case .magenta: (1.0, 0.22, 0.08)
        case .cool: (0.3, 0.95, 1.0)
        case .green: (0.8, 1.0, 0.3)
        case .mono: (1.0, 0.92, 0.82)
        }
    }

    /** Display swatch RGB in sRGB 0..1. */
    public var rgb: (Double, Double, Double) {
        switch self {
        case .warm: (1.0, 0.549, 0.18)
        case .amber: (1.0, 0.82, 0.278)
        case .red: (1.0, 0.22, 0.078)
        case .magenta: (1.0, 0.251, 0.6)
        case .cool: (0.251, 0.651, 1.0)
        case .green: (0.451, 1.0, 0.502)
        case .mono: (1.0, 0.949, 0.878)
        }
    }
}

public struct FilmLeak: Equatable, Identifiable, Sendable {
    public var id: String
    public var enabled: Bool
    public var type: FilmLeakType
    public var seed: Float
    public var cx: Float
    public var cy: Float
    public var w: Float
    public var h: Float
    public var turn: Int
    public var mirror: Bool
    public var palette: FilmPalette
    public var intensity: Float
    public var softness: Float
    public var texture: Float
    public var amount: Float
    public var variant: Float
    public var warmth: Float
    public var tint: Float
    public var fade: Float
    public var contrast: Float

    public init(
        id: String = Masks.newId(),
        enabled: Bool = true,
        type: FilmLeakType = .edge,
        seed: Float = 0,
        cx: Float = 0.5,
        cy: Float = 0.5,
        w: Float = 1.04,
        h: Float = 1.04,
        turn: Int = 0,
        mirror: Bool = false,
        palette: FilmPalette = .warm,
        intensity: Float = 80,
        softness: Float = 50,
        texture: Float = 65,
        amount: Float = 55,
        variant: Float = 50,
        warmth: Float = 0,
        tint: Float = 0,
        fade: Float = 0,
        contrast: Float = 0
    ) {
        self.id = id
        self.enabled = enabled
        self.type = type
        self.seed = seed
        self.cx = cx
        self.cy = cy
        self.w = w
        self.h = h
        self.turn = ((turn % 4) + 4) % 4
        self.mirror = mirror
        self.palette = palette
        self.intensity = intensity
        self.softness = softness
        self.texture = texture
        self.amount = amount
        self.variant = variant
        self.warmth = warmth
        self.tint = tint
        self.fade = fade
        self.contrast = contrast
    }
}

public struct FilmLeakUniforms: Equatable, Sendable {
    public let count: Int
    public let box: [Float]
    public let form: [Float]
    public let tint: [Float]
    public let tint2: [Float]
    public let look: [Float]
    public let grade: [Float]

    public static let none = FilmLeakUniforms(
        count: 0,
        box: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4),
        form: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4),
        tint: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4),
        tint2: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4),
        look: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4),
        grade: [Float](repeating: 0, count: FilmLeaks.maxLeaks * 4)
    )
}

public enum FilmLeaks {
    public static let maxLeaks = 4

    public static func isIdentity(_ l: FilmLeak) -> Bool {
        !l.enabled || (l.intensity <= 0 && l.warmth == 0 && l.tint == 0 && l.fade == 0 && l.contrast == 0)
    }

    public static func newSeed() -> Double {
        Double(UInt32.random(in: 0...UInt32.max)) / 4294967296.0
    }

    /** Mulberry32: portable bit-for-bit with FilmLeaks.ts. */
    private final class Mulberry32 {
        private var s: UInt32
        init(_ seed: UInt32) { self.s = seed }
        func next() -> Double {
            s = s &+ 0x6d2b79f5
            var t = s
            t = (t ^ (t >> 15)) &* (t | 1)
            t = t ^ (t &+ ((t ^ (t >> 7)) &* (t | 61)))
            return Double(t ^ (t >> 14)) / 4294967296.0
        }
    }

    private static func seedBits(_ seed: Double) -> UInt32 {
        let clamped = max(0.0, min(seed, 1.0))
        let scaled = Foundation.floor(clamped * 4294967296.0)
        return UInt32(truncatingIfNeeded: Int64(scaled))
    }

    private static func between(_ r: Mulberry32, _ lo: Double, _ hi: Double) -> Double {
        lo + (hi - lo) * r.next()
    }

    private static func pick<T>(_ r: Mulberry32, _ weights: [(T, Double)]) -> T {
        let total = weights.reduce(0.0) { $0 + $1.1 }
        var x = r.next() * total
        for (v, w) in weights {
            x -= w
            if x < 0 { return v }
        }
        return weights[weights.count - 1].0
    }

    private static let typeWeights: [(FilmLeakType, Double)] = [
        (.edge, 24), (.blob, 17), (.streak, 9), (.sprocket, 7), (.fog, 8), (.rebate, 5),
        (.flare, 6), (.start, 7), (.end, 5), (.tear, 3), (.stain, 3), (.dust, 3), (.scratches, 3),
    ]

    private static func paletteWeights(for type: FilmLeakType) -> [(FilmPalette, Double)] {
        switch type {
        case .edge: [(.warm, 45), (.amber, 20), (.red, 20), (.cool, 8), (.magenta, 7)]
        case .blob: [(.red, 45), (.warm, 30), (.magenta, 12), (.cool, 13)]
        case .streak: [(.warm, 40), (.mono, 25), (.amber, 20), (.red, 15)]
        case .sprocket: [(.warm, 50), (.red, 30), (.mono, 20)]
        case .fog: [(.mono, 45), (.warm, 30), (.cool, 25)]
        case .rebate: [(.red, 70), (.warm, 30)]
        case .flare: [(.warm, 100)]
        case .start: [(.warm, 40), (.amber, 35), (.red, 25)]
        case .end: [(.warm, 70), (.red, 30)]
        case .tear: [(.mono, 100)]
        case .dust: [(.mono, 100)]
        case .stain: [(.magenta, 35), (.amber, 35), (.green, 30)]
        case .scratches: [(.mono, 100)]
        }
    }

    private enum SidePref { case short, long, any }

    private static func sidePref(for type: FilmLeakType) -> SidePref {
        switch type {
        case .edge, .streak, .start, .end, .tear: .short
        case .sprocket: .long
        case .blob, .fog, .rebate, .flare, .dust, .stain, .scratches: .any
        }
    }

    private static func sideFor(
        _ r: Mulberry32, _ type: FilmLeakType, _ aspect: Double, shortSideSprockets: Bool = false
    ) -> Int {
        let shortSides = aspect >= 1 ? [0, 2] : [1, 3]
        let longSides = aspect >= 1 ? [1, 3] : [0, 2]
        if type == .sprocket {
            let pool = shortSideSprockets ? [0, 1, 2, 3] : longSides
            return pool[Int(Foundation.floor(r.next() * Double(pool.count)))]
        }
        let pref = sidePref(for: type)
        let pool: [Int]
        if pref == .any {
            pool = [0, 1, 2, 3]
        } else if r.next() < 0.85 {
            pool = pref == .short ? shortSides : longSides
        } else {
            pool = pref == .short ? longSides : shortSides
        }
        return pool[Int(Foundation.floor(r.next() * Double(pool.count)))]
    }

    private static func sideBox(
        _ turn: Int, _ depth: Double, _ along: Double, _ offset: Double = 0.5, _ over: Double = 0.02
    ) -> (cx: Double, cy: Double, w: Double, h: Double) {
        let near = depth / 2.0 - over
        switch turn {
        case 1: return (offset, near, along, depth)
        case 2: return (1.0 - near, offset, depth, along)
        case 3: return (offset, 1.0 - near, along, depth)
        default: return (near, offset, depth, along)
        }
    }

    private static func jsRound(_ v: Double) -> Float {
        Float(Foundation.floor(v + 0.5))
    }

    public static func random(
        type: FilmLeakType? = nil, aspect: Float, seed: Double, grade: Bool = true, shortSideSprockets: Bool = false
    ) -> FilmLeak {
        let asp = Double(max(aspect, 0.01))
        let r = Mulberry32(seedBits(seed))
        let t = type ?? pick(r, typeWeights)
        let turn = sideFor(r, t, asp, shortSideSprockets: shortSideSprockets)
        let palette = pick(r, paletteWeights(for: t))
        var box: (cx: Double, cy: Double, w: Double, h: Double) = (0.5, 0.5, 1.04, 1.04)
        var amount = between(r, 30, 80)
        var intensity = between(r, 65, 100)
        let variant = between(r, 0, 100)

        switch t {
        case .edge:
            box = sideBox(turn, between(r, 0.3, 0.8), 1.04)
            amount = between(r, 55, 85)
        case .start:
            box = sideBox(turn, between(r, 0.45, 0.95), 1.04)
            amount = between(r, 45, 80)
        case .end:
            box = sideBox(turn, between(r, 0.3, 0.7), 1.04)
            amount = between(r, 50, 80)
            intensity = 100
        case .tear:
            box = sideBox(turn, between(r, 0.14, 0.36), 1.04)
            amount = between(r, 20, 65)
            intensity = 100
        case .sprocket:
            box = sideBox(turn, between(r, 0.15, 0.4), 1.04)
            amount = between(r, 30, 80)
        case .rebate:
            box = sideBox(turn, between(r, 0.06, 0.15), 1.04, 0.5, 0)
            amount = between(r, 20, 70)
        case .blob:
            box = sideBox(turn, between(r, 0.5, 1.0), between(r, 0.6, 1.1), between(r, 0.2, 0.8))
            amount = between(r, 30, 70)
        case .flare:
            box = sideBox(turn, between(r, 0.6, 1.0), between(r, 0.6, 1.0), between(r, 0.15, 0.85))
            amount = between(r, 20, 60)
        case .streak:
            let thick = between(r, 0.15, 0.45)
            let pos = between(r, 0.2, 0.8)
            box = turn % 2 == 0 ? (0.5, pos, 1.1, thick) : (pos, 0.5, thick, 1.1)
            amount = between(r, 15, 60)
        case .fog:
            intensity = between(r, 40, 80)
        case .dust:
            box = (0.5, 0.5, 1, 1)
            amount = between(r, 35, 85)
            intensity = between(r, 65, 95)
        case .scratches:
            box = (0.5, 0.5, 1, 1)
            amount = between(r, 35, 85)
            intensity = between(r, 65, 95)
        case .stain:
            let s = between(r, 0.35, 0.8)
            box = (between(r, 0.25, 0.75), between(r, 0.25, 0.75), s, s * asp * between(r, 0.7, 1.3))
            intensity = between(r, 50, 90)
        }

        let warmBias: Double = palette == .cool ? -1 : (palette == .mono || palette == .green ? 0 : 1)
        let layerSeed = Float(r.next())
        let mirror = r.next() < 0.5
        let softness = jsRound(t == .tear ? between(r, 5, 28) : between(r, 25, 75))
        let texture = jsRound(between(r, 40, 90))
        let warmth: Float = grade ? jsRound(warmBias * between(r, 5, 35) + between(r, -8, 8)) : 0
        let tint: Float = grade ? jsRound(between(r, -15, 15)) : 0
        let fade: Float = grade ? jsRound(between(r, 0, 35)) : 0
        let contrast: Float = grade ? jsRound(between(r, -25, 5)) : 0

        return FilmLeak(
            id: Masks.newId(),
            enabled: true,
            type: t,
            seed: layerSeed,
            cx: Float(box.cx),
            cy: Float(box.cy),
            w: Float(box.w),
            h: Float(box.h),
            turn: turn,
            mirror: mirror,
            palette: palette,
            intensity: jsRound(intensity),
            softness: softness,
            texture: texture,
            amount: jsRound(amount),
            variant: jsRound(variant),
            warmth: warmth,
            tint: tint,
            fade: fade,
            contrast: contrast
        )
    }

    public static func randomRoll(aspect: Float, seed: Double, shortSideSprockets: Bool = false) -> [FilmLeak] {
        let r = Mulberry32(seedBits(seed) ^ 0x9e3779b9)
        let main = random(type: nil, aspect: aspect, seed: r.next(), grade: true, shortSideSprockets: shortSideSprockets)
        var out = [main]
        if main.type != .dust && main.type != .scratches && r.next() < 0.3 {
            out.append(random(type: r.next() < 0.45 ? .scratches : .dust, aspect: aspect, seed: r.next(), grade: false, shortSideSprockets: shortSideSprockets))
        }
        if main.type != .rebate && main.type != .end && r.next() < 0.15 {
            var rebate = random(type: .rebate, aspect: aspect, seed: r.next(), grade: false, shortSideSprockets: shortSideSprockets)
            rebate.palette = main.palette == .cool ? .red : main.palette
            out.append(rebate)
        }
        if (main.type == .edge || main.type == .blob) && r.next() < 0.2 {
            let second = random(type: main.type, aspect: aspect, seed: r.next(), grade: false)
            var moved = sideMove(second, turn: (main.turn + 2) % 4)
            moved.palette = main.palette
            moved.intensity = jsRound(Double(second.intensity) * 0.6)
            out.append(moved)
        }
        return Array(out.prefix(maxLeaks))
    }

    public static func newVariation(_ l: FilmLeak, seed: Float) -> FilmLeak {
        var copy = l
        copy.seed = seed
        return copy
    }

    public static func sideMove(_ l: FilmLeak, turn: Int) -> FilmLeak {
        let t = ((turn % 4) + 4) % 4
        let depth = Double(l.turn % 2 == 0 ? l.w : l.h)
        let along = Double(l.turn % 2 == 0 ? l.h : l.w)
        let offset = Double(l.turn % 2 == 0 ? l.cy : l.cx)
        let hugs = l.type != .streak && l.type != .fog && l.type != .dust && l.type != .stain && l.type != .scratches
        var copy = l
        copy.turn = t
        if hugs {
            let box = sideBox(t, depth, along, offset, l.type == .rebate ? 0 : 0.02)
            copy.cx = Float(box.cx)
            copy.cy = Float(box.cy)
            copy.w = Float(box.w)
            copy.h = Float(box.h)
        }
        return copy
    }

    public static func pack(_ leaks: [FilmLeak], imageWidth: Int, imageHeight: Int) -> FilmLeakUniforms {
        let on = leaks.filter { !isIdentity($0) }.prefix(maxLeaks)
        if on.isEmpty { return .none }
        var box = [Float](repeating: 0, count: maxLeaks * 4)
        var form = [Float](repeating: 0, count: maxLeaks * 4)
        var tint = [Float](repeating: 0, count: maxLeaks * 4)
        var tint2 = [Float](repeating: 0, count: maxLeaks * 4)
        var look = [Float](repeating: 0, count: maxLeaks * 4)
        var grade = [Float](repeating: 0, count: maxLeaks * 4)
        let w = Float(imageWidth)
        let h = Float(imageHeight)

        for (i, l) in on.enumerated() {
            let o = i * 4
            let a = l.palette.a
            let b = l.palette.b
            box[o] = l.cx * w
            box[o + 1] = l.cy * h
            box[o + 2] = 2.0 / max(l.w * w, 1)
            box[o + 3] = 2.0 / max(l.h * h, 1)
            form[o] = l.type.shaderId
            form[o + 1] = Float(((l.turn % 4) + 4) % 4)
            form[o + 2] = l.mirror ? 1 : 0
            form[o + 3] = l.seed
            tint[o] = a.0
            tint[o + 1] = a.1
            tint[o + 2] = a.2
            tint[o + 3] = l.intensity / 100
            tint2[o] = b.0
            tint2[o + 1] = b.1
            tint2[o + 2] = b.2
            tint2[o + 3] = l.variant / 100
            look[o] = l.softness / 100
            look[o + 1] = l.texture / 100
            look[o + 2] = l.amount / 100
            look[o + 3] = 0
            grade[o] = l.warmth / 100
            grade[o + 1] = l.tint / 100
            grade[o + 2] = l.fade / 100
            grade[o + 3] = l.contrast / 100
        }

        return FilmLeakUniforms(count: on.count, box: box, form: form, tint: tint, tint2: tint2, look: look, grade: grade)
    }

    // MARK: - JSON

    private static func num(_ v: Any?, _ lo: Float, _ hi: Float) -> Float? {
        guard let n = (v as? NSNumber)?.doubleValue, n.isFinite else { return nil }
        return min(hi, max(lo, Float(n)))
    }

    public static func parseLeak(_ raw: Any?) -> FilmLeak? {
        guard let s = raw as? [String: Any] else { return nil }
        guard let cx = num(s["cx"], -1, 2),
              let cy = num(s["cy"], -1, 2),
              let w = num(s["w"], 0.01, 4),
              let h = num(s["h"], 0.01, 4) else { return nil }
        let type = (s["type"] as? String).flatMap(FilmLeakType.init(rawValue:)) ?? .edge
        let palette = (s["palette"] as? String).flatMap(FilmPalette.init(rawValue:)) ?? .warm
        let turnRaw = num(s["turn"], -16, 16) ?? 0
        let turn = ((Int(Foundation.floor(turnRaw + 0.5)) % 4) + 4) % 4  // JS Math.round: halves go up
        return FilmLeak(
            id: Masks.newId(),
            enabled: (s["enabled"] as? Bool) ?? true,
            type: type,
            seed: num(s["seed"], 0, 1) ?? 0,
            cx: cx,
            cy: cy,
            w: w,
            h: h,
            turn: turn,
            mirror: (s["mirror"] as? Bool) ?? false,
            palette: palette,
            intensity: num(s["intensity"], 0, 100) ?? 80,
            softness: num(s["softness"], 0, 100) ?? 50,
            texture: num(s["texture"], 0, 100) ?? 65,
            amount: num(s["amount"], 0, 100) ?? 55,
            variant: num(s["variant"], 0, 100) ?? 50,
            warmth: num(s["warmth"], -100, 100) ?? 0,
            tint: num(s["tint"], -100, 100) ?? 0,
            fade: num(s["fade"], 0, 100) ?? 0,
            contrast: num(s["contrast"], -100, 100) ?? 0
        )
    }

    public static func parseLeaks(_ raw: Any?) -> [FilmLeak] {
        guard let arr = raw as? [Any] else { return [] }
        return Array(arr.compactMap(parseLeak).prefix(maxLeaks))
    }

    public static func toJson(_ leaks: [FilmLeak]) -> [[String: Any]] {
        leaks.map { l in
            [
                "enabled": l.enabled,
                "type": l.type.rawValue,
                "seed": l.seed,
                "cx": l.cx,
                "cy": l.cy,
                "w": l.w,
                "h": l.h,
                "turn": l.turn,
                "mirror": l.mirror,
                "palette": l.palette.rawValue,
                "intensity": l.intensity,
                "softness": l.softness,
                "texture": l.texture,
                "amount": l.amount,
                "variant": l.variant,
                "warmth": l.warmth,
                "tint": l.tint,
                "fade": l.fade,
                "contrast": l.contrast,
            ]
        }
    }
}
