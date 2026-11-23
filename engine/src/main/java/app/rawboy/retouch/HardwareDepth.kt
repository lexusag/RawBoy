package app.rawboy.retouch

import app.rawboy.export.DepthMap
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Turns a camera's hardware depth frame (Android `ImageFormat.DEPTH16`) into a [DepthMap]. Nothing is estimated. */
object HardwareDepth {

    /**
     * Converts an Android `ImageFormat.DEPTH16` plane (`16-bit` little-endian samples: low 13 bits = depth in mm,
     * high 3 bits = confidence `0..7`) into an upright, normalized [DepthMap] (max dimension [maxDimension]).
     */
    fun fromDepth16(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        rowStrideBytes: Int,
        pixelStrideBytes: Int = 2,
        exifOrientation: Int = 1,
        focusX: Float = 0.5f,
        focusY: Float = 0.5f,
        maxDimension: Int = 512,
    ): DepthMap? {
        if (width <= 0 || height <= 0) return null
        val scale = min(1f, maxDimension.toFloat() / max(width, height))
        val srcW = max(1, (width * scale).roundToInt())
        val srcH = max(1, (height * scale).roundToInt())
        val mm = FloatArray(srcW * srcH)
        val valid = ArrayList<Float>(srcW * srcH)
        val dup = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)

        for (y in 0 until srcH) {
            val sy = ((y + 0.5f) * height / srcH).toInt().coerceIn(0, height - 1)
            val rowOffset = sy * rowStrideBytes
            for (x in 0 until srcW) {
                val sx = ((x + 0.5f) * width / srcW).toInt().coerceIn(0, width - 1)
                val idx = rowOffset + sx * pixelStrideBytes
                if (idx + 1 >= dup.limit()) continue
                val sample = dup.getShort(idx).toInt() and 0xffff
                val depthMm = sample and 0x1fff
                val confidence = (sample ushr 13) and 0x7
                // In Android DEPTH16, confidence 0 denotes 100% confidence on some HALs or invalid if depthMm == 0;
                // depthMm in 40..15000 mm with confidence != 1 is usable.
                if (depthMm in 40..15000 && confidence != 1) {
                    val v = depthMm.toFloat()
                    mm[y * srcW + x] = v
                    valid.add(v)
                }
            }
        }
        if (valid.size < (srcW * srcH) / 16) return null
        valid.sort()
        val nearMm = valid[(valid.size * 0.03f).toInt().coerceIn(0, valid.size - 1)]
        val farMm = max(nearMm + 100f, valid[(valid.size * 0.95f).toInt().coerceIn(0, valid.size - 1)])
        val fallbackMm = valid[valid.size / 2]

        // Fill holes (0 values) from nearest valid neighbor along rows/columns, then normalize to 0..1.
        var last = fallbackMm
        for (i in mm.indices) {
            if (mm[i] > 0f) last = mm[i] else mm[i] = last
        }
        val norm = FloatArray(srcW * srcH) { i ->
            ((mm[i] - nearMm) / (farMm - nearMm)).coerceIn(0f, 1f)
        }
        val smoothed = Filters.box(norm, srcW, srcH, 1)

        // Apply EXIF orientation (1..8) so the resulting DepthMap matches the upright decoded RawImage.
        val swapAxes = exifOrientation in 5..8
        val outW = if (swapAxes) srcH else srcW
        val outH = if (swapAxes) srcW else srcH
        val outBytes = ByteArray(outW * outH)
        for (sy in 0 until srcH) {
            for (sx in 0 until srcW) {
                val (dx, dy) = orientPixel(sx, sy, srcW, srcH, exifOrientation)
                val b = (smoothed[sy * srcW + sx] * 255f).roundToInt().coerceIn(0, 255).toByte()
                outBytes[dy * outW + dx] = b
            }
        }
        val prelim = DepthMap(outW, outH, outBytes, hardware = true, subjectDetected = true, focusDepth = 0.2f)
        val focusDepth = prelim.sampleUv(focusX.coerceIn(0.1f, 0.9f), focusY.coerceIn(0.1f, 0.9f))
        return DepthMap(
            width = outW,
            height = outH,
            data = outBytes,
            hardware = true,
            subjectDetected = true,
            focusDepth = focusDepth,
        )
    }

    private fun orientPixel(x: Int, y: Int, w: Int, h: Int, orientation: Int): Pair<Int, Int> = when (orientation) {
        2 -> (w - 1 - x) to y
        3 -> (w - 1 - x) to (h - 1 - y)
        4 -> x to (h - 1 - y)
        5 -> y to x
        6 -> (h - 1 - y) to x
        7 -> (h - 1 - y) to (w - 1 - x)
        8 -> y to (w - 1 - x)
        else -> x to y
    }
}
