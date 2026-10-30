package app.rawboy.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LowLightTest {
    @Test
    fun productCalculation() {
        // ISO 400, 1/60 s, boost 1.0 -> 400 * (1/60) ≈ 6.667
        val exposureNs = (1_000_000_000L / 60)
        val product = LowLight.product(400f, exposureNs, 1f)
        assertEquals(400f / 60f, product, 0.01f)

        // Boost below 1.0 is coerced to 1.0
        val withLowBoost = LowLight.product(400f, exposureNs, 0.5f)
        assertEquals(product, withLowBoost, 0.001f)

        // Boost above 1.0 multiplies proportionally
        val withHighBoost = LowLight.product(400f, exposureNs, 1.5f)
        assertEquals(product * 1.5f, withHighBoost, 0.01f)
    }

    @Test
    fun daytimeOutdoorsAndBrightIndoorsDoNotMerge() {
        // Sunny day: ISO 50, 1/1000s -> product = 0.05
        assertFalse(LowLight.next(previous = false, iso = 50f, exposureNs = 1_000_000L, postRawBoost = 1f))

        // Bright indoors: ISO 100, 1/30s -> product ≈ 3.33
        val brightIndoorsNs = 1_000_000_000L / 30
        assertFalse(LowLight.next(previous = false, iso = 100f, exposureNs = brightIndoorsNs, postRawBoost = 1f))
    }

    @Test
    fun moderateAndDimIndoorScenesEnterLowLight() {
        // ISO 400 at 1/60s (product ≈ 6.67) enters low light (>= ENTER_PRODUCT of 6.0)
        val shutter60Ns = 1_000_000_000L / 60
        assertTrue(LowLight.next(previous = false, iso = 400f, exposureNs = shutter60Ns, postRawBoost = 1f))

        // ISO 300 at 1/40s (product = 7.5) enters low light
        val shutter40Ns = 1_000_000_000L / 40
        assertTrue(LowLight.next(previous = false, iso = 300f, exposureNs = shutter40Ns, postRawBoost = 1f))
    }

    @Test
    fun hysteresisPreventsFlicker() {
        // Mid-range value (product = 5.0, between EXIT_PRODUCT 4.0 and ENTER_PRODUCT 6.0)
        // ISO 200 at 1/40s -> 5.0
        val midNs = 1_000_000_000L / 40
        val isoMid = 200f

        // Stays false if it was false
        assertFalse(LowLight.next(previous = false, iso = isoMid, exposureNs = midNs, postRawBoost = 1f))

        // Stays true if it was true
        assertTrue(LowLight.next(previous = true, iso = isoMid, exposureNs = midNs, postRawBoost = 1f))

        // Drops back to false only below EXIT_PRODUCT (e.g. product = 3.0: ISO 120 at 1/40s)
        assertFalse(LowLight.next(previous = true, iso = 120f, exposureNs = midNs, postRawBoost = 1f))
    }

    @Test
    fun unknownExposureKeepsPreviousState() {
        assertTrue(LowLight.next(previous = true, iso = 0f, exposureNs = 1_000_000L, postRawBoost = 1f))
        assertFalse(LowLight.next(previous = false, iso = 100f, exposureNs = 0L, postRawBoost = 1f))
    }
}
