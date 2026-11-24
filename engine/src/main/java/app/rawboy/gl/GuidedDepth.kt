package app.rawboy.gl

import android.util.Half
import app.rawboy.export.DepthMap
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * 3-channel colour Guided Image Filter (He, Sun, Tang 2013) for upsampling the low-resolution (~518 px) portrait
 * depth map along the photo's full-resolution edges.
 *
 * Fits `depth ≈ a · sqrt(guide) + b` over a `(2r + 1) × (2r + 1)` window at each depth texel using the ~512 px
 * linear RGB base copy as the guide, then box-averages `(a, b)`. Uploaded to `uDepthMap` as `RGBA16F`
 * (`rgb = mean_a`, `a = mean_b`) so the develop and bokeh shaders evaluate `clamp(dot(ab.rgb, sqrt(rgb)) + ab.a, 0, 1)`
 * with a single bilinear lookup. Without a base guide, fills `(0, 0, 0, d)`.
 *
 * Ports: GuidedDepth.ts, GuidedDepth.swift.
 */
object GuidedDepth {
    /** Box window radius in depth-map texels (9x9 window at ~518 px). */
    const val RADIUS = 4

    /** Regularization epsilon from edge softness `0..1` (0 = crispest edge lock, 1 = softest). */
    fun eps(edge: Float): Float {
        val e = edge.coerceIn(0f, 1f).toDouble()
        return (3e-4 * 100.0.pow(e)).toFloat()
    }

    /** Separable O(1)-per-pixel box mean into [dst] (double prefix sums avoid cancellation in variance). */
    private fun boxMean(
        src: FloatArray,
        dst: FloatArray,
        tmp: FloatArray,
        prefix: DoubleArray,
        w: Int,
        h: Int,
        r: Int,
    ) {
        for (y in 0 until h) {
            val row = y * w
            prefix[0] = 0.0
            for (x in 0 until w) prefix[x + 1] = prefix[x] + src[row + x]
            for (x in 0 until w) {
                val x0 = if (x > r) x - r else 0
                val x1 = if (x + r < w) x + r else w - 1
                tmp[row + x] = ((prefix[x1 + 1] - prefix[x0]) / (x1 - x0 + 1)).toFloat()
            }
        }
        for (x in 0 until w) {
            prefix[0] = 0.0
            for (y in 0 until h) prefix[y + 1] = prefix[y] + tmp[y * w + x]
            for (y in 0 until h) {
                val y0 = if (y > r) y - r else 0
                val y1 = if (y + r < h) y + r else h - 1
                dst[y * w + x] = ((prefix[y1 + 1] - prefix[y0]) / (y1 - y0 + 1)).toFloat()
            }
        }
    }

    /**
     * Computes RGBA float32 `(mean_a.r, mean_a.g, mean_a.b, mean_b)` coefficients for [depth] guided by [base].
     * Returns a direct native-order [ByteBuffer] of `depth.width * depth.height * 4` floats for `GL_RGBA16F`.
     */
    fun compute(depth: DepthMap, base: PreviewImage?, edge: Float): ByteBuffer {
        val w = depth.width
        val h = depth.height
        val n = w * h
        val buf = ByteBuffer.allocateDirect(max(1, n) * 16).order(ByteOrder.nativeOrder())
        if (n == 0) return buf
        val dst = buf.asFloatBuffer()

        // Fallback without a usable base guide: (0, 0, 0, d) so dot(a, g) + b == d.
        if (base == null || base.width < 2 || base.height < 2) {
            for (i in 0 until n) {
                dst.put(0f)
                dst.put(0f)
                dst.put(0f)
                dst.put((depth.data[i].toInt() and 0xFF) / 255f)
            }
            buf.position(0)
            return buf
        }

        val r = min(RADIUS, max(1, min(w, h) - 1))
        val epsVal = eps(edge)

        val bw = base.width
        val bh = base.height
        val baseShorts = base.pixels.duplicate().apply { position(0) }.order(ByteOrder.nativeOrder()).asShortBuffer()
        val baseRgb = FloatArray(bw * bh * 3) { Half.toFloat(baseShorts.get(it)) }

        val ir = FloatArray(n)
        val ig = FloatArray(n)
        val ib = FloatArray(n)
        val p = FloatArray(n)
        for (y in 0 until h) {
            val fy = ((y + 0.5f) / h) * bh - 0.5f
            val y0 = floor(fy).toInt().coerceIn(0, bh - 1)
            val y1 = min(bh - 1, y0 + 1)
            val ty = (fy - y0).coerceIn(0f, 1f)
            val wy0 = 1f - ty
            for (x in 0 until w) {
                val fx = ((x + 0.5f) / w) * bw - 0.5f
                val x0 = floor(fx).toInt().coerceIn(0, bw - 1)
                val x1 = min(bw - 1, x0 + 1)
                val tx = (fx - x0).coerceIn(0f, 1f)
                val wx0 = 1f - tx
                val i00 = (y0 * bw + x0) * 3
                val i10 = (y0 * bw + x1) * 3
                val i01 = (y1 * bw + x0) * 3
                val i11 = (y1 * bw + x1) * 3
                val w00 = wx0 * wy0
                val w10 = tx * wy0
                val w01 = wx0 * ty
                val w11 = tx * ty
                val cr = w00 * baseRgb[i00] + w10 * baseRgb[i10] + w01 * baseRgb[i01] + w11 * baseRgb[i11]
                val cg = w00 * baseRgb[i00 + 1] + w10 * baseRgb[i10 + 1] + w01 * baseRgb[i01 + 1] + w11 * baseRgb[i11 + 1]
                val cb = w00 * baseRgb[i00 + 2] + w10 * baseRgb[i10 + 2] + w01 * baseRgb[i01 + 2] + w11 * baseRgb[i11 + 2]
                val idx = y * w + x
                ir[idx] = if (cr > 0f) sqrt(cr) else 0f
                ig[idx] = if (cg > 0f) sqrt(cg) else 0f
                ib[idx] = if (cb > 0f) sqrt(cb) else 0f
                p[idx] = (depth.data[idx].toInt() and 0xFF) / 255f
            }
        }

        val tmp = FloatArray(n)
        val prefix = DoubleArray(max(w, h) + 1)
        val prod = FloatArray(n)

        val mr = FloatArray(n)
        val mg = FloatArray(n)
        val mb = FloatArray(n)
        val mp = FloatArray(n)
        boxMean(ir, mr, tmp, prefix, w, h, r)
        boxMean(ig, mg, tmp, prefix, w, h, r)
        boxMean(ib, mb, tmp, prefix, w, h, r)
        boxMean(p, mp, tmp, prefix, w, h, r)

        val covR = FloatArray(n)
        val covG = FloatArray(n)
        val covB = FloatArray(n)
        for (i in 0 until n) prod[i] = ir[i] * p[i]
        boxMean(prod, covR, tmp, prefix, w, h, r)
        for (i in 0 until n) covR[i] -= mr[i] * mp[i]

        for (i in 0 until n) prod[i] = ig[i] * p[i]
        boxMean(prod, covG, tmp, prefix, w, h, r)
        for (i in 0 until n) covG[i] -= mg[i] * mp[i]

        for (i in 0 until n) prod[i] = ib[i] * p[i]
        boxMean(prod, covB, tmp, prefix, w, h, r)
        for (i in 0 until n) covB[i] -= mb[i] * mp[i]

        val vrr = FloatArray(n)
        val vrg = FloatArray(n)
        val vrb = FloatArray(n)
        val vgg = FloatArray(n)
        val vgb = FloatArray(n)
        val vbb = FloatArray(n)

        for (i in 0 until n) prod[i] = ir[i] * ir[i]
        boxMean(prod, vrr, tmp, prefix, w, h, r)
        for (i in 0 until n) vrr[i] = max(0f, vrr[i] - mr[i] * mr[i]) + epsVal

        for (i in 0 until n) prod[i] = ir[i] * ig[i]
        boxMean(prod, vrg, tmp, prefix, w, h, r)
        for (i in 0 until n) vrg[i] -= mr[i] * mg[i]

        for (i in 0 until n) prod[i] = ir[i] * ib[i]
        boxMean(prod, vrb, tmp, prefix, w, h, r)
        for (i in 0 until n) vrb[i] -= mr[i] * mb[i]

        for (i in 0 until n) prod[i] = ig[i] * ig[i]
        boxMean(prod, vgg, tmp, prefix, w, h, r)
        for (i in 0 until n) vgg[i] = max(0f, vgg[i] - mg[i] * mg[i]) + epsVal

        for (i in 0 until n) prod[i] = ig[i] * ib[i]
        boxMean(prod, vgb, tmp, prefix, w, h, r)
        for (i in 0 until n) vgb[i] -= mg[i] * mb[i]

        for (i in 0 until n) prod[i] = ib[i] * ib[i]
        boxMean(prod, vbb, tmp, prefix, w, h, r)
        for (i in 0 until n) vbb[i] = max(0f, vbb[i] - mb[i] * mb[i]) + epsVal

        // Solve 3x3 SPD system (Sigma + eps*I) * a = cov(I, p) via cofactors; reuse ir/ig/ib/p for a_r, a_g, a_b, b.
        for (i in 0 until n) {
            val rr = vrr[i]; val rg = vrg[i]; val rb = vrb[i]
            val gg = vgg[i]; val gb = vgb[i]; val bb = vbb[i]
            val crr = gg * bb - gb * gb
            val crg = gb * rb - rg * bb
            val crb = rg * gb - gg * rb
            val cgg = rr * bb - rb * rb
            val cgb = rg * rb - rr * gb
            val cbb = rr * gg - rg * rg
            val det = rr * crr + rg * crg + rb * crb
            val inv = if (det > 1e-20f) 1f / det else 0f
            val crp = covR[i]; val cgp = covG[i]; val cbp = covB[i]
            val xr = (crr * crp + crg * cgp + crb * cbp) * inv
            val xg = (crg * crp + cgg * cgp + cgb * cbp) * inv
            val xb = (crb * crp + cgb * cgp + cbb * cbp) * inv
            ir[i] = xr
            ig[i] = xg
            ib[i] = xb
            p[i] = mp[i] - xr * mr[i] - xg * mg[i] - xb * mb[i]
        }

        boxMean(ir, mr, tmp, prefix, w, h, r)
        boxMean(ig, mg, tmp, prefix, w, h, r)
        boxMean(ib, mb, tmp, prefix, w, h, r)
        boxMean(p, mp, tmp, prefix, w, h, r)

        for (i in 0 until n) {
            dst.put(mr[i])
            dst.put(mg[i])
            dst.put(mb[i])
            dst.put(mp[i])
        }
        buf.position(0)
        return buf
    }
}
