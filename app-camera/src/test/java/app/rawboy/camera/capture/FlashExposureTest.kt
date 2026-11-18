package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

class FlashExposureTest {
    /** The sensors' ranges: ISO and exposure time (ns). */
    private class Sensor(val isoMin: Int, val isoMax: Int, val timeMin: Long, val timeMax: Long)

    private val sensors = listOf(
        Sensor(50, 3200, 10_000L, 100_000_000L), // CameraController's fallback when the lens reports none
        Sensor(100, 6400, 9_000L, 1_000_000_000L),
        Sensor(40, 12_800, 1_000L, 30_000_000_000L),
    )
    private val distances = listOf(null, 0f, -1f, 0.05f, 0.2f, 0.3f, 1f, 3f, 10f, 20f) // dioptres
    private val guides = listOf(0.5f, 4f, 16f, 80f, 1000f)
    private val ambients = listOf(0.5f, 10f, 200f, Float.MAX_VALUE)

    /** CameraController.flashExposure before the pure part moved into [FlashExposure], as it was (2026-11-17). */
    private fun former(guide: Float, diopters: Float?, ambientGain: Float, c: Sensor): Triple<Long, Int, Float?> {
        val known = diopters != null && diopters > 0f
        val metres = if (known) (1f / diopters!!).coerceIn(0.1f, 5f) else 1f
        val falloff = metres * metres * max(1f, metres).pow(0.3f)
        val byFlash = guide * falloff
        val gain = min(byFlash, ambientGain).coerceAtMost(33_333_333L / 1e9f * c.isoMax)
        var t = 33_333_333L.coerceIn(c.timeMin, c.timeMax)
        var iso = gain / (t / 1e9f)
        if (iso < c.isoMin) {
            t = (gain / c.isoMin * 1e9f).toLong().coerceIn(c.timeMin, c.timeMax)
            iso = c.isoMin.toFloat()
        }
        val exposure = t to iso.toInt().coerceIn(c.isoMin, c.isoMax)
        val used = exposure.first / 1e9f * exposure.second
        val guideUsed = if (byFlash <= ambientGain && abs(used / byFlash - 1f) < 0.1f) used / falloff else null
        return Triple(exposure.first, exposure.second, guideUsed)
    }

    private fun plan(guide: Float, diopters: Float?, ambient: Float, c: Sensor) =
        FlashExposure.plan(guide, FlashExposure.metres(diopters), ambient, c.isoMin, c.isoMax, c.timeMin, c.timeMax)

    @Test
    fun sameAsBefore() {
        for (c in sensors) for (d in distances) for (g in guides) for (a in ambients) {
            val p = plan(g, d, a, c)
            val f = former(g, d, a, c)
            val what = "guide $g dpt $d ambient $a sensor ${c.isoMin}-${c.isoMax}"
            assertEquals(what, f.first, p.exposureNs)
            assertEquals(what, f.second, p.iso)
            assertEquals(what, f.third, p.guideUsed)
        }
    }

    @Test
    fun staysInTheSensorsRanges() {
        for (c in sensors) for (d in distances) for (g in guides) for (a in ambients) {
            val p = plan(g, d, a, c)
            assertTrue("ISO ${p.iso}", p.iso in c.isoMin..c.isoMax)
            assertTrue("time ${p.exposureNs}", p.exposureNs in c.timeMin..c.timeMax)
            assertTrue("never longer than the flash frame", p.exposureNs <= FlashExposure.EXPOSURE_NS)
            // Never more than the ambient exposure (beyond rounding to whole ISO).
            assertTrue("gain over ambient", p.exposureNs / 1e9f * p.iso <= max(a * 1.001f, c.timeMin / 1e9f * c.isoMin))
        }
    }

    @Test
    fun distances() {
        assertNull(FlashExposure.metres(null))
        assertNull(FlashExposure.metres(0f)) // exactly 0 = unknown, not infinity
        assertNull(FlashExposure.metres(-0.5f))
        assertEquals(0.5f, FlashExposure.metres(2f)!!, 0f)
        assertEquals(FlashExposure.MIN_DISTANCE_M, FlashExposure.metres(50f)!!, 0f)
        assertEquals(FlashExposure.MAX_DISTANCE_M, FlashExposure.metres(0.01f)!!, 0f)
        // Inverse square, plus a little beyond 1 m.
        assertEquals(0.09f, FlashExposure.falloff(0.3f), 1e-6f)
        assertEquals(1f, FlashExposure.falloff(1f), 0f)
        assertEquals(9f * 3f.pow(0.3f), FlashExposure.falloff(3f), 1e-4f)
    }

    @Test
    fun learnsOnlyFromShotsTheFlashExposed() {
        val c = sensors[1]
        // The flash decides: the guide comes back (to within whole ISO steps).
        val free = plan(16f, 1f, Float.MAX_VALUE, c)
        assertNotNull(free.guideUsed)
        assertEquals(16f, free.guideUsed!!, 16f * 0.01f)
        // Capped by the ambient exposure: nothing to learn.
        assertNull(plan(16f, 1f, 4f, c).guideUsed)
        // Capped by the sensor's highest ISO: nothing to learn.
        assertNull(plan(1000f, 0.2f, Float.MAX_VALUE, c).guideUsed)
    }
}

class CompensationStepsTest {
    /** CameraController.compensationSteps before the flash's bias was added, as it was (2026-11-17). */
    private fun former(ev: Float, step: Float, lower: Int, upper: Int): Int {
        if (step <= 0f) return 0
        return (ev / step).roundToInt().coerceIn(lower, upper)
    }

    @Test
    fun sameAsBeforeWithoutAFlashBias() {
        for (step in listOf(1f / 6, 1f / 3, 0.5f, 0f)) for (ev in listOf(-4f, -1f, -0.3f, 0f, 0.1f, 0.7f, 2f, 5f)) {
            assertEquals("ev $ev step $step", former(ev, step, -18, 18), CompensationSteps.of(ev, step, -18, 18))
        }
    }

    @Test
    fun flashBiasAddsAndStaysInRange() {
        // OnePlus 11: 1/6 EV steps, -18..18. The flash's -1 EV on top of Brightness +0.5.
        assertEquals(-3, CompensationSteps.of(0.5f + -1f, 1f / 6, -18, 18))
        assertEquals(-18, CompensationSteps.of(-2.5f + -1f, 1f / 6, -18, 18))
        assertEquals(0, CompensationSteps.of(-1f, Float.NaN, -18, 18))
    }
}
