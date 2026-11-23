package app.rawboy.retouch

import app.rawboy.export.DepthMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A lens's dual-pixel constants from Settings › Calibrate dual-pixel distances: a measured shift d (half-pixel
 * columns, [DualPixelDepth.Measurement]) is `slope × (1/z − D) + offset`, with z the distance in metres and D the lens's
 * focus distance in dioptres (`LENS_FOCUS_DISTANCE`). [slope] is negative (behind focus = positive shift).
 */
data class DualPixelCalibration(val slope: Float, val offset: Float, val samples: Int = 0) {
    /** The inverse distance (1/m) a shift [d] says, focused at [focusDiopters]. */
    fun inverseDistance(d: Float, focusDiopters: Float): Float = focusDiopters + (d - offset) / slope
}

/**
 * Millimetre depth from dual pixel (2026-11-23, Pixel 9 Pro W; tools in the PR's notes). Per pixel the dual-pixel shift is
 * too weak for distances: on the main lens it is ~0.1 half-pixel column per dioptre of defocus, the size of its noise
 * (held-out frames against ARCore: 22-27% median error, worse than calling everything the focus distance, 17-19%).
 * Over a whole frame the noise averages out, so the shape comes from the AI estimate (sharp, relative inverse depth)
 * and the dual pixel only sets its scale and offset: `1/z = α × ai + β`, fitted robustly to the dual-pixel's
 * inverse distances on its confident cells. Held out: 8% median error, p90 ~30%.
 */
object DualPixelMetric {
    /** At least this many matched samples, spread over at least [MIN_SPREAD] dioptres of defocus, make a calibration. */
    const val MIN_SAMPLES = 2000
    const val MIN_SPREAD = 0.6f

    /** What [calibrate] found, or why not. */
    sealed interface Fit {
        data class Ok(val calibration: DualPixelCalibration) : Fit
        data class Failed(val why: String) : Fit
    }

    /**
     * Fits [DualPixelCalibration] to samples of defocus [x] (`1/z − D`, from a reference distance such as ARCore's
     * depth) and the dual-pixel shift [d] there (from [DualPixelDepth.Measurement.smoothAt]). Robust (Huber-weighted)
     * least squares of d on x: x is the accurate one.
     */
    fun calibrate(x: FloatArray, d: FloatArray): Fit {
        val n = min(x.size, d.size)
        if (n < MIN_SAMPLES) return Fit.Failed("$n samples, need $MIN_SAMPLES")
        val spread = DualPixelDepth.percentile(x, 0.95f) - DualPixelDepth.percentile(x, 0.05f)
        if (spread < MIN_SPREAD) return Fit.Failed("defocus spread ${"%.2f".format(spread)} D, need $MIN_SPREAD")
        val (slope, offset) = robustLine(x, d, n)
        if (!(slope < -0.01f && slope > -5f)) return Fit.Failed("slope ${"%.3f".format(slope)} out of range")
        return Fit.Ok(DualPixelCalibration(slope, offset, n))
    }

    /**
     * The millimetre [DepthMap] of a shot: [ai] (the AI estimate, upright, 0 near … 1 far: affine in inverse depth)
     * scaled by the dual-pixel measurement [m] (sensor orientation; [exifOrientation] as the photo's) through
     * [calibration] at [focusDiopters]. The 8-bit map is the defocus (0.5 = the focus distance, like
     * [DualPixelDepth.compute]); null if the fit has too little to go on or comes out reversed.
     */
    fun millimetres(m: DualPixelDepth.Measurement, ai: DepthMap, calibration: DualPixelCalibration, focusDiopters: Float, exifOrientation: Int): DepthMap? {
        if (focusDiopters <= 0f) return null
        val threshold = DualPixelDepth.percentile(m.confidence, 0.5f)
        val rs = ArrayList<Float>()
        val invs = ArrayList<Float>()
        for (y in 0 until ai.height) {
            for (x in 0 until ai.width) {
                val (su, sv) = sensorUv((x + 0.5f) / ai.width, (y + 0.5f) / ai.height, exifOrientation)
                val gx = (su * m.width).toInt().coerceIn(0, m.width - 1)
                val gy = (sv * m.height).toInt().coerceIn(0, m.height - 1)
                val g = gy * m.width + gx
                if (m.confidence[g] <= threshold) continue
                val inv = calibration.inverseDistance(m.disparity[g], focusDiopters)
                if (!(inv > 0.05f && inv < 20f)) continue
                rs += 1f - (ai.data[y * ai.width + x].toInt() and 0xff) / 255f
                invs += inv
            }
        }
        if (rs.size < 300) return null
        val (alpha, beta) = robustLine(rs.toFloatArray(), invs.toFloatArray(), rs.size)
        if (alpha <= 0f) return null
        val n = ai.width * ai.height
        val inverse = FloatArray(n) { i -> alpha * (1f - (ai.data[i].toInt() and 0xff) / 255f) + beta }
        val mm = ShortArray(n) { i ->
            val inv = inverse[i]
            (if (inv <= 1f / 65.534f) 65535 else (1000f / inv).roundToInt().coerceIn(1, 65534)).toShort()
        }
        val spread = max(0.3f, DualPixelDepth.percentile(FloatArray(n) { abs(focusDiopters - inverse[it]) }, 0.98f))
        val bytes = ByteArray(n) { i -> ((0.5f + 0.5f * (focusDiopters - inverse[i]) / spread).coerceIn(0f, 1f) * 255f).roundToInt().toByte() }
        return DepthMap(ai.width, ai.height, bytes, hardware = true, subjectDetected = ai.subjectDetected, focusDepth = 0.5f, millimetres = mm)
    }

    /** The sensor-orientation position (0..1) of upright position ([u], [v]) under EXIF [orientation] (inverse of [HardwareDepth.toDepthMap]'s turn). */
    fun sensorUv(u: Float, v: Float, orientation: Int): Pair<Float, Float> = when (orientation) {
        2 -> (1 - u) to v
        3 -> (1 - u) to (1 - v)
        4 -> u to (1 - v)
        5 -> v to u
        6 -> v to (1 - u)
        7 -> (1 - v) to (1 - u)
        8 -> (1 - v) to u
        else -> u to v
    }

    /** y = a·x + b, Huber-weighted (IRLS, cut at 2 robust sigmas). */
    internal fun robustLine(x: FloatArray, y: FloatArray, n: Int): Pair<Float, Float> {
        val w = DoubleArray(n) { 1.0 }
        var a = 0.0
        var b = 0.0
        val residual = FloatArray(n)
        repeat(10) {
            var sw = 0.0; var sx = 0.0; var sy = 0.0; var sxx = 0.0; var sxy = 0.0
            for (i in 0 until n) {
                val wi = w[i]; val xi = x[i].toDouble(); val yi = y[i].toDouble()
                sw += wi; sx += wi * xi; sy += wi * yi; sxx += wi * xi * xi; sxy += wi * xi * yi
            }
            val det = sw * sxx - sx * sx
            if (abs(det) < 1e-12) return 0f to (sy / max(sw, 1e-9)).toFloat()
            a = (sw * sxy - sx * sy) / det
            b = (sy - a * sx) / sw
            for (i in 0 until n) residual[i] = abs(y[i] - (a * x[i] + b).toFloat())
            val sigma = max(1e-6f, 1.4826f * DualPixelDepth.percentile(residual, 0.5f))
            for (i in 0 until n) w[i] = 1.0 / max(1.0, residual[i] / (2.0 * sigma))
        }
        return a.toFloat() to b.toFloat()
    }
}
