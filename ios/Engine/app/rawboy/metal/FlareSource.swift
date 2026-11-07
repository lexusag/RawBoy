import Foundation

/**
 * What the anamorphic flare (shaders/develop.glsl, `anamorphicFlare`) scatters light from, made once per photo from the
 * highlight-boosted `sourceMaxDimension` px copy. Port of FlareSource.kt / FlareSource.ts: keep the maths in step.
 *
 * Three bands stacked top to bottom, each `width` texels across (the copy's width / 3):
 * - band 0, `rows` rows: the copy's own rows. A bright light is thin here: the needle.
 * - band 1, `ceil(rows / 3)` rows: three rows to one, so a texel is square. The wing and the bar.
 * - band 2, as band 1: its luminance blurred into tall ovals (sigma 4 across, 10 down), for the ghosts.
 *
 * Bands 0 and 1 are the boosted light times two gates (size: big windows and signs don't flare; brightness: lights
 * that don't fill a texel with clipped light drop out), so the shader's knee does the rest.
 */
public enum FlareSource {
    public static let sourceMaxDimension = 1536

    private static let sizeSigma: Float = 0.04
    private static let sizeLo: Float = 0.05
    private static let sizeHi: Float = 0.14
    private static let brightLo: Float = 4.5
    private static let brightHi: Float = 6.8
    private static let blownLo: Float = 1.5
    private static let blownHi: Float = 4.0

    /** Rows of band 1 (and 2) for a copy of [rows] rows. */
    public static func coarseRows(_ rows: Int) -> Int { (rows + 2) / 3 }

    /** Rows of band 0 for a flare source (what [make] kept of the copy's rows). */
    public static func rows(_ source: PreviewImage) -> Int {
        var rows = source.height * 3 / 5
        while rows + 2 * coarseRows(rows) < source.height { rows += 1 }
        while rows + 2 * coarseRows(rows) > source.height { rows -= 1 }
        return rows
    }

    private static func smoothstep(_ e0: Float, _ e1: Float, _ x: Float) -> Float {
        let t = min(1, max(0, (x - e0) / (e1 - e0)))
        return t * t * (3 - 2 * t)
    }

    private static func boxPass(_ a: [Float], _ w: Int, _ h: Int, _ r: Int, alongX: Bool) -> [Float] {
        var out = [Float](repeating: 0, count: a.count)
        let n = alongX ? w : h
        let lines = alongX ? h : w
        let window = Float(2 * r + 1)
        for l in 0..<lines {
            func at(_ i: Int) -> Float {
                let c = min(n - 1, max(0, i))
                return alongX ? a[l * w + c] : a[c * w + l]
            }
            var sum: Float = 0
            for i in -r...r { sum += at(i) }
            for i in 0..<n {
                out[alongX ? l * w + i : i * w + l] = sum / window
                sum += at(i + r + 1) - at(i - r)
            }
        }
        return out
    }

    private static func gauss3(_ a: [Float], _ w: Int, _ h: Int, sy: Float, sx: Float) -> [Float] {
        func radius(_ s: Float) -> Int { max(1, Int(((4 * s * s + 1).squareRoot() - 1) / 2 + 0.5)) }
        var out = a
        for (alongX, s) in [(false, sy), (true, sx)] {
            let r = radius(s)
            for _ in 0..<3 { out = boxPass(out, w, h, r, alongX: alongX) }
        }
        return out
    }

    private static func maxFilter(_ a: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
        func pass(_ src: [Float], alongX: Bool) -> [Float] {
            var out = [Float](repeating: 0, count: src.count)
            let n = alongX ? w : h
            let lines = alongX ? h : w
            for l in 0..<lines {
                for i in 0..<n {
                    var m = -Float.infinity
                    for j in max(0, i - r)...min(n - 1, i + r) { m = max(m, src[alongX ? l * w + j : j * w + l]) }
                    out[alongX ? l * w + i : i * w + l] = m
                }
            }
            return out
        }
        return pass(pass(a, alongX: true), alongX: false)
    }

    /** The flare source for [src] (the highlight-boosted ~1536 px copy). */
    public static func make(_ src: PreviewImage) -> PreviewImage {
        let w = src.width, h = src.height
        let wf = (w + 2) / 3
        let rc = coarseRows(h)
        let px = src.pixels.map { Float(Float16(bitPattern: $0)) }

        var fine = [Float](repeating: 0, count: wf * h * 3)
        for y in 0..<h { for x in 0..<wf { for c in 0..<3 {
            var sum: Float = 0
            for k in 0..<3 { sum += px[(y * w + min(w - 1, 3 * x + k)) * 3 + c] }
            fine[(y * wf + x) * 3 + c] = sum / 3
        } } }

        var blown = [Float](repeating: 0, count: wf * rc)
        for yc in 0..<rc { for x in 0..<wf {
            var sum: Float = 0
            for k in 0..<3 {
                let o = (min(h - 1, 3 * yc + k) * wf + x) * 3
                sum += min(1, max(0, (max(fine[o], fine[o + 1], fine[o + 2]) - blownLo) / (blownHi - blownLo)))
            }
            blown[yc * wf + x] = sum / 3
        } }
        let sigma = sizeSigma * Float(max(wf, rc))
        let area = maxFilter(gauss3(blown, wf, rc, sy: sigma, sx: sigma), wf, rc, Int((0.8 * sigma).rounded()))

        var gated = [Float](repeating: 0, count: wf * h * 3)
        for y in 0..<h { for x in 0..<wf {
            let o = (y * wf + x) * 3
            let gate = (1 - smoothstep(sizeLo, sizeHi, area[y / 3 * wf + x]))
                * smoothstep(brightLo, brightHi, max(fine[o], fine[o + 1], fine[o + 2]))
            gated[o] = fine[o] * gate
            gated[o + 1] = fine[o + 1] * gate
            gated[o + 2] = fine[o + 2] * gate
        } }
        var coarse = [Float](repeating: 0, count: wf * rc * 3)
        for yc in 0..<rc { for x in 0..<wf { for c in 0..<3 {
            var sum: Float = 0
            for k in 0..<3 { sum += gated[(min(h - 1, 3 * yc + k) * wf + x) * 3 + c] }
            coarse[(yc * wf + x) * 3 + c] = sum / 3
        } } }

        var lum = [Float](repeating: 0, count: wf * rc)
        for i in 0..<lum.count { lum[i] = coarse[i * 3] * 0.2627 + coarse[i * 3 + 1] * 0.678 + coarse[i * 3 + 2] * 0.0593 }
        let ghost = gauss3(lum, wf, rc, sy: 10, sx: 4)

        var out = [UInt16]()
        out.reserveCapacity(wf * (h + 2 * rc) * 3)
        for v in gated { out.append(Float16(v).bitPattern) }
        for v in coarse { out.append(Float16(v).bitPattern) }
        for v in ghost { let hv = Float16(v).bitPattern; out.append(hv); out.append(hv); out.append(hv) }
        return PreviewImage(width: wf, height: h + 2 * rc, pixels: out, fullWidth: src.fullWidth, fullHeight: src.fullHeight)
    }
}
