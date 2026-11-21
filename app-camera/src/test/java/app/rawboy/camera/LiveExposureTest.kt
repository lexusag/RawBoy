package app.rawboy.camera

import app.rawboy.auto.analysis.AutoTone
import app.rawboy.auto.analysis.SceneStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.log2
import kotlin.math.pow

class LiveExposureTest {
    @Test
    fun firstUpdateIsNotEased() {
        assertEquals(1.7f, LiveExposure.ease(null, 0f, 1.7f, 2f, 0.3f), 1e-6f)
    }

    @Test
    fun meteringChangesEase() {
        // Same compensation, the metering asks for a stop more: 0.3 EV per update.
        assertEquals(0.3f, LiveExposure.ease(0f, 0f, 1f, 0f, 0.3f), 1e-6f)
        assertEquals(-1.7f, LiveExposure.ease(-2f, 2f, -1f, 2f, 0.3f), 1e-6f)
    }

    @Test
    fun compensationIsTakenOutAtOnce() {
        // AE has put +2 EV into the frame: the develop takes all of it out in the same update.
        assertEquals(-2f, LiveExposure.ease(0f, 0f, -2f, 2f, 0.3f), 1e-6f)
        assertEquals(2f, LiveExposure.ease(0f, 0f, 2f, -2f, 0.3f), 1e-6f)
    }

    /**
     * Brightness 0 -> +100 (+3 EV, of which +2 EV is AE compensation, the Pixel's limit): the viewfinder, relative to
     * Brightness 0, while AE converges (half the step on the first analysed frame, all of it on the next). It used to
     * overshoot to +4.4 EV and sink back over ~7 updates.
     */
    @Test
    fun brightnessStepDoesNotOvershoot() {
        for (phoneKey in floatArrayOf(0.03f, 0.08f)) {
            val normal = phoneKey * 2f.pow(AutoTone.exposure(stats(phoneKey), phoneAe = true))
            var last: Float? = AutoTone.exposure(stats(phoneKey), phoneAe = true)
            var lastCapture = 0f
            val shown = (0 until 8).map { i ->
                val raw = phoneKey * 2f.pow(if (i == 0) 1f else 2f)
                val auto = AutoTone.exposure(stats(raw), phoneAe = true, captureEv = 2f)
                val e = LiveExposure.ease(last, lastCapture, auto, 2f, 0.3f)
                last = e
                lastCapture = 2f
                log2(raw * 2f.pow(e + 3f) / normal)
            }
            shown.forEach { assertTrue("overshoot $it at key $phoneKey: $shown", it <= 3.01f) }
            shown.drop(1).forEach { assertEquals(3f, it, 0.01f) }
        }
    }

    /** A scene of key [key] with nothing else that moves the exposure (no face, highlights far below clip). */
    private fun stats(key: Float) = SceneStats(key, -8f, -7f, -5f, -3f, -2.5f, 0f, 0.1f, 0f, 0f, 0f, 0f, 100f, IntArray(1))
}
