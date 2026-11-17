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
        // Long exposure: its gain over the boosted preview, taken over the still instead.
        assertEquals(1f * 0.5f * (8f * 2f / 1.5f), ViewfinderGain.target(PreviewLevel.STILL_WHITE_BALANCED, 1f, 2f, 1.5f, 8f, 0.5f), 1e-5f)
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
}
