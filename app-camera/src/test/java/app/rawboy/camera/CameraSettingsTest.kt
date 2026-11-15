package app.rawboy.camera

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.develop.DevelopParams
import app.rawboy.export.DateStampFormat
import app.rawboy.export.DateStampStyle
import app.rawboy.export.Pentax645Field
import app.rawboy.export.PhotoFrame
import app.rawboy.export.TimeStampFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CameraSettingsTest {
    @Test
    fun defaultsHaveFramesDisabled() {
        val s = CameraSettings()
        assertEquals(PhotoFrame.NONE, s.photoFrame)
        assertEquals(PhotoFrame.PENTAX_645, s.lastPhotoFrame)
        assertEquals(DateStampFormat.DMY, s.dateStampFormat)
        assertEquals(DateStampStyle.CLASSIC, s.dateStampStyle)
        assertEquals(TimeStampFormat.H24, s.timeStampFormat)
        assertFalse(s.pentax645Flip)
        assertEquals(Pentax645Field.DEFAULT, s.pentax645Fields)
        assertEquals(Pentax645Field.DEFAULT_ORDER, s.pentax645Order)
        val subset = setOf(Pentax645Field.SHUTTER, Pentax645Field.ISO, Pentax645Field.DATE, Pentax645Field.TIME)
        assertEquals(subset, Pentax645Field.parseSet(Pentax645Field.serialize(subset)))
        // Legacy "datetime" key migrates to both DATE and TIME.
        assertEquals(setOf(Pentax645Field.DATE, Pentax645Field.TIME), Pentax645Field.parseSet("datetime"))
        val customOrder = listOf(Pentax645Field.TIME, Pentax645Field.DATE, Pentax645Field.FRAME_NUMBER)
        val parsedOrder = Pentax645Field.parseOrder(Pentax645Field.serializeOrder(customOrder))
        assertEquals(Pentax645Field.entries.size, parsedOrder.size)
        assertEquals(customOrder, parsedOrder.take(3))
    }

    @Test
    fun grainIsOnByDefaultAndOffRemovesIt() {
        val base = DevelopParams(grain = 20f, filmGrain = 75f)
        val on = CameraSettings()
        assertEquals(true, on.grain)
        val off = on.copy(grain = false).develop(base, false, neutralPlatform.noise)
        assertEquals(0f, off.grain, 0f)
        assertEquals(0f, off.filmGrain, 0f)
    }

    @Test
    fun resetToDefaultsKeepsCalibration() {
        val scales = mapOf("W" to 0.42f, "FW" to 0.6f)
        val guides = mapOf("W" to 12.5f)
        val modified = CameraSettings(
            jpegQuality = 80,
            strength = 50f,
            brightness = 20f,
            warmth = -15f,
            mono = true,
            film = false,
            keepDng = true,
            smallExport = false,
            rememberLast = true,
            showGrid = true,
            showLevel = true,
            showHistogram = true,
            grain = false,
            scanQr = false,
            photoFrame = PhotoFrame.PENTAX_645,
            front = true,
            lens = "T",
            previewScales = scales,
            flashGuides = guides,
        )
        val reset = modified.resetToDefaults()
        assertEquals(CameraSettings(previewScales = scales, flashGuides = guides), reset)
        assertEquals(scales, reset.previewScales)
        assertEquals(guides, reset.flashGuides)
    }
}
