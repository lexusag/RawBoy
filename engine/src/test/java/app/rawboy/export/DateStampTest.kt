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
        assertEquals("'26 11 13", DateStamp.format(cal.timeInMillis, tz))

        cal.set(2026, Calendar.MARCH, 5, 0, 0, 0)
        assertEquals("'26 03 05", DateStamp.format(cal.timeInMillis, tz))
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
    fun imprintStandsOutOnPureWhiteBackground() {
        val width = 400
        val height = 300
        val bottomBand = ShortArray(width * 100 * 3) { 0xFFFF.toShort() }
        DateStamp.imprint(bottomBand, width, height, bandY = 200, bandRows = 100, text = "'26 11 13")

        var tintedPixels = 0
        for (py in 0 until 100) {
            for (px in width / 2 until width) {
                val idx = (py * width + px) * 3
                val r = bottomBand[idx].toInt() and 0xFFFF
                val g = bottomBand[idx + 1].toInt() and 0xFFFF
                val b = bottomBand[idx + 2].toInt() and 0xFFFF
                if (r > 60_000 && g in 40_000..58_000 && b < 20_000) {
                    tintedPixels++
                }
            }
        }
        assertTrue("Expected readable yellow-orange digits over white background, found $tintedPixels", tintedPixels > 20)
    }
}
