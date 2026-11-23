package app.rawboy.retouch

import app.rawboy.export.DepthMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToInt
import kotlin.random.Random

/** Tests for [DualPixelMetric]: the calibration fit and the millimetre map from AI shape + dual-pixel scale. */
class DualPixelMetricTest {

    @Test
    fun robustLineIgnoresOutliers() {
        val rnd = Random(1)
        val x = FloatArray(5000) { rnd.nextFloat() * 4 - 2 }
        val y = FloatArray(x.size) { i -> -0.1f * x[i] + 0.03f + (rnd.nextFloat() - 0.5f) * 0.02f }
        for (i in 0 until 500) y[i * 10] = 5f // 10% wild
        val (a, b) = DualPixelMetric.robustLine(x, y, x.size)
        assertEquals(-0.1f, a, 0.005f)
        assertEquals(0.03f, b, 0.005f)
    }

    @Test
    fun calibrationNeedsSamplesSpreadAndTheRightSign() {
        val rnd = Random(2)
        val x = FloatArray(4000) { rnd.nextFloat() * 3 - 1.5f }
        val d = FloatArray(x.size) { i -> -0.1f * x[i] + 0.034f + (rnd.nextFloat() - 0.5f) * 0.1f }
        val fit = DualPixelMetric.calibrate(x, d)
        assertTrue(fit.toString(), fit is DualPixelMetric.Fit.Ok)
        assertEquals(-0.1f, (fit as DualPixelMetric.Fit.Ok).calibration.slope, 0.01f)
        assertTrue(DualPixelMetric.calibrate(x.copyOf(100), d.copyOf(100)) is DualPixelMetric.Fit.Failed)
        assertTrue(DualPixelMetric.calibrate(FloatArray(4000) { 0.1f }, d) is DualPixelMetric.Fit.Failed)
        assertTrue(DualPixelMetric.calibrate(x, FloatArray(x.size) { i -> -d[i] }) is DualPixelMetric.Fit.Failed)
    }

    @Test
    fun sensorUvInvertsTheUprightTurn() {
        // HardwareDepth.toDepthMap turns a sensor map upright; sensorUv must lead back to the same sensor cell.
        val w = 8
        val h = 6
        for (o in 1..8) {
            val norm = FloatArray(w * h) { it / (w * h - 1f) }
            val up = HardwareDepth.toDepthMap(norm, w, h, o, hardware = true, subjectDetected = false, focusDepth = 0.5f)
            for (y in 0 until up.height) for (x in 0 until up.width) {
                val (su, sv) = DualPixelMetric.sensorUv((x + 0.5f) / up.width, (y + 0.5f) / up.height, o)
                val sx = (su * w).toInt()
                val sy = (sv * h).toInt()
                assertEquals("orientation $o at $x,$y", (norm[sy * w + sx] * 255f).roundToInt(), up.data[y * up.width + x].toInt() and 0xff)
            }
        }
    }

    @Test
    fun millimetresFollowTheAiShapeAtTheDualPixelScale() {
        val calibration = DualPixelCalibration(slope = -0.1f, offset = 0.034f)
        val focus = 1.5f // dioptres: 0.67 m
        // True inverse distance over the upright photo: 0.5 1/m (2 m) on the left to 3.5 1/m (0.29 m) on the right.
        fun trueInverse(u: Float) = 0.5f + 3f * u
        val orientation = 6
        val aw = 96
        val ah = 128
        // The AI map: affine in inverse depth (0 near … 1 far), its own scale unknown to the fit.
        val ai = DepthMap(aw, ah, ByteArray(aw * ah) { i -> ((1f - (i % aw + 0.5f) / aw) * 255f).roundToInt().toByte() })
        // The dual-pixel grid in sensor orientation, noisy, with random confidence.
        val gw = 256
        val gh = 96
        val rnd = Random(3)
        val disparity = FloatArray(gw * gh)
        val confidence = FloatArray(gw * gh) { rnd.nextFloat() }
        for (gy in 0 until gh) for (gx in 0 until gw) {
            // Orientation 6: sensor (su, sv) = (v, 1 - u), so this cell shows upright u = 1 - sv.
            val u = 1f - (gy + 0.5f) / gh
            disparity[gy * gw + gx] = calibration.slope * (trueInverse(u) - focus) + calibration.offset + (rnd.nextFloat() - 0.5f) * 0.1f
        }
        val m = DualPixelDepth.Measurement(gw, gh, disparity, confidence, disparity)
        val map = DualPixelMetric.millimetres(m, ai, calibration, focus, orientation)
        assertNotNull(map)
        map!!
        for (u in floatArrayOf(0.1f, 0.5f, 0.9f)) {
            val x = (u * aw).toInt()
            val expected = 1000f / trueInverse((x + 0.5f) / aw)
            val got = map.millimetresAt(x, ah / 2)!!.toFloat()
            assertEquals("at u $u", expected, got, expected * 0.08f)
        }
        // The 8-bit map is the defocus: mid-grey where the true distance equals the focus distance (u = 1/3).
        assertEquals(0.5f, map.sampleUv(1f / 3f, 0.5f), 0.06f)
    }
}
