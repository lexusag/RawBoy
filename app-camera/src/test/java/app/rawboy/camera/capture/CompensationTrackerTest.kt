package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Gains from the Pixel 9 Pro in a room at 1/30 s, ISO 39 (2026-11-22): +14 steps (+2.33 EV) raised AE's gain 0.27 EV. */
class CompensationTrackerTest {
    private val step = 1f / 6f
    private val zeroGain = 1.2998316f

    private fun CompensationTracker.frame(steps: Int, gain: Float, t: Long, residual: Float = 1f, settled: Boolean = true) =
        onFrame(steps, steps * step, gain, residual, settled, t)

    @Test
    fun unknownUntilAnUncompensatedFrame() {
        val c = CompensationTracker()
        assertNull(c.frame(6, 2f, 0))
        assertEquals(0f, c.frame(0, zeroGain, 33)!!, 0f)
    }

    @Test
    fun aBrighterStepAeHardlyGaveIsHardlyTakenOut() {
        val c = CompensationTracker()
        c.frame(0, zeroGain, 0)
        // The result reports the new step at once, AE moves a few frames later.
        assertEquals(0f, c.frame(14, zeroGain, 33, settled = false)!!, 1e-4f)
        assertEquals(0.269f, c.frame(14, 1.5664637f, 300, settled = false)!!, 1e-3f)
        assertEquals(0.269f, c.frame(14, 1.5664637f, 600)!!, 1e-3f)
        // Held once AE settled: a scene change afterwards is metering, not compensation.
        assertEquals(0.269f, c.frame(14, 0.5f, 900)!!, 1e-3f)
    }

    @Test
    fun aSmallerStepAeDidNotFollowKeepsWhatWasThere() {
        val c = CompensationTracker()
        c.frame(0, zeroGain, 0)
        c.frame(14, 1.5664637f, 100)
        c.frame(14, 1.5664637f, 700)
        // +14 -> +3 steps (+0.5 EV): the gain didn't move, so the 0.27 EV stay.
        assertEquals(0.269f, c.frame(3, 1.5664637f, 1000)!!, 1e-3f)
        assertEquals(0.269f, c.frame(3, 1.5664637f, 1600)!!, 1e-3f)
    }

    @Test
    fun aDarkerStepAeGaveInFull() {
        val c = CompensationTracker()
        c.frame(0, zeroGain, 0)
        c.frame(14, 1.5664637f, 100)
        c.frame(14, 1.5664637f, 700)
        assertEquals(-2.333f, c.frame(-14, 0.25552246f, 1000)!!, 1e-3f)
        // Back towards 0 over a few frames.
        assertEquals(-1.2f, c.frame(-2, 0.56103843f, 1300, settled = false)!!, 0.01f)
        assertEquals(-0.333f, c.frame(-2, 1.0109801f, 1600)!!, 0.05f)
    }

    @Test
    fun whatWentIntoTheBoostStaysDigital() {
        val c = CompensationTracker()
        c.frame(0, 1f, 0, residual = 1.2f)
        // In low light AE put +1 EV into the boost only: the gain doubled with the residual.
        assertEquals(0f, c.frame(6, 2f, 600, residual = 2.4f)!!, 1e-4f)
    }

    @Test
    fun nothingChangedAtTheCeiling() {
        val c = CompensationTracker()
        c.frame(0, 110f, 0, residual = 2.39f)
        assertEquals(0f, c.frame(18, 110f, 600, residual = 2.39f)!!, 1e-4f)
    }

    @Test
    fun aSlowRampIsFollowedUntilAeConverges() {
        val c = CompensationTracker()
        c.frame(0, 1f, 0)
        c.frame(15, 1.25f, 100, settled = false)
        // Still searching 4 s on, well past MIN_SETTLE_MS: keep measuring.
        assertEquals(2f, c.frame(15, 4f, 4000, settled = false)!!, 1e-4f)
        assertEquals(2.5f, c.frame(15, 6f, 5000)!!, 1e-4f)
        assertEquals(2.5f, c.frame(15, 3f, 5500)!!, 1e-4f)
    }

    @Test
    fun aResetForgets() {
        val c = CompensationTracker()
        c.frame(0, zeroGain, 0)
        c.reset()
        assertNull(c.frame(6, 2f, 100))
    }
}
