package app.rawboy.retouch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.roundToInt
import kotlin.random.Random

/** Unit tests for [DualPixelDepth]: RAW10 unpacking and the sign and position of the measured defocus. */
class DualPixelDepthTest {

    /** Packs [px] (10-bit, w×h) as MIPI RAW10 rows of [stride] bytes. */
    private fun raw10(px: IntArray, w: Int, h: Int, stride: Int): ByteArray {
        val out = ByteArray(stride * h)
        for (y in 0 until h) {
            for (g in 0 until w / 4) {
                var lsb = 0
                for (k in 0 until 4) {
                    val v = px[y * w + g * 4 + k]
                    out[y * stride + g * 5 + k] = (v shr 2).toByte()
                    lsb = lsb or ((v and 3) shl (2 * k))
                }
                out[y * stride + g * 5 + 4] = lsb.toByte()
            }
        }
        return out
    }

    /**
     * A dual-pixel frame of a smooth random texture whose right halves (odd columns) are the left halves (even
     * columns) moved by [shift] half-pixel columns: [shift] of the row's band (top or bottom half of the frame).
     */
    private fun frame(w: Int, h: Int, shift: (y: Int) -> Float): IntArray {
        val rnd = Random(7)
        val hw = w / 2
        // A texture with detail at several scales, as wide as a half and 2 px taller per row for the binning.
        val coarse = FloatArray((hw / 8 + 2) * (h / 4 + 2)) { rnd.nextFloat() }
        val fine = FloatArray(hw * h) { rnd.nextFloat() }
        fun tex(x: Float, y: Int): Float {
            val xi = x.coerceIn(0f, hw - 1f)
            val cx = xi / 8f
            val cy = y / 4f
            val x0 = cx.toInt()
            val y0 = cy.toInt()
            val tx = cx - x0
            val ty = cy - y0
            val cw = hw / 8 + 2
            val c = coarse[y0 * cw + x0] * (1 - tx) * (1 - ty) + coarse[y0 * cw + x0 + 1] * tx * (1 - ty) +
                coarse[(y0 + 1) * cw + x0] * (1 - tx) * ty + coarse[(y0 + 1) * cw + x0 + 1] * tx * ty
            val f0 = xi.toInt().coerceAtMost(hw - 2)
            val ft = xi - f0
            val f = fine[y * hw + f0] * (1 - ft) + fine[y * hw + f0 + 1] * ft
            return 0.7f * c + 0.3f * f
        }
        val px = IntArray(w * h)
        for (y in 0 until h) {
            val d = shift(y)
            for (x in 0 until hw) {
                px[y * w + 2 * x] = (64 + 600 * tex(x.toFloat(), y)).roundToInt()
                px[y * w + 2 * x + 1] = (64 + 600 * tex(x - d, y)).roundToInt()
            }
        }
        return px
    }

    @Test
    fun unpacksRaw10() {
        val w = 8
        val h = 2
        val px = IntArray(w * h) { (it * 131) % 1024 }
        val out = DualPixelDepth.unpack(raw10(px, w, h, 12), w, h, 12, DualPixelDepth.RAW_DEPTH10)!!
        for (i in px.indices) assertEquals(px[i].toFloat(), out[i], 0f)
        assertNull(DualPixelDepth.unpack(ByteArray(4), w, h, 12, DualPixelDepth.RAW_DEPTH10))
        assertNull(DualPixelDepth.unpack(ByteArray(64), w, h, 16, 0x20))
    }

    @Test
    fun fartherThanFocusReadsAboveHalfAndNearerBelow() {
        val w = 1024
        val h = 192
        // Top band 2 half-pixel columns behind focus, bottom band 2 in front.
        val px = frame(w, h) { y -> if (y < h / 2) 2f else -2f }
        val stride = w * 5 / 4 + 16
        val map = DualPixelDepth.compute(raw10(px, w, h, stride), w, h, stride, DualPixelDepth.RAW_DEPTH10, 4f / 3f, 1)
        assertNotNull(map)
        map!!
        assertEquals(512, map.width)
        assertEquals(384, map.height)
        val top = map.sampleUv(0.5f, 0.2f)
        val bottom = map.sampleUv(0.5f, 0.8f)
        assertTrue("top $top", top > 0.7f)
        assertTrue("bottom $bottom", bottom < 0.3f)
        // Focus on the sharpest cells: here both bands are equally sharp, so either one.
        assertTrue("focus ${map.focusDepth}", map.focusDepth < 0.3f || map.focusDepth > 0.7f)
    }

    @Test
    fun aSceneAllInFocusStaysNearHalf() {
        val w = 1024
        val h = 192
        val px = frame(w, h) { 0f }
        val stride = w * 5 / 4
        val map = DualPixelDepth.compute(raw10(px, w, h, stride), w, h, stride, DualPixelDepth.RAW_DEPTH10, 4f / 3f, 6)!!
        // Orientation 6 turns the landscape frame upright (portrait).
        assertEquals(384, map.width)
        assertEquals(512, map.height)
        for (v in floatArrayOf(0.2f, 0.5f, 0.8f)) {
            val d = map.sampleUv(0.5f, v)
            assertTrue("at $v: $d", d in 0.35f..0.65f)
        }
    }

    /**
     * A frame pulled from a phone (debug builds write `dualpixel/<name>.bin` + `.txt`): set RAWBOY_DUALPIXEL to the
     * `.bin` to check it decodes and write the map beside it as a PGM.
     */
    @Test
    fun realFrameFromThePhone() {
        val path = System.getenv("RAWBOY_DUALPIXEL") ?: return
        val bin = File(path)
        val (w, h, stride, format, orientation) = File(path.removeSuffix(".bin") + ".txt").readText().trim().split(Regex("\\s+")).map { it.toInt() }
        val start = System.nanoTime()
        val map = DualPixelDepth.compute(bin.readBytes(), w, h, stride, format, 4f / 3f, orientation)!!
        println("dual pixel ${w}x$h -> ${map.width}x${map.height} in ${(System.nanoTime() - start) / 1_000_000} ms")
        File(path.removeSuffix(".bin") + "-depth.pgm").outputStream().use {
            it.write("P5\n${map.width} ${map.height}\n255\n".toByteArray())
            it.write(map.data)
        }
    }
}
