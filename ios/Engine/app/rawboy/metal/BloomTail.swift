import Foundation

/**
 * Bloom's wide tail, scattered once per photo on its small (~64 px) copy: a round power law (alpha 2.2, knee
 * 0.6 texel) out to 7 texels (~10% of the long edge), its weights falling to zero at the rim. The develop shader
 * samples the result as a B-spline, so the glow is smooth: summed per pixel from a bilinear copy, the coarse
 * texels showed as bands and squares. Only the highlights scatter (the shader's bloomKnee), and which tones are
 * highlights depends on exposure, so the result is `bands` copies stacked top to bottom, kneed at exposure
 * 2^0 .. 2^5; the shader blends the two either side of its own. The viewfinder runs the same kernel on the GPU (`tailScatterFragment`).
 * Port of BloomTail.kt.
 */
public enum BloomTail {
    public static let radius = 6

    /** Exposure bands, 2^0 .. 2^(bands - 1) (develop.glsl's BLOOM_TAIL_BANDS). */
    public static let bands = 6

    // develop.glsl's BLOOM_KNEE_LO / _HI.
    private static let kneeLo: Float = 0.36
    private static let kneeHi: Float = 1.44

    /** Tap offsets and their weights, summing to 1. */
    private static let taps: (dx: [Int], dy: [Int], weight: [Float]) = {
        var dx: [Int] = [], dy: [Int] = [], ws: [Double] = []
        let rim2 = Double((radius + 1) * (radius + 1))
        for j in -radius...radius {
            for i in -radius...radius {
                let r2 = Double(i * i + j * j)
                let rim = 1 - r2 / rim2
                if rim <= 0 { continue }
                dx.append(i)
                dy.append(j)
                ws.append(pow(1 + r2.squareRoot() / 0.6, -2.2) * rim * rim)
            }
        }
        let sum = ws.reduce(0, +)
        return (dx, dy, ws.map { Float($0 / sum) })
    }()

    /** The develop shader's bloomKnee: the share of light bloom scatters from a pixel `r` `g` `b` at exposure `gain`. */
    public static func knee(_ r: Float, _ g: Float, _ b: Float, gain: Float) -> Float {
        let t = min(1, max(0, (max(r, g, b) * gain - kneeLo) / (kneeHi - kneeLo)))
        return t * t * (3 - 2 * t)
    }

    /** `img` (half-float RGB), its highlights scattered by the tail kernel, edges clamped: `bands` bands. */
    public static func scatter(_ img: PreviewImage) -> PreviewImage {
        let w = img.width, h = img.height
        let rgb = img.pixels.map { Float(Float16(bitPattern: $0)) }
        var lit = [Float](repeating: 0, count: rgb.count)
        var out = [UInt16](repeating: 0, count: w * h * bands * 3)
        let (dx, dy, weight) = taps
        for band in 0..<bands {
            let gain = Float(1 << band)
            for o in stride(from: 0, to: rgb.count, by: 3) {
                let k = knee(rgb[o], rgb[o + 1], rgb[o + 2], gain: gain)
                lit[o] = k * rgb[o]
                lit[o + 1] = k * rgb[o + 1]
                lit[o + 2] = k * rgb[o + 2]
            }
            for y in 0..<h {
                for x in 0..<w {
                    var r: Float = 0, g: Float = 0, b: Float = 0
                    for k in 0..<weight.count {
                        let o = (min(h - 1, max(0, y + dy[k])) * w + min(w - 1, max(0, x + dx[k]))) * 3
                        r += weight[k] * lit[o]
                        g += weight[k] * lit[o + 1]
                        b += weight[k] * lit[o + 2]
                    }
                    let o = ((band * h + y) * w + x) * 3
                    out[o] = Float16(r).bitPattern
                    out[o + 1] = Float16(g).bitPattern
                    out[o + 2] = Float16(b).bitPattern
                }
            }
        }
        return PreviewImage(width: w, height: h * bands, pixels: out, fullWidth: img.fullWidth, fullHeight: img.fullHeight)
    }
}
