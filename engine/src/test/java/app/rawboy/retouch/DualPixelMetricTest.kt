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

    /**
     * A synthetic shot (orientation 6): true inverse distance 0.5 + 3u over the upright photo (2 m on the left to
     * 0.29 m on the right), the lens focused at 1.5 D (u = 1/3), where the dual pixel is sharpest ([sharpAt]); its
     * shifts follow the calibration with noise. [confidentOnly] limits confident cells to a band of u (a portrait).
     */
    private fun shot(sharpAt: Float, confidentOnly: ClosedFloatingPointRange<Float>? = null): Triple<DualPixelDepth.Measurement, DepthMap, DualPixelCalibration> {
        val calibration = DualPixelCalibration(slope = -0.1f, offset = 0.034f)
        val aw = 96
        val ah = 128
        val ai = DepthMap(aw, ah, ByteArray(aw * ah) { i -> ((1f - (i % aw + 0.5f) / aw) * 255f).roundToInt().toByte() })
        val gw = 256
        val gh = 96
        val rnd = Random(3)
        val disparity = FloatArray(gw * gh)
        val confidence = FloatArray(gw * gh)
        for (gy in 0 until gh) for (gx in 0 until gw) {
            // Orientation 6: sensor (su, sv) = (v, 1 - u), so this cell shows upright u = 1 - sv.
            val u = 1f - (gy + 0.5f) / gh
            disparity[gy * gw + gx] = calibration.slope * (0.5f + 3f * u - 1.5f) + calibration.offset + (rnd.nextFloat() - 0.5f) * 0.1f
            // Strongest on the in-focus subject, moderate on textured but blurred things around it.
            val sharp = 0.3f + 0.7f * kotlin.math.exp(-((u - sharpAt) / 0.08f).let { it * it })
            confidence[gy * gw + gx] = if (confidentOnly != null && u !in confidentOnly) 0.01f * rnd.nextFloat() else sharp * (0.8f + 0.2f * rnd.nextFloat())
        }
        return Triple(DualPixelDepth.Measurement(gw, gh, disparity, confidence, disparity), ai, calibration)
    }

    @Test
    fun millimetresFollowTheAiShapeAnchoredAtTheFocusedSubject() {
        val (m, ai, calibration) = shot(sharpAt = 1f / 3f)
        val map = DualPixelMetric.millimetres(m, ai, calibration, 1.5f, 6)
        assertNotNull(map)
        map!!
        assertNotNull("millimetres", map.millimetres)
        for (u in floatArrayOf(0.1f, 0.5f, 0.9f)) {
            val x = (u * ai.width).toInt()
            val expected = 1000f / (0.5f + 3f * (x + 0.5f) / ai.width)
            val got = map.millimetresAt(x, ai.height / 2)!!.toFloat()
            assertEquals("at u $u", expected, got, expected * 0.1f)
        }
        // The blur's focus is the AI map's value on the focused subject (u = 1/3).
        assertEquals(map.sampleUv(1f / 3f, 0.5f), map.focusDepth, 0.05f)
    }

    @Test
    fun aPortraitKeepsItsSubjectInFocusAndSkipsMillimetresItCannotMeasure() {
        // Release 1.20.8: confident cells only on the sharp subject (u 0.3..0.37), the background blurred. The map must
        // still focus on the subject; millimetres can't be scaled from one depth, so there are none.
        val (m, ai, calibration) = shot(sharpAt = 1f / 3f, confidentOnly = 0.3f..0.37f)
        val map = DualPixelMetric.millimetres(m, ai, calibration, 1.5f, 6)!!
        assertEquals(map.sampleUv(1f / 3f, 0.5f), map.focusDepth, 0.05f)
        assertEquals(null, map.millimetres)
    }

    @Test
    fun shiftsNoLensCanMakeDoNotScaleTheMap() {
        // As on the Pixel 9 Pro's portraits: the far, blurred part (u < 0.15) matched at +3.8 half-pixels, beyond
        // what any distance gives at this focus (~0.15 at most). Without the gate the scale came out 5-10x too big.
        val (m, ai, calibration) = shot(sharpAt = 1f / 3f)
        for (gy in 0 until m.height) {
            val u = 1f - (gy + 0.5f) / m.height
            if (u < 0.15f) for (gx in 0 until m.width) m.disparity[gy * m.width + gx] = 3.8f
        }
        val map = DualPixelMetric.millimetres(m, ai, calibration, 1.5f, 6)!!
        val x = (0.5f * ai.width).toInt()
        val expected = 1000f / (0.5f + 3f * (x + 0.5f) / ai.width)
        assertEquals(expected, map.millimetresAt(x, ai.height / 2)!!.toFloat(), expected * 0.1f)
    }

    /**
     * The 1.20.9 selfie: the lens focused on the subject at u = 0.8 (inverse distance 2.9 D), a textured room behind
     * (u < 0.5) matches far more confidently than the smooth, backlit face.
     */
    private fun selfie(person: Boolean): Triple<DualPixelDepth.Measurement, DepthMap, DualPixelCalibration> {
        val calibration = DualPixelCalibration(slope = -0.1f, offset = 0.034f)
        val focus = 0.5f + 3f * 0.8f
        val aw = 96
        val ah = 128
        val ai = DepthMap(
            aw, ah, ByteArray(aw * ah) { i -> ((1f - (i % aw + 0.5f) / aw) * 255f).roundToInt().toByte() },
            subjectDetected = person, focusDepth = if (person) 0.2f else 0.5f,
        )
        val gw = 256
        val gh = 96
        val rnd = Random(5)
        val disparity = FloatArray(gw * gh)
        val confidence = FloatArray(gw * gh)
        for (gy in 0 until gh) for (gx in 0 until gw) {
            val u = 1f - (gy + 0.5f) / gh
            disparity[gy * gw + gx] = calibration.slope * (0.5f + 3f * u - focus) + calibration.offset + (rnd.nextFloat() - 0.5f) * 0.06f
            confidence[gy * gw + gx] = if (u < 0.5f) 0.9f + 0.1f * rnd.nextFloat() else 0.3f + 0.05f * rnd.nextFloat()
        }
        return Triple(DualPixelDepth.Measurement(gw, gh, disparity, confidence, disparity), ai, calibration)
    }

    @Test
    fun aPersonIsTheFocusEvenWhenTheRoomBehindMatchesBetter() {
        val (m, ai, calibration) = selfie(person = true)
        val map = DualPixelMetric.millimetres(m, ai, calibration, 0.5f + 3f * 0.8f, 6)!!
        assertEquals(0.2f, map.focusDepth, 0.02f)
        map.millimetres?.let { assertEquals(1000f / 2.9f, map.millimetresAt((0.8f * ai.width).toInt(), ai.height / 2)!!.toFloat(), 40f) }
    }

    @Test
    fun withoutAPersonTheFocusIsWhereTheShiftSaysInFocusNotWhereMatchingIsStrongest() {
        val (m, ai, calibration) = selfie(person = false)
        val map = DualPixelMetric.millimetres(m, ai, calibration, 0.5f + 3f * 0.8f, 6)!!
        // The subject (u = 0.8) is 0.2 on the AI map; the room behind is 0.5..1.
        assertEquals(0.2f, map.focusDepth, 0.08f)
    }
}
