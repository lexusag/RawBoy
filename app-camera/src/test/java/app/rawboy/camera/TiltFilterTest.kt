package app.rawboy.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TiltFilterTest {
    @Test
    fun keepsQuadrantsWithoutWrappingModulo90() {
        val filter = TiltFilter(alpha = 1f)
        assertEquals(0f, filter.update(0)!!, 0f)
        assertEquals(45f, filter.update(45)!!, 0.05f)
        assertEquals(90f, filter.update(90)!!, 0.05f)
        assertEquals(180f, filter.update(180)!!, 0.05f)
        assertEquals(270f, filter.update(270)!!, 0.05f)
    }

    @Test
    fun unwrapsContinuouslyAcross360And180() {
        val filter = TiltFilter()
        // Turn clockwise through 180 and 360 in 10-degree steps: output stays monotonic without jumping.
        var prev = filter.update(0)!!
        for (deg in 10..400 step 10) {
            repeat(8) { prev = filter.update(deg % 360)!! }
        }
        assertEquals(400f, prev, 1f)

        // Turn back anticlockwise across 360 -> 350 -> 180 -> 0: output decreases monotonically.
        for (deg in 390 downTo 0 step 10) {
            var next = prev
            repeat(8) { next = filter.update(deg % 360)!! }
            assertEquals(true, next <= prev + 0.1f)
            prev = next
        }
        assertEquals(0f, prev, 1f)
    }

    @Test
    fun deadbandAppliesAtEvery90DegreeUpright() {
        val filter = TiltFilter(alpha = 1f, deadband = 0.4f)
        // Within deadband -> snaps to exact 90-degree multiple.
        assertEquals(0f, filter.update(0)!!, 0f)
        assertEquals(90f, filter.update(90)!!, 0f)
        assertEquals(180f, filter.update(180)!!, 0f)
        assertEquals(270f, filter.update(270)!!, 0f)

        // Smooth reading 0.3 degrees off 90 snaps to 90; 1.0 degree off does not.
        val smoothed = TiltFilter(alpha = 0.3f, deadband = 0.4f)
        assertEquals(90f, smoothed.update(90)!!, 0f)
        assertEquals(90f, smoothed.update(91)!!, 0f) // +0.3 deg from 90 -> inside 0.4 deadband
        assertEquals(90.5f, smoothed.update(91)!!, 0.05f) // ~0.51 deg from 90 -> outside deadband

        // Same around 270 (or -90).
        val smoothed270 = TiltFilter(alpha = 0.3f, deadband = 0.4f)
        assertEquals(-90f, smoothed270.update(270)!!, 0f)
        assertEquals(-90f, smoothed270.update(271)!!, 0f)
        assertEquals(-89.5f, smoothed270.update(271)!!, 0.05f)
    }

    @Test
    fun flatResetsLowPassAndReturnsNull() {
        val filter = TiltFilter()
        assertEquals(0f, filter.update(0)!!, 0f)
        assertNull(filter.update(null))
        // After lying flat, a new angle starts immediately instead of smoothing from 0.
        assertEquals(90f, filter.update(90)!!, 0f)
    }
}
