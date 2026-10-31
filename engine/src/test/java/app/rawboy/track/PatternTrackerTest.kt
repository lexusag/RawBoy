package app.rawboy.track

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.floor
import kotlin.math.max
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

    /** [img] box-blurred [radius] px each way (a box of that radius, repeated twice: soft shading). */
    private fun smooth(img: IntArray, radius: Int): IntArray {
        var cur = img
        repeat(2) {
            cur = IntArray(w * h) { i ->
                val x = i % w
                val y = i / w
                var s = 0
                var n = 0
                for (dy in -radius..radius) for (dx in -radius..radius) {
                    val xx = x + dx
                    val yy = y + dy
                    if (xx in 0 until w && yy in 0 until h) {
                        s += cur[yy * w + xx]
                        n++
                    }
                }
                s / n
            }
        }
        // Stretched back to a normal contrast.
        val lo = cur.min()
        val hi = cur.max()
        return IntArray(w * h) { (cur[it] - lo) * 255 / max(1, hi - lo) }
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

    @Test
    fun aSubjectLeavingTheFrameIsLostNotSwapped() {
        // A smooth room (soft shading, like walls and floor in a real frame) the subject leaves by the left edge; once
        // it's gone, something a bit like it (half its texture) sits where it was last seen.
        val soft = smooth(texture(4, w, h), 6)
        val other = texture(5, 40, 40)
        fun room(sx: Int, sy: Int) = ByteArray(w * h) { i ->
            val x = i % w
            val y = i / w
            val v = when {
                x - sx in 0 until 40 && y - sy in 0 until 40 -> subject[(y - sy) * 40 + x - sx]
                sx <= -40 && x - 2 in 0 until 40 && y - sy in 0 until 40 -> {
                    val k = (y - sy) * 40 + x - 2
                    (subject[k] * 3 + other[k] * 2) / 5
                }
                else -> soft[i]
            }
            v.toByte()
        }
        val t = PatternTracker()
        var sx = 40
        val sy = 100
        assertTrue(t.start(w, h, room(sx, sy), (sx + 20f) / w, (sy + 20f) / h, 0))
        var lost = false
        for (i in 1..30) {
            sx -= 6
            val r = assertNotNullResult(t.update(w, h, room(sx, sy), i * 66L))
            if (r.lost) {
                lost = true
                break
            }
            // Followed while in view, then held near the edge: never on the background or the look-alike.
            assertTrue("frame $i: x ${r.x * w}", r.x * w <= max(sx + 20f, 12f) + 3f)
            assertEquals((sy + 20f) / h, r.y, 3f / h)
            assertTrue("frame $i: following the look-alike", sx > -40 || r.score < PatternTracker.MIN_SCORE)
        }
        assertTrue(lost)
    }

    @Test
    fun aRepeatingPatternIsFollowedWithoutSkipping() {
        // A striped door: the same 16 px tile over and over (plus a little noise), panning 5 px a frame.
        val r = Random(3)
        val tile = IntArray(16 * 16) { r.nextInt(256) }
        fun striped(offset: Int, seed: Int): ByteArray {
            val noise = Random(seed)
            return ByteArray(w * h) { i ->
                val x = i % w + offset
                val y = i / w
                (tile[(y % 16) * 16 + Math.floorMod(x, 16)] * 0.8f + 25 + noise.nextInt(12)).toInt().coerceIn(0, 255).toByte()
            }
        }
        val t = PatternTracker()
        assertTrue(t.start(w, h, striped(0, 0), 0.5f, 0.5f, 0))
        for (i in 1..20) {
            val res = assertNotNullResult(t.update(w, h, striped(i * 5, i), i * 66L))
            assertFalse(res.lost)
            assertEquals((w / 2f - i * 5) / w, res.x, 2f / w)
        }
    }

    @Test
    fun aSubjectGrowingAsTheCameraApproachesIsFollowed() {
        // Walking up to the subject: it grows 6% a frame, from 40 to ~180 px, its centre drifting a little.
        fun approach(z: Float, cx: Float, cy: Float) = ByteArray(w * h) { i ->
            val x = i % w
            val y = i / w
            val u = floor((x + 0.5f - cx) / z + 20f).toInt()
            val v = floor((y + 0.5f - cy) / z + 20f).toInt()
            val g = if (u in 0 until 40 && v in 0 until 40) subject[v * 40 + u] else background[i]
            g.toByte()
        }
        val t = PatternTracker()
        assertTrue(t.start(w, h, approach(1f, 150f, 120f), 150f / w, 120f / h, 0))
        var z = 1f
        for (i in 1..26) {
            z *= 1.06f
            val cx = 150f + i
            val cy = 120f - i * 0.5f
            val r = assertNotNullResult(t.update(w, h, approach(z, cx, cy), i * 66L))
            assertFalse("frame $i lost (size ${"%.2f".format(z)})", r.lost)
            assertEquals(cx / w, r.x, 3f / w)
            assertEquals(cy / h, r.y, 3f / h)
        }
    }

    private fun assertNotNullResult(r: PatternTracker.Result?): PatternTracker.Result {
        assertNotNull(r)
        return r!!
    }
}
