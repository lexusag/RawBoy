package app.rawboy.color

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** B&W colour filters (the same cases as web's bwfilter.test.ts). */
class BwFilterTest {
    private fun luma(c: DoubleArray) = 0.2627 * c[0] + 0.6780 * c[1] + 0.0593 * c[2]
    private fun filtered(f: BwFilter, rgb: DoubleArray) = luma(Mat3.apply(f.matrix(), rgb))

    @Test
    fun greyKeepsItsBrightnessThroughEveryFilter() {
        for (f in BwFilter.entries) assertEquals(f.name, 0.18, filtered(f, doubleArrayOf(0.18, 0.18, 0.18)), 1e-9)
    }

    @Test
    fun noneIsTheIdentity() {
        val m = BwFilter.NONE.matrix()
        for (i in 0 until 9) assertEquals(if (i % 4 == 0) 1.0 else 0.0, m[i], 1e-12)
    }

    @Test
    fun aFilterLightensItsOwnColourAndDarkensTheOpposite() {
        val sky = doubleArrayOf(0.10, 0.17, 0.35)
        val skin = doubleArrayOf(0.30, 0.17, 0.11)
        val leaves = doubleArrayOf(0.12, 0.22, 0.06)
        assertTrue(filtered(BwFilter.RED, sky) < filtered(BwFilter.ORANGE, sky))
        assertTrue(filtered(BwFilter.ORANGE, sky) < filtered(BwFilter.YELLOW, sky))
        assertTrue(filtered(BwFilter.YELLOW, sky) < filtered(BwFilter.NONE, sky))
        assertTrue(filtered(BwFilter.RED, skin) > filtered(BwFilter.NONE, skin))
        assertTrue(filtered(BwFilter.GREEN, skin) < filtered(BwFilter.NONE, skin))
        assertTrue(filtered(BwFilter.GREEN, leaves) > filtered(BwFilter.NONE, leaves))
    }

    @Test
    fun keysRoundTrip() {
        for (f in BwFilter.entries) assertEquals(f, BwFilter.fromKey(f.key))
        assertEquals(null, BwFilter.fromKey("blue"))
    }
}
