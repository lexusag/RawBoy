package app.rawboy.export

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class Pentax645FrameTest {
    @Test
    fun formattersMatchPentax645Conventions() {
        assertEquals("3", Pentax645Frame.formatFrameNumber(3))
        assertEquals("--", Pentax645Frame.formatFrameNumber(0))

        assertEquals("1/125", Pentax645Frame.formatShutter(1.0 / 125.0))
        assertEquals("2.5s", Pentax645Frame.formatShutter(2.5))
        assertEquals("1s", Pentax645Frame.formatShutter(1.0))
        assertEquals("---", Pentax645Frame.formatShutter(Double.NaN))

        assertEquals("F 8", Pentax645Frame.formatAperture(8.0))
        assertEquals("F1.8", Pentax645Frame.formatAperture(1.8))
        assertEquals("F11", Pentax645Frame.formatAperture(11.0))
        assertEquals("F--", Pentax645Frame.formatAperture(0.0))

        assertEquals("±0.0EV", Pentax645Frame.formatEv(0f))
        assertEquals("+0.7EV", Pentax645Frame.formatEv(0.7f))
        assertEquals("-1.3EV", Pentax645Frame.formatEv(-1.3f))

        assertEquals("24 mm", Pentax645Frame.formatFocalLength(24.0))
        assertEquals("-- mm", Pentax645Frame.formatFocalLength(Double.NaN))
    }

    @Test
    fun topBarRendersOrangeLedOnDarkRebateAndWrapsPhoto() {
        val layout = Pentax645Frame.layout(600, 800)
        assertTrue(layout.border >= 3)
        assertTrue(layout.topBar >= 28)
        assertEquals(600 + 2 * layout.border, layout.outWidth)
        assertEquals(800 + layout.topBar + layout.border, layout.outHeight)

        val topBand = ShortArray(layout.outWidth * layout.topBar * 3)
        val info = Pentax645Info(
            frameNumber = 3,
            mode = "FILM",
            exposureTime = 1.0 / 125.0,
            fNumber = 1.8,
            compensationEv = 0f,
            spotMetered = false,
            focalLengthMm = 24.0,
        )
        Pentax645Frame.renderTopBarBand(topBand, layout, 0, layout.topBar, info)

        var maxR = 0
        var maxG = 0
        var maxB = 0
        var brightOrangePixels = 0
        for (i in 0 until layout.outWidth * layout.topBar) {
            val r = topBand[i * 3].toInt() and 0xFFFF
            val g = topBand[i * 3 + 1].toInt() and 0xFFFF
            val b = topBand[i * 3 + 2].toInt() and 0xFFFF
            if (r > maxR) maxR = r
            if (g > maxG) maxG = g
            if (b > maxB) maxB = b
            if (r > 30000 && r > g && g > b) brightOrangePixels++
        }
        assertTrue("Expected glowing amber-orange LED dots in top rebate", brightOrangePixels > 50)
        assertTrue(maxR > maxG && maxG > maxB)

        // Photo wrapping preserves inner pixels and fills side borders darkly.
        val src = ShortArray(600 * 4 * 3) { 20000.toShort() }
        val dst = ShortArray(layout.outWidth * 4 * 3)
        Pentax645Frame.wrapPhotoBand(src, dst, layout, 0, 4)
        val leftBorderR = dst[0].toInt() and 0xFFFF
        val photoStartR = dst[layout.border * 3].toInt() and 0xFFFF
        assertTrue(leftBorderR < 2000)
        assertEquals(20000, photoStartR)
    }

    @Test
    fun monochromeModeRendersNeutralBlackAndWhiteForBothFrames() {
        val layout = Pentax645Frame.layout(600, 800)
        val topBand = ShortArray(layout.outWidth * layout.topBar * 3)
        val info = Pentax645Info(
            frameNumber = 5,
            mode = "BW",
            exposureTime = 1.0 / 60.0,
            fNumber = 2.8,
            compensationEv = -0.3f,
            spotMetered = true,
            focalLengthMm = 48.0,
        )
        Pentax645Frame.renderTopBarBand(topBand, layout, 0, layout.topBar, info, monochrome = true)
        var brightMonoPixels = 0
        for (i in 0 until layout.outWidth * layout.topBar) {
            val r = topBand[i * 3].toInt() and 0xFFFF
            val g = topBand[i * 3 + 1].toInt() and 0xFFFF
            val b = topBand[i * 3 + 2].toInt() and 0xFFFF
            assertEquals(r, g)
            assertEquals(g, b)
            if (r > 30000) brightMonoPixels++
        }
        assertTrue("Expected neutral white LED dots in BW mode", brightMonoPixels > 50)

        // DateStamp in monochrome mode also keeps R == G == B.
        val w = 400
        val h = 300
        val band = ShortArray(w * h * 3) { 8000.toShort() }
        DateStamp.imprint(band, w, h, 0, h, "13 11 '26", monochrome = true)
        var brightDatePixels = 0
        for (i in 0 until w * h) {
            val r = band[i * 3].toInt() and 0xFFFF
            val g = band[i * 3 + 1].toInt() and 0xFFFF
            val b = band[i * 3 + 2].toInt() and 0xFFFF
            assertEquals(r, g)
            assertEquals(g, b)
            if (r > 30000) brightDatePixels++
        }
        assertTrue("Expected neutral white date stamp digits in BW mode", brightDatePixels > 30)
    }
}
