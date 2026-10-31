package app.rawboy.track

import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Follows the patch under the camera's focus point from one greyscale frame to the next (one byte per pixel, row 0 =
 * top, upright as the viewfinder shows it; about 320 px on the long side). Zero-mean normalised cross-correlation of a
 * template: searched near where the patch should be at half resolution, then refined at full resolution. The template
 * slowly takes on the patch's new look while the match is good, so a turning subject keeps being found.
 *
 * Positions are fractions of the frame (x right, y down). [update] holds the last position while the match is poor
 * (a brief occlusion) and reports the patch lost once it has been poor for [lostAfterMs], or the frame's size changed.
 * Not thread-safe: one caller at a time.
 */
class PatternTracker(
    /** Template side at full resolution, px (half that at half resolution). */
    private val size: Int = TEMPLATE_SIZE,
    /** How far the patch may move between frames, px at full resolution (on top of its last move). */
    private val reach: Int = SEARCH_REACH,
    private val lostAfterMs: Long = LOST_AFTER_MS,
) {
    /** One frame's answer: where the patch is, how well it matched (-1..1) and whether it is lost for good. */
    data class Result(val x: Float, val y: Float, val score: Float, val lost: Boolean)

    private var width = 0
    private var height = 0
    /** Zero-mean templates, full and half resolution. */
    private var full: FloatArray? = null
    private var half: FloatArray? = null
    /** Patch centre, full-resolution px, and its last move. */
    private var cx = 0f
    private var cy = 0f
    private var vx = 0f
    private var vy = 0f
    private var lastGood = 0L

    val active get() = full != null

    /**
     * Starts following the patch around ([x], [y]) of this frame at [now] (ms, any monotonic clock). Returns false, and
     * follows nothing, when the patch has too little detail to be found again (a plain wall, the sky).
     */
    fun start(width: Int, height: Int, grey: ByteArray, x: Float, y: Float, now: Long): Boolean {
        stop()
        if (width < size * 2 || height < size * 2 || grey.size < width * height) return false
        val px = (x * width).coerceIn(size / 2f, width - size / 2f)
        val py = (y * height).coerceIn(size / 2f, height - size / 2f)
        val f = patch(grey, width, height, size, (px - size / 2f).roundToInt(), (py - size / 2f).roundToInt())
        if (std(f) < MIN_STD) return false
        val h = halve(grey, width, height)
        val hs = size / 2
        this.width = width
        this.height = height
        full = zeroMean(f)
        val hx = (px / 2f - hs / 2f).roundToInt()
        val hy = (py / 2f - hs / 2f).roundToInt()
        half = zeroMean(patch(h, width / 2, height / 2, hs, hx, hy))
        cx = px
        cy = py
        vx = 0f
        vy = 0f
        lastGood = now
        return true
    }

    /** Finds the patch in the next frame; null when nothing is being followed. */
    fun update(width: Int, height: Int, grey: ByteArray, now: Long): Result? {
        val f = full ?: return null
        val hf = half ?: return null
        if (width != this.width || height != this.height || grey.size < width * height) {
            stop()
            return Result(cx / max(1, this.width), cy / max(1, this.height), 0f, lost = true)
        }
        val hw = width / 2
        val hh = height / 2
        val hs = size / 2
        val h = halve(grey, width, height)
        // Half resolution: around the predicted position, the patch's top left within reach.
        val r = (reach + 1) / 2
        val gx = ((cx + vx) / 2f - hs / 2f).roundToInt()
        val gy = ((cy + vy) / 2f - hs / 2f).roundToInt()
        val coarse = best(h, hw, hh, hf, hs, gx - r, gx + r, gy - r, gy + r)
        // Full resolution: a pixel or two around it.
        val fx = coarse.x * 2
        val fy = coarse.y * 2
        val fine = best(grey, width, height, f, size, fx - REFINE, fx + REFINE, fy - REFINE, fy + REFINE)
        val score = fine.score
        if (score >= MIN_SCORE) {
            val nx = fine.x + size / 2f
            val ny = fine.y + size / 2f
            vx = (nx - cx) * VELOCITY_KEEP
            vy = (ny - cy) * VELOCITY_KEEP
            cx = nx
            cy = ny
            lastGood = now
            if (score >= UPDATE_SCORE) {
                blend(f, zeroMean(patch(grey, width, height, size, fine.x, fine.y)))
                blend(hf, zeroMean(patch(h, hw, hh, hs, (cx / 2f - hs / 2f).roundToInt(), (cy / 2f - hs / 2f).roundToInt())))
            }
        } else {
            vx = 0f
            vy = 0f
        }
        val lost = now - lastGood > lostAfterMs
        val result = Result(cx / width, cy / height, score, lost)
        if (lost) stop()
        return result
    }

    fun stop() {
        full = null
        half = null
    }

    private class Match(val x: Int, val y: Int, val score: Float)

    /**
     * The best match of template [t] ([s] px square, zero mean) with its top left in [x0]..[x1] x [y0]..[y1] (kept
     * inside the image), by normalised cross-correlation.
     */
    private fun best(img: ByteArray, w: Int, h: Int, t: FloatArray, s: Int, x0: Int, x1: Int, y0: Int, y1: Int): Match {
        val tNorm = sqrt(t.sumOf { (it * it).toDouble() }).toFloat()
        val ax = x0.coerceIn(0, w - s)
        val bx = x1.coerceIn(0, w - s)
        val ay = y0.coerceIn(0, h - s)
        val by = y1.coerceIn(0, h - s)
        val n = (s * s).toFloat()
        var bestX = ax
        var bestY = ay
        var bestScore = -2f
        for (y in ay..by) {
            for (x in ax..bx) {
                var sum = 0f
                var sum2 = 0f
                var cross = 0f
                var k = 0
                for (j in 0 until s) {
                    var i = (y + j) * w + x
                    for (c in 0 until s) {
                        val v = (img[i].toInt() and 0xFF).toFloat()
                        sum += v
                        sum2 += v * v
                        cross += v * t[k]
                        i++
                        k++
                    }
                }
                // The template has zero mean, so the patch's mean drops out of the cross term.
                val variance = sum2 - sum * sum / n
                val score = if (variance <= 0f || tNorm <= 0f) 0f else cross / (sqrt(variance) * tNorm)
                if (score > bestScore) {
                    bestScore = score
                    bestX = x
                    bestY = y
                }
            }
        }
        return Match(bestX, bestY, bestScore)
    }

    companion object {
        /** About 7% of a 320 px frame: larger than the AF box, so the patch holds some texture around it. */
        const val TEMPLATE_SIZE = 24
        /** A fast pan moves the subject ~30 px a frame at 15 fps on a 320 px frame; the last move is added on top. */
        const val SEARCH_REACH = 24
        /** Correlation the patch must reach to count as found; above [UPDATE_SCORE] the template learns from it. */
        const val MIN_SCORE = 0.6f
        const val UPDATE_SCORE = 0.85f
        /** Share of the new look a good match blends into the template. */
        const val LEARN = 0.15f
        /** Share of the last move expected again in the next frame. */
        const val VELOCITY_KEEP = 0.5f
        /** How long the patch may stay unfound (a hand passing in front) before it counts as lost. */
        const val LOST_AFTER_MS = 400L
        /** Grey levels (0..255) of spread a patch needs to be followed at all. */
        const val MIN_STD = 4f
        private const val REFINE = 2

        /** The [s] px square with its top left at ([x0], [y0]), moved inside the [w] x [h] image. */
        private fun patch(img: ByteArray, w: Int, h: Int, s: Int, x0: Int, y0: Int): FloatArray {
            val ax = x0.coerceIn(0, w - s)
            val ay = y0.coerceIn(0, h - s)
            val out = FloatArray(s * s)
            for (j in 0 until s) {
                for (i in 0 until s) out[j * s + i] = (img[(ay + j) * w + ax + i].toInt() and 0xFF).toFloat()
            }
            return out
        }

        private fun zeroMean(p: FloatArray): FloatArray {
            val mean = p.average().toFloat()
            return FloatArray(p.size) { p[it] - mean }
        }

        private fun std(p: FloatArray): Float {
            val mean = p.average()
            return sqrt(p.sumOf { (it - mean) * (it - mean) } / p.size).toFloat()
        }

        private fun blend(into: FloatArray, from: FloatArray) {
            for (i in into.indices) into[i] = into[i] * (1f - LEARN) + from[i] * LEARN
        }

        /** 2x2 box average, [w] / 2 x [h] / 2. */
        private fun halve(img: ByteArray, w: Int, h: Int): ByteArray {
            val hw = w / 2
            val hh = h / 2
            val out = ByteArray(hw * hh)
            for (y in 0 until hh) {
                val r0 = 2 * y * w
                val r1 = r0 + w
                for (x in 0 until hw) {
                    val s = (img[r0 + 2 * x].toInt() and 0xFF) + (img[r0 + 2 * x + 1].toInt() and 0xFF) +
                        (img[r1 + 2 * x].toInt() and 0xFF) + (img[r1 + 2 * x + 1].toInt() and 0xFF)
                    out[y * hw + x] = ((s + 2) / 4).toByte()
                }
            }
            return out
        }
    }
}
