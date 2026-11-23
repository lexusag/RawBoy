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
 * Over a whole frame the noise averages out, so the shape comes from the AI estimate (sharp, relative inverse depth),
 * anchored at the lens's focus distance on the sharpest cells, and the dual pixel only sets its scale ([millimetres]).
 * A free scale-and-offset fit scored 8% median error on desk scenes but collapsed on portraits (see [millimetres]).
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
     * The [DepthMap] of a shot on a calibrated lens. The 8-bit map is [ai] itself (0 near … 1 far), focused on what the
     * camera focused on: the sharpest dual-pixel cells (the lens put them at [focusDiopters]); that part never
     * depends on the fit, so the portrait blur keeps the subject sharp. Millimetres are added when the frame supports
     * them: `1/z = D + α × (ai − ai_focus)`, anchored at the focus distance on that subject, with only the scale α
     * fitted (robustly, through the origin) to the dual pixel's inverse distances relative to the same sharp cells.
     *
     * Why anchored: in a portrait the dual pixel is confident only where things are sharp, i.e. on the subject; the
     * blurred background gives it little. A free scale-and-offset fit then collapsed (release 1.20.8: every distance
     * ~0.4 m, the subject placed far in front of the focus plane, so the blur hit the subject and spared the
     * background). Without samples spread over enough of the AI map's depth ([MIN_AI_SPREAD]) there are no millimetres
     * (a version 1 trailer) rather than wrong ones. Null only when [ai] can't be paired with the frame at all.
     */
    fun millimetres(m: DualPixelDepth.Measurement, ai: DepthMap, calibration: DualPixelCalibration, focusDiopters: Float, exifOrientation: Int): DepthMap? {
        val n = ai.width * ai.height
        val r = FloatArray(n) { i -> 1f - (ai.data[i].toInt() and 0xff) / 255f }
        // Each AI pixel's dual-pixel cell.
        val conf = FloatArray(n)
        val disp = FloatArray(n)
        for (y in 0 until ai.height) {
            for (x in 0 until ai.width) {
                val (su, sv) = sensorUv((x + 0.5f) / ai.width, (y + 0.5f) / ai.height, exifOrientation)
                val g = (sv * m.height).toInt().coerceIn(0, m.height - 1) * m.width + (su * m.width).toInt().coerceIn(0, m.width - 1)
                conf[y * ai.width + x] = m.confidence[g]
                disp[y * ai.width + x] = m.disparity[g]
            }
        }
        val person = if (ai.subjectDetected) ai.focusDepth else null
        val anchor = focusAnchor(conf, disp, r, person, calibration.offset) ?: return null
        val (dFocus, rFocus) = anchor
        val focused = DepthMap(ai.width, ai.height, ai.data, hardware = true, subjectDetected = ai.subjectDetected, focusDepth = 1f - rFocus)
        if (focusDiopters <= 0f) return focused

        // α: (d − d_focus) / slope = 1/z − D against r − r_focus, over the confident cells: at least a tenth of the
        // strongest (a median threshold let a blurred background's noise in on portraits).
        val threshold = USABLE * strongest(conf)
        // Only shifts the lens can make: from infinity (1/z = 0) to [NEAREST_M]. Blurred, textureless backgrounds
        // matched at ~+3.8 half-pixels on the Pixel 9 Pro's portraits, where a wall a few metres behind a 40 cm focus
        // can shift ~0.35: kept, they scaled distances 5-10× and put rooms at infinity.
        val farthest = -calibration.slope * focusDiopters * 1.2f + SHIFT_SLACK
        val nearest = calibration.slope * (1f / NEAREST_M - focusDiopters) - SHIFT_SLACK
        val xs = ArrayList<Float>()
        val ys = ArrayList<Float>()
        for (i in 0 until n) {
            if (conf[i] <= threshold) continue
            val shift = disp[i] - dFocus
            if (shift > farthest || shift < nearest) continue
            xs += r[i] - rFocus
            ys += shift / calibration.slope
        }
        if (xs.size < 300) return focused
        val x = xs.toFloatArray()
        if (DualPixelDepth.percentile(x, 0.9f) - DualPixelDepth.percentile(x, 0.1f) < MIN_AI_SPREAD) return focused
        val alpha = robustSlope(x, ys.toFloatArray())
        if (!(alpha > MIN_ALPHA && alpha < MAX_ALPHA)) return focused
        val mm = ShortArray(n) { i ->
            val inv = focusDiopters + alpha * (r[i] - rFocus)
            (if (inv <= 1f / 65.534f) 65535 else (1000f / inv).roundToInt().coerceIn(1, 65534)).toShort()
        }
        return DepthMap(ai.width, ai.height, ai.data, hardware = true, subjectDetected = ai.subjectDetected, focusDepth = 1f - rFocus, millimetres = mm)
    }

    /** The nearest distance a shift may stand for (metres), and the matching noise allowed past the physical limits. */
    private const val NEAREST_M = 0.1f
    private const val SHIFT_SLACK = 0.05f

    /** The strongest confidence, ignoring the top 0.5% (stray matches). */
    internal fun strongest(conf: FloatArray): Float = DualPixelDepth.percentile(conf, 0.995f)

    /** Shares of [strongest]: the sharp (in-focus) cells, and those confident enough to scale the map. */
    private const val SHARP = 0.5f
    private const val USABLE = 0.1f

    /** The cells sampled must span at least this much of the AI map's 0..1 range (10th to 90th percentile). */
    const val MIN_AI_SPREAD = 0.2f

    /** Dioptres per unit of the AI map: below, the scale is noise; above, absurd (0 to 1 of the map = 50 D). */
    private const val MIN_ALPHA = 0.1f
    private const val MAX_ALPHA = 50f

    /**
     * Where the camera focused, as (dual-pixel shift, AI value) there.
     *
     * - A person in [personFocus] (the AI estimate found one; its value of them): the person. The phone's autofocus
     *   goes for faces, and a backlit face is dark and smooth, so the dual pixel matches it less confidently than a
     *   textured room behind (1.20.9: a selfie focused on the shelves and blurred the face).
     * - Otherwise the confident cells whose shift is the lens's in-focus shift [inFocusShift] (within [IN_FOCUS]):
     *   confidence alone also measures texture, not only focus. Only without any such cell the strongest ones.
     *
     * The shift there is the median over confident cells at that AI value. Null without confident cells.
     */
    internal fun focusAnchor(conf: FloatArray, disp: FloatArray, r: FloatArray, personFocus: Float?, inFocusShift: Float): Pair<Float, Float>? {
        val strongest = strongest(conf)
        if (strongest <= 0f) return null
        val usable = USABLE * strongest
        val rFocus = if (personFocus != null) {
            1f - personFocus
        } else {
            val rs = ArrayList<Float>()
            for (i in conf.indices) if (conf[i] >= usable && abs(disp[i] - inFocusShift) <= IN_FOCUS) rs += r[i]
            if (rs.size >= MIN_CELLS) {
                DualPixelDepth.percentile(rs.toFloatArray(), 0.5f)
            } else {
                for (i in conf.indices) if (conf[i] >= SHARP * strongest) rs += r[i]
                if (rs.size < MIN_CELLS) return null
                DualPixelDepth.percentile(rs.toFloatArray(), 0.5f)
            }
        }
        val ds = ArrayList<Float>()
        for (i in conf.indices) if (conf[i] >= usable && abs(r[i] - rFocus) <= AT_FOCUS) ds += disp[i]
        val dFocus = if (ds.size >= MIN_CELLS) DualPixelDepth.percentile(ds.toFloatArray(), 0.5f) else inFocusShift
        return dFocus to rFocus
    }

    /** A shift this close to the in-focus shift is in focus (half-pixel columns; ~0.5 D of defocus on the Pixel 9 Pro's W). */
    private const val IN_FOCUS = 0.07f

    /** Cells within this much of the focus's AI value give its shift; and the fewest cells to trust a median. */
    private const val AT_FOCUS = 0.04f
    private const val MIN_CELLS = 20

    /** y = a·x through the origin, Huber-weighted (IRLS, cut at 2 robust sigmas). */
    internal fun robustSlope(x: FloatArray, y: FloatArray): Float {
        val n = min(x.size, y.size)
        val w = DoubleArray(n) { 1.0 }
        var a = 0.0
        val residual = FloatArray(n)
        repeat(10) {
            var sxx = 0.0
            var sxy = 0.0
            for (i in 0 until n) { sxx += w[i] * x[i] * x[i]; sxy += w[i] * x[i] * y[i] }
            if (sxx < 1e-12) return 0f
            a = sxy / sxx
            for (i in 0 until n) residual[i] = abs(y[i] - (a * x[i]).toFloat())
            val sigma = max(1e-6f, 1.4826f * DualPixelDepth.percentile(residual, 0.5f))
            for (i in 0 until n) w[i] = 1.0 / max(1.0, residual[i] / (2.0 * sigma))
        }
        return a.toFloat()
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
