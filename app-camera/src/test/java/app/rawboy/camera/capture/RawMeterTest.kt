package app.rawboy.camera.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.log2

class RawMeterTest {
    private val black = floatArrayOf(64f, 64f, 64f, 64f)
    private val white = 1023f

    /** A grey patch: each channel at [level] of the white range before white balance ([neutral] per channel). */
    private fun grey(cfa: Int, level: Float, neutral: FloatArray): (Int, Int) -> Int {
        val colours = when (cfa) {
            0 -> intArrayOf(0, 1, 1, 2)
            1 -> intArrayOf(1, 0, 2, 1)
            2 -> intArrayOf(1, 2, 0, 1)
            else -> intArrayOf(2, 1, 1, 0)
        }
        return { x, y -> (64f + level * neutral[colours[(y and 1) * 2 + (x and 1)]] * 959f).toInt() }
    }

    @Test
    fun neutralGreyReadsAsDecoded() {
        // A grey the camera sees as the as-shot neutral: every channel decodes to green × min(neutral) / ... — LibRaw's
        // multipliers are normalised to the largest, so the decoded grey is the green fraction × the smallest neutral.
        val neutral = floatArrayOf(0.663f, 1f, 0.496f)
        for (cfa in 0..3) {
            val key = RawMeter.key(400, 300, cfa, black, white, neutral, 0.5f, sample = grey(cfa, 0.2f, neutral))!!
            // channel c's raw fraction = 0.2 × neutral[c]; × mul[c] = (1 / neutral[c]) / (1 / 0.496) → 0.2 × 0.496.
            assertEquals("cfa $cfa", 0.2f * 0.496f, key, 0.002f)
        }
    }

    @Test
    fun cellAveragingKeepsNoiseFromPullingTheKeyDown() {
        val neutral = floatArrayOf(1f, 1f, 1f)
        // Alternating ±20 DN around a dark level: point samples at the floor would drag a per-pixel log mean far down.
        val key = RawMeter.key(256, 256, 0, black, white, neutral, 0.5f) { x, y -> 64 + 20 + if ((x + y / 2) % 2 == 0) 20 else -20 }!!
        assertEquals(log2(20f / 959f), log2(key), 0.05f)
    }

    @Test
    fun unknownLayoutsGiveNull() {
        assertNull(RawMeter.key(64, 64, 4, black, white, floatArrayOf(1f, 1f, 1f), 0.5f) { _, _ -> 100 })
        assertNull(RawMeter.key(64, 64, 0, black, 60f, floatArrayOf(1f, 1f, 1f), 0.5f) { _, _ -> 100 })
        assertNull(RawMeter.key(64, 64, 0, black, white, floatArrayOf(0f, 1f, 1f), 0.5f) { _, _ -> 100 })
    }
}
