package app.rawboy.camera.capture

import kotlin.math.pow

/** The sRGB transfer curve as TONEMAP_CURVE points, which the viewfinder's inverse sRGB undoes (`ViewfinderRenderer`). */
object PreviewCurve {
    /**
     * Interleaved (x, y) points of the sRGB curve at [n] inputs, input i at [spacing] (0..1 -> 0..1) of the evenly
     * spaced i / (n - 1).
     */
    fun srgbPoints(n: Int, spacing: (Float) -> Float): FloatArray {
        val points = FloatArray(n * 2)
        for (i in 0 until n) {
            val x = spacing(i.toFloat() / (n - 1))
            val y = if (x <= 0.0031308f) 12.92f * x else 1.055f * x.toDouble().pow(1 / 2.4).toFloat() - 0.055f
            points[i * 2] = x
            points[i * 2 + 1] = y.coerceIn(0f, 1f)
        }
        return points
    }

    /** 65 points (the Pixel's maximum) packed near black, where the curve bends most. */
    val dense: FloatArray = srgbPoints(65) { it * it }

    /**
     * 64 points (every HAL takes at least 64) at evenly spaced inputs, for HALs that read the points as evenly spaced
     * ([app.rawboy.camera.platform.PreviewProfile.curveAtEvenPoints]).
     */
    val even: FloatArray = srgbPoints(64) { it }
}
