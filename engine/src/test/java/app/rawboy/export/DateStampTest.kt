package app.rawboy.export

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class DateStampTest {

    @Test
    fun formatUsesClassicFilmDateBackOrder() {
        val tz = TimeZone.getTimeZone("UTC")
        val cal = Calendar.getInstance(tz).apply {
            clear()
            set(2026, Calendar.NOVEMBER, 13, 9, 45, 0)
        }
        assertEquals("13 11 '26", DateStamp.format(cal.timeInMillis, timeZone = tz))
        assertEquals("13 11 '26", DateStamp.format(cal.timeInMillis, DateStampFormat.DMY, tz))
        assertEquals("'26 11 13", DateStamp.format(cal.timeInMillis, DateStampFormat.YMD, tz))
        assertEquals("11 13 '26", DateStamp.format(cal.timeInMillis, DateStampFormat.MDY, tz))

        cal.set(2026, Calendar.MARCH, 5, 0, 0, 0)
        assertEquals("05 03 '26", DateStamp.format(cal.timeInMillis, DateStampFormat.DMY, tz))
        assertEquals("'26 03 05", DateStamp.format(cal.timeInMillis, DateStampFormat.YMD, tz))
        assertEquals("03 05 '26", DateStamp.format(cal.timeInMillis, DateStampFormat.MDY, tz))
    }

    @Test
    fun imprintLeavesTopBandsUntouchedAndBurnsYellowOrangeInBottomRight() {
        val width = 400
        val height = 300
        val text = "'26 11 13"

        val topBand = ShortArray(width * 100 * 3)
        DateStamp.imprint(topBand, width, height, bandY = 0, bandRows = 100, text = text)
        assertTrue("Top band should stay completely untouched", topBand.all { it == 0.toShort() })

        val bottomBand = ShortArray(width * 100 * 3)
        DateStamp.imprint(bottomBand, width, height, bandY = 200, bandRows = 100, text = text)

        // Bottom-left quadrant of the bottom band must stay untouched.
        for (py in 0 until 100) {
            for (px in 0 until width / 2) {
                val idx = (py * width + px) * 3
                assertEquals(0.toShort(), bottomBand[idx])
                assertEquals(0.toShort(), bottomBand[idx + 1])
                assertEquals(0.toShort(), bottomBand[idx + 2])
            }
        }

        // Bottom-right corner must contain bright yellowy-orange core pixels.
        var yellowOrangeCorePixels = 0
        for (py in 0 until 100) {
            for (px in width / 2 until width) {
                val idx = (py * width + px) * 3
                val r = bottomBand[idx].toInt() and 0xFFFF
                val g = bottomBand[idx + 1].toInt() and 0xFFFF
                val b = bottomBand[idx + 2].toInt() and 0xFFFF
                if (r > 50_000 && g in 25_000..55_000 && b < 15_000 && r > g && g > b) {
                    yellowOrangeCorePixels++
                }
            }
        }
        assertTrue("Expected yellowy-orange 7-segment pixels in bottom-right corner, found $yellowOrangeCorePixels", yellowOrangeCorePixels > 20)
    }

    @Test
    fun imprintFadesIntoBrightAreasButStillTintsThem() {
        val width = 400
        val height = 300
        val bottomBand = ShortArray(width * 100 * 3) { 0xFFFF.toShort() }
        DateStamp.imprint(bottomBand, width, height, bandY = 200, bandRows = 100, text = "'26 11 13")

        // Light added to the film can't brighten white: red and green stay white, only blue is held back (yellow tint).
        var tintedPixels = 0
        for (i in 0 until width * 100) {
            val r = bottomBand[i * 3].toInt() and 0xFFFF
            val g = bottomBand[i * 3 + 1].toInt() and 0xFFFF
            val b = bottomBand[i * 3 + 2].toInt() and 0xFFFF
            assertEquals(0xFFFF, r)
            assertEquals(0xFFFF, g)
            if (b < 35_000) tintedPixels++
        }
        assertTrue("Expected a yellow tint where the digits are, found $tintedPixels", tintedPixels > 20)
    }

    @Test
    fun fringeIsRedderThanCore() {
        val width = 400
        val height = 300
        val band = ShortArray(width * 100 * 3)
        DateStamp.imprint(band, width, height, bandY = 200, bandRows = 100, text = "'26 11 13")

        // Like a real data back: the hot core goes yellow-orange, the dim glow around it stays red-orange.
        var coreRatio = 0.0
        var coreN = 0
        var fringeRatio = 0.0
        var fringeN = 0
        for (i in 0 until width * 100) {
            val r = band[i * 3].toInt() and 0xFFFF
            val g = band[i * 3 + 1].toInt() and 0xFFFF
            if (r > 55_000) { coreRatio += g.toDouble() / r; coreN++ }
            else if (r in 3_000..20_000) { fringeRatio += g.toDouble() / r; fringeN++ }
        }
        assertTrue(coreN > 0 && fringeN > 0)
        assertTrue("core g/r ${coreRatio / coreN} should exceed fringe g/r ${fringeRatio / fringeN}", coreRatio / coreN > fringeRatio / fringeN + 0.1)
    }

    @Test
    fun redLedImprintBurnsRedOrangeInBottomRight() {
        val width = 400
        val height = 300
        val text = "'26 11 13"

        val topBand = ShortArray(width * 100 * 3)
        DateStamp.imprint(topBand, width, height, bandY = 0, bandRows = 100, text = text, style = DateStampStyle.RED_LED)
        assertTrue("Top band should stay completely untouched", topBand.all { it == 0.toShort() })

        val bottomBand = ShortArray(width * 100 * 3)
        DateStamp.imprint(bottomBand, width, height, bandY = 200, bandRows = 100, text = text, style = DateStampStyle.RED_LED)

        var redLedCorePixels = 0
        for (py in 0 until 100) {
            for (px in width / 2 until width) {
                val idx = (py * width + px) * 3
                val r = bottomBand[idx].toInt() and 0xFFFF
                val g = bottomBand[idx + 1].toInt() and 0xFFFF
                val b = bottomBand[idx + 2].toInt() and 0xFFFF
                if (r > 50_000 && g in 10_000..28_000 && b < 8_000 && r > g && g > b) {
                    redLedCorePixels++
                }
            }
        }
        assertTrue("Expected red-orange 7-segment pixels in bottom-right corner, found $redLedCorePixels", redLedCorePixels > 20)
    }
}
