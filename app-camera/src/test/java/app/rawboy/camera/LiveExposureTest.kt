package app.rawboy.camera

import app.rawboy.auto.analysis.AutoTone
import app.rawboy.auto.analysis.SceneLight
import app.rawboy.auto.analysis.SceneRecognition
import app.rawboy.auto.analysis.SceneStats
import app.rawboy.develop.DevelopParams
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

    @Test
    fun sunnyBlueSkyBrightnessStepDoesNotOvershoot() {
        val baseStats = stats(0.06f, p98 = -1.2f, blueSky = 0.25f)
        val baseLight = SceneLight(exposureSeconds = 1f / 1000f, captureEv = 0f)
        val baseAuto = SceneRecognition.apply(AutoTone.develop(baseStats, DevelopParams(), phoneAe = true), baseStats, baseLight)
        assertEquals(0.45f, baseAuto.exposure, 1e-5f)

        val normal = 0.06f * 2f.pow(baseAuto.exposure)
        var last: Float? = baseAuto.exposure
        var lastCapture = 0f
        val shown = (0 until 6).map { i ->
            val stepEv = if (i == 0) 1f else 2f
            val rawKey = 0.06f * 2f.pow(stepEv)
            val s = stats(rawKey, p98 = -1.2f + stepEv, blueSky = 0.25f)
            val light = SceneLight(exposureSeconds = (1f / 1000f) * 2f.pow(stepEv), captureEv = 2f)
            val auto = SceneRecognition.apply(AutoTone.develop(s, DevelopParams(), phoneAe = true, captureEv = 2f), s, light)
            val e = LiveExposure.ease(last, lastCapture, auto.exposure, 2f, 0.3f)
            last = e
            lastCapture = 2f
            log2(rawKey * 2f.pow(e + 3f) / normal)
        }
        shown.forEach { assertTrue("overshoot $it: $shown", it <= 3.05f) }
        shown.drop(1).forEach { assertEquals(3f, it, 0.05f) }
    }

    @Test
    fun lockedExposureHoldsAcrossSceneChanges() {
        // Locked on a bright scene (auto exposure 0.0 EV), then panned to a much darker scene (+2.0 EV)
        // and a sunny blue-sky scene (+0.45 EV): locked exposure stays fixed without lifting or easing.
        val lockedEv = 0.25f
        val darkAuto = AutoTone.exposure(stats(0.015f), phoneAe = true)
        assertTrue("dark scene would otherwise lift: $darkAuto", darkAuto > 1.5f)
        assertEquals(lockedEv, LiveExposure.resolve(lockedEv, lockedEv, 0f, darkAuto, 0f, 0.3f), 1e-6f)
        assertEquals(lockedEv, LiveExposure.resolve(lockedEv, lockedEv, 0f, darkAuto, 0f, 0.05f), 1e-6f)

        val skyStats = stats(0.06f, p98 = -1.2f, blueSky = 0.25f)
        val skyAuto = SceneRecognition.apply(
            AutoTone.develop(skyStats, DevelopParams(), phoneAe = true),
            skyStats,
            SceneLight(exposureSeconds = 1f / 1000f),
        )
        assertEquals(lockedEv, LiveExposure.resolve(lockedEv, lockedEv, 0f, skyAuto.exposure, 0f, 0.3f), 1e-6f)

        // Unlocking resumes normal easing from the held value.
        assertEquals(lockedEv + 0.3f, LiveExposure.resolve(null, lockedEv, 0f, darkAuto, 0f, 0.3f), 1e-6f)
    }

    /** A scene of key [key] with nothing else that moves the exposure (no face, highlights far below clip). */
    private fun stats(key: Float, p98: Float = -3f, blueSky: Float = 0f) =
        SceneStats(key, -8f, -7f, -5f, p98, p98 + 0.5f, 0f, 0.1f, blueSky, 0f, 0f, 0f, 50f, IntArray(1), blueSky)
}
