import Foundation

/** What a light effect draws. Mirrors Android's FxKind and web's FxKind. */
public enum FxKind: CaseIterable, Sendable {
    case lightning, sparks, trails, swirl

    public var label: String {
        switch self {
        case .lightning: "Lightning"
        case .sparks: "Sparks"
        case .trails: "Trails"
        case .swirl: "Swirl"
        }
    }

    public var angle: Float { 0 }

    public var amount: Float {
        switch self {
        case .lightning, .sparks, .trails: 50
        case .swirl: 40
        }
    }

    public var thickness: Float { 50 }

    public var glow: Float {
        switch self {
        case .lightning: 50
        case .sparks: 55
        case .trails: 45
        case .swirl: 50
        }
    }

    public var hue: Float {
        switch self {
        case .lightning: 222
        case .sparks: 235
        case .trails: 285
        case .swirl: 190
        }
    }

    public var spread: Float {
        switch self {
        case .lightning: 10
        case .sparks: 70
        case .trails: 45
        case .swirl: 35
        }
    }

    /** How much the shader bends the lines with fine noise (lightning and the sparks' arcs crackle; trails and swirls stay smooth). */
    public var wobble: Float {
        switch self {
        case .lightning: 1
        case .sparks: 0.6
        case .trails, .swirl: 0
        }
    }

    /** The kind's name in saved edits (web's and Android's JSON). */
    public var key: String {
        switch self {
        case .lightning: "lightning"
        case .sparks: "sparks"
        case .trails: "trails"
        case .swirl: "swirl"
        }
    }
}

/**
 * A light ("lomo") effect (Pro; mirrored in Android's LightEffects.kt and web's LightEffects.ts): procedural light
 * drawn over the finished picture like a double exposure on film: lightning bolts, electric spark clusters,
 * light-trail streaks and neon swirls, as a white-hot core, a coloured glow and a wide soft halo
 * (shaders/light_fx.glsl), exposed into the picture per channel.
 *
 * Geometry is a radial mask's (MaskShape.radial): centre (cx, cy) in fractions of the decoded image, rx/ry the half
 * extent along and across as fractions of its long side, angle in degrees (clockwise). The pattern lives in its own
 * frame (-1..1 on both axes), so stretching the box stretches the pattern, while line widths and glows scale with the
 * box's mean size. amount 0..100 = how much there is; thickness 0..100 = line width (50 = as generated); glow 0..100 =
 * how far the glow and halo reach; intensity 0..100; hue in degrees (0..360); spread 0..100 = how far each line's
 * colour may drift from it.
 *
 * The pattern is generated from [seed] + [amount] with the same generator as Android's and the web's. [seed] is a
 * Double: a Float would pick another pattern.
 *
 * Effects belong to one photo's content, like leaks: they reset for each new photo and presets don't keep them.
 */
public struct LightEffect: Equatable, Sendable, Identifiable {
    public var id: String
    public var enabled = true
    public var kind = FxKind.lightning
    public var cx: Float
    public var cy: Float
    public var rx: Float
    public var ry: Float
    public var angle: Float
    public var seed: Double
    public var amount: Float
    public var thickness: Float
    public var glow: Float
    public var intensity: Float = 100
    public var hue: Float
    public var spread: Float

    public init(id: String, kind: FxKind = .lightning, cx: Float = 0.5, cy: Float = 0.5, rx: Float, ry: Float, seed: Double = 0) {
        self.id = id
        self.kind = kind
        self.cx = cx
        self.cy = cy
        self.rx = rx
        self.ry = ry
        angle = kind.angle
        self.seed = seed
        amount = kind.amount
        thickness = kind.thickness
        glow = kind.glow
        hue = kind.hue
        spread = kind.spread
    }

    public var isIdentity: Bool { !enabled || intensity <= 0 }

    /** The same effect as a radial mask shape (the overlay draws and drags it as one). */
    public var shape: MaskShape { .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: 1) }

    /** This effect moved, sized or turned to a radial shape's place; anything else is ignored. */
    public func withShape(_ s: MaskShape) -> LightEffect {
        guard case let .radial(cx, cy, rx, ry, angle, _) = s else { return self }
        var e = self
        e.cx = cx
        e.cy = cy
        e.rx = rx
        e.ry = ry
        e.angle = angle
        return e
    }

    /** This effect turned into [k] with that kind's amount, colour and widths; place, size, angle, intensity and seed stay. */
    public func withKind(_ k: FxKind) -> LightEffect {
        if k == kind { return self }
        var e = self
        e.kind = k
        e.amount = k.amount
        e.thickness = k.thickness
        e.glow = k.glow
        e.hue = k.hue
        e.spread = k.spread
        return e
    }
}

/** One glowing line piece: from (x0, y0) to (x1, y1), half widths w0 → w1, brightness b, colour offset h (-1..1). */
public struct FxSegment: Sendable {
    public var x0: Double, y0: Double, x1: Double, y1: Double
    public var w0: Double, w1: Double, b: Double, h: Double
}

/** The segments of all shown effects as the shader's RGBA32F data texture: [LightEffects.row] texels wide, [rows] tall. Compared by identity. */
public final class FxData: @unchecked Sendable {
    public let rows: Int
    public let data: [Float]
    init(rows: Int, data: [Float]) {
        self.rows = rows
        self.data = data
    }
}

/** Effects packed for the shader's uniform arrays (see shaders/light_fx.glsl), LightEffects.maxEffects x vec4 each. */
public struct FxUniforms: Sendable {
    public let count: Int
    public var geom: [Float]
    public var shape: [Float]
    public var color: [Float]
    public var range: [Float]
    /** nil when no effect shows. */
    public let data: FxData?

    static func empty(_ count: Int, data: FxData? = nil) -> FxUniforms {
        let zeros = [Float](repeating: 0, count: LightEffects.maxEffects * 4)
        return FxUniforms(count: count, geom: zeros, shape: zeros, color: zeros, range: zeros, data: data)
    }

    public static let none = empty(0)
}

public enum LightEffects {
    /** Uniform arrays in the shader are this long. */
    public static let maxEffects = 4

    /** A new effect's box is this many times the photo, so most of the pattern sits outside the frame. */
    public static let startScale: Float = 1.75

    /** At most this many segments per effect. */
    public static let maxSegments = 1280

    /** Segments per chunk: a chunk's bounding box lets the shader skip it where none of its light reaches. */
    public static let chunk = 16

    /** Texels per chunk row of the data texture: the chunk's bounding box, then two per segment. */
    public static let row = 1 + 2 * chunk

    /** The box a new effect starts in (radii as fractions of the photo's long side): [startScale] times a photo of [aspect] = width / height. */
    public static func coverSize(aspect: Float) -> (rx: Float, ry: Float) {
        let h = 0.5 * startScale
        return aspect >= 1 ? (h, h / aspect) : (h * aspect, h)
    }

    /** A seed 0..1 (9 decimals, like the web's); the generator turns it into 32 bits. */
    public static func newSeed() -> Double { (Double.random(in: 0..<1) * 1e9).rounded(.down) / 1e9 }

    /** A new random effect of [kind] covering the whole photo of [aspect], centred at ([cx], [cy]). */
    public static func newEffect(_ kind: FxKind = .lightning, cx: Float = 0.5, cy: Float = 0.5, aspect: Float = 1.5) -> LightEffect {
        let c = coverSize(aspect: aspect)
        return LightEffect(id: Masks.newId(), kind: kind, cx: cx, cy: cy, rx: c.rx, ry: c.ry, seed: newSeed())
    }

    /** Colour of a hue at full light, for swatches (display RGB 0..1): a light, slightly pastel neon. */
    public static func color(_ hue: Float) -> [Float] {
        let h = ((hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)) / 60
        func f(_ n: Float) -> Float {
            let k = (n + h).truncatingRemainder(dividingBy: 6)
            return 1 - 0.8 * max(0, min(min(k, 4 - k), 1))
        }
        return [f(5), f(3), f(1)]
    }

    // MARK: Generation: segments in the effect's own frame (-1..1), widths in its mean radius. The same random calls in
    // the same order as web's LightEffects.ts and Android's LightEffects.kt, so a seed gives the same pattern.

    private typealias Pt = (x: Double, y: Double)

    /** A small, fast deterministic PRNG (mulberry32): the same pattern for the same seed everywhere. */
    struct Rng {
        private var a: UInt32

        init(seed: Double) {
            a = UInt32(truncatingIfNeeded: Int64((seed * 4294967296.0).rounded(.down)))
        }

        mutating func next() -> Double {
            a = a &+ 0x6d2b79f5
            var t = a
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return Double(t ^ (t >> 14)) / 4294967296.0
        }

        mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * next() }

        /** Roughly normal, mean 0, sd 1. */
        mutating func gauss() -> Double {
            let a = next(), b = next(), c = next(), d = next()
            return (a + b + c + d - 2) * 1.732
        }
    }

    private static func jsRound(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }

    /** Points of a jagged bolt from a to b: midpoint displacement, [levels] times, sideways by [rough] x the piece's length. */
    private static func jagged(_ r: inout Rng, _ a: Pt, _ b: Pt, _ levels: Int, _ rough: Double) -> [Pt] {
        var pts = [a, b]
        var amp = rough
        for _ in 0..<levels {
            var next = [pts[0]]
            next.reserveCapacity(pts.count * 2)
            for i in 1..<pts.count {
                let (x0, y0) = pts[i - 1]
                let (x1, y1) = pts[i]
                let dx = x1 - x0
                let dy = y1 - y0
                let len = hypot(dx, dy)
                let off = r.gauss() * 0.5 * amp * len
                let along = (r.next() - 0.5) * 0.2
                let l1 = len == 0 ? 1 : len
                next.append((x0 + dx * (0.5 + along) - (dy / l1) * off, y0 + dy * (0.5 + along) + (dx / l1) * off))
                next.append(pts[i])
            }
            pts = next
            amp *= 0.92  // keeps fine kinks at every scale: real lightning is jagged all the way down
        }
        return pts
    }

    /** Segments along [pts], half width w0 → w1 and brightness b0 → b1 from start to end, flickering a little. */
    private static func polyline(_ out: inout [FxSegment], _ r: inout Rng, _ pts: [Pt], _ w0: Double, _ w1: Double,
                                 _ b0: Double, _ b1: Double, _ h: Double, _ flicker: Double = 0.15) {
        let n = pts.count - 1
        var i = 0
        while i < n && out.count < maxSegments {
            let t0 = Double(i) / Double(n)
            let t1 = Double(i + 1) / Double(n)
            let fl = 1 - flicker * r.next()
            out.append(FxSegment(
                x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y,
                w0: w0 + (w1 - w0) * t0, w1: w0 + (w1 - w0) * t1,
                b: max(0.001, (b0 + (b1 - b0) * (t0 + t1) * 0.5) * fl), h: h))
            i += 1
        }
    }

    /** A lightning bolt from top to bottom with forks: branches leave the channel at shallow angles and branch again. */
    private static func lightning(_ r: inout Rng, _ amount: Int) -> [FxSegment] {
        var out: [FxSegment] = []
        let density = Double(amount) / 100
        func branch(_ r: inout Rng, _ from: Pt, _ dir: Double, _ len: Double, _ level: Int, _ w: Double, _ b: Double) {
            let to: Pt = (from.x + cos(dir) * len, from.y + sin(dir) * len)
            let pts = jagged(&r, from, to, level == 0 ? 8 : level == 1 ? 6 : 5, level == 0 ? 0.42 : 0.5)
            let flick = (r.next() - 0.5) * 0.6
            polyline(&out, &r, pts, w, w * (level == 0 ? 0.55 : 0.2), b, b * (level == 0 ? 0.8 : 0.35), flick, 0.25)
            if level >= 2 { return }
            // Forks: more near the bottom of a channel; each heads off 15..55° to one side, its length a part of what's left.
            let forks = jsRound((level == 0 ? 2 + 9 * density : 0.5 + 3 * density) * r.range(0.7, 1.3))
            var f = 0
            while f < forks && out.count < maxSegments - 100 {
                let t = level == 0 ? 0.12 + 0.8 * r.next().squareRoot() : 0.15 + 0.7 * r.next()
                let k = min(pts.count - 2, max(1, Int((t * Double(pts.count - 1)).rounded(.down))))
                let p = pts[k]
                let local = atan2(pts[k + 1].y - pts[k - 1].y, pts[k + 1].x - pts[k - 1].x)
                let side: Double = r.next() < 0.5 ? -1 : 1
                let turn = side * r.range(0.26, 0.95)
                let left = len * (1 - t)
                let nl = left * r.range(0.3, 0.75)
                let nw = w * r.range(0.4, 0.6)
                let nb = b * r.range(0.45, 0.7)
                branch(&r, p, local * 0.4 + dir * 0.6 + turn, nl, level + 1, nw, nb)
                f += 1
            }
        }
        let x0 = r.range(-0.25, 0.25)
        let x1 = x0 + r.range(-0.35, 0.35)
        let len = hypot(x1 - x0, 1.9)
        branch(&r, (x0, -0.95), atan2(1.9, x1 - x0), len, 0, 0.006, 1)
        return out
    }

    /**
     * An electric spark cluster: a hot centre, short crackling arcs out of it, and many sparks around it, most of them
     * tiny, some flying outwards as short streaks; colours spread so blue, violet and green sit together.
     */
    private static func sparks(_ r: inout Rng, _ amount: Int) -> [FxSegment] {
        var out: [FxSegment] = []
        let density = Double(amount) / 100
        let arcs = jsRound(3 + 6 * density * r.range(0.6, 1.4))
        for _ in 0..<arcs {
            let dir = r.next() * Double.pi * 2
            let len = r.range(0.25, 0.75)
            let fx = r.gauss() * 0.04
            let fy = r.gauss() * 0.04
            let pts = jagged(&r, (fx, fy), (fx + cos(dir) * len, fy + sin(dir) * len), 5, 0.55)
            let hue = r.gauss() * 0.35
            polyline(&out, &r, pts, 0.006, 0.0015, 0.9, 0.25, hue, 0.3)
            // One small fork per arc, sometimes.
            if r.next() < 0.6 {
                let k = 2 + Int((r.next() * Double(pts.count - 4)).rounded(.down))
                let fd = dir + (r.next() < 0.5 ? -1.0 : 1.0) * r.range(0.4, 1)
                let fl = len * r.range(0.2, 0.4)
                let fork = jagged(&r, pts[k], (pts[k].x + cos(fd) * fl, pts[k].y + sin(fd) * fl), 3, 0.6)
                let fh = r.gauss() * 0.35
                polyline(&out, &r, fork, 0.003, 0.001, 0.5, 0.15, fh, 0.3)
            }
        }
        // The hot centre: a few overlapping bright dots.
        for _ in 0..<3 {
            let x = r.gauss() * 0.02
            let y = r.gauss() * 0.02
            let h = r.gauss() * 0.2
            out.append(FxSegment(x0: x, y0: y, x1: x, y1: y, w0: 0.02, w1: 0.02, b: 1.4, h: h))
        }
        var particles: [FxSegment] = []
        // A few soft orbs of light around the cluster, out of focus like bokeh.
        let orbs = jsRound(3 + 8 * density * r.next())
        for _ in 0..<orbs {
            let dir = r.next() * Double.pi * 2
            let dist = r.range(0.15, 0.85)
            let x = cos(dir) * dist
            let y = sin(dir) * dist
            let w = r.range(0.012, 0.03)
            let b = r.range(0.12, 0.3)
            let h = r.next() * 2 - 1
            particles.append(FxSegment(x0: x, y0: y, x1: x, y1: y, w0: w, w1: w, b: b, h: h))
        }
        let n = jsRound(80 + 520 * density)
        for _ in 0..<n {
            let dir = r.next() * Double.pi * 2
            let dist = min(1, abs(r.gauss()) * 0.45 + 0.03)
            let x = cos(dir) * dist
            let y = sin(dir) * dist
            let big = pow(r.next(), 6)  // most sparks are tiny, a few large
            let w = 0.0025 + 0.012 * big
            let b = r.range(0.35, 1.1) * (1.15 - dist * 0.6)
            let h = r.next() * 2 - 1
            if r.next() < 0.35 {
                // A flying spark: a short streak outwards, thinning towards its tail.
                let len = r.range(0.03, 0.16) * (0.4 + dist)
                particles.append(FxSegment(x0: x, y0: y, x1: x + cos(dir) * len, y1: y + sin(dir) * len, w0: w * 0.9, w1: w * 0.25, b: b, h: h))
            } else {
                particles.append(FxSegment(x0: x, y0: y, x1: x, y1: y, w0: w, w1: w, b: b, h: h))
            }
        }
        // Spatial order, so each chunk's bounding box stays small and the shader can skip far chunks.
        func morton(_ s: FxSegment) -> Int {
            let qx = min(63, max(0, Int(((s.x0 + 1) * 32).rounded(.down))))
            let qy = min(63, max(0, Int(((s.y0 + 1) * 32).rounded(.down))))
            var m = 0
            for bit in 0..<6 { m |= ((qx >> bit) & 1) << (2 * bit) | ((qy >> bit) & 1) << (2 * bit + 1) }
            return m
        }
        // A stable sort (JS's and Kotlin's are): ties keep their order.
        let order = particles.enumerated().sorted { a, b in
            let ma = morton(a.element), mb = morton(b.element)
            return ma != mb ? ma < mb : a.offset < b.offset
        }
        for p in order where out.count < maxSegments { out.append(p.element) }
        return out
    }

    /** Smooth 1D noise (-1..1) from a few random sines: wobble for trails and swirls. */
    private static func wobble(_ r: inout Rng) -> (Double) -> Double {
        var f = [Double](repeating: 0, count: 3)
        var p = [Double](repeating: 0, count: 3)
        var a = [Double](repeating: 0, count: 3)
        for i in 0..<3 {
            f[i] = r.range(1.5, 4) * Double(i + 1)
            p[i] = r.next() * Double.pi * 2
            a[i] = 1 / (Double(i) + 1.5)
        }
        return { t in
            var s = 0.0
            for i in 0..<3 { s += a[i] * sin(f[i] * t + p[i]) }
            return s / 1.2
        }
    }

    /** Light trails: a few long, nearly parallel streaks of moving light, like a long exposure, flickering along their length. */
    private static func trails(_ r: inout Rng, _ amount: Int) -> [FxSegment] {
        var out: [FxSegment] = []
        let strands = jsRound(2 + 5 * (Double(amount) / 100) * r.range(0.7, 1.3))
        let bow = r.range(-0.5, 0.5)
        for s in 0..<strands {
            let base = strands == 1 ? 0.0 : (Double(s) / Double(strands - 1)) * 1.3 - 0.65
            let y0 = base + r.gauss() * 0.08
            let amp = r.range(0.04, 0.2)
            let wob = wobble(&r)
            let flick = wobble(&r)
            let xs = r.range(-1, -0.75)
            let xe = r.range(0.75, 1)
            let w = r.range(0.004, 0.011)
            let b = r.range(0.55, 1.1)
            let h = Double(s) / Double(max(1, strands - 1)) * 2 - 1 + r.gauss() * 0.2
            let n = 128
            var pts: [Pt] = []
            for i in 0...n {
                let t = Double(i) / Double(n)
                let x = xs + (xe - xs) * t
                pts.append((x, y0 + bow * (x * x - 0.5) * 0.6 + amp * wob(t * 3)))
            }
            var i = 0
            while i < n && out.count < maxSegments {
                let t = (Double(i) + 0.5) / Double(n)
                let fade = min(1, min(t / 0.15, (1 - t) / 0.12))  // trails fade in and out at their ends
                let level = max(0, 0.65 + 0.45 * flick(t * 4))
                out.append(FxSegment(
                    x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y,
                    w0: w * (0.7 + 0.3 * level), w1: w * (0.7 + 0.3 * level), b: max(0.001, b * fade * level), h: h))
                i += 1
            }
        }
        return out
    }

    /** Neon swirls: one to four loose spirals of light winding round the centre, wobbling, fading at their ends. */
    private static func swirl(_ r: inout Rng, _ amount: Int) -> [FxSegment] {
        var out: [FxSegment] = []
        let strands = jsRound(1 + 3 * (Double(amount) / 100) * r.range(0.7, 1.3))
        for s in 0..<strands {
            let turns = r.range(1.2, 2.6)
            let r0 = r.range(0.08, 0.35)
            let r1 = r.range(0.7, 1)
            let tilt = r.range(0.55, 1)  // an ellipse seen at an angle
            let rot = r.next() * Double.pi * 2
            let th0 = r.next() * Double.pi * 2
            let dir: Double = r.next() < 0.5 ? -1 : 1
            let wob = wobble(&r)
            let w = r.range(0.004, 0.009)
            let b = r.range(0.7, 1.1)
            let h = r.gauss() * 0.5
            let n = min(320, (maxSegments - out.count) / max(1, strands - s) - 1)
            if n < 8 { break }
            var pts: [Pt] = []
            for i in 0...n {
                let t = Double(i) / Double(n)
                let th = th0 + dir * turns * 2 * Double.pi * t
                let rr = (r0 + (r1 - r0) * t) * (1 + 0.12 * wob(t * 5))
                let ex = cos(th) * rr
                let ey = sin(th) * rr * tilt
                pts.append((ex * cos(rot) - ey * sin(rot), ex * sin(rot) + ey * cos(rot)))
            }
            for i in 0..<n {
                let t = (Double(i) + 0.5) / Double(n)
                let fade = min(1, min(t / 0.2, (1 - t) / 0.25))
                out.append(FxSegment(x0: pts[i].x, y0: pts[i].y, x1: pts[i + 1].x, y1: pts[i + 1].y,
                                     w0: w, w1: w, b: max(0.001, b * fade), h: h))
            }
        }
        return out
    }

    /** The effect's segments, freshly generated (`segments` caches them). */
    public static func generate(_ kind: FxKind, seed: Double, amount: Int) -> [FxSegment] {
        let a = min(100, max(0, amount))
        var r = Rng(seed: seed)
        let all: [FxSegment]
        switch kind {
        case .lightning: all = lightning(&r, a)
        case .sparks: all = sparks(&r, a)
        case .trails: all = trails(&r, a)
        case .swirl: all = swirl(&r, a)
        }
        return Array(all.prefix(maxSegments))
    }

    private static func amountOf(_ amount: Float) -> Int { Int((amount.clamped(0, 100) + 0.5).rounded(.down)) }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var generated: [String: [FxSegment]] = [:]
    private nonisolated(unsafe) static var generatedOrder: [String] = []
    private nonisolated(unsafe) static var last: (key: String, packed: Packed)?

    /** The effect's segments (cached: the same kind, seed and amount always give the same pattern). */
    public static func segments(_ e: LightEffect) -> [FxSegment] {
        lock.lock()
        defer { lock.unlock() }
        return segmentsLocked(e)
    }

    private static func segmentsLocked(_ e: LightEffect) -> [FxSegment] {
        let amount = amountOf(e.amount)
        let key = "\(e.kind.key):\(e.seed):\(amount)"
        if let s = generated[key] { return s }
        let s = generate(e.kind, seed: e.seed, amount: amount)
        if generatedOrder.count >= 32 { generated[generatedOrder.removeFirst()] = nil }
        generated[key] = s
        generatedOrder.append(key)
        return s
    }

    // MARK: Packing.

    /** The thickness slider as a width factor: 1/4 .. 1 (at 50) .. 4. */
    public static func thicknessFactor(_ t: Float) -> Float { powf(4, (t.clamped(0, 100) - 50) / 50) }

    /** The glow slider as the glow's radius in core half widths. */
    public static func glowRadius(_ g: Float) -> Float { 2 + g.clamped(0, 100) / 100 * 8 }

    /** The glow slider as the halo's radius in the effect's mean radius. */
    public static func haloRadius(_ g: Float) -> Float { 0.02 + g.clamped(0, 100) / 100 * 0.16 }

    private struct Packed {
        let data: FxData
        let first: [Int]
        let rows: [Int]
    }

    private static func packData(_ lists: [[FxSegment]]) -> Packed {
        let rowsOf = lists.map { ($0.count + chunk - 1) / chunk }
        let total = max(1, rowsOf.reduce(0, +))
        var data = [Float](repeating: 0, count: total * row * 4)
        var first: [Int] = []
        var rowIndex = 0
        for (i, segs) in lists.enumerated() {
            first.append(rowIndex)
            for c in 0..<rowsOf[i] {
                var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
                for k in 0..<chunk {
                    let idx = c * chunk + k
                    if idx >= segs.count { break }
                    let s = segs[idx]
                    minX = min(minX, min(s.x0, s.x1)); minY = min(minY, min(s.y0, s.y1))
                    maxX = max(maxX, max(s.x0, s.x1)); maxY = max(maxY, max(s.y0, s.y1))
                    let o = (rowIndex * row + 1 + 2 * k) * 4
                    for (j, v) in [s.x0, s.y0, s.x1, s.y1, s.w0, s.w1, s.b, s.h].enumerated() { data[o + j] = Float(v) }
                }
                let o = rowIndex * row * 4
                data[o] = Float(minX); data[o + 1] = Float(minY); data[o + 2] = Float(maxX); data[o + 3] = Float(maxY)
                rowIndex += 1
            }
        }
        return Packed(data: FxData(rows: total, data: data), first: first, rows: rowsOf)
    }

    /**
     * Packs the effects that show; positions go from image fractions to full-resolution image pixels. The data
     * texture is reused (same object) while only placement, size or colour change, so dragging never re-uploads it.
     */
    public static func pack(_ effects: [LightEffect], imageWidth: Int, imageHeight: Int) -> FxUniforms {
        let used = Array(effects.filter { !$0.isIdentity }.prefix(maxEffects))
        if used.isEmpty { return .none }
        lock.lock()
        defer { lock.unlock() }
        let lists = used.map { segmentsLocked($0) }
        let key = used.map { "\($0.kind.key):\($0.seed):\(amountOf($0.amount))" }.joined(separator: "|")
        let packed: Packed
        if let l = last, l.key == key {
            packed = l.packed
        } else {
            packed = packData(lists)
            last = (key, packed)
        }
        var u = FxUniforms.empty(used.count, data: packed.data)
        let w = Float(imageWidth)
        let h = Float(imageHeight)
        let long = max(w, h)
        func put(_ values: [Float], into array: inout [Float], at o: Int) {
            for (k, v) in values.enumerated() { array[o + k] = v }
        }
        for (i, e) in used.enumerated() {
            let o = i * 4
            let a = e.angle * .pi / 180
            let rxPx = max(e.rx * long, 1)
            let ryPx = max(e.ry * long, 1)
            let mean = (rxPx * ryPx).squareRoot()
            put([e.cx * w, e.cy * h, rxPx, ryPx], into: &u.geom, at: o)
            put([cos(a), sin(a), mean * thicknessFactor(e.thickness), glowRadius(e.glow)], into: &u.shape, at: o)
            let hue = (e.hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 360
            put([hue, (e.spread / 100).clamped(0, 1), (e.intensity / 100).clamped(0, 1), mean * haloRadius(e.glow)], into: &u.color, at: o)
            // How far the effect's light reaches beyond its lines: past it, the shader skips a chunk.
            let widest = Float(lists[i].reduce(0.0) { max($0, max($1.w0, $1.w1)) }) * u.shape[o + 2]
            // Far enough out that a segment's glow, halo and crackle are all within it (the crackle bends a line by up to ~2% of the size).
            let reach = 3.2 * max(u.color[o + 3], widest * u.shape[o + 3]) + 2 + 0.02 * mean * e.kind.wobble
            put([Float(packed.first[i]), Float(packed.rows[i]), reach, e.kind.wobble], into: &u.range, at: o)
        }
        return u
    }
}
