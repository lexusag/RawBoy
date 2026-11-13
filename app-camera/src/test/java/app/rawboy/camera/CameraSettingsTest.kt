package app.rawboy.camera

import app.rawboy.develop.DevelopParams
import app.rawboy.export.DateStampFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

class CameraSettingsTest {
    @Test
    fun defaultsHaveDateStampDisabled() {
        val s = CameraSettings()
        assertFalse(s.dateStamp)
        assertEquals(DateStampFormat.DMY, s.dateStampFormat)
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
