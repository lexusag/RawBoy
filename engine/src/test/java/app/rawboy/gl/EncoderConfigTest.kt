package app.rawboy.gl

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** The encoder surface's default attempts are the two it always made: recordable RGBA8888, then the context's config. */
class EncoderConfigTest {
    @Test
    fun defaultOrderIsRecordableThenContext() {
        assertEquals(listOf(EncoderConfig.RECORDABLE_RGBA8888, EncoderConfig.CONTEXT), EncoderConfig.DEFAULT_ORDER)
    }

    @Test
    fun recordableAttribsAsBefore() {
        // EGL14's values as literals, so the test also catches a changed constant.
        val expected = intArrayOf(
            0x3040, 0x40, // EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT
            0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, // EGL_RED/GREEN/BLUE/ALPHA_SIZE
            0x3033, 0x0004, // EGL_SURFACE_TYPE, EGL_WINDOW_BIT
            0x3142, 1, // EGL_RECORDABLE_ANDROID
            0x3038, // EGL_NONE
        )
        assertArrayEquals(expected, EncoderConfig.recordableRgba8888Attribs())
    }
}
