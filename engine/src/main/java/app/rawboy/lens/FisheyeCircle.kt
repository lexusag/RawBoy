package app.rawboy.lens

import android.util.Half
import app.rawboy.gl.PreviewImage
import java.nio.ByteOrder
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The picture circle of a circular fisheye, found on the 512 px base copy: centre as a fraction of the width and
 * height away from the frame's centre (-0.5..0.5), radius as a fraction of the frame's half diagonal (what the Image
 * circle size slider calls 100%).
 */
class FisheyeCircle(val offsetX: Double, val offsetY: Double, val radius: Double) {
    companion object {
        /** How much smaller than the measured edge the circle is taken: the rim is vignetted and soft. */
        private const val SHRINK = 0.97

        /** Port of FisheyeCircle.ts (keep in step): a bright disc on a dark surround, else null. */
        fun detect(base: PreviewImage): FisheyeCircle? {
            val w = base.width
            val h = base.height
            if (w < 32 || h < 32) return null
            val px = base.pixels.duplicate().apply { position(0) }.order(ByteOrder.nativeOrder()).asShortBuffer()
            val lum = FloatArray(w * h) {
                0.2126f * Half.toFloat(px.get(it * 3)) + 0.7152f * Half.toFloat(px.get(it * 3 + 1)) + 0.0722f * Half.toFloat(px.get(it * 3 + 2))
            }
            return detect(lum, w, h)
        }

        fun detect(lum: FloatArray, w: Int, h: Int): FisheyeCircle? {
            val s = max(4, (0.04 * min(w, h)).roundToInt())
            var corner = 0.0
            for ((x0, y0) in listOf(0 to 0, w - s to 0, 0 to h - s, w - s to h - s)) {
                for (y in y0 until y0 + s) for (x in x0 until x0 + s) corner += lum[y * w + x]
            }
            corner /= 4.0 * s * s
            val sample = ArrayList<Float>()
            var i = 0
            while (i < lum.size) { sample.add(lum[i]); i += 7 }
            sample.sort()
            val p98 = sample[(sample.size * 0.98).toInt()]
            if (!(p98 > 0f) || corner > 0.01 * p98) return null
            val thr = max(corner * 4, 0.02 * p98)

            val cols = IntArray(w)
            val rows = IntArray(h)
            for (y in 0 until h) for (x in 0 until w) {
                if (lum[y * w + x] > thr) { cols[x]++; rows[y]++ }
            }
            val min = 4
            val left = cols.indexOfFirst { it >= min }
            val right = cols.indexOfLast { it >= min }
            val top = rows.indexOfFirst { it >= min }
            val bottom = rows.indexOfLast { it >= min }
            if (left < 0 || top < 0 || right <= left || bottom <= top) return null

            val touchX = left <= 1 && right >= w - 2
            val touchY = top <= 1 && bottom >= h - 2
            if (touchX && touchY) return null
            val dx = right - left + 1
            val dy = bottom - top + 1
            val diameter = when {
                touchX -> dy.toDouble()
                touchY -> dx.toDouble()
                else -> {
                    val ratio = dx.toDouble() / dy
                    if (ratio < 0.8 || ratio > 1.25) return null
                    (dx + dy) / 2.0
                }
            }
            val cx = if (touchX) w / 2.0 else (left + right + 1) / 2.0
            val cy = if (touchY) h / 2.0 else (top + bottom + 1) / 2.0
            val halfDiag = hypot(w / 2.0, h / 2.0)
            val radius = diameter / 2 * SHRINK / halfDiag
            if (radius < 0.15 || radius > 0.98) return null
            // Outside a real fisheye circle it is black; a dim frame-filling photo has picture in the ring beyond it.
            val rPx = radius * halfDiag
            var outside = 0
            var above = 0
            for (y in 0 until h) for (x in 0 until w) {
                val d = hypot(x + 0.5 - cx, y + 0.5 - cy)
                if (d > rPx * 1.08 && d < rPx * 1.3) {
                    outside++
                    if (lum[y * w + x] > thr) above++
                }
            }
            if (outside > 0 && above.toDouble() / outside > 0.15) return null
            return FisheyeCircle((cx - w / 2.0) / w, (cy - h / 2.0) / h, radius)
        }
    }
}
