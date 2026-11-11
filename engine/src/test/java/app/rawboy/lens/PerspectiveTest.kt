package app.rawboy.lens

import app.rawboy.color.Mat3
import app.rawboy.develop.CropMath
import app.rawboy.develop.DevelopParams
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pro's perspective sliders (the same cases as web's engine.test.ts). */
class PerspectiveTest {
    private val info = LensInfo.none(6000, 4000)

    @Test
    fun offIsThePlainAffineMap() {
        assertArrayEquals(LensTransform(info, DevelopParams()).outToImage, LensTransform(info, DevelopParams(perspectiveVertical = 0f)).outToImage, 0.0)
    }

    @Test
    fun keepsTheCentreAndAutoCropsToRealPicture() {
        for ((v, h) in listOf(-60f to 0f, 45f to 0f, 0f to -70f, 0f to 100f, -100f to 100f, 35f to -25f)) {
            val lens = LensTransform(info, DevelopParams(perspectiveVertical = v, perspectiveHorizontal = h, straighten = 4f))
            val w = lens.outputWidth.toDouble()
            val ht = lens.outputHeight.toDouble()
            assertArrayEquals(doubleArrayOf(3000.0, 2000.0), lens.source(w / 2, ht / 2), 1e-6)
            var slack = Double.MAX_VALUE
            for (i in 0..20) {
                val t = i / 20.0
                for ((x, y) in listOf(t * w to 0.0, t * w to ht, 0.0 to t * ht, w to t * ht)) {
                    val (sx, sy) = lens.source(x, y).let { it[0] to it[1] }
                    assertTrue(sx > -1e-3 && sy > -1e-3 && sx < 6000 + 1e-3 && sy < 4000 + 1e-3)
                    slack = minOf(slack, sx, sy, 6000 - sx, 4000 - sy)
                }
            }
            assertTrue("crop is tight: $slack", slack < 0.5)
        }
    }

    @Test
    fun straightensConvergingLines() {
        // Vertical below 0 widens the top.
        val up = LensTransform(info, DevelopParams(perspectiveVertical = -50f))
        fun spread(y: Double) = up.source(up.outputWidth * 0.75, y)[0] - up.source(up.outputWidth * 0.25, y)[0]
        assertTrue(spread(0.0) < spread(up.outputHeight.toDouble()) * 0.9)
        val s = up.source(1000.0, 100.0)
        assertEquals(1000.0, LensTransform.project(Mat3.inverse(up.outToImage), s[0], s[1])[0], 1e-6)
        // Horizontal above 0 widens the right side.
        val right = LensTransform(info, DevelopParams(perspectiveHorizontal = 50f))
        fun tall(x: Double) = right.source(x, right.outputHeight * 0.75)[1] - right.source(x, right.outputHeight * 0.25)[1]
        assertTrue(tall(right.outputWidth.toDouble()) < tall(0.0) * 0.9)
    }

    @Test
    fun turnsAndMirrorsWithThePicture() {
        for (rotation in 0..3) {
            for ((v, h) in listOf(-40f to 0f, 0f to 55f)) {
                val before = DevelopParams(rotation = rotation, perspectiveVertical = v, perspectiveHorizontal = h, straighten = 3f)
                val a = LensTransform(info, before)
                val b = LensTransform(info, CropMath.rotatePerspective(before.copy(rotation = (rotation + 1) % 4), 1))
                assertEquals(a.outputHeight, b.outputWidth)
                assertEquals(a.outputWidth, b.outputHeight)
                // Clockwise: output (x, y) moves to (height - y, x).
                for ((x, y) in listOf(0.0 to 0.0, a.outputWidth.toDouble() to 0.0, 137.5 to 401.25)) {
                    assertArrayEquals(a.source(x, y), b.source(a.outputHeight - y, x), 1e-6)
                }
                assertEquals(before, CropMath.rotatePerspective(CropMath.rotatePerspective(before, 1), -1))
                for (vertical in listOf(false, true)) {
                    val f = LensTransform(info, CropMath.flip(before, vertical))
                    for ((x, y) in listOf(0.0 to 0.0, a.outputWidth.toDouble() to 0.0, 137.5 to 401.25)) {
                        val mx = if (vertical) x else a.outputWidth - x
                        val my = if (vertical) a.outputHeight - y else y
                        assertArrayEquals(a.source(x, y), f.source(mx, my), 1e-6)
                    }
                }
            }
        }
    }
}
