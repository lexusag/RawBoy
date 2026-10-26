package app.rawboy.camera.qr

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToInt

class QrReaderTest {
    /**
     * A [width] x [height] grey frame as ViewfinderRenderer's LumaProgram makes it (y / (y + 0.06) of raw units): a
     * dim scene with the code [side] px wide at ([x], [y]), black modules at [dark] and white ones at [light].
     */
    private fun frame(
        text: String, width: Int, height: Int, side: Int, x: Int, y: Int,
        dark: Float = 0.01f, light: Float = 0.12f, mirror: Boolean = false,
    ): ByteArray {
        val bits = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, side, side, mapOf(EncodeHintType.MARGIN to 2))
        fun grey(v: Float) = (v / (v + 0.06f) * 255f).roundToInt().toByte()
        val out = ByteArray(width * height) { grey(0.03f) }
        for (j in 0 until side) for (i in 0 until side) {
            val px = if (mirror) side - 1 - i else i
            out[(y + j) * width + x + px] = grey(if (bits[i, j]) dark else light)
        }
        return out
    }

    @Test
    fun readsACodeAFifthOfTheFrame() {
        val text = "https://example.com/rawboy"
        assertEquals(text, QrReader.read(1280, 960, frame(text, 1280, 960, 256, 500, 300)))
    }

    @Test
    fun readsASmallCode() {
        val text = "WIFI:T:WPA;S:Home;P:correct horse;;"
        assertEquals(text, QrReader.read(1280, 960, frame(text, 1280, 960, 96, 100, 700)))
    }

    @Test
    fun readsTheSelfieCamerasMirrorImage() {
        val text = "https://example.com/selfie"
        assertEquals(text, QrReader.read(1280, 960, frame(text, 1280, 960, 300, 400, 200, mirror = true)))
    }

    @Test
    fun noCode() {
        assertNull(QrReader.read(640, 480, ByteArray(640 * 480) { ((it * 31) % 251).toByte() }))
    }

    @Test
    fun tracker() {
        val t = QrTracker(holdMs = 1000)
        assertTrue(t.update("https://a.test", 0))
        assertFalse(t.update(null, 500)) // a missed read: still shown
        assertEquals("a.test", t.shown?.label)
        assertTrue(t.update(null, 1600))
        assertNull(t.shown)
        t.update("https://a.test", 2000)
        t.dismiss(2100)
        assertNull(t.shown)
        assertFalse(t.update("https://a.test", 2500)) // dismissed while it stays in view
        assertTrue(t.update("https://b.test", 2600)) // another code shows
        t.update(null, 4000)
        assertTrue(t.update("https://a.test", 4100)) // back after leaving the view
    }
}
