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
        assertEquals("0.8s", Pentax645Frame.formatShutter(0.8))
        assertEquals("1/2", Pentax645Frame.formatShutter(0.5))

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
        assertEquals("13.11.26", Pentax645Frame.formatDate(1794581160000L, DateStampFormat.DMY, utc))
        assertEquals("26.11.13", Pentax645Frame.formatDate(1794581160000L, DateStampFormat.YMD, utc))
        assertEquals("11.13.26", Pentax645Frame.formatDate(1794581160000L, DateStampFormat.MDY, utc))
        assertEquals("nov 26", Pentax645Frame.formatDate(1794581160000L, DateStampFormat.MMM_YY, utc))

        assertEquals("14:46", Pentax645Frame.formatTime(1794581160000L, TimeStampFormat.H24, utc))
        assertEquals("2:46PM", Pentax645Frame.formatTime(1794581160000L, TimeStampFormat.H12, utc))
        // 2026-01-13 00:05:00 UTC = 1768262700000L
        assertEquals("jan 26", Pentax645Frame.formatDate(1768262700000L, DateStampFormat.MMM_YY, utc))
        assertEquals("12:05AM", Pentax645Frame.formatTime(1768262700000L, TimeStampFormat.H12, utc))

        assertEquals("13.11.26 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.DMY, utc))
        assertEquals("26.11.13 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.YMD, utc))
        assertEquals("11.13.26 14:46", Pentax645Frame.formatDateTime(1794581160000L, DateStampFormat.MDY, utc))
    }

    @Test
    fun flippedAndCustomFieldOrderRenderLedDots() {
        val layout = Pentax645Frame.layout(600, 800)
        val infoNormal = Pentax645Info(
            frameNumber = 1,
            date = "jan 26",
            time = "4:46PM",
            flipped = false,
            fieldOrder = listOf("time", "date", "frame"),
        )
        val infoFlipped = infoNormal.copy(flipped = true)
        val src = ShortArray(600 * layout.infoBar * 3) { 20000.toShort() }
        val dstNormal = ShortArray(layout.outWidth * layout.infoBar * 3)
        val dstFlipped = ShortArray(layout.outWidth * layout.infoBar * 3)
        Pentax645Frame.wrapPhotoBand(src, dstNormal, layout, 0, layout.infoBar, monochrome = false, info = infoNormal)
        Pentax645Frame.wrapPhotoBand(src, dstFlipped, layout, 0, layout.infoBar, monochrome = false, info = infoFlipped)

        var diffCount = 0
        var brightFlipped = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
            val rn = dstNormal[i * 3].toInt() and 0xFFFF
            val rf = dstFlipped[i * 3].toInt() and 0xFFFF
            if (rn != rf) diffCount++
            if (rf > 30000) brightFlipped++
        }
        assertTrue("Expected flipped LED text to render bright dots", brightFlipped > 30)
        assertTrue("Expected flipped LED text to differ from unflipped", diffCount > 50)
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

    @Test
    fun slideAndRedColorsRenderExpectedHues() {
        val layout = Pentax645Frame.layout(600, 800)
        val src = ShortArray(600 * layout.infoBar * 3) { 20000.toShort() }

        val slideDst = ShortArray(layout.outWidth * layout.infoBar * 3)
        Pentax645Frame.wrapPhotoBand(
            src, slideDst, layout, 0, layout.infoBar, monochrome = false,
            info = Pentax645Info(frameNumber = 14, mode = "FILM", exposureTime = 1.0 / 125.0, fNumber = 4.5, color = FilmFrameColor.SLIDE),
        )
        var slidePixels = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
            val r = slideDst[i * 3].toInt() and 0xFFFF
            val g = slideDst[i * 3 + 1].toInt() and 0xFFFF
            val b = slideDst[i * 3 + 2].toInt() and 0xFFFF
            if (g > 30000 && g > r && r > b) slidePixels++
        }
        assertTrue("Expected yellow-green Slide LED dots", slidePixels > 50)

        val redDst = ShortArray(layout.outWidth * layout.infoBar * 3)
        Pentax645Frame.wrapPhotoBand(
            src, redDst, layout, 0, layout.infoBar, monochrome = false,
            info = Pentax645Info(frameNumber = 14, mode = "FILM", exposureTime = 1.0 / 125.0, fNumber = 4.5, color = FilmFrameColor.RED),
        )
        var redPixels = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
            val r = redDst[i * 3].toInt() and 0xFFFF
            val g = redDst[i * 3 + 1].toInt() and 0xFFFF
            val b = redDst[i * 3 + 2].toInt() and 0xFFFF
            if (r > 30000 && r > g * 2 && g > b) redPixels++
        }
        assertTrue("Expected Red LED dots", redPixels > 50)

        val greenDst = ShortArray(layout.outWidth * layout.infoBar * 3)
        Pentax645Frame.wrapPhotoBand(
            src, greenDst, layout, 0, layout.infoBar, monochrome = false,
            info = Pentax645Info(frameNumber = 14, mode = "FILM", exposureTime = 1.0 / 125.0, fNumber = 4.5, color = FilmFrameColor.GREEN),
        )
        var greenPixels = 0
        for (i in 0 until layout.outWidth * layout.infoBar) {
            val r = greenDst[i * 3].toInt() and 0xFFFF
            val g = greenDst[i * 3 + 1].toInt() and 0xFFFF
            val b = greenDst[i * 3 + 2].toInt() and 0xFFFF
            if (g > 30000 && g > r * 2 && g > b * 2) greenPixels++
        }
        assertTrue("Expected Green LED dots", greenPixels > 50)
    }

    @Test
    fun contax645RendersTopShootInfoAndBottomTriangleFrameNumber() {
        assertEquals("10", Pentax645Frame.formatContaxFrameNumber(10))
        assertEquals("--", Pentax645Frame.formatContaxFrameNumber(0))
        assertEquals("1/4000", Pentax645Frame.formatContaxShutter(1.0 / 4000.0))
        assertEquals("1/30", Pentax645Frame.formatContaxShutter(1.0 / 30.0))
        assertEquals("2s", Pentax645Frame.formatContaxShutter(2.0))
        assertEquals("F 2.8", Pentax645Frame.formatContaxAperture(2.8))
        assertEquals("F 4", Pentax645Frame.formatContaxAperture(4.0))

        val layout = Pentax645Frame.layout(600, 800, FilmFrameStyle.CONTAX_645)
        assertEquals(layout.infoBar, layout.topPad)
        assertEquals(layout.infoBar, layout.bottomPad)
        assertTrue(!layout.infoOnLeft)

        val info = Pentax645Info(
            frameNumber = 10,
            mode = "FILM",
            exposureTime = 1.0 / 4000.0,
            fNumber = 2.8,
            focalLengthMm = 80.0,
            color = FilmFrameColor.RED,
            style = FilmFrameStyle.CONTAX_645,
        )

        val topBand = ShortArray(layout.outWidth * layout.topPad * 3)
        Pentax645Frame.renderTopBarBand(topBand, layout, 0, layout.topPad, info, monochrome = false)
        var topRedPixels = 0
        for (i in 0 until layout.outWidth * layout.topPad) {
            val r = topBand[i * 3].toInt() and 0xFFFF
            val g = topBand[i * 3 + 1].toInt() and 0xFFFF
            if (r > 30000 && r > g * 2) topRedPixels++
        }
        assertTrue("Expected Red LED shoot info in Contax 645 top bar", topRedPixels > 50)

        // Photo corners have cutouts with a shallower, soft-blurred gate edge than the middle dark gate shoulder.
        val photoSrc = ShortArray(600 * 10 * 3) { 20000.toShort() }
        val photoDst = ShortArray(layout.outWidth * 10 * 3)
        Pentax645Frame.wrapPhotoBand(photoSrc, photoDst, layout, 0, 10, monochrome = false, info = info)
        val cutoutEdgePx = photoDst[(layout.leftPad + 8) * 3].toInt() and 0xFFFF
        val cutoutInnerPx = photoDst[(2 * layout.outWidth + layout.leftPad + 8) * 3].toInt() and 0xFFFF
        val middleInnerPx = photoDst[(2 * layout.outWidth + layout.leftPad + 300) * 3].toInt() and 0xFFFF
        assertTrue("Expected soft-blurred edge inside Contax 645 cutout", cutoutEdgePx in 1000..15000)
        assertTrue(
            "Expected Contax 645 cutout to be shallower than middle gate shoulder",
            cutoutInnerPx > middleInnerPx && middleInnerPx < 10000,
        )
        assertTrue(
            "Expected Contax 645 dark gate shoulder in middle of top edge",
            (photoDst[(layout.leftPad + 300) * 3].toInt() and 0xFFFF) < 2000,
        )

        val bottomBand = ShortArray(layout.outWidth * layout.bottomPad * 3)
        Pentax645Frame.renderBorderBand(bottomBand, layout, layout.topPad + layout.photoHeight, layout.bottomPad, monochrome = false, info = info)
        var bottomRedPixels = 0
        for (i in 0 until layout.outWidth * layout.bottomPad) {
            val r = bottomBand[i * 3].toInt() and 0xFFFF
            val g = bottomBand[i * 3 + 1].toInt() and 0xFFFF
            if (r > 30000 && r > g * 2) bottomRedPixels++
        }
        assertTrue("Expected triangle + frame number in Contax 645 bottom bar", bottomRedPixels > 25)
    }

    @Test
    fun landscapePhotoPlacesContax645BarsOnShorterLeftAndRightSides() {
        val layout = Pentax645Frame.layout(800, 600, FilmFrameStyle.CONTAX_645)
        assertTrue(layout.infoOnLeft)
        assertEquals(layout.infoBar, layout.leftPad)
        assertEquals(layout.infoBar, layout.rightPad)
        assertEquals(layout.border, layout.topPad)
        assertEquals(layout.border, layout.bottomPad)

        val info = Pentax645Info(
            frameNumber = 10,
            mode = "FILM",
            exposureTime = 1.0 / 4000.0,
            fNumber = 2.8,
            focalLengthMm = 80.0,
            color = FilmFrameColor.RED,
            style = FilmFrameStyle.CONTAX_645,
        )
        val src = ShortArray(800 * 600 * 3) { 20000.toShort() }
        val dst = ShortArray(layout.outWidth * 600 * 3)
        Pentax645Frame.wrapPhotoBand(src, dst, layout, 0, 600, monochrome = false, info = info)

        var leftBarPixels = 0
        var rightBarPixels = 0
        for (y in 0 until 600) {
            for (x in 0 until layout.leftPad) {
                val r = dst[(y * layout.outWidth + x) * 3].toInt() and 0xFFFF
                if (r > 30000) leftBarPixels++
            }
            for (x in (layout.leftPad + layout.photoWidth) until layout.outWidth) {
                val r = dst[(y * layout.outWidth + x) * 3].toInt() and 0xFFFF
                if (r > 30000) rightBarPixels++
            }
        }
        assertTrue("Expected shoot info in Contax 645 left short-side bar", leftBarPixels > 50)
        assertTrue("Expected triangle + frame number in Contax 645 right short-side bar", rightBarPixels > 25)
    }

    @Test
    fun exportFieldsFilterOutCameraOnlyFields() {
        val parsed = Pentax645Field.parseExportFields("SHUTTER,MODE,APERTURE,EV")
        assertEquals(setOf(Pentax645Field.SHUTTER, Pentax645Field.APERTURE), parsed)

        val order = Pentax645Field.parseExportOrder("TIME,MODE,SHUTTER")
        assertEquals(Pentax645Field.TIME, order.first())
        assertTrue(Pentax645Field.MODE !in order)
        assertEquals(Pentax645Field.EXPORT_FIELDS.size, order.size)
    }
}
