package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ExposureProgramTest {
    private fun program(ev: Float, t0: Long, iso0: Float, isoMax: Int = 6400, maxStill: Long = 66_666_667L) =
        ExposureProgram.compute(ev, t0, iso0, isoMin = 50, isoMax = isoMax, expMin = 10_000L, expMax = 1_000_000_000L, maxStillNs = maxStill)

    private fun ev(e: ExposureProgram.Exposure, t0: Long, iso0: Float) =
        ExposureProgram.capturedEv(e.exposureNs, e.iso, t0 / 1e9 * iso0)

    @Test
    fun zeroKeepsTheMeteredExposure() {
        val e = program(0f, 4_000_000L, 100f)
        assertEquals(4_000_000L, e.exposureNs)
        assertEquals(100, e.iso)
    }

    @Test
    fun brighterLengthensTheTimeFirst() {
        // Daylight 1/1000 s ISO 50: +2 EV is 1/250 s at the same ISO.
        val e = program(2f, 1_000_000L, 50f)
        assertEquals(4_000_000L, e.exposureNs)
        assertEquals(50, e.iso)
        assertEquals(2f, ev(e, 1_000_000L, 50f), 0.01f)
    }

    @Test
    fun brighterRaisesIsoPastTheHandheldLimit() {
        // Indoors 1/30 s ISO 800: +1 EV stays at 1/30 s, ISO 1600.
        val e = program(1f, ExposureProgram.HANDHELD_NS, 800f)
        assertEquals(ExposureProgram.HANDHELD_NS, e.exposureNs)
        assertEquals(1600, e.iso)
    }

    @Test
    fun brighterAtTheIsoCeilingLengthensUpToTheStillLimit() {
        // Dark: 1/30 s ISO 3200, ceiling 6400, still limit 1/15 s: +3 EV gets 2 EV in the raw, the rest stays digital.
        val e = program(3f, ExposureProgram.HANDHELD_NS, 3200f)
        assertEquals(6400, e.iso)
        assertEquals(66_666_667L, e.exposureNs)
        assertEquals(2f, ev(e, ExposureProgram.HANDHELD_NS, 3200f), 0.01f)
    }

    @Test
    fun darkerLowersIsoThenShortensTheTime() {
        // 1/100 s ISO 200: -3 EV = ISO 50 (-2 EV), then 1/200 s.
        val e = program(-3f, 10_000_000L, 200f)
        assertEquals(50, e.iso)
        assertEquals(5_000_000L, e.exposureNs)
        assertEquals(-3f, ev(e, 10_000_000L, 200f), 0.01f)
    }

    @Test
    fun darkerAtTheSensorLimitStaysPartlyDigital() {
        // Already at the shortest time and lowest ISO: nothing darker reaches the raw.
        val e = ExposureProgram.compute(-2f, 10_000L, 50f, 50, 6400, 10_000L, 1_000_000_000L, 66_666_667L)
        assertEquals(10_000L, e.exposureNs)
        assertEquals(50, e.iso)
    }

    @Test
    fun flickerSafeTimesStayWholePeriods() {
        // 50 Hz room at 1/100 s ISO 400: +1 EV wants 20 ms, two whole periods.
        val e = program(1f, 10_000_000L, 400f)
        assertEquals(20_000_000L, e.exposureNs)
        assertEquals(400, e.iso)
        // +0.67 EV wants ~15.9 ms: one period and the ISO makes up the rest.
        val f = program(2f / 3f, 10_000_000L, 400f)
        assertEquals(10_000_000L, f.exposureNs)
        assertEquals(635, f.iso)
    }

    @Test
    fun flickerPeriods() {
        assertEquals(10_000_000L, ExposureProgram.flickerPeriodNs(10_000_000L))
        assertEquals(10_000_000L, ExposureProgram.flickerPeriodNs(30_000_000L))
        assertEquals(8_333_333L, ExposureProgram.flickerPeriodNs(16_666_667L))
        assertNull(ExposureProgram.flickerPeriodNs(4_000_000L))
        assertNull(ExposureProgram.flickerPeriodNs(13_000_000L))
    }
}
