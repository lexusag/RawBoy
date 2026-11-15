import Foundation

/**
 * Healing brush (Pro, Desktop): strokes painted over dust, blemishes and small objects. Port of web's HealSpots.ts; the
 * edits JSON is the same. A click is a disk on the photo, a drag a stroke of such disks along a path (`path`: the
 * points after the first, flat x, y pairs). A disk's centre (x, y) is in fractions of the decoded image (display
 * orientation, before crop and lens, like masks), radius a fraction of its long side. It is healed in the
 * full-resolution image (`RawImage.healBlemishes`) by seamless cloning: inside the disk the picture takes the detail of
 * a source area and the tone of its surroundings.
 *
 * `source`: where the texture comes from (image fractions, the stroke's first point; the rest of the stroke keeps the
 * same offset, clone-stamp style), nil to let the engine pick the cleanest same-size area nearby for each disk.
 * `feather` 0..100 only sets how much of the old picture stays near the edge.
 *
 * Spots belong to one photo's content: they reset for each new photo and presets don't keep them (edits sidecars do).
 */
public struct HealSpot: Equatable, Sendable, Identifiable {
    public var id: String
    public var x: Float
    public var y: Float
    public var radius: Float
    public var source: [Float]?
    public var feather: Float
    public var path: [Float]

    public init(id: String = Masks.newId(), x: Float, y: Float, radius: Float, source: [Float]? = nil,
                feather: Float = HealSpots.defaultFeather, path: [Float] = []) {
        self.id = id
        self.x = x
        self.y = y
        self.radius = radius
        self.source = source
        self.feather = feather
        self.path = path
    }
}

public enum HealSpots {
    /** Strokes per photo: every one is healed again whenever the list changes. */
    public static let maxSpots = 64
    /** Points per stroke (a longer drag stops adding), and disks per photo's healing (the spacing widens past it). */
    public static let maxPoints = 1500
    static let maxDabs = 3000
    /** The brush radius range, fractions of the image's long side (the engine floors a disk at 2 px). */
    public static let radiusMin: Float = 0.0004
    public static let radiusMax: Float = 0.03
    public static let defaultFeather: Float = 80

    /** Brush size slider 0..100 <-> radius, exponential so small spots are easy to set. */
    public static func sizeValue(_ r: Float) -> Float {
        100 * log(min(radiusMax, max(radiusMin, r)) / radiusMin) / log(radiusMax / radiusMin)
    }

    public static func sizeRadius(_ v: Float) -> Float { radiusMin * pow(radiusMax / radiusMin, v / 100) }

    // MARK: - Edits JSON (web's Edits.ts: `healSpots`, ids not stored)

    public static func toJson(_ spots: [HealSpot]) -> [[String: Any]] {
        spots.map { s in
            ["x": Masks.num(s.x), "y": Masks.num(s.y), "radius": Masks.num(s.radius),
             "source": s.source.map { $0.map { Masks.num($0) } as Any } ?? NSNull(),
             "feather": Masks.num(s.feather), "path": s.path.map { Masks.num($0) }]
        }
    }

    /** Spots from untrusted JSON: invalid ones are dropped, at most [maxSpots] kept, values brought into range. */
    public static func parse(_ v: Any?) -> [HealSpot] {
        guard let a = v as? [Any] else { return [] }
        var out: [HealSpot] = []
        for raw in a {
            guard let o = raw as? [String: Any] else { continue }
            func number(_ x: Any?) -> Float? {
                guard let n = x as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.floatValue.isFinite else { return nil }
                return n.floatValue
            }
            guard let x = number(o["x"]), let y = number(o["y"]), let r = number(o["radius"]) else { continue }
            var source: [Float]?
            if let s = o["source"] as? [Any], s.count >= 2, let sx = number(s[0]), let sy = number(s[1]) {
                source = [sx.clamped(0, 1), sy.clamped(0, 1)]
            }
            var path: [Float] = []
            if let p = o["path"] as? [Any] {
                path = p.prefix(maxPoints * 2).map { number($0)?.clamped(0, 1) ?? 0 }
                path = Array(path.prefix(p.count / 2 * 2))
            }
            out.append(HealSpot(x: x.clamped(0, 1), y: y.clamped(0, 1), radius: r.clamped(radiusMin, radiusMax),
                                source: source, feather: number(o["feather"])?.clamped(0, 100) ?? defaultFeather,
                                path: path))
            if out.count >= maxSpots { break }
        }
        return out
    }

    // MARK: - What the engine heals

    /**
     * The disks the engine heals for [spots], in order: (x, y, radius, srcX, srcY, feather) per disk in full-resolution
     * pixels of an image [width] x [height]; srcX is -1 without a source. A stroke is cut into disks a third of a
     * radius apart (wider on very long ones), each with the stroke's source offset.
     */
    public static func strokes(_ spots: [HealSpot], width: Int, height: Int) -> [Float] {
        let w = Double(width), h = Double(height), long = max(w, h)
        let polylines: [[(Double, Double)]] = spots.map { s in
            var pts = [(Double(s.x) * w, Double(s.y) * h)]
            var i = 0
            while i + 1 < s.path.count {
                pts.append((Double(s.path[i]) * w, Double(s.path[i + 1]) * h))
                i += 2
            }
            return pts
        }
        func length(_ pts: [(Double, Double)]) -> Double {
            var sum = 0.0
            for i in 1..<max(pts.count, 1) { sum += hypot(pts[i].0 - pts[i - 1].0, pts[i].1 - pts[i - 1].1) }
            return sum
        }
        var spacing = 1.0 / 3
        func count(_ k: Double) -> Int {
            spots.enumerated().reduce(0) { sum, e in
                sum + 1 + Int((length(polylines[e.offset]) / max(1, max(2, Double(e.element.radius) * long) * k)).rounded(.up))
            }
        }
        while count(spacing) > maxDabs { spacing *= 1.5 }
        var out: [Float] = []
        for (i, s) in spots.enumerated() {
            let r = max(2, Double(s.radius) * long)
            let step = max(1, r * spacing)
            let pts = polylines[i]
            let dx = s.source.map { (Double($0[0]) - Double(s.x)) * w } ?? 0
            let dy = s.source.map { (Double($0[1]) - Double(s.y)) * h } ?? 0
            func dab(_ x: Double, _ y: Double) {
                out += [Float(x), Float(y), Float(r), s.source != nil ? Float(x + dx) : -1, s.source != nil ? Float(y + dy) : 0,
                        s.feather / 100]
            }
            dab(pts[0].0, pts[0].1)
            var toNext = step  // distance along the path to the next disk
            for k in 1..<max(pts.count, 1) {
                let (x0, y0) = pts[k - 1]
                let len = hypot(pts[k].0 - x0, pts[k].1 - y0)
                var d = toNext
                while d <= len {
                    dab(x0 + (pts[k].0 - x0) * d / len, y0 + (pts[k].1 - y0) * d / len)
                    d += step
                }
                toNext = d - len
            }
            // The stroke's end gets a disk too.
            if pts.count > 1 { dab(pts[pts.count - 1].0, pts[pts.count - 1].1) }
        }
        return out
    }

    /** A key that changes whenever the healing the spots ask for does (ids don't count). */
    public static func key(_ spots: [HealSpot]) -> String {
        func f(_ v: Float, _ digits: Int) -> String { String(format: "%.\(digits)f", Double(v)) }
        return spots.map { s in
            let src = s.source.map { "\(f($0[0], 5)),\(f($0[1], 5))" } ?? "-"
            let path = s.path.isEmpty ? "" : ",\(s.path.count):\(s.path.map { f($0, 4) }.joined(separator: " "))"
            return "\(f(s.x, 5)),\(f(s.y, 5)),\(f(s.radius, 5)),\(src),\(Int(s.feather.rounded()))" + path
        }.joined(separator: ";")
    }
}
