package app.rawboy.camera.capture

import android.graphics.ImageFormat
import android.graphics.Rect
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.params.ColorSpaceTransform
import android.location.Location
import android.media.ExifInterface
import android.media.Image
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.util.Rational
import app.rawboy.export.ExifMetadata
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Writes an uncompressed 16-bit Bayer DNG 1.4 file from a maximum-resolution [ImageFormat.RAW10] or
 * [ImageFormat.RAW_SENSOR] [Image].
 *
 * Needed because Android's [android.hardware.camera2.DngCreator] rejects maximum-resolution buffers unless the camera
 * also advertises `ULTRA_HIGH_RESOLUTION_SENSOR` in `REQUEST_AVAILABLE_CAPABILITIES` (Pixel 9 Pro exposes the 50 MP
 * `RAW10` stream and all `*MaximumResolution` sensor/lens tags, and honours `SENSOR_PIXEL_MODE_MAXIMUM_RESOLUTION`,
 * without listing that capability), and `DngCreator.writeImage` rejects `RAW10`.
 */
internal object MaxResDngWriter {
    private const val BYTE: Short = 1
    private const val ASCII: Short = 2
    private const val SHORT: Short = 3
    private const val LONG: Short = 4
    private const val RATIONAL: Short = 5
    private const val UNDEFINED: Short = 7
    private const val SRATIONAL: Short = 10
    private const val DOUBLE: Short = 12

    private const val TARGET_STRIP_BYTES = 1_048_576

    class Entry(val tag: Int, val type: Short, val count: Int, var bytes: ByteArray) {
        val valueSize: Int
            get() = count * when (type) {
                SHORT -> 2
                LONG -> 4
                RATIONAL, SRATIONAL, DOUBLE -> 8
                else -> 1
            }
    }

    fun write(
        characteristics: CameraCharacteristics,
        result: CaptureResult,
        image: Image,
        exifOrientation: Int,
        location: Location?,
        out: OutputStream,
    ) {
        val width = image.width
        val height = image.height
        val pre = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            characteristics.get(CameraCharacteristics.SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE_MAXIMUM_RESOLUTION)
                ?: characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE_MAXIMUM_RESOLUTION)
        } else null)
            ?: characteristics.get(CameraCharacteristics.SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE)
            ?: characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
            ?: Rect(0, 0, width, height)

        val preW = pre.width().takeIf { it > 0 } ?: width
        val preH = pre.height().takeIf { it > 0 } ?: height
        val xMin = if (width == preW && height == preH) 0 else pre.left
        val yMin = if (width == preW && height == preH) 0 else pre.top

        val cfaEnum = characteristics.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT)
            ?: CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_RGGB
        val cfa = cfaPattern(cfaEnum)

        val dynamicBlack = result.get(CaptureResult.SENSOR_DYNAMIC_BLACK_LEVEL)?.takeIf { it.size == 4 }
        val staticBlack = characteristics.get(CameraCharacteristics.SENSOR_BLACK_LEVEL_PATTERN)
            ?.let { IntArray(4).also { dst -> it.copyTo(dst, 0) } }
        val blackRationals: Array<Pair<Long, Long>> = when {
            dynamicBlack != null -> Array(4) { i -> (dynamicBlack[i] * 100f).roundToLong().coerceAtLeast(0L) to 100L }
            staticBlack != null -> Array(4) { i -> staticBlack[i].toLong().coerceAtLeast(0L) to 1L }
            else -> Array(4) { 64L to 1L }
        }
        val blackFloat: FloatArray = when {
            dynamicBlack != null -> FloatArray(4) { dynamicBlack[it].coerceAtLeast(0f) }
            staticBlack != null -> FloatArray(4) { staticBlack[it].toFloat().coerceAtLeast(0f) }
            else -> FloatArray(4) { 64f }
        }
        val whiteLevel = result.get(CaptureResult.SENSOR_DYNAMIC_WHITE_LEVEL)
            ?: characteristics.get(CameraCharacteristics.SENSOR_INFO_WHITE_LEVEL)
            ?: 1023

        val captureTime = formatCaptureTime(characteristics, result)
        val exposureNs = (result.get(CaptureResult.SENSOR_EXPOSURE_TIME) ?: 10_000_000L).coerceAtLeast(1L)
        val iso = (result.get(CaptureResult.SENSOR_SENSITIVITY) ?: 100).coerceIn(0, 65535)
        val boost = (result.get(CaptureResult.CONTROL_POST_RAW_SENSITIVITY_BOOST) ?: 100).coerceAtLeast(1)
        val baselineEv = ln(boost / 100.0) / ln(2.0)
        val focal = result.get(CaptureResult.LENS_FOCAL_LENGTH)
            ?: characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
            ?: 0f
        val aperture = result.get(CaptureResult.LENS_APERTURE)
            ?: characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.firstOrNull()
            ?: 0f

        val neutral = result.get(CaptureResult.SENSOR_NEUTRAL_COLOR_POINT)?.takeIf { it.size >= 3 }
            ?: arrayOf(Rational(1, 1), Rational(1, 1), Rational(1, 1))
        val nR = neutral[0].toFloat().takeIf { it > 1e-4f } ?: 1f
        val nG = neutral[1].toFloat().takeIf { it > 1e-4f } ?: 1f
        val nB = neutral[2].toFloat().takeIf { it > 1e-4f } ?: 1f
        val wb = floatArrayOf((nG / nR).coerceIn(0.25f, 4f), 1f, (nG / nB).coerceIn(0.25f, 4f))

        val rawRowsPerStrip = (TARGET_STRIP_BYTES / (width * 2)).coerceIn(1, height)
        val rowsPerStrip = if (rawRowsPerStrip >= 2) (rawRowsPerStrip and 1.inv()).coerceAtLeast(2) else rawRowsPerStrip
        val stripCount = (height + rowsPerStrip - 1) / rowsPerStrip
        val stripByteCounts = IntArray(stripCount) { i ->
            val rows = minOf(rowsPerStrip, height - i * rowsPerStrip)
            rows * width * 2
        }

        val entries = ArrayList<Entry>(44)
        entries += long(254, 0)                                                 // NewSubfileType: full-res raw
        entries += long(256, width)                                             // ImageWidth
        entries += long(257, height)                                            // ImageLength
        entries += short(258, 16)                                               // BitsPerSample
        entries += short(259, 1)                                                // Compression: none
        entries += short(262, 32803)                                            // PhotometricInterpretation: CFA
        entries += ascii(270, "")                                               // ImageDescription
        entries += ascii(271, Build.MANUFACTURER.orEmpty())                     // Make
        entries += ascii(272, Build.MODEL.orEmpty())                            // Model
        val stripOffsetsEntry = longs(273, IntArray(stripCount))                // StripOffsets (patched once sized)
        entries += stripOffsetsEntry
        entries += short(274, exifOrientation.coerceIn(ExifInterface.ORIENTATION_NORMAL, ExifInterface.ORIENTATION_ROTATE_270))
        entries += short(277, 1)                                                // SamplesPerPixel
        entries += long(278, rowsPerStrip)                                      // RowsPerStrip
        entries += longs(279, stripByteCounts)                                  // StripByteCounts
        entries += rationals(282, 72L to 1L)                                    // XResolution
        entries += rationals(283, 72L to 1L)                                    // YResolution
        entries += short(284, 1)                                                // PlanarConfiguration: chunky
        entries += short(296, 2)                                                // ResolutionUnit: inch
        entries += ascii(305, Build.FINGERPRINT.orEmpty())                      // Software
        entries += ascii(306, captureTime)                                      // DateTime
        entries += shorts(33421, intArrayOf(2, 2))                              // CFARepeatPatternDim
        entries += bytes(33422, cfa)                                            // CFAPattern
        entries += ascii(33432, "")                                             // Copyright
        entries += rationals(33434, exposureRational(exposureNs))               // ExposureTime
        if (aperture > 0f) entries += rationals(33437, (aperture * 100f).roundToLong() to 100L) // FNumber
        entries += short(34855, iso)                                            // ISOSpeedRatings
        entries += ascii(36867, captureTime)                                    // DateTimeOriginal
        if (focal > 0f) entries += rationals(37386, (focal * 100f).roundToLong() to 100L) // FocalLength
        entries += bytes(37398, byteArrayOf(1, 0, 0, 0))                        // TIFF/EPStandardID
        entries += bytes(50706, byteArrayOf(1, 4, 0, 0))                        // DNGVersion
        entries += bytes(50707, byteArrayOf(1, 1, 0, 0))                        // DNGBackwardVersion
        entries += ascii(50708, "${Build.MODEL}-${Build.MANUFACTURER}-${Build.BRAND}") // UniqueCameraModel
        entries += bytes(50710, byteArrayOf(0, 1, 2))                           // CFAPlaneColor
        entries += short(50711, 1)                                              // CFALayout
        entries += shorts(50713, intArrayOf(2, 2))                              // BlackLevelRepeatDim
        entries += rationals(50714, *blackRationals)                            // BlackLevel
        entries += long(50717, whiteLevel)                                      // WhiteLevel
        entries += rationals(50718, 1L to 1L, 1L to 1L)                         // DefaultScale
        val cropMargin = if (preW > 16 && preH > 16) 8 else 0
        entries += longs(50719, intArrayOf(cropMargin, cropMargin))             // DefaultCropOrigin
        entries += longs(50720, intArrayOf(preW - cropMargin * 2, preH - cropMargin * 2)) // DefaultCropSize

        val ill1 = characteristics.get(CameraCharacteristics.SENSOR_REFERENCE_ILLUMINANT1)
        val ill2 = characteristics.get(CameraCharacteristics.SENSOR_REFERENCE_ILLUMINANT2)?.toInt()?.and(0xFF)
        characteristics.get(CameraCharacteristics.SENSOR_COLOR_TRANSFORM1)?.let { entries += matrix(50721, it) }
        if (ill2 != null) characteristics.get(CameraCharacteristics.SENSOR_COLOR_TRANSFORM2)?.let { entries += matrix(50722, it) }
        characteristics.get(CameraCharacteristics.SENSOR_CALIBRATION_TRANSFORM1)?.let { entries += matrix(50723, it) }
        if (ill2 != null) characteristics.get(CameraCharacteristics.SENSOR_CALIBRATION_TRANSFORM2)?.let { entries += matrix(50724, it) }
        entries += rationals(
            50728,
            neutral[0].numerator.toLong().coerceAtLeast(1L) to neutral[0].denominator.toLong().coerceAtLeast(1L),
            neutral[1].numerator.toLong().coerceAtLeast(1L) to neutral[1].denominator.toLong().coerceAtLeast(1L),
            neutral[2].numerator.toLong().coerceAtLeast(1L) to neutral[2].denominator.toLong().coerceAtLeast(1L),
        )
        entries += srationals(50730, (baselineEv * 100.0).roundToInt() to 100)  // BaselineExposure
        if (ill1 != null) entries += short(50778, ill1 and 0xFF)                // CalibrationIlluminant1
        if (ill2 != null) entries += short(50779, ill2)                         // CalibrationIlluminant2
        entries += longs(50829, intArrayOf(yMin, xMin, yMin + preH, xMin + preW)) // ActiveArea
        characteristics.get(CameraCharacteristics.SENSOR_FORWARD_MATRIX1)?.let { entries += matrix(50964, it) }
        if (ill2 != null) characteristics.get(CameraCharacteristics.SENSOR_FORWARD_MATRIX2)?.let { entries += matrix(50965, it) }

        buildOpcodeList2(result, cfaEnum, preW, preH)?.let { entries += undefined(51009, it) }
        buildOpcodeList3(characteristics, result, preW, preH, xMin, yMin)?.let { entries += undefined(51022, it) }
        buildNoiseProfile(result, cfa)?.let { entries += doubles(51041, it) }

        val gpsEntries = location?.let(::gpsIfdEntries)
        val gpsPointer = if (gpsEntries != null) long(34853, 0).also { entries += it } else null

        val header = serializeHeader(entries, gpsEntries, gpsPointer, stripOffsetsEntry, stripByteCounts)
        out.write(header)
        val caps = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
        val hasUltraHighResCap = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_ULTRA_HIGH_RESOLUTION_SENSOR in caps
        val avgBlack = 0.25f * (blackFloat[0] + blackFloat[1] + blackFloat[2] + blackFloat[3])
        val whiteRange = max(1f, whiteLevel - avgBlack)
        val quad = isQuadBayer(width, height, whiteRange, hasUltraHighResCap, imageRowSource(image))
        if (quad) {
            val t0 = SystemClock.elapsedRealtime()
            writeRemosaicedPixels(width, height, rowsPerStrip, cfa, blackFloat, whiteLevel, wb, out) { imageRowSource(image) }
            Log.d("RawBoyCamera", "Quad-Bayer remosaic + DNG pixels (${width}x$height): ${SystemClock.elapsedRealtime() - t0} ms")
        } else {
            writePixels(image, width, height, rowsPerStrip, out)
        }
    }

    internal fun serializeHeader(
        ifd0Entries: List<Entry>,
        gpsEntries: List<Entry>?,
        gpsPointer: Entry?,
        stripOffsetsEntry: Entry,
        stripByteCounts: IntArray,
    ): ByteArray {
        val sorted0 = ifd0Entries.sortedBy { it.tag }
        val ifd0Offset = 8
        val ifd0Bytes = ifdSize(sorted0)
        val gpsOffset = ifd0Offset + ifd0Bytes
        val gpsSorted = gpsEntries?.sortedBy { it.tag }
        val gpsBytes = gpsSorted?.let(::ifdSize) ?: 0
        val dataOffset = align4(gpsOffset + gpsBytes)

        if (gpsPointer != null) {
            gpsPointer.bytes = le(4) { putInt(gpsOffset) }
        }
        val offsets = IntArray(stripByteCounts.size)
        var off = dataOffset
        for (i in stripByteCounts.indices) {
            offsets[i] = off
            off += stripByteCounts[i]
        }
        stripOffsetsEntry.bytes = le(4 * offsets.size) { offsets.forEach(::putInt) }

        val buf = ByteBuffer.allocate(dataOffset).order(ByteOrder.LITTLE_ENDIAN)
        buf.put(0, 'I'.code.toByte()).put(1, 'I'.code.toByte())
        buf.putShort(2, 42)
        buf.putInt(4, ifd0Offset)
        writeIfd(buf, ifd0Offset, sorted0)
        if (gpsSorted != null) writeIfd(buf, gpsOffset, gpsSorted)
        return buf.array()
    }

    private fun ifdSize(entries: List<Entry>): Int =
        2 + entries.size * 12 + 4 + entries.sumOf { if (it.valueSize > 4) align4(it.valueSize) else 0 }

    private fun align4(n: Int): Int = (n + 3) and 3.inv()

    private fun writeIfd(buf: ByteBuffer, offset: Int, sorted: List<Entry>) {
        var p = offset
        var data = offset + 2 + sorted.size * 12 + 4
        buf.putShort(p, sorted.size.toShort())
        p += 2
        for (e in sorted) {
            buf.putShort(p, e.tag.toShort())
            buf.putShort(p + 2, e.type)
            buf.putInt(p + 4, e.count)
            if (e.valueSize <= 4) {
                buf.position(p + 8)
                buf.put(e.bytes)
            } else {
                buf.putInt(p + 8, data)
                buf.position(data)
                buf.put(e.bytes)
                data += align4(e.valueSize)
            }
            p += 12
        }
        buf.putInt(p, 0)
    }

    private fun writePixels(image: Image, width: Int, height: Int, rowsPerStrip: Int, out: OutputStream) {
        val plane = image.planes[0]
        val buf = plane.buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val rowStride = plane.rowStride
        val rowBytesOut = width * 2
        val stripBuf = ByteArray(rowsPerStrip * rowBytesOut)
        if (image.format == ImageFormat.RAW10) {
            val rowIn = ByteArray(width / 4 * 5)
            var y = 0
            while (y < height) {
                val rows = minOf(rowsPerStrip, height - y)
                var o = 0
                for (r in 0 until rows) {
                    buf.position((y + r) * rowStride)
                    buf.get(rowIn, 0, rowIn.size)
                    var i = 0
                    while (i < rowIn.size) {
                        val low = rowIn[i + 4].toInt()
                        for (k in 0 until 4) {
                            val v = ((rowIn[i + k].toInt() and 0xFF) shl 2) or ((low ushr (2 * k)) and 3)
                            stripBuf[o++] = v.toByte()
                            stripBuf[o++] = (v ushr 8).toByte()
                        }
                        i += 5
                    }
                }
                out.write(stripBuf, 0, o)
                y += rows
            }
        } else {
            val pixStride = plane.pixelStride
            val rowRaw = if (pixStride == 2) null else ByteArray(rowStride)
            var y = 0
            while (y < height) {
                val rows = minOf(rowsPerStrip, height - y)
                var o = 0
                for (r in 0 until rows) {
                    buf.position((y + r) * rowStride)
                    if (rowRaw == null) {
                        buf.get(stripBuf, o, rowBytesOut)
                        o += rowBytesOut
                    } else {
                        val len = minOf(rowStride, buf.remaining())
                        buf.get(rowRaw, 0, len)
                        for (x in 0 until width) {
                            val p = x * pixStride
                            stripBuf[o++] = rowRaw[p]
                            stripBuf[o++] = rowRaw[p + 1]
                        }
                    }
                }
                out.write(stripBuf, 0, o)
                y += rows
            }
        }
    }

    internal fun interface RowSource {
        fun readRow(y: Int, dst: ShortArray, dstOffset: Int)
    }

    private fun imageRowSource(image: Image): RowSource {
        val width = image.width
        val plane = image.planes[0]
        val buf = plane.buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val rowStride = plane.rowStride
        if (image.format == ImageFormat.RAW10) {
            val rowIn = ByteArray(width / 4 * 5)
            return RowSource { y, dst, dstOffset ->
                buf.position(y * rowStride)
                buf.get(rowIn, 0, rowIn.size)
                var i = 0
                var o = dstOffset
                while (i < rowIn.size) {
                    val b0 = rowIn[i].toInt() and 0xFF
                    val b1 = rowIn[i + 1].toInt() and 0xFF
                    val b2 = rowIn[i + 2].toInt() and 0xFF
                    val b3 = rowIn[i + 3].toInt() and 0xFF
                    val low = rowIn[i + 4].toInt()
                    dst[o] = ((b0 shl 2) or (low and 3)).toShort()
                    dst[o + 1] = ((b1 shl 2) or ((low ushr 2) and 3)).toShort()
                    dst[o + 2] = ((b2 shl 2) or ((low ushr 4) and 3)).toShort()
                    dst[o + 3] = ((b3 shl 2) or ((low ushr 6) and 3)).toShort()
                    o += 4
                    i += 5
                }
            }
        }
        val pixStride = plane.pixelStride
        if (pixStride == 2) {
            return RowSource { y, dst, dstOffset ->
                buf.position(y * rowStride)
                buf.asShortBuffer().get(dst, dstOffset, width)
            }
        }
        val rowRaw = ByteArray(rowStride)
        return RowSource { y, dst, dstOffset ->
            buf.position(y * rowStride)
            val len = minOf(rowStride, buf.remaining())
            buf.get(rowRaw, 0, len)
            for (x in 0 until width) {
                val p = x * pixStride
                dst[dstOffset + x] = (((rowRaw[p + 1].toInt() and 0xFF) shl 8) or (rowRaw[p].toInt() and 0xFF)).toShort()
            }
        }
    }

    /**
     * Detects whether a maximum-resolution raw frame is un-remosaiced 4x4 Quad-Bayer (each 2x2 superpixel shares one
     * colour filter, as on the Pixel 9 Pro's 50 MP RAW10 stream) vs already-remosaiced 2x2 Bayer.
     *
     * Both `intra` (within a 2x2 superpixel) and `inter` (across the 2x2 boundary) measure 1-pixel adjacent differences,
     * so scene texture cancels out (`inter / intra` is ~1.0 on 2x2 Bayer and ~2.5-8+ on Quad-Bayer).
     */
    internal fun isQuadBayer(
        width: Int,
        height: Int,
        whiteRange: Float,
        hasUltraHighResCapability: Boolean,
        source: RowSource,
    ): Boolean {
        if (width < 16 || height < 16 || (width and 3) != 0 || (height and 3) != 0) return false
        val yStart = ((height / 10) and 1.inv()).coerceAtLeast(0)
        val yEnd = ((height * 9 / 10) and 1.inv()) - 4
        val xStart = ((width / 10) and 1.inv()).coerceAtLeast(0)
        val xEnd = ((width * 9 / 10) and 1.inv()) - 4
        if (yEnd <= yStart || xEnd <= xStart) return !hasUltraHighResCapability

        val samples = 32
        val yStep = max(2, ((yEnd - yStart) / samples) and 1.inv())
        val rows = ShortArray(3 * width)
        var intra = 0.0
        var inter = 0.0
        var count = 0L
        var y = yStart
        var taken = 0
        while (y <= yEnd && taken < samples) {
            source.readRow(y, rows, 0)
            source.readRow(y + 1, rows, width)
            source.readRow(y + 2, rows, 2 * width)
            var x = xStart
            while (x <= xEnd) {
                val p00 = rows[x].toInt() and 0xFFFF
                val p01 = rows[x + 1].toInt() and 0xFFFF
                val p02 = rows[x + 2].toInt() and 0xFFFF
                val p10 = rows[width + x].toInt() and 0xFFFF
                val p20 = rows[2 * width + x].toInt() and 0xFFFF
                intra += abs(p00 - p01) + abs(p00 - p10)
                inter += abs(p01 - p02) + abs(p10 - p20)
                count++
                x += 2
            }
            y += yStep
            taken++
        }
        if (count == 0L) return !hasUltraHighResCapability
        val meanIntra = intra / count
        val meanInter = inter / count
        return when {
            meanInter > meanIntra * 1.25 -> true
            meanIntra > whiteRange * 0.02 -> false
            else -> !hasUltraHighResCapability
        }
    }

    internal class QuadStripWorkspace(maxStripRows: Int, width: Int) {
        private val hw = width ushr 1
        private val maxSpRows = (maxStripRows ushr 1) + 8
        private val maxGRows = (maxStripRows ushr 1) + 4
        private val maxDmRows = (maxStripRows ushr 1) + 2
        val rawShort = ShortArray(maxSpRows * 2 * width)
        val ub = FloatArray(maxSpRows * hw)
        val ubWb = FloatArray(maxSpRows * hw)
        val gPass = FloatArray(maxGRows * hw)
        val wPass = FloatArray(maxGRows * hw)
        val lowR = FloatArray(maxDmRows * hw)
        val lowG = FloatArray(maxDmRows * hw)
        val lowB = FloatArray(maxDmRows * hw)
        val lowWhi = FloatArray(maxDmRows * hw)
        val outBytes = ByteArray(maxStripRows * width * 2)
    }

    internal fun writeRemosaicedPixels(
        width: Int,
        height: Int,
        rowsPerStrip: Int,
        cfa: ByteArray,
        black: FloatArray,
        whiteLevel: Int,
        wb: FloatArray,
        out: OutputStream,
        sourceFactory: () -> RowSource,
    ) {
        val stripCount = (height + rowsPerStrip - 1) / rowsPerStrip
        val workers = Runtime.getRuntime().availableProcessors().coerceIn(1, 4).coerceAtMost(stripCount)
        val workspaces = Array(workers) { QuadStripWorkspace(rowsPerStrip, width) }
        val sources = Array(workers) { sourceFactory() }
        val pool = if (workers > 1) Executors.newFixedThreadPool(workers - 1) else null
        try {
            var base = 0
            while (base < stripCount) {
                val batch = min(workers, stripCount - base)
                val futures = if (pool != null && batch > 1) {
                    Array(batch - 1) { idx ->
                        val w = idx + 1
                        val stripIdx = base + w
                        val y0 = stripIdx * rowsPerStrip
                        val y1 = min(height, y0 + rowsPerStrip)
                        pool.submit(Callable {
                            remosaicQuadBayerStrip(sources[w], workspaces[w], width, height, y0, y1, cfa, black, whiteLevel, wb)
                        })
                    }
                } else null
                val y0First = base * rowsPerStrip
                val y1First = min(height, y0First + rowsPerStrip)
                remosaicQuadBayerStrip(sources[0], workspaces[0], width, height, y0First, y1First, cfa, black, whiteLevel, wb)
                futures?.forEach { it.get() }
                for (w in 0 until batch) {
                    val stripIdx = base + w
                    val rows = min(rowsPerStrip, height - stripIdx * rowsPerStrip)
                    out.write(workspaces[w].outBytes, 0, rows * width * 2)
                }
                base += batch
            }
        } finally {
            pool?.shutdown()
        }
    }

    /**
     * Remosaics raw rows `[y0, y1)` from 4x4 Quad-Bayer into standard 2x2 Bayer (`cfa`) in `ws.outBytes` (little-endian
     * 16-bit). Preserves the 6/16 matching CFA sites per 4x4 block directly, demosaics the 2x2 superpixel averages with
     * directional Hamilton-Adams Green + colour-difference (`C - G`) chroma in white-balanced space, and transfers
     * full-resolution high-frequency detail with a smooth fade near `whiteLevel` so clipped channels never bleed chroma.
     */
    internal fun remosaicQuadBayerStrip(
        source: RowSource,
        ws: QuadStripWorkspace,
        width: Int,
        height: Int,
        y0: Int,
        y1: Int,
        cfa: ByteArray,
        black: FloatArray,
        whiteLevel: Int,
        wb: FloatArray,
    ) {
        val hw = width ushr 1
        val hh = height ushr 1
        val hrStart = y0 ushr 1
        val hrEnd = y1 ushr 1
        val stripSpRows = hrEnd - hrStart
        val dmR0 = max(0, hrStart - 1)
        val dmR1 = min(hh - 1, hrEnd)
        val gR0 = max(0, dmR0 - 1)
        val gR1 = min(hh - 1, max(dmR1 + 1, min(hh - 1, 1)))
        val spR0 = max(0, gR0 - 2)
        val spR1 = min(hh, max(gR1 + 3, min(hh, 3)))
        val spCount = spR1 - spR0
        val rawY0 = spR0 shl 1
        val rawCount = spCount shl 1

        val rawShort = ws.rawShort
        for (r in 0 until rawCount) {
            source.readRow(rawY0 + r, rawShort, r * width)
        }

        val ub = ws.ub
        val ubWb = ws.ubWb
        val wbByPhase = FloatArray(4) { wb[cfa[it].toInt()] }
        for (sr in 0 until spCount) {
            val gr = spR0 + sr
            val pr = (gr and 1) shl 1
            val bEven = black[pr]
            val bOdd = black[pr or 1]
            val wEven = wbByPhase[pr]
            val wOdd = wbByPhase[pr or 1]
            val r0 = (sr shl 1) * width
            val r1 = r0 + width
            val spOff = sr * hw
            var hc = 0
            while (hc < hw) {
                val x0 = hc shl 1
                val s0 = ((rawShort[r0 + x0].toInt() and 0xFFFF) + (rawShort[r0 + x0 + 1].toInt() and 0xFFFF) +
                    (rawShort[r1 + x0].toInt() and 0xFFFF) + (rawShort[r1 + x0 + 1].toInt() and 0xFFFF)) * 0.25f - bEven
                ub[spOff + hc] = s0
                ubWb[spOff + hc] = s0 * wEven
                val x1 = x0 + 2
                val s1 = ((rawShort[r0 + x1].toInt() and 0xFFFF) + (rawShort[r0 + x1 + 1].toInt() and 0xFFFF) +
                    (rawShort[r1 + x1].toInt() and 0xFFFF) + (rawShort[r1 + x1 + 1].toInt() and 0xFFFF)) * 0.25f - bOdd
                ub[spOff + hc + 1] = s1
                ubWb[spOff + hc + 1] = s1 * wOdd
                hc += 2
            }
        }

        val avgBlack = 0.25f * (black[0] + black[1] + black[2] + black[3])
        val whiteRange = max(1f, whiteLevel - avgBlack)
        val hiStart = 0.96f * whiteRange
        val invHiSpan = 1f / max(1f, 0.16f * whiteRange)

        val gCount = gR1 - gR0 + 1
        val dmCount = dmR1 - dmR0 + 1
        val gPass = ws.gPass
        val wPass = ws.wPass
        val lowR = ws.lowR
        val lowG = ws.lowG
        val lowB = ws.lowB
        val lowWhi = ws.lowWhi
        val lowCh = arrayOf(lowR, lowG, lowB)

        val phaseHere = IntArray(4) { cfa[it].toInt() }
        val phaseHoriz = IntArray(4) { cfa[it xor 1].toInt() }
        val phaseVert = IntArray(4) { cfa[it xor 2].toInt() }

        // Pass 1: directional Hamilton-Adams Green + highlight fade weight on the 2x2 superpixel grid.
        val hwLimit1 = hw - 1
        val hwLimit2 = hw - 2
        val hwReflect2 = 2 * hw - 4
        for (gi in 0 until gCount) {
            val gr = gR0 + gi
            val uM2 = (reflect(gr - 2, hh) - spR0) * hw
            val uM1 = (reflect(gr - 1, hh) - spR0) * hw
            val u0 = (gr - spR0) * hw
            val uP1 = (reflect(gr + 1, hh) - spR0) * hw
            val uP2 = (reflect(gr + 2, hh) - spR0) * hw
            val pr = (gr and 1) shl 1
            val gRow = gi * hw

            for (hc in 0 until hw) {
                val cM1 = if (hc > 0) hc - 1 else min(hwLimit1, 1)
                val cP1 = if (hc < hwLimit1) hc + 1 else max(0, hwLimit2)
                val gOff = gRow + hc
                var m = max(max(ub[uM1 + cM1], ub[uM1 + hc]), ub[uM1 + cP1])
                m = max(m, max(max(ub[u0 + cM1], ub[u0 + hc]), ub[u0 + cP1]))
                m = max(m, max(max(ub[uP1 + cM1], ub[uP1 + hc]), ub[uP1 + cP1]))
                val wHi = ((hiStart - m) * invHiSpan).coerceIn(0f, 1f)
                wPass[gOff] = wHi

                val z00 = ubWb[u0 + hc]
                if (phaseHere[pr or (hc and 1)] == 1) {
                    gPass[gOff] = z00
                } else {
                    val cM2 = if (hc >= 2) hc - 2 else min(hwLimit1, 2 - hc)
                    val cP2 = if (hc < hwLimit2) hc + 2 else max(0, hwReflect2 - hc)
                    val zN1 = ubWb[uM1 + hc]
                    val zS1 = ubWb[uP1 + hc]
                    val zW1 = ubWb[u0 + cM1]
                    val zE1 = ubWb[u0 + cP1]
                    val d2H = 2f * z00 - ubWb[u0 + cM2] - ubWb[u0 + cP2]
                    val d2V = 2f * z00 - ubWb[uM2 + hc] - ubWb[uP2 + hc]
                    val gH = 0.5f * (zW1 + zE1) + wHi * 0.25f * d2H
                    val gV = 0.5f * (zN1 + zS1) + wHi * 0.25f * d2V
                    val gradH = abs(zW1 - zE1) + abs(d2H)
                    val gradV = abs(zN1 - zS1) + abs(d2V)
                    val sum = gradH + gradV
                    gPass[gOff] = if (sum <= 1e-3f) 0.5f * (gH + gV) else (gradV * gH + gradH * gV) / sum
                }
            }
        }

        // Pass 2: colour-difference (C - G) bilinear interpolation for R and B, fading to single-channel near whiteLevel.
        for (di in 0 until dmCount) {
            val gr = dmR0 + di
            val uM1 = (reflect(gr - 1, hh) - spR0) * hw
            val u0 = (gr - spR0) * hw
            val uP1 = (reflect(gr + 1, hh) - spR0) * hw
            val gM1 = (reflect(gr - 1, hh) - gR0) * hw
            val g0 = (gr - gR0) * hw
            val gP1 = (reflect(gr + 1, hh) - gR0) * hw
            val pr = (gr and 1) shl 1
            val dRow = di * hw

            for (hc in 0 until hw) {
                val cM1 = if (hc > 0) hc - 1 else min(hwLimit1, 1)
                val cP1 = if (hc < hwLimit1) hc + 1 else max(0, hwLimit2)
                val dOff = dRow + hc
                val gCenter = gPass[g0 + hc]
                val wHi = wPass[g0 + hc]
                lowG[dOff] = gCenter
                lowWhi[dOff] = wHi

                val z00 = ubWb[u0 + hc]
                val ph = pr or (hc and 1)
                val here = phaseHere[ph]
                if (here == 1) {
                    val hBase = 0.5f * (ubWb[u0 + cM1] + ubWb[u0 + cP1])
                    val vBase = 0.5f * (ubWb[uM1 + hc] + ubWb[uP1 + hc])
                    lowCh[phaseHoriz[ph]][dOff] = hBase + wHi * (gCenter - 0.5f * (gPass[g0 + cM1] + gPass[g0 + cP1]))
                    lowCh[phaseVert[ph]][dOff] = vBase + wHi * (gCenter - 0.5f * (gPass[gM1 + hc] + gPass[gP1 + hc]))
                } else {
                    lowCh[here][dOff] = z00
                    val dBase = 0.25f * (ubWb[uM1 + cM1] + ubWb[uM1 + cP1] + ubWb[uP1 + cM1] + ubWb[uP1 + cP1])
                    val gDiag = 0.25f * (gPass[gM1 + cM1] + gPass[gM1 + cP1] + gPass[gP1 + cM1] + gPass[gP1 + cP1])
                    lowCh[2 - here][dOff] = dBase + wHi * (gCenter - gDiag)
                }
            }
        }

        val invWb = floatArrayOf(1f / wb[0], 1f / wb[1], 1f / wb[2])
        val outBytes = ws.outBytes
        for (localHr in 0 until stripSpRows) {
            val gr = hrStart + localHr
            val pr = (gr and 1) shl 1
            for (subY in 0..1) {
                val y = (gr shl 1) + subY
                val diA = gr - dmR0
                val diB = (if (subY == 0) max(0, gr - 1) else min(hh - 1, gr + 1)) - dmR0
                val rowA = diA * hw
                val rowB = diB * hw
                val rawRowOff = ((gr - spR0) * 2 + subY) * width
                var outOff = (localHr * 2 + subY) * width * 2
                val yBit = (y and 1) shl 1
                for (hc in 0 until hw) {
                    val qIdx = pr or (hc and 1)
                    val cSrc = phaseHere[qIdx]
                    val wbSrc = wb[cSrc]
                    val bSrc = black[qIdx]
                    val lowSrcArr = lowCh[cSrc]
                    val xBase = hc shl 1
                    for (subX in 0..1) {
                        val dIdx = yBit or subX
                        val cDst = phaseHere[dIdx]
                        val rawVal = rawShort[rawRowOff + xBase + subX].toInt() and 0xFFFF
                        val outVal = if (cSrc == cDst) {
                            val bDiff = black[dIdx] - bSrc
                            if (bDiff == 0f) rawVal else (rawVal + bDiff.roundToInt()).coerceIn(0, whiteLevel)
                        } else {
                            val hcB = if (subX == 0) max(0, hc - 1) else min(hw - 1, hc + 1)
                            val i00 = rowA + hc
                            val i01 = rowA + hcB
                            val i10 = rowB + hc
                            val i11 = rowB + hcB
                            val lowDstArr = lowCh[cDst]
                            val lSrc = 0.5625f * lowSrcArr[i00] + 0.1875f * (lowSrcArr[i01] + lowSrcArr[i10]) + 0.0625f * lowSrcArr[i11]
                            val lDst = 0.5625f * lowDstArr[i00] + 0.1875f * (lowDstArr[i01] + lowDstArr[i10]) + 0.0625f * lowDstArr[i11]
                            val wHi = 0.5625f * lowWhi[i00] + 0.1875f * (lowWhi[i01] + lowWhi[i10]) + 0.0625f * lowWhi[i11]
                            val uSrcWb = (rawVal - bSrc) * wbSrc
                            val uDstWb = lDst + wHi * (uSrcWb - lSrc)
                            val f = uDstWb * invWb[cDst] + black[dIdx]
                            (if (f <= 0f) 0 else (f + 0.5f).toInt()).coerceAtMost(whiteLevel)
                        }
                        outBytes[outOff++] = outVal.toByte()
                        outBytes[outOff++] = (outVal ushr 8).toByte()
                    }
                }
            }
        }
    }

    private fun reflect(i: Int, n: Int): Int = when {
        i < 0 -> (-i).coerceAtMost(n - 1)
        i >= n -> (2 * (n - 1) - i).coerceAtLeast(0)
        else -> i
    }

    internal fun unpackRaw10Row(rowIn: ByteArray, width: Int, rowOut: ByteArray) {
        var o = 0
        var i = 0
        val limit = width / 4 * 5
        while (i < limit) {
            val low = rowIn[i + 4].toInt()
            for (k in 0 until 4) {
                val v = ((rowIn[i + k].toInt() and 0xFF) shl 2) or ((low ushr (2 * k)) and 3)
                rowOut[o++] = v.toByte()
                rowOut[o++] = (v ushr 8).toByte()
            }
            i += 5
        }
    }

    internal fun cfaPattern(cfaEnum: Int): ByteArray = when (cfaEnum) {
        CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_RGGB -> byteArrayOf(0, 1, 1, 2)
        CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GRBG -> byteArrayOf(1, 0, 2, 1)
        CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG -> byteArrayOf(1, 2, 0, 1)
        CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_BGGR -> byteArrayOf(2, 1, 1, 0)
        else -> byteArrayOf(0, 1, 1, 2)
    }

    private fun exposureRational(exposureNs: Long): Pair<Long, Long> {
        var num = exposureNs
        var den = 1_000_000_000L
        while (num > 0xFFFFFFFFL && den > 1L) {
            num = num ushr 1
            den = den ushr 1
        }
        return num to den
    }

    private fun formatCaptureTime(c: CameraCharacteristics, r: CaptureResult): String {
        val now = System.currentTimeMillis()
        val source = c.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)
            ?: CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_UNKNOWN
        val offset = if (source == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME) {
            now - SystemClock.elapsedRealtime()
        } else {
            now - SystemClock.uptimeMillis()
        }
        val captureMs = r.get(CaptureResult.SENSOR_TIMESTAMP)?.let { it / 1_000_000L + offset } ?: now
        return SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getDefault()
        }.format(Date(captureMs))
    }

    private fun buildNoiseProfile(r: CaptureResult, cfa: ByteArray): DoubleArray? {
        val profile = r.get(CaptureResult.SENSOR_NOISE_PROFILE) ?: return null
        if (profile.size != 4) return null
        val out = DoubleArray(6)
        for (plane in 0 until 3) {
            var found = false
            var bestS = 0.0
            var bestO = 0.0
            for (ch in 0 until 4) {
                val s = profile[ch].first
                val o = profile[ch].second
                if (cfa[ch].toInt() == plane && (!found || s > bestS)) {
                    bestS = s
                    bestO = o
                    found = true
                }
            }
            if (!found) return null
            out[plane * 2] = bestS
            out[plane * 2 + 1] = bestO
        }
        return out
    }

    /** OpcodeList2: 4 Bayer GainMap opcodes (big-endian) from the capture's lens shading map. */
    private fun buildOpcodeList2(r: CaptureResult, cfaEnum: Int, activeW: Int, activeH: Int): ByteArray? {
        val lsm = r.get(CaptureResult.STATISTICS_LENS_SHADING_CORRECTION_MAP) ?: return null
        val w = lsm.columnCount
        val h = lsm.rowCount
        if (w < 1 || h < 1) return null
        val factors = FloatArray(w * h * 4)
        lsm.copyGainFactors(factors, 0)
        return buildBayerGainMapOpcodeList(w, h, activeW, activeH, cfaEnum, factors)
    }

    internal fun buildBayerGainMapOpcodeList(
        lsmW: Int,
        lsmH: Int,
        activeW: Int,
        activeH: Int,
        cfaEnum: Int,
        factors: FloatArray,
    ): ByteArray {
        // (top, left) offsets in the 2x2 Bayer cell for [R, G_even, G_odd, B], matching Android's DngUtils.cpp.
        val offsets = when (cfaEnum) {
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GRBG ->
                arrayOf(0 to 1, 0 to 0, 1 to 1, 1 to 0)
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG ->
                arrayOf(1 to 0, 0 to 0, 1 to 1, 0 to 1)
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_BGGR ->
                arrayOf(1 to 1, 0 to 1, 1 to 0, 0 to 0)
            else ->
                arrayOf(0 to 0, 0 to 1, 1 to 0, 1 to 1)
        }
        val n = lsmW * lsmH
        val paramBytes = 76 + n * 4
        val perOpcode = 16 + paramBytes
        val spacingV = 1.0 / max(1, lsmH - 1)
        val spacingH = 1.0 / max(1, lsmW - 1)
        val buf = ByteBuffer.allocate(4 + 4 * perOpcode).order(ByteOrder.BIG_ENDIAN)
        buf.putInt(4) // 4 GainMap opcodes
        for (ch in 0 until 4) {
            val (top, left) = offsets[ch]
            buf.putInt(9)                       // GainMap opcode ID
            buf.put(byteArrayOf(1, 3, 0, 0))    // DNG 1.3
            buf.putInt(1)                       // Optional flag
            buf.putInt(paramBytes)
            buf.putInt(top)
            buf.putInt(left)
            buf.putInt(activeH)
            buf.putInt(activeW)
            buf.putInt(0)                       // Plane
            buf.putInt(1)                       // Planes
            buf.putInt(2)                       // RowPitch
            buf.putInt(2)                       // ColPitch
            buf.putInt(lsmH)                    // MapPointsV
            buf.putInt(lsmW)                    // MapPointsH
            buf.putDouble(spacingV)
            buf.putDouble(spacingH)
            buf.putDouble(0.0)                  // MapOriginV
            buf.putDouble(0.0)                  // MapOriginH
            buf.putInt(1)                       // MapPlanes
            for (i in 0 until n) buf.putFloat(factors[i * 4 + ch])
        }
        return buf.array()
    }

    /** OpcodeList3: WarpRectilinear opcode (big-endian) from the maximum-resolution intrinsic calibration & distortion. */
    private fun buildOpcodeList3(
        c: CameraCharacteristics,
        r: CaptureResult,
        preW: Int,
        preH: Int,
        xMin: Int,
        yMin: Int,
    ): ByteArray? {
        if (preW <= 1 || preH <= 1) return null
        // Prefer the capture result's per-frame calibration if its optical centre is in this mode's array; some HALs
        // report the binned mode's cx/cy even on a maximum-resolution capture, in which case use the static max-res tag.
        val resIntr = r.get(CaptureResult.LENS_INTRINSIC_CALIBRATION)?.takeIf {
            it.size >= 5 && kotlin.math.abs(it[2] - preW * 0.5f) < preW * 0.2f && kotlin.math.abs(it[3] - preH * 0.5f) < preH * 0.2f
        }
        val intr = resIntr ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            c.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION_MAXIMUM_RESOLUTION)
        } else null) ?: return null
        val dist = r.get(CaptureResult.LENS_DISTORTION)?.takeIf { resIntr != null && it.size >= 5 }
            ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                c.get(CameraCharacteristics.LENS_DISTORTION_MAXIMUM_RESOLUTION)
            } else null) ?: r.get(CaptureResult.LENS_DISTORTION) ?: return null
        if (intr.size < 5 || dist.size < 5) return null
        val f = intr[0]
        val cx = intr[2]
        val cy = intr[3]
        if (!(f > 0f) || dist.all { it == 0f }) return null
        return buildWarpRectilinearOpcodeList(dist, cx, cy, f, preW, preH, xMin, yMin)
    }

    internal fun buildWarpRectilinearOpcodeList(
        dist: FloatArray,
        cx: Float,
        cy: Float,
        f: Float,
        preW: Int,
        preH: Int,
        xMin: Int = 0,
        yMin: Int = 0,
    ): ByteArray {
        val d = FloatArray(6)
        d[0] = 1f
        for (i in 0 until 5) d[i + 1] = dist[i]
        normalizeLensDistortion(d, cx + xMin, cy + yMin, f, preW, preH, xMin, yMin)
        val mx = max(preW - cx, cx).toDouble()
        val my = max(preH - cy, cy).toDouble()
        val mSq = mx * mx + my * my
        val m = hypot(mx, my)
        val fSq = f.toDouble() * f.toDouble()
        val conv = doubleArrayOf(mSq / fSq, (mSq / fSq).pow(2), (mSq / fSq).pow(3), m / f, m / f)
        val coeffs = DoubleArray(6)
        coeffs[0] = d[0].toDouble()
        for (i in 0 until 5) coeffs[i + 1] = d[i + 1] * conv[i]
        val ocx = (cx.toDouble() / preW).coerceIn(0.0, 1.0)
        val ocy = (cy.toDouble() / preH).coerceIn(0.0, 1.0)

        val paramBytes = 4 + 6 * 8 + 2 * 8
        val buf = ByteBuffer.allocate(4 + 16 + paramBytes).order(ByteOrder.BIG_ENDIAN)
        buf.putInt(1)                           // 1 opcode
        buf.putInt(1)                           // WarpRectilinear opcode ID
        buf.put(byteArrayOf(1, 3, 0, 0))        // DNG 1.3
        buf.putInt(1)                           // Optional flag
        buf.putInt(paramBytes)
        buf.putInt(1)                           // NumPlanes
        for (c in coeffs) buf.putDouble(c)
        buf.putDouble(ocx)
        buf.putDouble(ocy)
        return buf.array()
    }

    private fun normalizeLensDistortion(
        d: FloatArray,
        cx: Float,
        cy: Float,
        f: Float,
        preW: Int,
        preH: Int,
        xMin: Int,
        yMin: Int,
    ) {
        fun inside(px: Double, py: Double): Boolean {
            val xp = (px - cx) / f
            val yp = (py - cy) / f
            val x2 = xp * xp
            val y2 = yp * yp
            val r2 = x2 + y2
            val xy2 = 2.0 * xp * yp
            val kr = d[0] + ((d[3] * r2 + d[2]) * r2 + d[1]) * r2
            val x = (xp * kr + d[4] * xy2 + d[5] * (r2 + 2.0 * x2)) * f + cx
            val y = (yp * kr + d[4] * (r2 + 2.0 * y2) + d[5] * xy2) * f + cy
            return x >= xMin && y >= yMin && x < xMin + preW && y < yMin + preH
        }
        var scale = 1.0
        var found = false
        while (scale > 0.5) {
            val left = cx * (1.0 - scale)
            val right = (preW - 1) * scale + cx * (1.0 - scale)
            val top = cy * (1.0 - scale)
            val bottom = (preH - 1) * scale + cy * (1.0 - scale)
            if (inside(left, top) && inside(cx.toDouble(), top) && inside(right, top) &&
                inside(left, cy.toDouble()) && inside(right, cy.toDouble()) &&
                inside(left, bottom) && inside(cx.toDouble(), bottom) && inside(right, bottom)
            ) {
                found = true
                break
            }
            scale -= 0.002
        }
        if (found) {
            val powers = intArrayOf(1, 3, 5, 7, 2, 2)
            for (i in 0 until 6) d[i] = (d[i] * scale.pow(powers[i])).toFloat()
        }
    }

    private fun gpsIfdEntries(loc: Location): List<Entry> {
        val alt = if (loc.hasAltitude()) loc.altitude else Double.NaN
        val g = ExifMetadata.Gps.of(loc.latitude, loc.longitude, alt, loc.time)
        fun dms(v: DoubleArray) = arrayOf(
            (v[0] * 1).roundToLong() to 1L,
            (v[1] * 1).roundToLong() to 1L,
            (v[2] * 10000).roundToLong() to 10000L,
        )
        val out = ArrayList<Entry>(9)
        out += bytes(0, byteArrayOf(2, 3, 0, 0))
        out += ascii(1, g.latitudeRef)
        out += rationals(2, *dms(g.latitude))
        out += ascii(3, g.longitudeRef)
        out += rationals(4, *dms(g.longitude))
        if (g.altitude.isFinite()) {
            out += bytes(5, byteArrayOf(if (g.belowSeaLevel) 1 else 0))
            out += rationals(6, (g.altitude * 100).roundToLong() to 100L)
        }
        g.timeStamp?.takeIf { it.size == 3 }?.let { t ->
            out += rationals(7, t[0].roundToLong() to 1L, t[1].roundToLong() to 1L, (t[2] * 1000).roundToLong() to 1000L)
        }
        if (g.dateStamp.isNotEmpty()) out += ascii(29, g.dateStamp)
        return out
    }

    private fun matrix(tag: Int, t: ColorSpaceTransform): Entry {
        val pairs = Array(9) { i ->
            val r = t.getElement(i % 3, i / 3)
            r.numerator to r.denominator
        }
        return srationals(tag, *pairs)
    }

    internal fun le(size: Int, fill: ByteBuffer.() -> Unit): ByteArray =
        ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN).apply(fill).array()

    internal fun bytes(tag: Int, v: ByteArray) = Entry(tag, BYTE, v.size, if (v.size < 4) v.copyOf(4) else v)
    internal fun undefined(tag: Int, v: ByteArray) = Entry(tag, UNDEFINED, v.size, if (v.size < 4) v.copyOf(4) else v)
    internal fun ascii(tag: Int, s: String): Entry {
        val raw = (s + "\u0000").toByteArray(Charsets.UTF_8)
        return Entry(tag, ASCII, raw.size, if (raw.size < 4) raw.copyOf(4) else raw)
    }
    internal fun short(tag: Int, v: Int) = Entry(tag, SHORT, 1, le(4) { putShort(v.toShort()) })
    internal fun shorts(tag: Int, v: IntArray) = Entry(tag, SHORT, max(1, v.size), le(max(4, v.size * 2)) { v.forEach { putShort(it.toShort()) } })
    internal fun long(tag: Int, v: Int) = Entry(tag, LONG, 1, le(4) { putInt(v) })
    internal fun longs(tag: Int, v: IntArray) = Entry(tag, LONG, v.size, le(max(4, v.size * 4)) { v.forEach(::putInt) })
    internal fun rationals(tag: Int, vararg v: Pair<Long, Long>) =
        Entry(tag, RATIONAL, v.size, le(v.size * 8) { v.forEach { putInt(it.first.toInt()); putInt(it.second.toInt()) } })
    internal fun srationals(tag: Int, vararg v: Pair<Int, Int>) =
        Entry(tag, SRATIONAL, v.size, le(v.size * 8) { v.forEach { putInt(it.first); putInt(it.second) } })
    internal fun doubles(tag: Int, v: DoubleArray) =
        Entry(tag, DOUBLE, v.size, le(v.size * 8) { v.forEach(::putDouble) })
}
