import Foundation

/**
 * The picture circle of a circular fisheye, found on the 512 px base copy: centre as a fraction of the width and
 * height away from the frame's centre (-0.5..0.5), radius as a fraction of the frame's half diagonal (what the Image
 * circle size slider calls 100%). Port of FisheyeCircle.kt/.ts: keep them in step.
 */
public struct FisheyeCircle: Sendable {
    public let offsetX: Double
    public let offsetY: Double
    public let radius: Double

    /** How much smaller than the measured edge the circle is taken: the rim is vignetted and soft. */
    private static let shrink = 0.97

    public static func detect(_ base: PreviewImage) -> FisheyeCircle? {
        let w = base.width, h = base.height
        if w < 32 || h < 32 { return nil }
        let px = base.pixels
        var lum = [Float](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            lum[i] = 0.2126 * Float(Float16(bitPattern: px[i * 3])) + 0.7152 * Float(Float16(bitPattern: px[i * 3 + 1]))
                + 0.0722 * Float(Float16(bitPattern: px[i * 3 + 2]))
        }
        return detect(lum: lum, width: w, height: h)
    }

    public static func detect(lum: [Float], width w: Int, height h: Int) -> FisheyeCircle? {
        let s = max(4, Int((0.04 * Double(min(w, h))).rounded()))
        var corner = 0.0
        for (x0, y0) in [(0, 0), (w - s, 0), (0, h - s), (w - s, h - s)] {
            for y in y0..<(y0 + s) { for x in x0..<(x0 + s) { corner += Double(lum[y * w + x]) } }
        }
        corner /= 4 * Double(s * s)
        var sample: [Float] = []
        var i = 0
        while i < lum.count { sample.append(lum[i]); i += 7 }
        sample.sort()
        let p98 = Double(sample[Int(Double(sample.count) * 0.98)])
        if !(p98 > 0) || corner > 0.01 * p98 { return nil }
        let thr = Float(max(corner * 4, 0.02 * p98))

        var cols = [Int](repeating: 0, count: w)
        var rows = [Int](repeating: 0, count: h)
        for y in 0..<h {
            for x in 0..<w where lum[y * w + x] > thr {
                cols[x] += 1
                rows[y] += 1
            }
        }
        let minCount = 4
        guard let left = cols.firstIndex(where: { $0 >= minCount }), let right = cols.lastIndex(where: { $0 >= minCount }),
              let top = rows.firstIndex(where: { $0 >= minCount }), let bottom = rows.lastIndex(where: { $0 >= minCount }),
              right > left, bottom > top else { return nil }

        let touchX = left <= 1 && right >= w - 2
        let touchY = top <= 1 && bottom >= h - 2
        if touchX && touchY { return nil }
        let dx = Double(right - left + 1), dy = Double(bottom - top + 1)
        let diameter: Double
        if touchX {
            diameter = dy
        } else if touchY {
            diameter = dx
        } else {
            let ratio = dx / dy
            if ratio < 0.8 || ratio > 1.25 { return nil }
            diameter = (dx + dy) / 2
        }
        let cx = touchX ? Double(w) / 2 : Double(left + right + 1) / 2
        let cy = touchY ? Double(h) / 2 : Double(top + bottom + 1) / 2
        let halfDiag = hypot(Double(w) / 2, Double(h) / 2)
        let radius = diameter / 2 * shrink / halfDiag
        if radius < 0.15 || radius > 0.98 { return nil }
        // Outside a real fisheye circle it is black; a dim frame-filling photo has picture in the ring beyond it.
        let rPx = radius * halfDiag
        var outside = 0, above = 0
        for y in 0..<h {
            for x in 0..<w {
                let d = hypot(Double(x) + 0.5 - cx, Double(y) + 0.5 - cy)
                if d > rPx * 1.08 && d < rPx * 1.3 {
                    outside += 1
                    if lum[y * w + x] > thr { above += 1 }
                }
            }
        }
        if outside > 0 && Double(above) / Double(outside) > 0.15 { return nil }
        return FisheyeCircle(offsetX: (cx - Double(w) / 2) / Double(w), offsetY: (cy - Double(h) / 2) / Double(h), radius: radius)
    }
}
