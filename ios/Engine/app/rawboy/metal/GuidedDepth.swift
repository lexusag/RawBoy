import Foundation

/**
 * 3-channel colour Guided Image Filter (He, Sun, Tang 2013) for upsampling the low-resolution (~518 px) portrait
 * depth map along the photo's full-resolution edges.
 *
 * Fits `depth ≈ a · sqrt(guide) + b` over a `(2r + 1) × (2r + 1)` window at each depth texel using the ~512 px
 * linear RGB base copy as the guide, then box-averages `(a, b)`. Uploaded to `uDepthMap` as `RGBA16F`
 * (`rgb = mean_a`, `a = mean_b`) so the develop and bokeh shaders evaluate `clamp(dot(ab.rgb, sqrt(rgb)) + ab.a, 0, 1)`
 * with a single bilinear lookup. Without a base guide, fills `(0, 0, 0, d)`.
 *
 * Port of GuidedDepth.ts / GuidedDepth.kt.
 */
public enum GuidedDepth {
    /** Box window radius in depth-map texels (9x9 window at ~518 px). */
    public static let radius = 4

    /** Regularization epsilon from edge softness `0..1` (0 = crispest edge lock, 1 = softest). */
    public static func eps(_ edge: Float) -> Float {
        let e = Double(min(1, max(0, edge)))
        return Float(3e-4 * pow(100.0, e))
    }

    /** Separable O(1)-per-pixel box mean into `dst` (Double prefix sums avoid cancellation in variance). */
    private static func boxMean(
        _ src: [Float],
        _ dst: inout [Float],
        _ tmp: inout [Float],
        _ prefix: inout [Double],
        _ w: Int,
        _ h: Int,
        _ r: Int
    ) {
        for y in 0..<h {
            let row = y * w
            prefix[0] = 0
            for x in 0..<w { prefix[x + 1] = prefix[x] + Double(src[row + x]) }
            for x in 0..<w {
                let x0 = x > r ? x - r : 0
                let x1 = x + r < w ? x + r : w - 1
                tmp[row + x] = Float((prefix[x1 + 1] - prefix[x0]) / Double(x1 - x0 + 1))
            }
        }
        for x in 0..<w {
            prefix[0] = 0
            for y in 0..<h { prefix[y + 1] = prefix[y] + Double(tmp[y * w + x]) }
            for y in 0..<h {
                let y0 = y > r ? y - r : 0
                let y1 = y + r < h ? y + r : h - 1
                dst[y * w + x] = Float((prefix[y1 + 1] - prefix[y0]) / Double(y1 - y0 + 1))
            }
        }
    }

    /**
     * Computes RGBA16F `(mean_a.r, mean_a.g, mean_a.b, mean_b)` coefficients for `depth` guided by `base`.
     * Returns `depth.width * depth.height * 4` `Float16` values ready to upload to `.rgba16Float`.
     */
    public static func compute(_ depth: DepthMap, base: PreviewImage?, edge: Float) -> [Float16] {
        let w = depth.width
        let h = depth.height
        let n = w * h
        var out = [Float16](repeating: 0, count: n * 4)
        if n == 0 { return out }

        // Fallback without a usable base guide: (0, 0, 0, d) so dot(a, g) + b == d.
        guard let base, base.width >= 2, base.height >= 2, base.pixels.count >= base.width * base.height * 3 else {
            for i in 0..<n { out[i * 4 + 3] = Float16(Float(depth.data[i]) / 255.0) }
            return out
        }

        let r = min(radius, max(1, min(w, h) - 1))
        let epsVal = eps(edge)

        let bw = base.width
        let bh = base.height
        var baseRgb = [Float](repeating: 0, count: bw * bh * 3)
        for i in 0..<baseRgb.count { baseRgb[i] = Float(Float16(bitPattern: base.pixels[i])) }

        var ir = [Float](repeating: 0, count: n)
        var ig = [Float](repeating: 0, count: n)
        var ib = [Float](repeating: 0, count: n)
        var p = [Float](repeating: 0, count: n)
        for y in 0..<h {
            let fy = (Float(y) + 0.5) / Float(h) * Float(bh) - 0.5
            let y0 = max(0, min(bh - 1, Int(floor(fy))))
            let y1 = min(bh - 1, y0 + 1)
            let ty = max(0, min(1, fy - Float(y0)))
            let wy0 = 1 - ty
            for x in 0..<w {
                let fx = (Float(x) + 0.5) / Float(w) * Float(bw) - 0.5
                let x0 = max(0, min(bw - 1, Int(floor(fx))))
                let x1 = min(bw - 1, x0 + 1)
                let tx = max(0, min(1, fx - Float(x0)))
                let wx0 = 1 - tx
                let i00 = (y0 * bw + x0) * 3
                let i10 = (y0 * bw + x1) * 3
                let i01 = (y1 * bw + x0) * 3
                let i11 = (y1 * bw + x1) * 3
                let w00 = wx0 * wy0
                let w10 = tx * wy0
                let w01 = wx0 * ty
                let w11 = tx * ty
                let cr = w00 * baseRgb[i00] + w10 * baseRgb[i10] + w01 * baseRgb[i01] + w11 * baseRgb[i11]
                let cg = w00 * baseRgb[i00 + 1] + w10 * baseRgb[i10 + 1] + w01 * baseRgb[i01 + 1] + w11 * baseRgb[i11 + 1]
                let cb = w00 * baseRgb[i00 + 2] + w10 * baseRgb[i10 + 2] + w01 * baseRgb[i01 + 2] + w11 * baseRgb[i11 + 2]
                let idx = y * w + x
                ir[idx] = cr > 0 ? sqrt(cr) : 0
                ig[idx] = cg > 0 ? sqrt(cg) : 0
                ib[idx] = cb > 0 ? sqrt(cb) : 0
                p[idx] = Float(depth.data[idx]) / 255.0
            }
        }

        var tmp = [Float](repeating: 0, count: n)
        var prefix = [Double](repeating: 0, count: max(w, h) + 1)
        var prod = [Float](repeating: 0, count: n)

        var mr = [Float](repeating: 0, count: n)
        var mg = [Float](repeating: 0, count: n)
        var mb = [Float](repeating: 0, count: n)
        var mp = [Float](repeating: 0, count: n)
        boxMean(ir, &mr, &tmp, &prefix, w, h, r)
        boxMean(ig, &mg, &tmp, &prefix, w, h, r)
        boxMean(ib, &mb, &tmp, &prefix, w, h, r)
        boxMean(p, &mp, &tmp, &prefix, w, h, r)

        var covR = [Float](repeating: 0, count: n)
        var covG = [Float](repeating: 0, count: n)
        var covB = [Float](repeating: 0, count: n)
        for i in 0..<n { prod[i] = ir[i] * p[i] }
        boxMean(prod, &covR, &tmp, &prefix, w, h, r)
        for i in 0..<n { covR[i] -= mr[i] * mp[i] }

        for i in 0..<n { prod[i] = ig[i] * p[i] }
        boxMean(prod, &covG, &tmp, &prefix, w, h, r)
        for i in 0..<n { covG[i] -= mg[i] * mp[i] }

        for i in 0..<n { prod[i] = ib[i] * p[i] }
        boxMean(prod, &covB, &tmp, &prefix, w, h, r)
        for i in 0..<n { covB[i] -= mb[i] * mp[i] }

        var vrr = [Float](repeating: 0, count: n)
        var vrg = [Float](repeating: 0, count: n)
        var vrb = [Float](repeating: 0, count: n)
        var vgg = [Float](repeating: 0, count: n)
        var vgb = [Float](repeating: 0, count: n)
        var vbb = [Float](repeating: 0, count: n)

        for i in 0..<n { prod[i] = ir[i] * ir[i] }
        boxMean(prod, &vrr, &tmp, &prefix, w, h, r)
        for i in 0..<n { vrr[i] = max(0, vrr[i] - mr[i] * mr[i]) + epsVal }

        for i in 0..<n { prod[i] = ir[i] * ig[i] }
        boxMean(prod, &vrg, &tmp, &prefix, w, h, r)
        for i in 0..<n { vrg[i] -= mr[i] * mg[i] }

        for i in 0..<n { prod[i] = ir[i] * ib[i] }
        boxMean(prod, &vrb, &tmp, &prefix, w, h, r)
        for i in 0..<n { vrb[i] -= mr[i] * mb[i] }

        for i in 0..<n { prod[i] = ig[i] * ig[i] }
        boxMean(prod, &vgg, &tmp, &prefix, w, h, r)
        for i in 0..<n { vgg[i] = max(0, vgg[i] - mg[i] * mg[i]) + epsVal }

        for i in 0..<n { prod[i] = ig[i] * ib[i] }
        boxMean(prod, &vgb, &tmp, &prefix, w, h, r)
        for i in 0..<n { vgb[i] -= mg[i] * mb[i] }

        for i in 0..<n { prod[i] = ib[i] * ib[i] }
        boxMean(prod, &vbb, &tmp, &prefix, w, h, r)
        for i in 0..<n { vbb[i] = max(0, vbb[i] - mb[i] * mb[i]) + epsVal }

        for i in 0..<n {
            let rr = vrr[i], rg = vrg[i], rb = vrb[i]
            let gg = vgg[i], gb = vgb[i], bb = vbb[i]
            let crr = gg * bb - gb * gb
            let crg = gb * rb - rg * bb
            let crb = rg * gb - gg * rb
            let cgg = rr * bb - rb * rb
            let cgb = rg * rb - rr * gb
            let cbb = rr * gg - rg * rg
            let det = rr * crr + rg * crg + rb * crb
            let inv: Float = det > 1e-20 ? 1 / det : 0
            let crp = covR[i], cgp = covG[i], cbp = covB[i]
            let xr = (crr * crp + crg * cgp + crb * cbp) * inv
            let xg = (crg * crp + cgg * cgp + cgb * cbp) * inv
            let xb = (crb * crp + cgb * cgp + cbb * cbp) * inv
            ir[i] = xr
            ig[i] = xg
            ib[i] = xb
            p[i] = mp[i] - xr * mr[i] - xg * mg[i] - xb * mb[i]
        }

        boxMean(ir, &mr, &tmp, &prefix, w, h, r)
        boxMean(ig, &mg, &tmp, &prefix, w, h, r)
        boxMean(ib, &mb, &tmp, &prefix, w, h, r)
        boxMean(p, &mp, &tmp, &prefix, w, h, r)

        for i in 0..<n {
            let o = i * 4
            out[o] = Float16(mr[i])
            out[o + 1] = Float16(mg[i])
            out[o + 2] = Float16(mb[i])
            out[o + 3] = Float16(mp[i])
        }
        return out
    }
}
