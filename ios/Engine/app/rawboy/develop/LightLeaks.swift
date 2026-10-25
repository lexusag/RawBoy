import Foundation

/**
 * What a light leak looks like, with the size, angle, softness and glow a new one starts with: a straight beam across
 * the photo, an ellipse, or a triangle (apex along its angle). [index] is the shader's kind number. Mirrors Android's
 * LeakKind.
 */
public enum LeakKind: CaseIterable, Sendable {
    case streak, glow, triangle

    public var label: String {
        switch self {
        case .streak: "Streak"
        case .glow: "Glow"
        case .triangle: "Triangle"
        }
    }

    public var index: Int {
        switch self {
        case .glow: 0
        case .streak: 1
        case .triangle: 2
        }
    }

    public var rx: Float {
        switch self {
        case .streak: 0.6
        case .glow: 0.09
        case .triangle: 0.12
        }
    }

    public var ry: Float {
        switch self {
        case .streak: 0.015
        case .glow: 0.09
        case .triangle: 0.11
        }
    }

    public var angle: Float {
        switch self {
        case .streak: -20
        case .glow: 0
        case .triangle: -90
        }
    }

    public var softness: Float {
        switch self {
        case .streak: 60
        case .glow: 45
        case .triangle: 40
        }
    }

    public var glow: Float {
        switch self {
        case .streak: 55
        case .glow, .triangle: 18
        }
    }
}

/**
 * A light leak (Pro; mirrored in Android's LightLeaks.kt and web's LightLeaks.ts): film-style light over the finished
 * picture, dragged into place on the photo, made like a Photoshop light leak: a white shape, blurred, with an orange
 * then a red outer glow, all in Screen mode (shaders/light_leak.glsl). The photo shows through the glow; at full
 * intensity the white core hides what is under it, so a leak can tastefully cover part of a photo. The photo's grain
 * lies over the leak.
 *
 * Geometry is a radial mask's (MaskShape.radial): centre (cx, cy) in fractions of the decoded image, radii rx/ry as
 * fractions of its long side (a streak: half length, half width; a triangle: apex to base, half base), angle in
 * degrees (clockwise), so a leak stays on the same content through crop, rotation and lens corrections.
 * softness 0..100 = the core's blur; glow 0..100 = how far the coloured glow reaches; bend -100..100 curves the shape
 * along its length (100: its ends move one length radius sideways); taper -100..100 narrows it towards one end; warp
 * 0..100 makes its edge uneven (seed 0..1 picks how); intensity 0..100; hue in degrees, -40 (magenta-red) .. 0 (red)
 * .. 37 (orange) .. 60 (yellow), the outer glow 37° redder.
 *
 * Leaks belong to one photo's content: they reset for each new photo and presets don't keep them.
 */
public struct LightLeak: Equatable, Sendable, Identifiable {
    public var id: String
    public var enabled = true
    public var kind = LeakKind.streak
    public var cx: Float
    public var cy: Float
    public var rx: Float
    public var ry: Float
    public var angle: Float
    public var softness: Float
    public var glow: Float
    public var bend: Float = 0
    public var taper: Float = 0
    public var warp: Float = 0
    public var intensity: Float = 100
    public var hue: Float = LightLeaks.hue
    public var seed: Float = 0

    public init(id: String, kind: LeakKind = .streak, cx: Float, cy: Float, seed: Float = 0) {
        self.id = id
        self.kind = kind
        self.cx = cx
        self.cy = cy
        rx = kind.rx
        ry = kind.ry
        angle = kind.angle
        softness = kind.softness
        glow = kind.glow
        self.seed = seed
    }

    public var isIdentity: Bool { !enabled || intensity <= 0 }

    /**
     * The same leak as a radial mask shape (the overlay draws and drags it as one); its feather ring marks where the
     * blurred core is fully white (the shader's blur, 0.03 + 0.6 x softness, in shape radii).
     */
    public var shape: MaskShape { .radial(cx: cx, cy: cy, rx: rx, ry: ry, angle: angle, feather: 3 + 0.6 * softness) }

    /** This leak moved, sized or turned to a radial shape's place; anything else is ignored. */
    public func withShape(_ s: MaskShape) -> LightLeak {
        guard case let .radial(cx, cy, rx, ry, angle, _) = s else { return self }
        var l = self
        l.cx = cx
        l.cy = cy
        l.rx = rx
        l.ry = ry
        l.angle = angle
        return l
    }

    /** This leak turned into [k], with that kind's size, angle, softness and glow; place, bend, colour and intensity stay. */
    public func withKind(_ k: LeakKind) -> LightLeak {
        if k == kind { return self }
        var l = self
        l.kind = k
        l.rx = k.rx
        l.ry = k.ry
        l.angle = k.angle
        l.softness = k.softness
        l.glow = k.glow
        return l
    }
}

public enum LightLeaks {
    /** Uniform arrays in the shader are this long. */
    public static let maxLeaks = 4

    public static let hueMin: Float = -40
    public static let hueMax: Float = 60

    /** The default hue: Photoshop's (255, 156, 0) orange. */
    public static let hue: Float = 37

    /** The outer glow's hue is this much redder: (255, 5, 5) beside that orange. */
    private static let outerShift: Float = 37

    /** The leak triangle's inradius in shape radii (base 2, height 2). */
    private static let triangleInradius: Float = 0.618

    public static func newSeed() -> Float { (Float.random(in: 0..<1) * 1000).rounded() / 1000 }

    /** A warm orange leak, solid enough to cover what is under its core. */
    public static func newLeak(_ kind: LeakKind = .streak, cx: Float = 0.5, cy: Float = 0.5) -> LightLeak {
        LightLeak(id: Masks.newId(), kind: kind, cx: cx, cy: cy, seed: newSeed())
    }

    /** Fully saturated light of [hue] (display RGB 0..1), hue 0 = red, negative hues lean to magenta. */
    private static func hueColor(_ hue: Float) -> [Float] {
        let deg = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        func f(_ n: Float) -> Float {
            let k = (n + deg / 60).truncatingRemainder(dividingBy: 6)
            return 1 - max(0, min(min(k, 4 - k), 1))
        }
        return [f(5), f(3), f(1)]
    }

    /** The inner glow colour for [hue] (display RGB 0..1). */
    public static func color(_ hue: Float) -> [Float] { hueColor(hue.clamped(hueMin, hueMax)) }

    /** The outer glow colour for [hue]: the same light, redder. */
    public static func outerColor(_ hue: Float) -> [Float] { hueColor(hue.clamped(hueMin, hueMax) - outerShift) }

    /** The glow slider 0..100 as the shader's glow reach, in shape radii. */
    public static func glowReach(_ glow: Float) -> Float { 0.03 + glow.clamped(0, 100) / 100 * 3 }

    /** The bend slider as the axis's curvature in 1/px for a length radius of [rxPx] pixels: v = k u². */
    public static func bendCurvature(_ bend: Float, rxPx: Float) -> Float { (bend / 100).clamped(-1, 1) / max(rxPx, 1) }

    /** The taper's width factor at [qx] (-1..1 along the length). */
    public static func taperWidth(_ taper: Float, qx: Float) -> Float { max(1 + taper / 100 * qx.clamped(-1, 1), 0.05) }

    /**
     * Signed edge distance in shape radii (0 on the outline, negative inside) of a point (qx, qy) in the shape's own
     * frame after bend and taper (the shader's leakEdge, without the warp). Triangle: apex (1, 0), base corners
     * (-1, ±1), exact distance outside, inside scaled by its inradius so the middle is -1 as for the other shapes.
     */
    public static func edge(_ kind: LeakKind, qx: Float, qy: Float) -> Float {
        switch kind {
        case .streak:
            return abs(qy) - 1
        case .glow:
            return hypotf(qx, qy) - 1
        case .triangle:
            func segment(_ ax: Float, _ ay: Float, _ bx: Float, _ by: Float) -> Float {
                let ex = bx - ax
                let ey = by - ay
                let t = (((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey)).clamped(0, 1)
                return hypotf(qx - ax - ex * t, qy - ay - ey * t)
            }
            let d = min(min(segment(1, 0, -1, 1), segment(-1, 1, -1, -1)), segment(-1, -1, 1, 0))
            return qx > -1 && qx + 2 * abs(qy) < 1 ? -d / triangleInradius : d
        }
    }

    /** Packs the leaks that show; positions go from image fractions to full-resolution image pixels. */
    public static func pack(_ leaks: [LightLeak], imageWidth: Int, imageHeight: Int) -> LeakUniforms {
        let used = Array(leaks.filter { !$0.isIdentity }.prefix(maxLeaks))
        if used.isEmpty { return .none }
        var u = LeakUniforms.empty(used.count)
        let w = Float(imageWidth)
        let h = Float(imageHeight)
        let long = max(w, h)
        func put(_ values: [Float], into array: inout [Float], at o: Int) {
            for (k, v) in values.enumerated() { array[o + k] = v }
        }
        for (i, l) in used.enumerated() {
            let o = i * 4
            let a = l.angle * .pi / 180
            let rxPx = max(l.rx * long, 1)
            put([l.cx * w, l.cy * h, 1 / rxPx, 1 / max(l.ry * long, 1)], into: &u.geom, at: o)
            put([cos(a), sin(a), (l.softness / 100).clamped(0, 1), glowReach(l.glow)], into: &u.shape, at: o)
            let c = color(l.hue)
            put([c[0], c[1], c[2], (l.intensity / 100).clamped(0, 1)], into: &u.color, at: o)
            let oc = outerColor(l.hue)
            put([oc[0], oc[1], oc[2], l.seed], into: &u.outer, at: o)
            put([Float(l.kind.index), bendCurvature(l.bend, rxPx: rxPx), (l.warp / 100).clamped(0, 1),
                 (l.taper / 100).clamped(-1, 1)], into: &u.form, at: o)
        }
        return u
    }
}

/** Leaks packed for the shader's uniform arrays (see shaders/light_leak.glsl), LightLeaks.maxLeaks x vec4 each. */
public struct LeakUniforms: Sendable {
    public let count: Int
    public var geom: [Float]
    public var shape: [Float]
    public var color: [Float]
    public var outer: [Float]
    public var form: [Float]

    static func empty(_ count: Int) -> LeakUniforms {
        let zeros = [Float](repeating: 0, count: LightLeaks.maxLeaks * 4)
        return LeakUniforms(count: count, geom: zeros, shape: zeros, color: zeros, outer: zeros, form: zeros)
    }

    public static let none = empty(0)
}
