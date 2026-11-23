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
    fun mapsTheToolCanvasPerExtendedSide() {
        val sides = ExtendSides(left = true, bottom = true)
        val v = CropMath.extendedView(sides)
        assertEquals(CropRect(-CropMath.MAX_EXTEND, 0f, 1f, 1f + CropMath.MAX_EXTEND), v)
        assertEquals(CropMath.MAX_EXTEND / (1f + CropMath.MAX_EXTEND), CropMath.toView(frame, sides).left, 1e-6f)
        assertEquals(0f, CropMath.toView(frame, sides).top, 1e-6f)
        val c = CropRect(-0.2f, 0.1f, 0.9f, 1.1f)
        val back = CropMath.fromView(CropMath.toView(c, sides), sides)
        assertEquals(c.left, back.left, 1e-5f)
        assertEquals(c.bottom, back.bottom, 1e-5f)
        assertEquals(sides, c.sides)
        assertEquals(CropRect(-0.2f, 0f, 1f, 1.2f), CropMath.within(CropRect(-0.2f, -0.2f, 1.2f, 1.2f), sides))
    }

    @Test
    fun keepsACropAspectInsideTheExtendedSides() {
        val r = CropMath.withAspect(frame, 1.0, 1000, 1000, ExtendSides(left = true))
        assertTrue(r.top >= 0f)
        assertTrue(r.right <= 1f)
        assertTrue(r.left >= -CropMath.MAX_EXTEND)
    }

    @Test
    fun sticksToThePhotoEdgeAndLetsGoPastThePull() {
        val snap = CropSnap(CropRect(0.1875f, 0.1875f, 0.8125f, 0.8125f), 0.01f, 0.01f)
        val start = CropRect(0.3f, 0.3f, 0.7f, 0.7f)
        assertEquals(0.2f, CropMath.drag(start, CropMath.Handle.LEFT, -0.1f, 0f, null, 1000, 1000, snap = snap).left, 1e-5f)
        assertEquals(0.1875f, CropMath.drag(start, CropMath.Handle.LEFT, -0.1075f, 0f, null, 1000, 1000, snap = snap).left, 1e-5f)
        val moved = CropMath.drag(CropRect(0.25f, 0.3f, 0.7f, 0.7f), CropMath.Handle.MOVE, 0.1085f, 0f, null, 1000, 1000, snap = snap)
        assertEquals(0.8125f, moved.right, 1e-5f)
        assertEquals(0.45f, moved.width, 1e-5f)
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
