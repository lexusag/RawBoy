package app.rawboy.export

import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class Pentax645FrameTest {
    @Test
    fun formattersMatchPentax645Conventions() {
        assertEquals("#3", Pentax645Frame.formatFrameNumber(3))
        assertEquals("#17", Pentax645Frame.formatFrameNumber(17))
        assertEquals("#--", Pentax645Frame.formatFrameNumber(0))

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

        assertEquals("24mm", Pentax645Frame.formatFocalLength(24.0))
        assertEquals("--mm", Pentax645Frame.formatFocalLength(Double.NaN))

        assertEquals("ISO400", Pentax645Frame.formatIso(400.0))
        assertEquals("ISO---", Pentax645Frame.formatIso(0.0))

        val utc = TimeZone.getTimeZone("UTC")
        // 2026-11-13 14:46:00 UTC = 1794581160000L
        assertEquals("13.11.26 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.DMY, utc))
        assertEquals("26.11.13 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.YMD, utc))
        assertEquals("11.13.26 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.MDY, utc))
    }

    @Test
    fun topBarRendersOrangeLedOnDarkRebateAndWrapsPhoto() {
        val layout = Pentax645Frame.layout(600, 800)
        assertTrue(layout.border >= 3)
        assertTrue(layout.infoBar >= 28)
        assertEquals(600 + 2 * layout.border, layout.outWidth)
        assertEquals(800 + 2 * layout.border, layout.outHeight)

        val info = Pentax645Info(
            frameNumber = 3,
            mode = "FILM",
            exposureTime = 1.0 / 125.0,
            fNumber = 1.8,
            compensationEv = 0f,
            spotMetered = false,
            focalLengthMm = 24.0,
            iso = 400.0,
            dateTime = "13.11.26 14:46",
        )
        val bandRows = layout.infoBar + 20
        val src = ShortArray(600 * bandRows * 3) { 20000.toShort() }
        val dst = ShortArray(layout.outWidth * bandRows * 3)
        Pentax645Frame.wrapPhotoBand(src, dst, layout, 0, bandRows, monochrome = false, info = info)

        var maxR = 0
        var maxG = 0
        var maxB = 0
        var brightOrangePixels = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
            val r = dst[i * 3].toInt() and 0xFFFF
            val g = dst[i * 3 + 1].toInt() and 0xFFFF
            val b = dst[i * 3 + 2].toInt() and 0xFFFF
            if (r > maxR) maxR = r
            if (g > maxG) maxG = g
            if (b > maxB) maxB = b
            if (r > 30000 && r > g && g > b) brightOrangePixels++
        }
        assertTrue("Expected glowing amber-orange LED dots in top stripe", brightOrangePixels > 50)
        assertTrue(maxR > maxG && maxG > maxB)

        val leftBorderR = dst[0].toInt() and 0xFFFF
        // Because the black stripe's ends curve upward, (x = 0, y = 10) reveals the photo underneath.
        val cornerPhotoR = dst[(10 * layout.outWidth + layout.leftPad) * 3].toInt() and 0xFFFF
        val centerStripeR = dst[(1 * layout.outWidth + layout.leftPad + 300) * 3].toInt() and 0xFFFF
        val belowStripeR = dst[((layout.infoBar + 10) * layout.outWidth + layout.leftPad + 300) * 3].toInt() and 0xFFFF
        assertTrue(leftBorderR < 2000)
        assertEquals(20000, cornerPhotoR)
        assertTrue("Expected dark stripe in middle of top edge", centerStripeR < 2000)
        assertEquals(20000, belowStripeR)
    }

    @Test
    fun landscapePhotoPlacesPentax645InfoOnShorterLeftSide() {
        val layout = Pentax645Frame.layout(800, 600)
        assertTrue(layout.infoOnLeft)
        assertEquals(800 + 2 * layout.border, layout.outWidth)
        assertEquals(600 + 2 * layout.border, layout.outHeight)

        val info = Pentax645Info(
            frameNumber = 7,
            mode = "FILM",
            exposureTime = 1.0 / 250.0,
            fNumber = 2.8,
            focalLengthMm = 24.0,
        )
        val src = ShortArray(800 * 600 * 3) { 20000.toShort() }
        val dst = ShortArray(layout.outWidth * 600 * 3)
        Pentax645Frame.wrapPhotoBand(src, dst, layout, 0, 600, monochrome = false, info = info)

        var brightLeftStripePixels = 0
        for (y in 0 until 600) {
            for (x in layout.leftPad until layout.leftPad + layout.infoBar) {
                val idx = (y * layout.outWidth + x) * 3
                val r = dst[idx].toInt() and 0xFFFF
                val g = dst[idx + 1].toInt() and 0xFFFF
                val b = dst[idx + 2].toInt() and 0xFFFF
                if (r > 30000 && r > g && g > b) brightLeftStripePixels++
            }
        }
        assertTrue("Expected glowing LED dots in left shorter-side stripe for landscape photo", brightLeftStripePixels > 50)
    }

    @Test
    fun monochromeModeRendersNeutralBlackAndWhiteForBothFrames() {
        val layout = Pentax645Frame.layout(600, 800)
        val src = ShortArray(600 * layout.infoBar * 3) { 20000.toShort() }
        val topBand = ShortArray(layout.outWidth * layout.infoBar * 3)
        val info = Pentax645Info(
            frameNumber = 5,
            mode = "BW",
            exposureTime = 1.0 / 60.0,
            fNumber = 2.8,
            compensationEv = -0.3f,
            spotMetered = true,
            focalLengthMm = 48.0,
        )
        Pentax645Frame.wrapPhotoBand(src, topBand, layout, 0, layout.infoBar, monochrome = true, info = info)
        var brightMonoPixels = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
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
