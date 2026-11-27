package app.rawboy.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PreviewOrientationTest {

    @Test
    fun inverseRoundTripsEveryExifOrientation() {
        val w = 5
        val h = 3
        // Distinct RGB per pixel in 16-bit unsigned form (exact 8-bit multiples so to8/expand is lossless).
        val upright8 = ByteArray(w * h * 3) { i -> ((i * 17 + 13) % 256).toByte() }
        val upright16 = ShortArray(w * h * 3) { i -> ((upright8[i].toInt() and 0xff) * 257).toShort() }

        for (o in 1..8) {
            val inv = PreviewOrientation.inverse(o)
            val (sw, sh) = PreviewOrientation.outputSize(w, h, inv)
            val sensor8 = ByteArray(sw * sh * 3)

            // Stream in uneven bands (rows 0..0, 1..2) to match Exporter.renderOutput.
            val band0 = upright16.copyOfRange(0, w * 3)
            val band1 = upright16.copyOfRange(w * 3, w * h * 3)
            PreviewOrientation.scatterBandToRgb8(band0, y = 0, rows = 1, srcWidth = w, srcHeight = h, orientation = inv, dst = sensor8)
            PreviewOrientation.scatterBandToRgb8(band1, y = 1, rows = 2, srcWidth = w, srcHeight = h, orientation = inv, dst = sensor8)

            // Applying the DNG's IFD0 orientation `o` to the sensor-oriented preview must recover the upright image.
            val (rw, rh) = PreviewOrientation.outputSize(sw, sh, o)
            assertEquals("width for orientation $o", w, rw)
            assertEquals("height for orientation $o", h, rh)

            val sensor16 = ShortArray(sensor8.size) { i -> ((sensor8[i].toInt() and 0xff) * 257).toShort() }
            val recovered = ByteArray(w * h * 3)
            PreviewOrientation.scatterBandToRgb8(sensor16, y = 0, rows = sh, srcWidth = sw, srcHeight = sh, orientation = o, dst = recovered)
            assertArrayEquals("round-trip failed for orientation $o (inv=$inv)", upright8, recovered)
        }
    }

    @Test
    fun portraitOrientation6TurnsPreviewLandscape() {
        // A 3x4 upright portrait preview for a DNG with IFD0 Orientation=6 (Rotate 90 CW)
        // must be stored as 4x3 (rotated 90 CCW) so the viewer's 90 CW rotation stands it upright.
        val inv = PreviewOrientation.inverse(6)
        assertEquals(8, inv)
        assertEquals(4 to 3, PreviewOrientation.outputSize(3, 4, inv))
    }

    @Test
    fun outOfRangeOrientationDefaultsToNormal() {
        assertEquals(1, PreviewOrientation.inverse(0))
        assertEquals(1, PreviewOrientation.inverse(9))
        assertEquals(1, PreviewOrientation.inverse(-1))
    }
}
