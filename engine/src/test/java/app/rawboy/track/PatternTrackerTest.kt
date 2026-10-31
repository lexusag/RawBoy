package app.rawboy.track

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** The camera's subject tracker on synthetic frames (the same cases as iOS's PatternTrackerTests). */
class PatternTrackerTest {
    private val w = 320
    private val h = 240

    /** A textured 3x3-smoothed noise image, as a busy background or subject. */
    private fun texture(seed: Int, tw: Int, th: Int): IntArray {
        val r = Random(seed)
        val raw = IntArray(tw * th) { r.nextInt(256) }
        return IntArray(tw * th) { i ->
            val x = i % tw
            val y = i / tw
            var s = 0
            var n = 0
            for (dy in -1..1) for (dx in -1..1) {
                val xx = x + dx
                val yy = y + dy
                if (xx in 0 until tw && yy in 0 until th) {
                    s += raw[yy * tw + xx]
                    n++
                }
            }
            s / n
        }
    }

    private val background = texture(1, w, h)
    private val subject = texture(2, 40, 40)

    /** The background with the subject's top left at ([sx], [sy]); [gain] scales the whole frame (exposure). */
    private fun frame(sx: Int, sy: Int, gain: Float = 1f, covered: Boolean = false): ByteArray {
        val out = ByteArray(w * h)
        for (y in 0 until h) for (x in 0 until w) {
            val inside = x - sx in 0 until 40 && y - sy in 0 until 40
            val v = when {
                inside && covered -> 128
                inside -> subject[(y - sy) * 40 + x - sx]
                else -> background[y * w + x]
            }
            out[y * w + x] = (v * gain).toInt().coerceIn(0, 255).toByte()
        }
        return out
    }

    @Test
    fun followsAMovingSubject() {
        val t = PatternTracker()
        var sx = 60
        val sy = 100
        assertTrue(t.start(w, h, frame(sx, sy), (sx + 20f) / w, (sy + 20f) / h, 0))
        for (i in 1..25) {
            sx += 7
            val r = assertNotNullResult(t.update(w, h, frame(sx, sy + i), i * 66L))
            assertFalse(r.lost)
            assertEquals((sx + 20f) / w, r.x, 2f / w)
            assertEquals((sy + i + 20f) / h, r.y, 2f / h)
        }
    }

    @Test
    fun keepsFollowingThroughAnExposureChange() {
        val t = PatternTracker()
        assertTrue(t.start(w, h, frame(100, 80), 120f / w, 100f / h, 0))
        val r = assertNotNullResult(t.update(w, h, frame(104, 82, gain = 0.6f), 66))
        assertFalse(r.lost)
        assertEquals(124f / w, r.x, 2f / w)
        assertEquals(102f / h, r.y, 2f / h)
    }

    @Test
    fun aPlainPatchIsNotFollowed() {
        val flat = ByteArray(w * h) { 90 }
        val t = PatternTracker()
        assertFalse(t.start(w, h, flat, 0.5f, 0.5f, 0))
        assertFalse(t.active)
    }

    @Test
    fun holdsThroughABriefOcclusionThenLoses() {
        val t = PatternTracker()
        assertTrue(t.start(w, h, frame(100, 80), 120f / w, 100f / h, 0))
        val held = assertNotNullResult(t.update(w, h, frame(100, 80, covered = true), 100))
        assertFalse(held.lost)
        assertEquals(120f / w, held.x, 1f / w)
        // Back in view within the grace time: found again.
        val back = assertNotNullResult(t.update(w, h, frame(103, 80), 300))
        assertFalse(back.lost)
        assertTrue(back.score > PatternTracker.MIN_SCORE)
        // Covered for longer than LOST_AFTER_MS: lost, and nothing is followed any more.
        assertFalse(assertNotNullResult(t.update(w, h, frame(103, 80, covered = true), 400)).lost)
        assertTrue(assertNotNullResult(t.update(w, h, frame(103, 80, covered = true), 800)).lost)
        assertFalse(t.active)
    }

    @Test
    fun aDifferentFrameSizeIsLost() {
        val t = PatternTracker()
        assertTrue(t.start(w, h, frame(100, 80), 120f / w, 100f / h, 0))
        assertTrue(assertNotNullResult(t.update(160, 120, ByteArray(160 * 120), 66)).lost)
        assertFalse(t.active)
    }

    private fun assertNotNullResult(r: PatternTracker.Result?): PatternTracker.Result {
        assertNotNull(r)
        return r!!
    }
}
