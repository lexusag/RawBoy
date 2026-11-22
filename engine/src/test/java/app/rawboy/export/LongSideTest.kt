package app.rawboy.export

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LongSideTest {
    @Test
    fun takesWholePixelsInRange() {
        assertEquals(1600, ExportSettings.parseLongSide("1600"))
        assertEquals(64, ExportSettings.parseLongSide(" 64 "))
        assertEquals(20_000, ExportSettings.parseLongSide("20000"))
    }

    @Test
    fun refusesBlanksTextFractionsAndOutOfRange() {
        for (bad in listOf("", "  ", "abc", "63", "20001", "-5", "12.5", "1e3", "٣٠٠٠", "1,600", "9999999")) {
            assertNull(bad, ExportSettings.parseLongSide(bad))
        }
    }
}
