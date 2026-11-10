package app.rawboy.lens

import kotlin.math.hypot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The circle finder (same cases as web's engine.test.ts). */
class FisheyeCircleTest {
    private fun disc(w: Int, h: Int, cx: Double, cy: Double, r: Double, inside: Float) =
        FloatArray(w * h) { i -> if (hypot(i % w + 0.5 - cx, i / w + 0.5 - cy) < r) inside else 0.0005f }

    @Test fun findsAnOffsetDisc() {
        val c = FisheyeCircle.detect(disc(512, 340, 270.0, 165.0, 150.0, 0.2f), 512, 340)
        assertNotNull(c)
        assertEquals((270.0 - 256) / 512, c!!.offsetX, 0.01)
        assertEquals((165.0 - 170) / 340, c.offsetY, 0.01)
        assertEquals(150.0 * 0.97 / hypot(256.0, 170.0), c.radius, 0.01)
    }

    @Test fun frameFillingPhotoIsNotACircle() {
        assertNull(FisheyeCircle.detect(FloatArray(512 * 340) { 0.2f }, 512, 340))
    }
}
