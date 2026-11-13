package app.rawboy.camera

import app.rawboy.develop.DevelopParams
import app.rawboy.export.DateStampFormat
import app.rawboy.export.TimeStampFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

class CameraSettingsTest {
    @Test
    fun defaultsHaveFramesDisabled() {
        val s = CameraSettings()
        assertEquals(PhotoFrame.NONE, s.photoFrame)
        assertEquals(PhotoFrame.PENTAX_645, s.lastPhotoFrame)
        assertEquals(DateStampFormat.DMY, s.dateStampFormat)
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
    fun samsungGetsTheIspLook() {
        val base = DevelopParams()
        val p = CameraSettings.withPhoneIspLook(base, "samsung")
        assertEquals(base.contrast + CameraSettings.SAMSUNG_CONTRAST, p.contrast, 1e-4f)
        assertEquals(base.saturation + CameraSettings.SAMSUNG_SATURATION, p.saturation, 1e-4f)
    }

    @Test
    fun otherMakersAreUntouched() {
        val base = DevelopParams()
        assertSame(base, CameraSettings.withPhoneIspLook(base, "Google"))
    }

    @Test
    fun blackAndWhiteStaysGrey() {
        val p = CameraSettings.withPhoneIspLook(DevelopParams(saturation = -100f), "SAMSUNG")
        assertEquals(-100f, p.saturation, 0f)
    }
}
