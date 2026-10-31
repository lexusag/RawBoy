package app.rawboy.track

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Follows the patch under the camera's focus point from one greyscale frame to the next (one byte per pixel, row 0 =
 * top, upright as the viewfinder shows it; about 320 px on the long side). Zero-mean normalised cross-correlation of a
 * template, searched near where the patch should be, at its last size and a little smaller and larger, so a subject
 * the camera walks up to (or away from) keeps being found as it grows. The region around the predicted spot is
 * resampled to the template's scale, searched every other pixel, then refined.
 *
 * The template slowly takes on the patch's new look while the match is good, so a turning subject keeps being found,
 * but a match must still resemble the patch as first tapped ([ANCHOR_SCORE]), or the learning would let it drift onto
 * whatever replaced the subject. Among similar matches (a striped door, tiles) the one nearest where the patch was
 * expected wins ([PRIOR]). A patch expected past the frame's edge counts as not found: what is left inside matches
 * poorly anyway, and a search kept inside the frame would settle on the next thing there.
 *
 * Positions are fractions of the frame (x right, y down). [update] holds the last position while the match is poor
 * (a brief occlusion) and reports the patch lost once it has been poor for [lostAfterMs], or the frame's size changed.
 * Not thread-safe: one caller at a time.
 */
class PatternTracker(
    /** Template side, px (of the frame, at the size the patch was tapped). */
    private val size: Int = TEMPLATE_SIZE,
    /** How far the patch may move between frames, template px (on top of its last move). */
    private val reach: Int = SEARCH_REACH,
    private val lostAfterMs: Long = LOST_AFTER_MS,
) {
    /**
     * One frame's answer: where the patch is, how well it matched (-1..1), its size against the tap's ([scale]),
     * whether it was [found] in this frame (else its last position is held) and whether it is lost for good.
     */
    data class Result(
        val x: Float,
        val y: Float,
        val score: Float,
        val lost: Boolean,
        val scale: Float = 1f,
        val found: Boolean = !lost,
    )

    private var width = 0
    private var height = 0
    /** Zero-mean template, and the same as first tapped. */
    private var template: FloatArray? = null
    private var anchor: FloatArray? = null
    /** Patch centre (frame px), its last move, and its side in frame px per template px. */
    private var cx = 0f
    private var cy = 0f
    private var vx = 0f
    private var vy = 0f
    private var scale = 1f
    private var lastGood = 0L
    /** The search region (template px, [size] + 2 [reach] square), reused between frames. */
    private val region = FloatArray((size + 2 * reach) * (size + 2 * reach))
    private val regionHalf = FloatArray((size / 2 + reach) * (size / 2 + reach))

    val active get() = template != null

    /**
     * Starts following the patch around ([x], [y]) of this frame at [now] (ms, any monotonic clock). Returns false, and
     * follows nothing, when the patch has too little detail to be found again (a plain wall, the sky).
     */
    fun start(width: Int, height: Int, grey: ByteArray, x: Float, y: Float, now: Long): Boolean {
        stop()
        if (width < size * 2 || height < size * 2 || grey.size < width * height) return false
        val px = (x * width).coerceIn(size / 2f, width - size / 2f)
        val py = (y * height).coerceIn(size / 2f, height - size / 2f)
        val f = FloatArray(size * size)
        sample(grey, width, height, px, py, 1f, size, f)
        if (std(f) < MIN_STD) return false
        this.width = width
        this.height = height
        template = zeroMean(f)
        anchor = template!!.copyOf()
        cx = px
        cy = py
        vx = 0f
        vy = 0f
        scale = 1f
        lastGood = now
        return true
    }

    /** Finds the patch in the next frame; null when nothing is being followed. */
    fun update(width: Int, height: Int, grey: ByteArray, now: Long): Result? {
        val t = template ?: return null
        val a = anchor ?: return null
        if (width != this.width || height != this.height || grey.size < width * height) {
            stop()
            return Result(cx / max(1, this.width), cy / max(1, this.height), 0f, lost = true, scale, found = false)
        }
        // Where the patch's centre should be now.
        val px = cx + vx
        val py = cy + vy
        val half = size * scale / 2f
        val inside = px - half >= -EDGE && py - half >= -EDGE && px + half <= width + EDGE && py + half <= height + EDGE
        var found: Found? = null
        if (inside) {
            for (k in SCALE_STEPS) {
                val s = (scale * k).coerceIn(MIN_SCALE, maxScale(width, height))
                val m = search(grey, width, height, t, px, py, s)
                val rank = m.score - if (k == 1f) 0f else SCALE_PENALTY
                if (found == null || rank > found.rank) found = Found(m.x, m.y, s, m.score, rank)
            }
        }
        var score = found?.score ?: 0f
        var ok = false
        if (found != null) {
            // Still the tapped subject, not something the template has learned its way onto?
            val patch = FloatArray(size * size)
            sample(grey, width, height, found.x, found.y, found.scale, size, patch)
            val first = ncc(patch, a)
            if (first < ANCHOR_SCORE) score = min(score, first)
            if (score >= MIN_SCORE) {
                ok = true
                vx = (found.x - cx) * VELOCITY_KEEP
                vy = (found.y - cy) * VELOCITY_KEEP
                cx = found.x
                cy = found.y
                scale = found.scale
                lastGood = now
                if (score >= UPDATE_SCORE) blend(t, zeroMean(patch))
            } else {
                // Not found where it should be: look around where it was. Expected past the edge, it keeps going out.
                vx = 0f
                vy = 0f
            }
        }
        val lost = now - lastGood > lostAfterMs
        val result = Result(cx / width, cy / height, score, lost, scale, ok)
        if (lost) stop()
        return result
    }

    fun stop() {
        template = null
        anchor = null
    }

    private class Found(val x: Float, val y: Float, val scale: Float, val score: Float, val rank: Float)
    private class Match(val x: Float, val y: Float, val score: Float)

    /** Largest patch scale: the patch may grow to 60% of the frame's short side. */
    private fun maxScale(width: Int, height: Int) = max(1f, min(width, height) * 0.6f / size)

    /**
     * The best match of template [t] around ([ex], [ey]) (frame px) with the frame seen at [s] frame px per template px:
     * the region within [reach] template px resampled, searched at half resolution (2x2 averages: a fine texture one
     * pixel off doesn't correlate at all), then refined to the pixel. Ranked by
     * correlation less [PRIOR] at the edge of the reach; returns the match's centre (frame px) and plain score.
     */
    private fun search(img: ByteArray, w: Int, h: Int, t: FloatArray, ex: Float, ey: Float, s: Float): Match {
        val rs = size + 2 * reach
        sample(img, w, h, ex, ey, s, rs, region)
        val prior = PRIOR / (reach * reach)
        // Half resolution: the whole reach.
        val hr = rs / 2
        halve(region, rs, regionHalf)
        val th = FloatArray((size / 2) * (size / 2))
        halve(t, size, th)
        val thNorm = sqrt(th.sumOf { (it * it).toDouble() }).toFloat()
        var hx = reach / 2
        var hy = reach / 2
        var hRank = -10f
        for (y in 0..reach) {
            for (x in 0..reach) {
                val dx = 2f * x - reach
                val dy = 2f * y - reach
                val rank = nccAt(regionHalf, hr, x, y, th, thNorm) - prior * (dx * dx + dy * dy)
                if (rank > hRank) {
                    hRank = rank
                    hx = x
                    hy = y
                }
            }
        }
        // Full resolution: a pixel or two around it.
        val tNorm = sqrt(t.sumOf { (it * it).toDouble() }).toFloat()
        var bestX = 2 * hx
        var bestY = 2 * hy
        var bestScore = -2f
        var bestRank = -10f
        for (y in max(0, 2 * hy - REFINE)..min(2 * reach, 2 * hy + REFINE)) {
            for (x in max(0, 2 * hx - REFINE)..min(2 * reach, 2 * hx + REFINE)) {
                val score = nccAt(region, rs, x, y, t, tNorm)
                val dx = (x - reach).toFloat()
                val dy = (y - reach).toFloat()
                val rank = score - prior * (dx * dx + dy * dy)
                if (rank > bestRank) {
                    bestRank = rank
                    bestScore = score
                    bestX = x
                    bestY = y
                }
            }
        }
        return Match(ex + (bestX - reach) * s, ey + (bestY - reach) * s, bestScore)
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
        /**
         * Lowest correlation with the patch as first tapped: below it the learned template has wandered onto something
         * else (the subject left, the next thing in the frame looked alike after a few blended frames).
         */
        const val ANCHOR_SCORE = 0.45f
        /** Score taken off a match at the edge of the search reach (less nearer the expected spot): repeated patterns. */
        const val PRIOR = 0.2f
        /** Sizes tried each frame against the last one: walking up to a subject grows it a few % a frame. */
        private val SCALE_STEPS = floatArrayOf(1f, 1f / 1.08f, 1.08f)
        /** Score a size change must win by, so noise doesn't make the size wander. */
        private const val SCALE_PENALTY = 0.02f
        private const val MIN_SCALE = 0.4f
        /** How far (px) the expected patch may reach past the frame's edge before it counts as leaving it. */
        private const val EDGE = 2f
        private const val REFINE = 2
        /** Grey levels (0..255) of spread a patch needs to be followed at all. */
        const val MIN_STD = 4f

        /**
         * [n] x [n] samples of the frame, [s] frame px apart, centred on ([cx], [cy]): bilinear, positions outside the
         * frame clamped to its edge.
         */
        private fun sample(img: ByteArray, w: Int, h: Int, cx: Float, cy: Float, s: Float, n: Int, out: FloatArray) {
            val x0 = cx - (n / 2f - 0.5f) * s - 0.5f
            val y0 = cy - (n / 2f - 0.5f) * s - 0.5f
            for (j in 0 until n) {
                val fy = (y0 + j * s).coerceIn(0f, h - 1f)
                val iy = min(floor(fy).toInt(), h - 2)
                val ty = fy - iy
                for (i in 0 until n) {
                    val fx = (x0 + i * s).coerceIn(0f, w - 1f)
                    val ix = min(floor(fx).toInt(), w - 2)
                    val tx = fx - ix
                    val p = iy * w + ix
                    val top = (img[p].toInt() and 0xFF) * (1 - tx) + (img[p + 1].toInt() and 0xFF) * tx
                    val bottom = (img[p + w].toInt() and 0xFF) * (1 - tx) + (img[p + w + 1].toInt() and 0xFF) * tx
                    out[j * n + i] = top * (1 - ty) + bottom * ty
                }
            }
        }

        /** Correlation of zero-mean template [t] (norm [tNorm]) with the patch of [img] (row length [n]) at ([x], [y]). */
        private fun nccAt(img: FloatArray, n: Int, x: Int, y: Int, t: FloatArray, tNorm: Float): Float {
            val s = sqrt(t.size.toDouble()).toInt()
            var sum = 0f
            var sum2 = 0f
            var cross = 0f
            var k = 0
            for (j in 0 until s) {
                var i = (y + j) * n + x
                for (c in 0 until s) {
                    val v = img[i]
                    sum += v
                    sum2 += v * v
                    cross += v * t[k]
                    i++
                    k++
                }
            }
            // The template has zero mean, so the patch's mean drops out of the cross term.
            val variance = sum2 - sum * sum / t.size
            return if (variance <= 1e-3f || tNorm <= 0f) 0f else cross / (sqrt(variance) * tNorm)
        }

        private fun ncc(patch: FloatArray, t: FloatArray): Float {
            val tNorm = sqrt(t.sumOf { (it * it).toDouble() }).toFloat()
            return nccAt(patch, sqrt(patch.size.toDouble()).toInt(), 0, 0, t, tNorm)
        }

        /** 2x2 averages of the [n] x [n] square [img] into [out] ([n] / 2 square). */
        private fun halve(img: FloatArray, n: Int, out: FloatArray) {
            val m = n / 2
            for (y in 0 until m) {
                val r0 = 2 * y * n
                val r1 = r0 + n
                for (x in 0 until m) {
                    out[y * m + x] = (img[r0 + 2 * x] + img[r0 + 2 * x + 1] + img[r1 + 2 * x] + img[r1 + 2 * x + 1]) * 0.25f
                }
            }
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
    }
}
