package app.rawboy.gl

import org.junit.Assert.assertEquals
import org.junit.Test

class ScanScaleTest {
    @Test
    fun aFilmScanIsOneAndAHalfTimesTheOutput() {
        assertEquals(1.5f, ScanScale.SCALE, 0f)
        assertEquals(Pair(9312, 12420), ScanScale.size(6208, 8280))
        assertEquals(Pair(1502, 1001), ScanScale.size(1001, 667))
    }

    @Test
    fun aScaledRenderSpansThePhotoInFractionsOfAPixel() {
        val plain = SampleGeometry(100, 100, PixelRect(10, 10, 100, 100), PixelRect(5, 6, 64, 32), 1000, 800)
        assertEquals(listOf(5f, 6f, 64f, 32f), plain.outputF.toList())
        val scan = SampleGeometry(150, 150, PixelRect(10, 10, 100, 100), PixelRect(1024, 512, 1024, 512), 1000, 800, 1f, 1.5f)
        assertEquals(1024f / 1.5f, scan.outputF[0], 1e-3f)
        assertEquals(512f / 1.5f, scan.outputF[1], 1e-3f)
        assertEquals(1024f / 1.5f, scan.outputF[2], 1e-3f)
    }
}
