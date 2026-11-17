package app.rawboy.camera.capture

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.pow

class PreviewCurveTest {
    private fun srgb(x: Float) = if (x <= 0.0031308f) 12.92f * x else 1.055f * x.toDouble().pow(1 / 2.4).toFloat() - 0.055f

    @Test
    fun densePointsAreTheFormerCurve() {
        // The former CameraController.SRGB_CURVE, as it was written.
        val n = 65
        val former = FloatArray(n * 2)
        for (i in 0 until n) {
            val x = (i.toFloat() / (n - 1)).let { it * it }
            former[i * 2] = x
            former[i * 2 + 1] = srgb(x).coerceIn(0f, 1f)
        }
        assertArrayEquals(former, PreviewCurve.dense, 0f)
    }

    @Test
    fun evenPointsAreEvenlySpacedSrgb() {
        val p = PreviewCurve.even
        assertEquals(128, p.size) // 64 points, the least any HAL takes
        for (i in 0 until 64) {
            assertEquals(i / 63f, p[i * 2], 1e-6f)
            assertEquals(srgb(i / 63f), p[i * 2 + 1], 1e-6f)
        }
        assertEquals(0f, p[1], 0f)
        assertEquals(1f, p[127], 1e-6f)
    }

    @Test
    fun evenToeIsTheFirstPointAfterBlack() {
        assertEquals(1 / 63f, PreviewCurve.evenToe, 1e-7f)
        assertEquals(PreviewCurve.even[2], PreviewCurve.evenToe, 0f)
    }
}
