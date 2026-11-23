package app.rawboy.export

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * An upright 8-bit normalized depth map (`0` = closest foreground, `255` = far background) embedded as a compact
 * trailer (`"RBDP"`) at the end of a DNG written by RawBoy Camera (Settings: "Save depth map in DNG").
 */
class DepthMap(
    val width: Int,
    val height: Int,
    /** [width] * [height] unsigned bytes (`0..255` -> `0.0..1.0` depth), already in display orientation. */
    val data: ByteArray,
    /** True when captured from a hardware `DEPTH16` sensor; false when estimated from the photo on device. */
    val hardware: Boolean = false,
    /** True when a person or pet subject was detected in the frame. */
    val subjectDetected: Boolean = false,
    /** Default normalized focus depth (`0..1`) on the detected subject or focus region. */
    val focusDepth: Float = 0.2f,
) {
    init {
        require(width > 0 && height > 0 && data.size == width * height) {
            "Invalid depth map dimensions ${width}x$height (${data.size} bytes)"
        }
    }

    /** Normalized depth (`0..1`) at pixel (`x`, `y`), clamped to the map's bounds. */
    fun sampleAt(x: Int, y: Int): Float {
        val cx = x.coerceIn(0, width - 1)
        val cy = y.coerceIn(0, height - 1)
        return (data[cy * width + cx].toInt() and 0xff) / 255f
    }

    /** Bilinearly sampled normalized depth (`0..1`) at normalized image coordinates (`u`, `v` in `0..1`). */
    fun sampleUv(u: Float, v: Float): Float {
        val fx = (u.coerceIn(0f, 1f) * (width - 1)).coerceIn(0f, (width - 1).toFloat())
        val fy = (v.coerceIn(0f, 1f) * (height - 1)).coerceIn(0f, (height - 1).toFloat())
        val x0 = fx.toInt()
        val y0 = fy.toInt()
        val x1 = (x0 + 1).coerceAtMost(width - 1)
        val y1 = (y0 + 1).coerceAtMost(height - 1)
        val tx = fx - x0
        val ty = fy - y0
        val d00 = sampleAt(x0, y0)
        val d10 = sampleAt(x1, y0)
        val d01 = sampleAt(x0, y1)
        val d11 = sampleAt(x1, y1)
        val top = d00 + (d10 - d00) * tx
        val bot = d01 + (d11 - d01) * tx
        return top + (bot - top) * ty
    }
}

/**
 * Appends or reads a [DepthMap] trailer at the end of a DNG file. TIFF/DNG readers address IFDs by offset from the
 * 8-byte header and ignore trailing bytes at EOF; RawBoy's decoder (`decode.cpp`) and lossy JPEG XL transcoder
 * (`dng_transcode.cpp`) recognize the 20-byte `"RBDP"` footer in $O(1)$.
 *
 * Footer layout (20 bytes, little-endian, immediately following [DepthMap.data]):
 * - `0..3`: magic `"RBDP"`
 * - `4`: version (`1`)
 * - `5`: flags (bit 0 = [DepthMap.hardware], bit 1 = [DepthMap.subjectDetected])
 * - `6..7`: `uint16` width
 * - `8..9`: `uint16` height
 * - `10..11`: `uint16` focusDepth (`0..65535` -> `0.0..1.0`)
 * - `12..15`: `uint32` payload size (`width * height`)
 * - `16..19`: magic `"RBDP"`
 */
object DngDepth {
    const val FOOTER_SIZE = 20
    private const val VERSION = 1
    private const val MAGIC = 0x50444252 // "RBDP" in little-endian
    private const val FLAG_HARDWARE = 1
    private const val FLAG_SUBJECT = 2

    /** Encodes [depth] as `[data bytes][20-byte RBDP footer]`. */
    fun encodeTrailer(depth: DepthMap): ByteArray {
        val payloadSize = depth.width * depth.height
        val out = ByteArray(payloadSize + FOOTER_SIZE)
        System.arraycopy(depth.data, 0, out, 0, payloadSize)
        val flags = (if (depth.hardware) FLAG_HARDWARE else 0) or (if (depth.subjectDetected) FLAG_SUBJECT else 0)
        val focusU16 = (depth.focusDepth.coerceIn(0f, 1f) * 65535f).roundToInt().coerceIn(0, 65535)
        ByteBuffer.wrap(out, payloadSize, FOOTER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(MAGIC)
            .put(VERSION.toByte())
            .put(flags.toByte())
            .putShort(depth.width.toShort())
            .putShort(depth.height.toShort())
            .putShort(focusU16.toShort())
            .putInt(payloadSize)
            .putInt(MAGIC)
        return out
    }

    /**
     * Reads the embedded [DepthMap] trailer from the end of a file of length [size], or returns `null` if none is
     * present.
     */
    fun read(
        size: Long,
        read: (offset: Long, length: Int) -> ByteArray?,
    ): DepthMap? {
        val payloadOffset = trailerOffset(size, read) ?: return null
        val footer = read(size - FOOTER_SIZE, FOOTER_SIZE)?.takeIf { it.size == FOOTER_SIZE } ?: return null
        val b = ByteBuffer.wrap(footer).order(ByteOrder.LITTLE_ENDIAN)
        val flags = b.get(5).toInt() and 0xff
        val w = b.getShort(6).toInt() and 0xffff
        val h = b.getShort(8).toInt() and 0xffff
        val focusU16 = b.getShort(10).toInt() and 0xffff
        val payloadSize = w * h
        val data = read(payloadOffset, payloadSize)?.takeIf { it.size == payloadSize } ?: return null
        return DepthMap(
            width = w,
            height = h,
            data = data,
            hardware = (flags and FLAG_HARDWARE) != 0,
            subjectDetected = (flags and FLAG_SUBJECT) != 0,
            focusDepth = focusU16 / 65535f,
        )
    }

    /**
     * Appends [depth] to the file (or replaces an existing `"RBDP"` trailer if one is already at the end).
     */
    fun write(
        depth: DepthMap,
        size: Long,
        read: (offset: Long, length: Int) -> ByteArray?,
        writeAt: (offset: Long, bytes: ByteArray) -> Unit,
    ) {
        val at = trailerOffset(size, read) ?: size
        writeAt(at, encodeTrailer(depth))
    }

    /** Byte offset where an existing `"RBDP"` trailer starts (payload start), or `null` if the file has none. */
    fun trailerOffset(
        size: Long,
        read: (offset: Long, length: Int) -> ByteArray?,
    ): Long? {
        if (size <= FOOTER_SIZE + 8) return null
        val footer = read(size - FOOTER_SIZE, FOOTER_SIZE)?.takeIf { it.size == FOOTER_SIZE } ?: return null
        val b = ByteBuffer.wrap(footer).order(ByteOrder.LITTLE_ENDIAN)
        if (b.getInt(0) != MAGIC || b.getInt(16) != MAGIC) return null
        if ((b.get(4).toInt() and 0xff) != VERSION) return null
        val w = b.getShort(6).toInt() and 0xffff
        val h = b.getShort(8).toInt() and 0xffff
        val payloadSize = b.getInt(12).toLong() and 0xffffffffL
        if (w <= 0 || h <= 0 || w > 4096 || h > 4096) return null
        if (payloadSize != w.toLong() * h.toLong()) return null
        val total = payloadSize + FOOTER_SIZE
        if (total >= size) return null
        return size - total
    }
}
