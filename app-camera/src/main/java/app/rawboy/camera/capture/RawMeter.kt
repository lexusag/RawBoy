package app.rawboy.camera.capture

import kotlin.math.log2
import kotlin.math.max
import kotlin.math.pow

/**
 * The scene key ([app.rawboy.auto.analysis.SceneAnalyzer]'s geometric-mean luminance, decoded units: 1.0 = sensor clip)
 * of a centred box of a Bayer raw frame, measured straight from the sensor data, without a decode.
 *
 * Used to calibrate the viewfinder's preview gain ([app.rawboy.camera.CameraSettings.previewScale]) before a lens's
 * first shot: some ISPs add a gain the raw never gets and Camera2 doesn't report (Galaxy Tab S11 Ultra: the raw sat
 * ~4.4 stops under the preview, `CONTROL_POST_RAW_SENSITIVITY_BOOST` fixed at 100), so the uncalibrated viewfinder
 * was blown out until the first photo.
 *
 * Matches the decode as `decoder_libraw.cpp` does it: (raw − black) / (white − black), less the camera's extra black,
 * times the white-balance multipliers normalised to the largest (LibRaw's pre_mul), then Rec.2020 luminance weights
 * (exact for neutral colours, which the colour matrix keeps neutral). Pixels are averaged in [CELL]-pixel cells before
 * the log, about the 512 px copy's footprint, so noise in the shadows doesn't pull the mean down; every other cell
 * each way is read (a quarter of the box: ~290 ms for the whole box of a 12 MP frame on the Tab S11 Ultra).
 */
object RawMeter {
    /** Cell side in sensor pixels (even, so each cell holds whole 2×2 CFA blocks). */
    const val CELL = 8

    /**
     * [sample] (x, y) → the raw value at sensor pixel (x, y) of a [width] × [height] frame. [cfa]: Camera2's
     * SENSOR_INFO_COLOR_FILTER_ARRANGEMENT (0 RGGB, 1 GRBG, 2 GBRG, 3 BGGR); [black]: per 2×2 position, row-major;
     * [neutral]: as-shot neutral (R, G, B, SENSOR_NEUTRAL_COLOR_POINT); [fraction]: the centred box's share of each side
     * ([app.rawboy.auto.analysis.MeterArea.Centre], symmetric, so the sensor's rotation doesn't matter).
     * Null for a CFA this doesn't know or unusable levels.
     */
    fun key(
        width: Int,
        height: Int,
        cfa: Int,
        black: FloatArray,
        white: Float,
        neutral: FloatArray,
        fraction: Float,
        extraBlack: Float = 0f,
        sample: (Int, Int) -> Int,
    ): Float? {
        val colours = colourOf(cfa) ?: return null
        if (black.size < 4 || neutral.size < 3 || neutral.any { !(it > 0f) }) return null
        val range = white - black.max()
        if (!(range > 0f)) return null
        val mul = FloatArray(3) { 1f / neutral[it] }
        val maxMul = mul.max()
        for (c in 0 until 3) mul[c] /= maxMul
        val x0 = (((1f - fraction) / 2f * width).toInt()) and 1.inv()
        val y0 = (((1f - fraction) / 2f * height).toInt()) and 1.inv()
        val x1 = width - x0
        val y1 = height - y0
        var logSum = 0.0
        var cells = 0
        val sum = DoubleArray(3)
        val count = IntArray(3)
        var cy = y0
        while (cy + CELL <= y1) {
            var cx = x0
            while (cx + CELL <= x1) {
                sum.fill(0.0)
                count.fill(0)
                for (y in cy until cy + CELL) {
                    for (x in cx until cx + CELL) {
                        val pos = (y and 1) * 2 + (x and 1)
                        val c = colours[pos]
                        sum[c] += (sample(x, y) - black[pos]) / range
                        count[c]++
                    }
                }
                var lum = 0.0
                for (c in 0 until 3) lum += WEIGHTS[c] * (sum[c] / count[c] - extraBlack) * mul[c]
                logSum += log2(max(lum, 1e-6))
                cells++
                cx += 2 * CELL
            }
            cy += 2 * CELL
        }
        if (cells == 0) return null
        return 2.0.pow(logSum / cells).toFloat()
    }

    /** Colour (0 R, 1 G, 2 B) at each 2×2 position, row-major. */
    private fun colourOf(cfa: Int): IntArray? = when (cfa) {
        0 -> intArrayOf(0, 1, 1, 2) // RGGB
        1 -> intArrayOf(1, 0, 2, 1) // GRBG
        2 -> intArrayOf(1, 2, 0, 1) // GBRG
        3 -> intArrayOf(2, 1, 1, 0) // BGGR
        else -> null
    }

    /** Rec.2020 luminance, as SceneAnalyzer. */
    private val WEIGHTS = doubleArrayOf(0.2627, 0.6780, 0.0593)
}
