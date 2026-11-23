package app.rawboy.develop

import app.rawboy.lens.LensInfo
import app.rawboy.lens.LensTransform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Extend canvas (the same cases as web's engine.test.ts): a crop may reach MAX_EXTEND past the frame, and the canvas is filled. */
class ExtendCropTest {
    private val frame = CropMath.FULL

    @Test
    fun staysInsideTheFrameUnlessExtending() {
        assertEquals(frame, CropMath.drag(frame, CropMath.Handle.LEFT, -0.5f, 0f, null, 1000, 800))
        val e = CropMath.drag(frame, CropMath.Handle.LEFT, -0.5f, 0f, null, 1000, 800, extend = true)
        assertEquals(-CropMath.MAX_EXTEND, e.left, 1e-6f)
        assertTrue(e.extendsFrame)
        val m = CropMath.drag(frame, CropMath.Handle.MOVE, 0.9f, -0.9f, null, 1000, 800, extend = true)
        assertEquals(CropMath.MAX_EXTEND, m.left, 1e-6f)
        assertEquals(-CropMath.MAX_EXTEND, m.top, 1e-6f)
        assertEquals(1f, m.right - m.left, 1e-6f)
    }

    @Test
    fun keepsTheAspectRatioWhenACornerIsDraggedOut() {
        val r = CropMath.drag(frame, CropMath.Handle.BOTTOM_RIGHT, 0.2f, 0.2f, 1.5, 1500, 1000, extend = true)
        assertEquals(1.5, (r.width * 1500.0) / (r.height * 1000.0), 1e-3)
        assertTrue(r.right > 1f)
    }

    @Test
    fun mapsToAndFromTheToolCanvas() {
        val c = CropRect(-0.2f, 0.1f, 1.1f, 0.9f)
        val back = CropMath.fromView(CropMath.toView(c))
        assertEquals(c.left, back.left, 1e-5f)
        assertEquals(c.bottom, back.bottom, 1e-5f)
        assertTrue(CropMath.toView(frame).left > 0f)
    }

    @Test
    fun anExtendedCropIsLargerThanTheFrameAndAsksForTheFill() {
        val info = LensInfo.none(6000, 4000)
        val t = LensTransform(info, DevelopParams().withCrop(CropRect(-0.1f, 0f, 1.1f, 1f)))
        assertEquals(7200, t.outputWidth)
        assertEquals(-600, t.cropRect.x)
        assertTrue(t.fillOutside)
        assertFalse(LensTransform(info, DevelopParams()).fillOutside)
        assertEquals(-600.0, t.source(0.0, 2000.0)[0], 1e-3)
    }
}
