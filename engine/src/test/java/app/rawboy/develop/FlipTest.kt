package app.rawboy.develop

import app.rawboy.lens.LensInfo
import app.rawboy.lens.LensTransform
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pro's flips (the same cases as web's engine.test.ts): a mirror of the picture as shown, crop and straighten included. */
class FlipTest {
    private val info = LensInfo.none(6000, 4000)

    @Test
    fun flipsMirrorThePictureAsShown() {
        for (rotation in 0..3) {
            for (vertical in listOf(false, true)) {
                val before = DevelopParams(lensDistortion = 40f, lensAnamorphic = -35f, lensCrop = -20f, straighten = 7.5f, rotation = rotation)
                    .withCrop(CropRect(0.1f, 0.2f, 0.5f, 0.9f))
                val a = LensTransform(info, before)
                val b = LensTransform(info, CropMath.flip(before, vertical))
                assertEquals(a.outputWidth, b.outputWidth)
                assertEquals(a.outputHeight, b.outputHeight)
                // Crop edges round to whole pixels, so allow a pixel's worth.
                for ((x, y) in listOf(0.0 to 0.0, a.outputWidth.toDouble() to 0.0, 137.5 to 401.25)) {
                    val mx = if (vertical) x else a.outputWidth - x
                    val my = if (vertical) a.outputHeight - y else y
                    assertArrayEquals(a.source(x, y), b.source(mx, my), 1.0)
                }
                // Twice is no flip.
                assertArrayEquals(a.outToImage, LensTransform(info, CropMath.flip(CropMath.flip(before, vertical), vertical)).outToImage, 1e-9)
            }
        }
    }

    @Test
    fun aSidewaysTurnSwapsTheAxis() {
        val plain = LensTransform(info, CropMath.flip(DevelopParams(), false))
        assertTrue(plain.flipHorizontal)
        assertArrayEquals(doubleArrayOf(5900.0, 50.0), plain.source(100.0, 50.0), 1e-6)
        assertTrue(CropMath.flip(DevelopParams(rotation = 1), false).flipVertical)
    }

    @Test
    fun scalePreservesResolutionAndZoomsAroundCenter() {
        val unscaled = LensTransform(info, DevelopParams())
        val scaled = LensTransform(info, DevelopParams(scale = 150f))
        assertEquals(unscaled.outputWidth, scaled.outputWidth)
        assertEquals(unscaled.outputHeight, scaled.outputHeight)
        val cx = unscaled.outputWidth / 2.0
        val cy = unscaled.outputHeight / 2.0
        assertArrayEquals(unscaled.source(cx, cy), scaled.source(cx, cy), 1e-6)
        val s1 = scaled.source(cx + 150.0, cy)
        val s0 = unscaled.source(cx + 100.0, cy)
        assertArrayEquals(s0, s1, 1e-6)
    }

    @Test
    fun anamorphicDistortionBowsVerticalsWhileKeepingHorizontalsStraightAndAdjustableCropZooms() {
        val auto = LensTransform(info, DevelopParams(lensAnamorphic = -60f))
        assertFalse(auto.clipFrame)
        assertTrue(auto.zoom > 1.0)
        // Horizontals keep constant source y when radial distortion is 0.
        val y0 = auto.source(1000.0, 500.0)[1]
        assertEquals(y0, auto.source(3000.0, 500.0)[1], 1e-9)
        assertEquals(y0, auto.source(5000.0, 500.0)[1], 1e-9)
        // Off-centre verticals bow horizontally between vertical centre and top/bottom.
        assertTrue(auto.source(1000.0, 200.0)[0] != auto.source(1000.0, 2000.0)[0])
        // At Crop 0 no empty edges show.
        for ((x, y) in listOf(0.0 to 0.0, 6000.0 to 0.0, 0.0 to 2000.0, 3000.0 to 0.0)) {
            val s = auto.source(x, y)
            assertTrue(s[0] > -0.6 && s[0] < 6000.6 && s[1] > -0.6 && s[1] < 4000.6)
        }
        // Negative Crop zooms out and enables frame clipping; positive Crop zooms in tighter without clipping.
        val zoomedOut = LensTransform(info, DevelopParams(lensAnamorphic = -60f, lensCrop = -100f))
        assertTrue(zoomedOut.clipFrame)
        assertTrue(zoomedOut.zoom < auto.zoom)
        assertTrue(zoomedOut.source(0.0, 0.0)[0] < -10.0)
        val tighter = LensTransform(info, DevelopParams(lensAnamorphic = -60f, lensCrop = 100f))
        assertFalse(tighter.clipFrame)
        assertTrue(tighter.zoom > auto.zoom)
        // Positive pincushion + anamorphic stays monotone and invertible even when zoomed out.
        val extreme = LensTransform(info, DevelopParams(lensDistortion = 100f, lensAnamorphic = 100f, lensCrop = -100f, straighten = 6f, rotation = 1))
        var prev = Double.NEGATIVE_INFINITY
        for (i in 0..20) {
            val sx = LensTransform(info, DevelopParams(lensDistortion = 100f, lensAnamorphic = 100f, lensCrop = -100f)).source(i * 300.0, 200.0)[0]
            assertTrue(sx > prev)
            prev = sx
        }
        for ((x, y) in listOf(200.0 to 300.0, 1800.0 to 1200.0, 3500.0 to 5200.0)) {
            val s = extreme.source(x, y)
            assertArrayEquals(doubleArrayOf(x, y), extreme.output(s[0], s[1]), 1e-2)
        }
    }

    @Test
    fun cinemaCropAspectRatiosHaveLandscapeAndPortraitLabelsAndRatios() {
        assertEquals("2:1", CropAspect.R2_1.label(false))
        assertEquals("1:2", CropAspect.R2_1.label(true))
        assertEquals(2.0, CropAspect.R2_1.ratio(6000, 4000, false)!!, 1e-9)
        assertEquals(0.5, CropAspect.R2_1.ratio(6000, 4000, true)!!, 1e-9)
        assertEquals("2.39:1", CropAspect.R2_39.label(false))
        assertEquals("1:2.39", CropAspect.R2_39.label(true))
        assertEquals(2.39, CropAspect.R2_39.ratio(6000, 4000, false)!!, 1e-9)
        assertEquals(1.0 / 2.39, CropAspect.R2_39.ratio(6000, 4000, true)!!, 1e-9)
        val scope = CropMath.withAspect(CropMath.FULL, 2.39, 6000, 4000)
        assertEquals(0f, scope.left, 1e-6f)
        assertEquals(1f, scope.right, 1e-6f)
        assertEquals(2.39, ((scope.right - scope.left) * 6000.0) / ((scope.bottom - scope.top) * 4000.0), 1e-5)
    }

    @Test
    fun fisheyeStraighteningIsOffAtZeroAndFollowsTheEquidistantToRectilinearFormula() {
        val off = LensTransform(info, DevelopParams(lensFisheye = 0f))
        assertFalse(off.isGeometric)
        assertEquals(1.0, off.zoom, 0.0)
        val l = LensTransform(info, DevelopParams(lensFisheye = 100f, lensCrop = -100f))
        assertTrue(l.isGeometric)
        val half = Math.hypot(3000.0, 2000.0)
        val fe = half / (Math.PI / 2)
        val t = l.fisheyeT
        assertEquals(Math.toRadians(75.0) / (Math.PI / 2), t, 1e-9)
        val s = l.source(3000.0 + 900.0 * l.zoom, 2000.0 + 300.0 * l.zoom)
        val r = Math.hypot(900.0, 300.0)
        assertEquals(fe * Math.atan(t * r / fe) / t, Math.hypot(s[0] - 3000.0, s[1] - 2000.0), 1e-6)
        // The auto crop never stretches the picture along the radius more than 4x (stretch = 1 + x^2).
        for (circle in listOf(100f, 60f)) {
            val lens = LensTransform(info, DevelopParams(lensFisheye = 100f, lensFisheyeCircle = circle))
            val x = lens.fisheyeT * half / lens.zoom / lens.fisheyeFe
            assertTrue(1 + x * x <= 4.0 + 1e-9)
        }
        // Auto zoom keeps every output pixel on real image data, inside the circle of a circular fisheye.
        val circ = LensTransform(info, DevelopParams(lensFisheye = 60f, lensFisheyeCircle = 40f))
        for ((x, y) in listOf(0.0 to 0.0, 6000.0 to 0.0, 0.0 to 4000.0, 6000.0 to 4000.0, 3000.0 to 0.0, 0.0 to 2000.0)) {
            val p = circ.source(x, y)
            assertTrue(Math.hypot(p[0] - 3000.0, p[1] - 2000.0) <= 0.4 * half + 0.5)
        }
        // Moving the circle moves the optical axis: the output centre samples the circle's centre.
        val moved = LensTransform(info, DevelopParams(lensFisheye = 60f, lensFisheyeX = 10f, lensFisheyeY = -5f))
        val mid = moved.source(3000.0, 2000.0)
        assertEquals(3600.0, mid[0], 1e-6)
        assertEquals(1800.0, mid[1], 1e-6)
    }
}
