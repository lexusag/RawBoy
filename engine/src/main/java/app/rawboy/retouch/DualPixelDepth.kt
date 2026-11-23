package app.rawboy.retouch

import app.rawboy.export.DepthMap
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Depth from a sensor's dual-pixel (phase-detect) frame: the raw depth stream some phones offer beside the raw
 * (`RAW_DEPTH10`, Pixel 9 Pro: 4080×768 on the main lens). Worked out on Pixel 9 Pro frames (2026-11-23):
 *
 * - The frame is one grey picture of the whole sensor, every column a half pixel: even columns see the left of the
 *   lens's pupil, odd ones the right. Rows are binned (768 for 3072 sensor rows).
 * - Out of focus, the two halves see the scene shifted sideways by the defocus disparity: 0 on the focus plane,
 *   one sign behind it (farther), the other in front. Positive here (right half shifted right of the left) is
 *   farther: −0.76 correlation with a monocular model's inverse depth on a desk scene.
 * - Disparities are small (±4 half-pixel columns at f/1.7), so the halves are matched by normalised correlation over
 *   windows at 2× and 4× horizontal decimation (blurred areas need the coarse one), picked per pixel by peak score,
 *   then confidence-weighted hole filling and a guided filter on the frame itself snap it to edges. Horizontal edges
 *   carry no sideways disparity and come out low-confidence; the filling takes them from around.
 *
 * The result is a defocus map, not a distance map: [DepthMap] 0.5 is the focus plane, 0 / 1 the strongest in front /
 * behind it. That suits portrait blur (the blur a lens would give grows with the disparity).
 * Plain Kotlin (JVM-testable).
 */
object DualPixelDepth {
    /** `ImageFormat.RAW_DEPTH10` (hidden): RAW10, 4 pixels in 5 bytes. */
    const val RAW_DEPTH10 = 0x1003

    /** `ImageFormat.RAW_DEPTH` (hidden): 16-bit little-endian samples. */
    const val RAW_DEPTH = 0x1002

    /** The map's long side, like [HardwareDepth]'s. */
    private const val OUT_MAX = 512

    /** Below this many half-pixel columns of spread the scene is treated as all in focus (noise isn't stretched). */
    private const val MIN_RANGE = 1.0f

    /**
     * The upright [DepthMap] of a dual-pixel frame ([bytes]: [height] rows of [rowStride] bytes in [format]), or null
     * if it can't be read. [sensorAspect] is the raw's width / height in sensor orientation (the frame's rows are
     * binned more than its columns); [exifOrientation] turns it upright like the photo.
     */
    fun compute(
        bytes: ByteArray,
        width: Int,
        height: Int,
        rowStride: Int,
        format: Int,
        sensorAspect: Float,
        exifOrientation: Int,
    ): DepthMap? = measure(bytes, width, height, rowStride, format)?.let { toMap(it, sensorAspect, exifOrientation) }

    /**
     * What a dual-pixel frame measures, on a grid in sensor orientation ([width]×[height]: half the frame's columns
     * and rows, e.g. 1020×384 for 4080×768), in half-pixel columns of sideways shift (positive = behind focus):
     * [disparity] and its [confidence] per cell as matched, and [smooth], filled in and snapped to the frame's edges.
     */
    class Measurement(val width: Int, val height: Int, val disparity: FloatArray, val confidence: FloatArray, val smooth: FloatArray) {
        /** [smooth] at sensor position ([u], [v]) in 0..1. */
        fun smoothAt(u: Float, v: Float): Float = bilinear(smooth, width, height, (u * width - 0.5f).coerceIn(0f, width - 1f), (v * height - 0.5f).coerceIn(0f, height - 1f))
    }

    /** Matches the frame's halves ([compute] without the map); null if it can't be read. */
    fun measure(bytes: ByteArray, width: Int, height: Int, rowStride: Int, format: Int): Measurement? {
        if (width < 64 || height < 32) return null
        val img = unpack(bytes, width, height, rowStride, format) ?: return null
        // Black: the stream doesn't say; the darkest samples sit at it (never above the usual 64 of 10-bit sensors).
        val black = min(64f, percentile(img, 0.001f))

        // Halves, two rows averaged: (width / 2) × (height / 2).
        val hw = width / 2
        val hh = height / 2
        val left = FloatArray(hw * hh)
        val right = FloatArray(hw * hh)
        for (y in 0 until hh) {
            val r0 = 2 * y * width
            val r1 = r0 + width
            for (x in 0 until hw) {
                left[y * hw + x] = max(0f, (img[r0 + 2 * x] + img[r1 + 2 * x]) * 0.5f - black)
                right[y * hw + x] = max(0f, (img[r0 + 2 * x + 1] + img[r1 + 2 * x + 1]) * 0.5f - black)
            }
        }
        // The halves are shaded differently (each sees one side of the pupil): divide out the local level.
        val ln = normalised(left, hw, hh)
        val rn = normalised(right, hw, hh)

        // Matching at 2× and 4× horizontal decimation; both brought to the 2× grid, in half-pixel columns.
        val gw = hw / 2
        val fine = matchInBands(decimate(ln, hw, hh, 2), decimate(rn, hw, hh, 2), gw, hh, maxShift = 3.5f)
        val cw = hw / 4
        val coarse = matchInBands(decimate(ln, hw, hh, 4), decimate(rn, hw, hh, 4), cw, hh, maxShift = 2.5f)
        val disp = FloatArray(gw * hh)
        val conf = FloatArray(gw * hh)
        for (y in 0 until hh) {
            for (x in 0 until gw) {
                val i = y * gw + x
                val j = y * cw + min(cw - 1, x / 2)
                if (coarse.second[j] > fine.second[i]) {
                    disp[i] = coarse.first[j] * 4f
                    conf[i] = coarse.second[j]
                } else {
                    disp[i] = fine.first[i] * 2f
                    conf[i] = fine.second[i]
                }
            }
        }

        val filled = fill(disp, conf, gw, hh)
        // Guide: the frame's own log brightness on the same grid.
        val guide = FloatArray(gw * hh) { i ->
            val y = i / gw
            val x = i % gw
            ln(left[y * hw + min(hw - 1, 2 * x)] + left[y * hw + min(hw - 1, 2 * x + 1)] + 1f)
        }
        val snapped = guidedFilter(guide, filled, gw, hh, rx = 6, ry = 3, eps = 1e-3f)
        return Measurement(gw, hh, disp, conf, snapped)
    }

    /** The normalised map of a [Measurement]: 0.5 = the focus plane, the spread of the shifts to 0 / 1. */
    fun toMap(m: Measurement, sensorAspect: Float, exifOrientation: Int): DepthMap {
        val gw = m.width
        val hh = m.height
        val snapped = m.smooth
        val spread = max(MIN_RANGE, percentile(FloatArray(snapped.size) { abs(snapped[it]) }, 0.98f))
        // Sensor-orientation output grid with the raw's aspect.
        val (ow, oh) = if (sensorAspect >= 1f) OUT_MAX to max(1, (OUT_MAX / sensorAspect).roundToInt())
        else max(1, (OUT_MAX * sensorAspect).roundToInt()) to OUT_MAX
        val norm = FloatArray(ow * oh)
        for (y in 0 until oh) {
            val fy = ((y + 0.5f) * hh / oh - 0.5f).coerceIn(0f, hh - 1f)
            for (x in 0 until ow) {
                val fx = ((x + 0.5f) * gw / ow - 0.5f).coerceIn(0f, gw - 1f)
                val d = bilinear(snapped, gw, hh, fx, fy)
                norm[y * ow + x] = (0.5f + 0.5f * d / spread).coerceIn(0f, 1f)
            }
        }
        // The focus: the in-focus shift as the confident cells near 0 show it (the lens's in-focus shift isn't quite 0).
        // Not the most confident cells: confidence also measures texture, and a textured room behind a smooth face won
        // (1.20.9).
        val usable = 0.1f * percentile(m.confidence, 0.995f)
        val inFocus = m.disparity.indices.filter { m.confidence[it] >= usable && m.confidence[it] > 0f && abs(m.disparity[it]) <= 0.07f }.map { m.disparity[it] }
        val focus = if (inFocus.size < 20) 0.5f else (0.5f + 0.5f * percentile(inFocus.toFloatArray(), 0.5f) / spread).coerceIn(0f, 1f)
        return HardwareDepth.toDepthMap(norm, ow, oh, exifOrientation, hardware = true, subjectDetected = true, focusDepth = focus)
    }

    /** RAW10 (MIPI packing) or 16-bit samples → floats, row by row. */
    internal fun unpack(bytes: ByteArray, width: Int, height: Int, rowStride: Int, format: Int): FloatArray? {
        val out = FloatArray(width * height)
        when (format) {
            RAW_DEPTH10 -> {
                if (width % 4 != 0 || rowStride < width * 5 / 4 || bytes.size < rowStride * (height - 1) + width * 5 / 4) return null
                for (y in 0 until height) {
                    var src = y * rowStride
                    var dst = y * width
                    repeat(width / 4) {
                        val lsb = bytes[src + 4].toInt() and 0xff
                        for (k in 0 until 4) {
                            out[dst + k] = (((bytes[src + k].toInt() and 0xff) shl 2) or ((lsb shr (2 * k)) and 3)).toFloat()
                        }
                        src += 5
                        dst += 4
                    }
                }
            }
            RAW_DEPTH -> {
                if (rowStride < width * 2 || bytes.size < rowStride * (height - 1) + width * 2) return null
                for (y in 0 until height) {
                    for (x in 0 until width) {
                        val i = y * rowStride + 2 * x
                        out[y * width + x] = ((bytes[i].toInt() and 0xff) or ((bytes[i + 1].toInt() and 0xff) shl 8)).toFloat()
                    }
                }
            }
            else -> return null
        }
        return out
    }

    private fun normalised(a: FloatArray, w: Int, h: Int): FloatArray {
        val level = box(a, w, h, 60, 15)
        return FloatArray(a.size) { a[it] / max(level[it], 1f) }
    }

    /** Horizontal box average over [factor] columns, keeping every [factor]th. */
    private fun decimate(a: FloatArray, w: Int, h: Int, factor: Int): FloatArray {
        val ow = w / factor
        val out = FloatArray(ow * h)
        for (y in 0 until h) {
            for (x in 0 until ow) {
                var s = 0f
                for (k in 0 until factor) s += a[y * w + x * factor + k]
                out[y * ow + x] = s / factor
            }
        }
        return out
    }

    /** Rows of context each band of [matchInBands] reads beyond its own (the high-pass and window reach). */
    private const val BAND_MARGIN = 16

    /**
     * [match] over horizontal bands of rows on all cores: the search is the slow part (a shift at a time over the
     * whole grid), and a band needs only [BAND_MARGIN] rows around it to give the same answer.
     */
    private fun matchInBands(a: FloatArray, b: FloatArray, w: Int, h: Int, maxShift: Float): Pair<FloatArray, FloatArray> {
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)
        val bands = min(threads, max(1, h / (2 * BAND_MARGIN)))
        if (bands == 1) return match(a, b, w, h, maxShift)
        val disp = FloatArray(w * h)
        val conf = FloatArray(w * h)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(bands)
        try {
            (0 until bands).map { k ->
                pool.submit {
                    val y0 = h * k / bands
                    val y1 = h * (k + 1) / bands
                    val r0 = max(0, y0 - BAND_MARGIN)
                    val r1 = min(h, y1 + BAND_MARGIN)
                    val (d, c) = match(a.copyOfRange(r0 * w, r1 * w), b.copyOfRange(r0 * w, r1 * w), w, r1 - r0, maxShift)
                    System.arraycopy(d, (y0 - r0) * w, disp, y0 * w, (y1 - y0) * w)
                    System.arraycopy(c, (y0 - r0) * w, conf, y0 * w, (y1 - y0) * w)
                }
            }.forEach { it.get() }
        } finally {
            pool.shutdown()
        }
        return disp to conf
    }

    /**
     * Per pixel, the sideways shift of [b] that best matches [a] (zero-mean normalised correlation over a 13×9 window,
     * shifts of ±[maxShift] in quarter steps, refined by a parabola) and a confidence: the peak's height to the 8th
     * power × its sharpness, 0 where the best shift is at the end of the range.
     */
    private fun match(a0: FloatArray, b0: FloatArray, w: Int, h: Int, maxShift: Float): Pair<FloatArray, FloatArray> {
        val rx = 6
        val ry = 4
        val a = highPass(a0, w, h, 2 * rx, 2 * ry)
        val b = highPass(b0, w, h, 2 * rx, 2 * ry)
        val va = box(FloatArray(a.size) { a[it] * a[it] }, w, h, rx, ry)
        val vb = box(FloatArray(b.size) { b[it] * b[it] }, w, h, rx, ry)
        val step = 0.25f
        val n = (2 * maxShift / step).roundToInt() + 1
        val bestScore = FloatArray(w * h) { -2f }
        val bestIndex = IntArray(w * h)
        val before = FloatArray(w * h)
        val after = FloatArray(w * h)
        var previous: FloatArray? = null
        val prod = FloatArray(w * h)
        val vbs = FloatArray(w * h)
        for (k in 0 until n) {
            val d = -maxShift + k * step
            shifted(b, w, h, d, prod)
            for (i in prod.indices) prod[i] *= a[i]
            shifted(vb, w, h, d, vbs)
            val num = box(prod, w, h, rx, ry)
            val score = FloatArray(w * h) { i -> num[i] / sqrt(va[i] * vbs[i] + 1e-9f) }
            for (i in score.indices) {
                // The shift after a new best is its right-hand neighbour.
                if (bestIndex[i] == k - 1 && k > 0) after[i] = score[i]
                if (score[i] > bestScore[i]) {
                    bestScore[i] = score[i]
                    bestIndex[i] = k
                    before[i] = previous?.get(i) ?: score[i]
                }
            }
            previous = score
        }
        val disp = FloatArray(w * h)
        val conf = FloatArray(w * h)
        for (i in disp.indices) {
            val k = bestIndex[i]
            if (k == 0 || k == n - 1) continue
            val c1 = bestScore[i]
            val den = 2 * c1 - before[i] - after[i]
            val sub = if (den > 1e-6f) 0.5f * (after[i] - before[i]) / den else 0f
            disp[i] = -maxShift + (k + sub.coerceIn(-0.5f, 0.5f)) * step
            val peak = c1.coerceIn(0f, 1f)
            val p2 = peak * peak
            val p4 = p2 * p2
            conf[i] = p4 * p4 * (den / step).coerceIn(0f, 1f)
        }
        return disp to conf
    }

    /** [b] moved left by [d] columns (linear interpolation), edges clamped, into [out]. */
    private fun shifted(b: FloatArray, w: Int, h: Int, d: Float, out: FloatArray) {
        val i0 = floor(d).toInt()
        val f = d - i0
        for (y in 0 until h) {
            val row = y * w
            for (x in 0 until w) {
                val x0 = (x + i0).coerceIn(0, w - 1)
                val x1 = (x + i0 + 1).coerceIn(0, w - 1)
                out[row + x] = (1 - f) * b[row + x0] + f * b[row + x1]
            }
        }
    }

    private fun highPass(a: FloatArray, w: Int, h: Int, rx: Int, ry: Int): FloatArray {
        val low = box(a, w, h, rx, ry)
        return FloatArray(a.size) { a[it] - low[it] }
    }

    /**
     * Fills low-confidence pixels from confident ones around them: normalised convolution at growing radii, each
     * radius taking what the smaller ones left.
     */
    private fun fill(d: FloatArray, c: FloatArray, w: Int, h: Int): FloatArray {
        val medianConf = percentile(c, 0.5f)
        val norm = medianConf * 0.5f + 1e-6f
        val cd = FloatArray(d.size) { c[it] * d[it] }
        val out = FloatArray(d.size)
        val taken = FloatArray(d.size)
        for (r in intArrayOf(2, 6, 18, 54)) {
            val nw = box(c, w, h, r, max(1, r / 2))
            val nd = box(cd, w, h, r, max(1, r / 2))
            for (i in out.indices) {
                val take = (nw[i] / norm).coerceIn(0f, 1f) * (1 - taken[i])
                out[i] += take * nd[i] / max(nw[i], 1e-6f)
                taken[i] += take
            }
        }
        // Left over (no confident pixel within reach): the focus plane.
        return out
    }

    /** Guided filter (He et al.) with an anisotropic window: the grid's rows are twice as far apart as its columns. */
    private fun guidedFilter(g: FloatArray, p: FloatArray, w: Int, h: Int, rx: Int, ry: Int, eps: Float): FloatArray {
        val mg = box(g, w, h, rx, ry)
        val mp = box(p, w, h, rx, ry)
        val cgp = box(FloatArray(g.size) { g[it] * p[it] }, w, h, rx, ry)
        val cgg = box(FloatArray(g.size) { g[it] * g[it] }, w, h, rx, ry)
        val a = FloatArray(g.size) { (cgp[it] - mg[it] * mp[it]) / (cgg[it] - mg[it] * mg[it] + eps) }
        val b = FloatArray(g.size) { mp[it] - a[it] * mg[it] }
        val ma = box(a, w, h, rx, ry)
        val mb = box(b, w, h, rx, ry)
        return FloatArray(g.size) { ma[it] * g[it] + mb[it] }
    }

    /** Mean over a (2rx+1)×(2ry+1) window, separable running sums, clamped at the borders. */
    internal fun box(src: FloatArray, w: Int, h: Int, rx: Int, ry: Int): FloatArray {
        val tmp = FloatArray(w * h)
        for (y in 0 until h) {
            val row = y * w
            var sum = 0.0
            var lo = 0
            var hi = -1
            for (x in 0 until w) {
                val nhi = min(w - 1, x + rx)
                while (hi < nhi) { hi++; sum += src[row + hi] }
                val nlo = max(0, x - rx)
                while (lo < nlo) { sum -= src[row + lo]; lo++ }
                tmp[row + x] = (sum / (hi - lo + 1)).toFloat()
            }
        }
        val out = FloatArray(w * h)
        for (x in 0 until w) {
            var sum = 0.0
            var lo = 0
            var hi = -1
            for (y in 0 until h) {
                val nhi = min(h - 1, y + ry)
                while (hi < nhi) { hi++; sum += tmp[hi * w + x] }
                val nlo = max(0, y - ry)
                while (lo < nlo) { sum -= tmp[lo * w + x]; lo++ }
                out[y * w + x] = (sum / (hi - lo + 1)).toFloat()
            }
        }
        return out
    }

    private fun bilinear(a: FloatArray, w: Int, h: Int, fx: Float, fy: Float): Float {
        val x0 = fx.toInt().coerceIn(0, w - 1)
        val y0 = fy.toInt().coerceIn(0, h - 1)
        val x1 = min(w - 1, x0 + 1)
        val y1 = min(h - 1, y0 + 1)
        val tx = fx - x0
        val ty = fy - y0
        val top = a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx
        val bottom = a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx
        return top * (1 - ty) + bottom * ty
    }

    /** The [q] quantile of [a] (a sorted copy of up to 64k samples). */
    fun percentile(a: FloatArray, q: Float): Float {
        if (a.isEmpty()) return 0f
        val stride = max(1, a.size / 65536)
        val sample = FloatArray((a.size + stride - 1) / stride) { a[it * stride] }
        sample.sort()
        return sample[(q * (sample.size - 1)).roundToInt().coerceIn(0, sample.size - 1)]
    }
}
