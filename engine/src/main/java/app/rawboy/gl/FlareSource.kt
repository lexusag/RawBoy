package app.rawboy.gl

import android.util.Half
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * What the anamorphic flare (shaders/develop.glsl, `anamorphicFlare`) scatters light from, made once per photo from the
 * highlight-boosted [SOURCE_MAX_DIMENSION] px copy (the same as the lens blur's). Port of FlareSource.ts.
 *
 * Three bands stacked top to bottom, each `width` texels across (the copy's width / 3):
 * - band 0, `rows` rows: the copy's own rows. A bright light is thin here: the needle.
 * - band 1, `ceil(rows / 3)` rows: three rows to one, so a texel is square. The wing and the bar.
 * - band 2, as band 1: its luminance blurred into tall ovals (sigma 4 across, 10 down), for the ghosts.
 *
 * Bands 0 and 1 are the boosted light times two gates, so the shader's knee does the rest: size (how much of the
 * neighbourhood is blown out: big windows and signs don't flare) and brightness (lights that don't fill a texel with
 * clipped light drop out). Same maths and constants as the TypeScript and Swift ports.
 */
object FlareSource {
    const val SOURCE_MAX_DIMENSION = 1536

    private const val SIZE_SIGMA = 0.025f
    private const val SIZE_DILATE = 0.3f
    private const val SIZE_LO = 0.05f
    private const val SIZE_HI = 0.14f
    private const val BRIGHT_LO = 4.5f
    private const val BRIGHT_HI = 6.8f
    private const val BLOWN_LO = 1.5f
    private const val BLOWN_HI = 4.0f

    /** Rows of band 1 (and 2) for a copy of [rows] rows. */
    fun coarseRows(rows: Int) = ceil(rows / 3.0).toInt()

    /** Rows of band 0 for a flare source (what [make] kept of the copy's rows). */
    fun rows(source: PreviewImage): Int {
        var rows = source.height * 3 / 5
        while (rows + 2 * coarseRows(rows) < source.height) rows++
        while (rows + 2 * coarseRows(rows) > source.height) rows--
        return rows
    }

    private fun smoothstep(e0: Float, e1: Float, x: Float): Float {
        val t = ((x - e0) / (e1 - e0)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    private fun boxPass(a: FloatArray, w: Int, h: Int, r: Int, alongX: Boolean): FloatArray {
        val out = FloatArray(a.size)
        val n = if (alongX) w else h
        val lines = if (alongX) h else w
        val window = 2 * r + 1
        for (l in 0 until lines) {
            fun at(i: Int): Float {
                val c = min(n - 1, max(0, i))
                return if (alongX) a[l * w + c] else a[c * w + l]
            }
            var sum = 0f
            for (i in -r..r) sum += at(i)
            for (i in 0 until n) {
                out[if (alongX) l * w + i else i * w + l] = sum / window
                sum += at(i + r + 1) - at(i - r)
            }
        }
        return out
    }

    private fun gauss3(a: FloatArray, w: Int, h: Int, sy: Float, sx: Float): FloatArray {
        fun radius(s: Float) = max(1, ((sqrt(4f * s * s + 1f) - 1f) / 2f).roundToInt())
        var out = a
        for ((alongX, s) in listOf(false to sy, true to sx)) {
            val r = radius(s)
            repeat(3) { out = boxPass(out, w, h, r, alongX) }
        }
        return out
    }

    private fun maxFilter(a: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        fun pass(src: FloatArray, alongX: Boolean): FloatArray {
            val out = FloatArray(src.size)
            val n = if (alongX) w else h
            val lines = if (alongX) h else w
            for (l in 0 until lines) for (i in 0 until n) {
                var m = Float.NEGATIVE_INFINITY
                for (j in max(0, i - r)..min(n - 1, i + r)) m = max(m, src[if (alongX) l * w + j else j * w + l])
                out[if (alongX) l * w + i else i * w + l] = m
            }
            return out
        }
        return pass(pass(a, true), false)
    }

    /** The flare source for [src] (the highlight-boosted ~1536 px copy). */
    fun make(src: PreviewImage): PreviewImage {
        val w = src.width
        val h = src.height
        val wf = ceil(w / 3.0).toInt()
        val rc = coarseRows(h)
        val half = src.pixels.duplicate().apply { position(0) }.order(ByteOrder.nativeOrder()).asShortBuffer()
        val px = FloatArray(w * h * 3) { Half.toFloat(half.get(it)) }

        val fine = FloatArray(wf * h * 3)
        for (y in 0 until h) for (x in 0 until wf) for (c in 0..2) {
            var sum = 0f
            for (k in 0..2) sum += px[(y * w + min(w - 1, 3 * x + k)) * 3 + c]
            fine[(y * wf + x) * 3 + c] = sum / 3f
        }

        val blown = FloatArray(wf * rc)
        for (yc in 0 until rc) for (x in 0 until wf) {
            var sum = 0f
            for (k in 0..2) {
                val o = (min(h - 1, 3 * yc + k) * wf + x) * 3
                sum += ((max(fine[o], max(fine[o + 1], fine[o + 2])) - BLOWN_LO) / (BLOWN_HI - BLOWN_LO)).coerceIn(0f, 1f)
            }
            blown[yc * wf + x] = sum / 3f
        }
        val sigma = SIZE_SIGMA * max(wf, rc)
        val area = maxFilter(gauss3(blown, wf, rc, sigma, sigma), wf, rc, (SIZE_DILATE * sigma).roundToInt())

        val gated = FloatArray(wf * h * 3)
        for (y in 0 until h) for (x in 0 until wf) {
            val o = (y * wf + x) * 3
            val gate = (1f - smoothstep(SIZE_LO, SIZE_HI, area[y / 3 * wf + x])) *
                smoothstep(BRIGHT_LO, BRIGHT_HI, max(fine[o], max(fine[o + 1], fine[o + 2])))
            gated[o] = fine[o] * gate
            gated[o + 1] = fine[o + 1] * gate
            gated[o + 2] = fine[o + 2] * gate
        }
        val coarse = FloatArray(wf * rc * 3)
        for (yc in 0 until rc) for (x in 0 until wf) for (c in 0..2) {
            var sum = 0f
            for (k in 0..2) sum += gated[(min(h - 1, 3 * yc + k) * wf + x) * 3 + c]
            coarse[(yc * wf + x) * 3 + c] = sum / 3f
        }

        val lum = FloatArray(wf * rc) { coarse[it * 3] * 0.2627f + coarse[it * 3 + 1] * 0.678f + coarse[it * 3 + 2] * 0.0593f }
        val ghost = gauss3(lum, wf, rc, 10f, 4f)

        val out = ByteBuffer.allocateDirect(wf * (h + 2 * rc) * 6).order(ByteOrder.nativeOrder())
        val dst = out.asShortBuffer()
        for (v in gated) dst.put(Half.toHalf(v))
        for (v in coarse) dst.put(Half.toHalf(v))
        for (v in ghost) {
            val hv = Half.toHalf(v)
            dst.put(hv); dst.put(hv); dst.put(hv)
        }
        return PreviewImage(wf, h + 2 * rc, out, src.fullWidth, src.fullHeight)
    }
}
