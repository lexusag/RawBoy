package app.rawboy.gl

import android.util.Half
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Bloom's wide tail, scattered once per photo on its small (~64 px) copy: a round power law (alpha 2.2, knee
 * 0.6 texel) out to 7 texels (~10% of the long edge), its weights falling to zero at the rim. The develop shader
 * samples the result as a B-spline, so the glow is smooth: summed per pixel from a bilinear copy, the coarse
 * texels showed as bands and squares. Only the highlights scatter (the shader's bloomKnee), and which tones are
 * highlights depends on exposure, so the result is [BANDS] copies stacked top to bottom, kneed at exposure
 * 2^0 .. 2^5; the shader blends the two either side of its own. The viewfinder runs the same kernel on the GPU
 * (ViewfinderRenderer's TAIL_SCATTER). Ports: BloomTail.ts, BloomTail.swift.
 */
object BloomTail {
    const val RADIUS = 6

    /** Exposure bands, 2^0 .. 2^(BANDS - 1) (develop.glsl's BLOOM_TAIL_BANDS). */
    const val BANDS = 6

    /** Tap offsets (dx, dy) and their weights, summing to 1. */
    private val dx: IntArray
    private val dy: IntArray
    private val weight: FloatArray

    init {
        val xs = ArrayList<Int>()
        val ys = ArrayList<Int>()
        val ws = ArrayList<Double>()
        val rim2 = ((RADIUS + 1) * (RADIUS + 1)).toDouble()
        for (j in -RADIUS..RADIUS) {
            for (i in -RADIUS..RADIUS) {
                val r2 = (i * i + j * j).toDouble()
                val rim = 1.0 - r2 / rim2
                if (rim <= 0.0) continue
                xs += i
                ys += j
                ws += (1.0 + sqrt(r2) / 0.6).pow(-2.2) * rim * rim
            }
        }
        val sum = ws.sum()
        dx = xs.toIntArray()
        dy = ys.toIntArray()
        weight = FloatArray(ws.size) { (ws[it] / sum).toFloat() }
    }

    /** The develop shader's bloomKnee: the share of light bloom scatters from a pixel [r] [g] [b] at exposure [gain]. */
    fun knee(r: Float, g: Float, b: Float, gain: Float): Float {
        val t = ((maxOf(r, g, b) * gain - KNEE_LO) / (KNEE_HI - KNEE_LO)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    /** [img] (half-float RGB), its highlights scattered by the tail kernel, edges clamped: [BANDS] bands, h x BANDS. */
    fun scatter(img: PreviewImage): PreviewImage {
        val w = img.width
        val h = img.height
        val src = img.pixels.duplicate().apply { position(0) }.order(ByteOrder.nativeOrder()).asShortBuffer()
        val rgb = FloatArray(w * h * 3) { Half.toFloat(src.get(it)) }
        val lit = FloatArray(rgb.size)
        val out = ByteBuffer.allocateDirect(w * h * BANDS * 6).order(ByteOrder.nativeOrder())
        val dst = out.asShortBuffer()
        for (band in 0 until BANDS) {
            val gain = (1 shl band).toFloat()
            for (o in rgb.indices step 3) {
                val k = knee(rgb[o], rgb[o + 1], rgb[o + 2], gain)
                lit[o] = k * rgb[o]
                lit[o + 1] = k * rgb[o + 1]
                lit[o + 2] = k * rgb[o + 2]
            }
            for (y in 0 until h) {
                for (x in 0 until w) {
                    var r = 0f
                    var g = 0f
                    var b = 0f
                    for (k in weight.indices) {
                        val o = ((y + dy[k]).coerceIn(0, h - 1) * w + (x + dx[k]).coerceIn(0, w - 1)) * 3
                        r += weight[k] * lit[o]
                        g += weight[k] * lit[o + 1]
                        b += weight[k] * lit[o + 2]
                    }
                    dst.put(Half.toHalf(r))
                    dst.put(Half.toHalf(g))
                    dst.put(Half.toHalf(b))
                }
            }
        }
        return PreviewImage(w, h * BANDS, out, img.fullWidth, img.fullHeight)
    }

    // develop.glsl's BLOOM_KNEE_LO / _HI.
    private const val KNEE_LO = 0.36f
    private const val KNEE_HI = 1.44f
}
