package app.rawboy.gl

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RawPreviewFramesTest {
    private val identity = doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    private val black = floatArrayOf(64f, 64f, 64f, 64f)
    private val neutral = floatArrayOf(1f, 1f, 1f)

    private fun offerFrame(frames: RawPreviewFrames, timestampNs: Long) {
        val plane = ByteBuffer.allocateDirect(4 * 4 * 2).order(ByteOrder.nativeOrder())
        frames.offer(
            plane = plane,
            width = 4,
            height = 4,
            rowStride = 8,
            cfa = 0,
            black = black,
            white = 1023f,
            neutral = neutral,
            colorRowMajor = identity,
            extraBlack = 0f,
            shading = null,
            shadingCols = 0,
            shadingRows = 0,
            timestampNs = timestampNs,
        )
    }

    @Test
    fun pausedDropsIncomingFramesAndRecyclesQueuedFrame() {
        val frames = RawPreviewFrames(poolSize = 2)
        var notifications = 0
        frames.onFrame = { notifications++ }

        offerFrame(frames, 100L)
        assertEquals(1L, frames.copied)
        assertEquals(1, notifications)

        // Pausing recycles the waiting frame and skips subsequent offers.
        frames.paused = true
        assertNull(frames.take())

        offerFrame(frames, 200L)
        offerFrame(frames, 300L)
        assertEquals(1L, frames.copied)
        assertEquals(0L, frames.dropped)
        assertEquals(1, notifications)
        assertNull(frames.take())

        // Resuming accepts new frames again using the recycled pool.
        frames.paused = false
        offerFrame(frames, 400L)
        assertEquals(2L, frames.copied)
        assertEquals(2, notifications)
        val taken = frames.take()
        assertNotNull(taken)
        assertEquals(400L, taken!!.timestampNs)
        frames.recycle(taken)
    }
}
