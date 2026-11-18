package app.rawboy.camera.capture

import app.rawboy.camera.platform.PreviewLevel
import org.junit.Assert.assertEquals
import org.junit.Test

class ViewfinderGainTest {
    private val stored = listOf(0.05f, 0.38f, 1f, 4.4f)
    private val boosts = listOf(1f, 1.27f, 2f, 4.25f)
    private val stillGains = listOf(1f, 1.5f, 2f)
    private val longGains = listOf(null, 0.5f, 8f)
    private val floors = listOf(0.3f, 0.47f, 1f)

    @Test
    fun boostedIsTheFormerExpression() {
        // CameraViewModel.onViewfinderBase before PreviewLevel: previewScale / boost * (longGain ?: stillGain).
        for (s in stored) for (b in boosts) for (g in stillGains) for (l in longGains) for (n in floors) {
            assertEquals(s / b * (l ?: g), ViewfinderGain.target(PreviewLevel.BOOSTED, s, b, g, l, n), 0f)
            assertEquals(0.07f, ViewfinderGain.calibrationKey(PreviewLevel.BOOSTED, 0.07f, s, s * n / b, n), 0f)
        }
    }

    @Test
    fun whiteBalancedIgnoresBoostAndStillGain() {
        for (b in boosts) for (g in stillGains) {
            assertEquals(0.98f * 0.47f, ViewfinderGain.target(PreviewLevel.STILL_WHITE_BALANCED, 0.98f, b, g, null, 0.47f), 1e-6f)
        }
        // Long exposure: its frames' time x ISO over the preview's whole gain (boost included), whatever the still gain.
        // OnePlus 11, 2026-11-17: preview 30 ms x ISO 6400 x boost 2.22, frames 500 ms x ISO 1315 (raw key 0.0307 against
        // 0.019-0.020 at the preview's gain: x1.54 = 0.5 x 1315 / (0.03 x 6400 x 2.22)).
        assertEquals(1f * 0.5f * (8f / 2f), ViewfinderGain.target(PreviewLevel.STILL_WHITE_BALANCED, 1f, 2f, 1.5f, 8f, 0.5f), 1e-5f)
        assertEquals(1.54f, ViewfinderGain.target(PreviewLevel.STILL_WHITE_BALANCED, 1f, 2.22f, 1f, 0.5f * 1315f / (0.029993f * 6400f), 1f), 0.01f)
    }

    @Test
    fun whiteBalancedCalibrationIsExactWhileTheGainStillEases() {
        // A preview key P drawn at any gain; the raw's key is P x floor x C. The estimate must come out C.
        val preview = 0.11f
        val c = 0.96f
        val floor = 0.45f
        val raw = preview * floor * c
        for (s in stored) for (drawn in listOf(1f, 0.7f, 0.45f, 0.2f)) {
            val key = ViewfinderGain.calibrationKey(PreviewLevel.STILL_WHITE_BALANCED, preview * drawn, s, drawn, floor)
            assertEquals(c, s * raw / key, 1e-5f)
        }
    }

    @Test
    fun longExposureKey() {
        // The Pixel's: scene key x calibration, as before (any neutral floor).
        assertEquals(0.02f * 1.3f, ViewfinderGain.longExposureKey(PreviewLevel.BOOSTED, 0.02f, 1.3f, 0.47f), 1e-7f)
        // OnePlus 11 at night: scene key 0.0476 per unit of scale, calibration 0.817, neutral floor 0.48 -> the raw's 0.019.
        assertEquals(0.0187f, ViewfinderGain.longExposureKey(PreviewLevel.STILL_WHITE_BALANCED, 0.0476f, 0.817f, 0.48f), 2e-4f)
    }
}

