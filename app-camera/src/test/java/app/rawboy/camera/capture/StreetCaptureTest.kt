package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreetCaptureTest {
    @Test
    fun snapFocusComputesDioptersAndClampsToLensRange() {
        // AF leaves Camera2 in continuous autofocus (null diopters).
        assertNull(SnapFocus.AF.diopters(hyperfocalDiopters = 0.25f, minFocusDiopters = 10f))
        // Fixed-focus lens (minFocusDiopters == 0) cannot manual-focus.
        assertNull(SnapFocus.M2_5.diopters(hyperfocalDiopters = 0f, minFocusDiopters = 0f))

        // Standard calibrated distances: 1 / meters.
        assertEquals(1f / 1.5f, SnapFocus.M1_5.diopters(0.2f, 10f)!!, 1e-4f)
        assertEquals(0.4f, SnapFocus.M2_5.diopters(0.2f, 10f)!!, 1e-4f)
        assertEquals(0.2f, SnapFocus.M5.diopters(0.2f, 10f)!!, 1e-4f)

        // Infinity uses hyperfocal distance when reported, else 0 diopters.
        assertEquals(0.22f, SnapFocus.INF.diopters(hyperfocalDiopters = 0.22f, minFocusDiopters = 10f)!!, 1e-4f)
        assertEquals(0f, SnapFocus.INF.diopters(hyperfocalDiopters = 0f, minFocusDiopters = 10f)!!, 1e-4f)

        // Telephoto lens with longer min focus distance (e.g. minFocusDiopters = 0.5 -> 2 m closest): 1.5 m clamps to 0.5 D.
        assertEquals(0.5f, SnapFocus.M1_5.diopters(0.1f, minFocusDiopters = 0.5f)!!, 1e-4f)

        // Honest labels for uncalibrated vs calibrated lenses.
        assertEquals("2.5m", SnapFocus.M2_5.displayLabel(calibrated = true))
        assertEquals("Mid", SnapFocus.M2_5.displayLabel(calibrated = false))
        assertEquals("AF", SnapFocus.AF.displayLabel(calibrated = false))
    }

    @Test
    fun streetExposureFreezesMotionAndRespectsIsoCeiling() {
        val isoMin = 50
        val isoMax = 6400
        val expMin = 100_000L
        val expMax = 1_000_000_000L

        // AUTO leaves AE untouched.
        assertNull(StreetExposure.compute(400f, 16_000_000L, StreetShutter.AUTO.maxExposureNs, isoMin, isoMax, expMin, expMax))

        // Already faster than 1/250 s (4 ms): leave AE untouched.
        assertNull(StreetExposure.compute(100f, 2_000_000L, StreetShutter.S250.maxExposureNs, isoMin, isoMax, expMin, expMax))

        // Dim street: AE picked 1/60 s (16 ms) @ ISO 200; floor is 1/250 s (4 ms) -> 4 ms @ ISO 800.
        val clamped = StreetExposure.compute(200f, 16_000_000L, StreetShutter.S250.maxExposureNs, isoMin, isoMax, expMin, expMax)
        assertEquals(4_000_000L to 800, clamped)

        // Night street: AE picked 1/30 s (33.3 ms) @ ISO 3200; floor 1/250 s (4 ms) would need ISO 26667 (> 6400).
        // Should pin ISO at 6400 and lengthen exposure to ~16.6 ms so exposure matches ambient instead of going black.
        val night = StreetExposure.compute(3200f, 33_333_333L, StreetShutter.S250.maxExposureNs, isoMin, isoMax, expMin, expMax)!!
        assertEquals(6400, night.second)
        assertTrue(night.first in 16_000_000L..17_000_000L)

        // Format helper produces clean camera shutter strings.
        assertEquals("1/250", StreetExposure.formatShutter(4_000_000L))
        assertEquals("1/30", StreetExposure.formatShutter(33_333_333L))
        assertEquals("0.5s", StreetExposure.formatShutter(500_000_000L))
        assertEquals("", StreetExposure.formatShutter(0L))
    }

    @Test
    fun fastLensEntryRoundTripsAndRejectsMalformedInput() {
        val entry = FastLensEntry(
            openId = "0",
            physicalId = "2",
            physicalFromLogical = true,
            label = "UW",
            facing = 1,
            equivalentFocal = 13.5f,
            rawWidth = 4080,
            rawHeight = 3072,
            previewWidth = 1440,
            previewHeight = 1080,
            sensorOrientation = 90,
            previewGamma = 0f,
            hasFlash = true,
            maxResWidth = 8160,
            maxResHeight = 6144,
            maxResFormat = 37,
            hiRes = false,
            fNumber = 1.68f,
        )
        assertEquals("0", entry.targetOpenId)
        assertEquals("2", entry.copy(physicalFromLogical = false).targetOpenId)
        assertEquals(entry, FastLensEntry.parse(entry.serialize()))

        val logical = entry.copy(physicalId = null, physicalFromLogical = false, label = "W")
        assertEquals(logical, FastLensEntry.parse(logical.serialize()))
        assertEquals("0", logical.targetOpenId)

        assertNull(FastLensEntry.parse(null))
        assertNull(FastLensEntry.parse(""))
        assertNull(FastLensEntry.parse("corrupted|only|three"))
        assertNull(FastLensEntry.parse(entry.serialize().replace("|4080|", "|0|")))
    }
}
