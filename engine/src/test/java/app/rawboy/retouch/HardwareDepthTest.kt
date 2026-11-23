package app.rawboy.retouch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Unit tests for [HardwareDepth]: DEPTH16 conversion, orientation, and refusing frames with too little data. */
class HardwareDepthTest {

    private fun frame(w: Int, h: Int, mm: (Int, Int) -> Int): ByteBuffer {
        val buf = ByteBuffer.allocate(w * h * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (y in 0 until h) for (x in 0 until w) buf.putShort((y * w + x) * 2, ((7 shl 13) or mm(x, y)).toShort())
        return buf
    }

    @Test
    fun convertsDepth16AndFocusesOnTheRequestedPoint() {
        val w = 8
        val h = 6
        // Left half near (600 mm), right half far (3000 mm), full confidence.
        val depth = HardwareDepth.fromDepth16(
            frame(w, h) { x, _ -> if (x < w / 2) 600 else 3000 }, w, h, w * 2, focusX = 0.25f, focusY = 0.5f,
        )
        assertNotNull(depth)
        depth!!
        assertTrue(depth.hardware)
        assertEquals(w, depth.width)
        assertEquals(h, depth.height)
        assertTrue(depth.sampleAt(1, 3) < 0.2f)
        assertTrue(depth.sampleAt(w - 2, 3) > 0.8f)
        assertTrue(depth.focusDepth < 0.25f)
    }

    @Test
    fun exifOrientationTurnsTheMapUpright() {
        val w = 8
        val h = 4
        // Orientation 6 (turn 90 clockwise): 4 wide, 8 tall; the sensor's left edge ends up on top.
        val depth = HardwareDepth.fromDepth16(frame(w, h) { x, _ -> if (x < w / 2) 600 else 3000 }, w, h, w * 2, exifOrientation = 6)!!
        assertEquals(h, depth.width)
        assertEquals(w, depth.height)
        assertTrue(depth.sampleAt(1, 1) < depth.sampleAt(1, w - 2))
    }

    @Test
    fun refusesAFrameWithoutValidSamples() {
        val w = 8
        val h = 6
        assertNull(HardwareDepth.fromDepth16(frame(w, h) { _, _ -> 0 }, w, h, w * 2))
    }
}
