package app.rawboy.camera.capture

import android.hardware.camera2.CameraCharacteristics
import app.rawboy.camera.CameraSettings
import app.rawboy.export.DngGps
import app.rawboy.export.ExifMetadata
import app.rawboy.export.TiffEpTags
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

class MaxResDngWriterTest {
    @Test
    fun unpackRaw10Row() {
        val values = intArrayOf(0, 1, 2, 3, 511, 512, 1022, 1023)
        val packed = ByteArray(10)
        for (g in 0 until 2) {
            var low = 0
            for (k in 0 until 4) {
                val v = values[g * 4 + k]
                packed[g * 5 + k] = (v ushr 2).toByte()
                low = low or ((v and 3) shl (2 * k))
            }
            packed[g * 5 + 4] = low.toByte()
        }
        val out = ByteArray(16)
        MaxResDngWriter.unpackRaw10Row(packed, 8, out)
        val shorts = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val unpacked = IntArray(8) { shorts.get(it).toInt() and 0xFFFF }
        assertArrayEquals(values, unpacked)
    }

    @Test
    fun headerRoundTripWithTiffEpTagsAndDngGps() {
        val stripCounts = intArrayOf(2048, 2048, 1024)
        val stripOffsets = MaxResDngWriter.longs(273, IntArray(stripCounts.size))
        val gpsPtr = MaxResDngWriter.long(34853, 0)
        val ifd0 = listOf(
            MaxResDngWriter.long(254, 0),
            MaxResDngWriter.long(256, 8160),
            MaxResDngWriter.long(257, 6144),
            stripOffsets,
            MaxResDngWriter.longs(279, stripCounts),
            MaxResDngWriter.rationals(33434, 10_000_000L to 1_000_000_000L),
            MaxResDngWriter.rationals(33437, 168L to 100L),
            gpsPtr,
            MaxResDngWriter.short(34855, 64),
            MaxResDngWriter.ascii(36867, "2026:10:30 11:45:00"),
            MaxResDngWriter.rationals(37386, 690L to 100L),
        )
        val gpsIfd = listOf(MaxResDngWriter.bytes(0, byteArrayOf(2, 3, 0, 0)))
        val header = MaxResDngWriter.serializeHeader(ifd0, gpsIfd, gpsPtr, stripOffsets, stripCounts)
        assertEquals(0, header.size % 4)

        // Verify tags are sorted in ascending order and strip offsets start right at header.size.
        val headBuf = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(42, headBuf.getShort(2).toInt())
        val ifdOffset = headBuf.getInt(4)
        val count = headBuf.getShort(ifdOffset).toInt() and 0xFFFF
        assertEquals(ifd0.size, count)
        var prevTag = -1
        for (i in 0 until count) {
            val e = ifdOffset + 2 + i * 12
            val tag = headBuf.getShort(e).toInt() and 0xFFFF
            assertTrue(tag > prevTag)
            prevTag = tag
            if (tag == 273) {
                val off = headBuf.getInt(e + 8)
                assertEquals(header.size, headBuf.getInt(off))
                assertEquals(header.size + 2048, headBuf.getInt(off + 4))
                assertEquals(header.size + 4096, headBuf.getInt(off + 8))
            }
        }

        // TiffEpTags must read exposure, aperture, ISO, focal length and DateTimeOriginal from IFD0.
        val ep = TiffEpTags.read { offset, length ->
            if (offset >= header.size) null
            else header.copyOfRange(offset.toInt(), minOf(header.size, offset.toInt() + length))
        }
        assertNotNull(ep)
        assertEquals(10_000_000L to 1_000_000_000L, ep!!.exposureTime)
        assertEquals(168L to 100L, ep.fNumber)
        assertEquals(64, ep.iso)
        assertEquals(690L to 100L, ep.focalLength)
        assertEquals("2026:10:30 11:45:00", ep.dateTimeOriginal)

        // DngGps must locate tag 0x8825 (34853) and append the full GPS IFD cleanly.
        var file = header + ByteArray(stripCounts.sum())
        val gps = ExifMetadata.Gps.of(50.4501, 30.5234, 179.5, 1_761_820_000_000L)
        val wrote = DngGps.write(
            gps,
            file.size.toLong(),
            read = { offset, length ->
                if (offset >= file.size) null
                else file.copyOfRange(offset.toInt(), minOf(file.size, offset.toInt() + length))
            },
            write = { offset, bytes ->
                val end = offset.toInt() + bytes.size
                if (end > file.size) file = file.copyOf(end)
                System.arraycopy(bytes, 0, file, offset.toInt(), bytes.size)
            },
        )
        assertTrue(wrote)
        assertTrue(file.size > header.size + stripCounts.sum())
    }

    @Test
    fun bayerGainMapAndWarpOpcodesAreBigEndianDng13() {
        val factors = FloatArray(2 * 3 * 4) { 1f + it * 0.01f }
        val op2 = MaxResDngWriter.buildBayerGainMapOpcodeList(
            lsmW = 3, lsmH = 2, activeW = 8160, activeH = 6144,
            cfaEnum = CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG,
            factors = factors,
        )
        val b2 = ByteBuffer.wrap(op2).order(ByteOrder.BIG_ENDIAN)
        assertEquals(4, b2.getInt(0))
        assertEquals(9, b2.getInt(4)) // GainMap ID
        assertEquals(1, b2.get(8).toInt())
        assertEquals(3, b2.get(9).toInt())
        val paramBytes = 76 + 6 * 4
        assertEquals(paramBytes, b2.getInt(16))
        // GBRG: R is at (row=1, col=0)
        assertEquals(1, b2.getInt(20))
        assertEquals(0, b2.getInt(24))
        assertEquals(6144, b2.getInt(28))
        assertEquals(8160, b2.getInt(32))

        val op3 = MaxResDngWriter.buildWarpRectilinearOpcodeList(
            dist = floatArrayOf(0.02f, -0.05f, 0.01f, 0f, 0f),
            cx = 4089.75f, cy = 3072.18f, f = 5689.05f,
            preW = 8160, preH = 6144,
        )
        val b3 = ByteBuffer.wrap(op3).order(ByteOrder.BIG_ENDIAN)
        assertEquals(1, b3.getInt(0))
        assertEquals(1, b3.getInt(4)) // WarpRectilinear ID
        assertEquals(68, b3.getInt(16))
        assertEquals(1, b3.getInt(20)) // NumPlanes
        val k0 = b3.getDouble(24)
        assertTrue(k0 in 0.8..1.05)
        val ocx = b3.getDouble(24 + 48)
        val ocy = b3.getDouble(24 + 56)
        assertEquals(4089.75 / 8160.0, ocx, 1e-5)
        assertEquals(3072.18 / 6144.0, ocy, 1e-5)
    }

    @Test
    fun hiResCalibrationFallsBackToNormalUntilLearned() {
        val s = CameraSettings(previewScales = mapOf("W" to 0.72f), lens = "W")
        assertEquals("W", s.lensKey(false))
        assertEquals("HW", s.lensKey(true))
        assertEquals(0.72f, s.previewScale(true), 1e-6f)
        val learned = s.copy(previewScales = s.previewScales + ("HW" to 0.68f))
        assertEquals(0.72f, learned.previewScale(false), 1e-6f)
        assertEquals(0.68f, learned.previewScale(true), 1e-6f)
    }

    @Test
    fun isQuadBayerDistinguishesQuadAndStandardBayer() {
        val w = 64
        val h = 64
        val cfaEnums = intArrayOf(
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_RGGB,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GRBG,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_BGGR,
        )
        for (cfaEnum in cfaEnums) {
            val cfa = MaxResDngWriter.cfaPattern(cfaEnum)
            val quad = ShortArray(w * h)
            val bayer = ShortArray(w * h)
            for (y in 0 until h) {
                for (x in 0 until w) {
                    // Smooth luminance gradient + realistic camera un-white-balanced RGB sensitivity ratios
                    val lum = 180 + (x * 4) + (y * 2)
                    val qColor = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
                    val bColor = cfa[((y and 1) shl 1) or (x and 1)].toInt()
                    val scaleQ = when (qColor) { 0 -> 0.55f; 1 -> 1.0f; else -> 0.65f }
                    val scaleB = when (bColor) { 0 -> 0.55f; 1 -> 1.0f; else -> 0.65f }
                    quad[y * w + x] = (64f + lum * scaleQ).toInt().toShort()
                    bayer[y * w + x] = (64f + lum * scaleB).toInt().toShort()
                }
            }
            val quadSrc = MaxResDngWriter.RowSource { y, dst, off -> System.arraycopy(quad, y * w, dst, off, w) }
            val bayerSrc = MaxResDngWriter.RowSource { y, dst, off -> System.arraycopy(bayer, y * w, dst, off, w) }
            assertTrue(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = false, quadSrc))
            assertTrue(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = true, quadSrc))
            assertFalse(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = false, bayerSrc))
            assertFalse(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = true, bayerSrc))
        }

        // Pitch-black frame falls back to the Camera2 ULTRA_HIGH_RESOLUTION_SENSOR capability contract.
        val dark = ShortArray(w * h) { 64 }
        val darkSrc = MaxResDngWriter.RowSource { y, dst, off -> System.arraycopy(dark, y * w, dst, off, w) }
        assertTrue(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = false, darkSrc))
        assertFalse(MaxResDngWriter.isQuadBayer(w, h, 959f, hasUltraHighResCapability = true, darkSrc))
    }

    @Test
    fun quadBayerRemosaicRecoversFlatColoursSharpNeutralEdgesAndSafeHighlights() {
        val w = 64
        val h = 48
        val black = floatArrayOf(64f, 64f, 64f, 64f)
        val whiteLevel = 1023
        val wb = floatArrayOf(1.9f, 1.0f, 1.55f)
        val cfaEnums = intArrayOf(
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_RGGB,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GRBG,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG,
            CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_BGGR,
        )

        for (cfaEnum in cfaEnums) {
            val cfa = MaxResDngWriter.cfaPattern(cfaEnum)

            // 1. Uniform coloured patch: every remosaiced 2x2 Bayer pixel must equal its true RGB channel value.
            val trueRgb = intArrayOf(210, 420, 280)
            val flatQuad = ShortArray(w * h) { idx ->
                val y = idx / w
                val x = idx % w
                val c = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
                trueRgb[c].toShort()
            }
            val flatOut = remosaicFull(flatQuad, w, h, rowsPerStrip = 8, cfa, black, whiteLevel, wb)
            for (y in 0 until h) {
                for (x in 0 until w) {
                    val expected = trueRgb[cfa[((y and 1) shl 1) or (x and 1)].toInt()]
                    assertEquals("cfa=$cfaEnum at ($x,$y)", expected, flatOut[y * w + x])
                }
            }

            // 2. Sharp 1-pixel neutral vertical bar at x = 31 (single column inside a 2x2 superpixel):
            // full-res contrast must survive without blurring into x = 30 or x = 32, and matching CFA sites stay exact.
            val lineQuad = ShortArray(w * h) { idx ->
                val y = idx / w
                val x = idx % w
                val c = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
                val lumWb = if (x == 31) 520f else 180f
                (64f + lumWb / wb[c] + 0.5f).toInt().toShort()
            }
            val lineOut = remosaicFull(lineQuad, w, h, rowsPerStrip = 4, cfa, black, whiteLevel, wb)
            for (y in 8 until h - 8) {
                for (x in 8 until w - 8) {
                    val qC = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
                    val dC = cfa[((y and 1) shl 1) or (x and 1)].toInt()
                    if (qC == dC) {
                        assertEquals(lineQuad[y * w + x].toInt() and 0xFFFF, lineOut[y * w + x])
                    }
                    if (abs(x - 31) >= 8) {
                        val expectedRaw = (64f + 180f / wb[dC] + 0.5f).toInt()
                        assertTrue("flat region at ($x,$y)", abs(lineOut[y * w + x] - expectedRaw) <= 1)
                    }
                }
                // Inside the same 2x2 superpixel (hc = 15 -> x = 30 is dark, x = 31 is bright), directional Hamilton-Adams
                // + colour-difference keeps both pixels within integer rounding of 180 and 520 without false chroma.
                val c30 = cfa[((y and 1) shl 1) or 0].toInt()
                val c31 = cfa[((y and 1) shl 1) or 1].toInt()
                val lum30 = (lineOut[y * w + 30] - 64f) * wb[c30]
                val lum31 = (lineOut[y * w + 31] - 64f) * wb[c31]
                assertTrue("x=30 lumWb=$lum30", lum30 in 176f..184f)
                assertTrue("x=31 lumWb=$lum31", lum31 in 516f..524f)
            }

            // 3. Single-channel highlight saturation (G clipped at 1023, R=440, B=760 unclipped):
            // unclipped R and B channels must not be corrupted by clipped G.
            val hiRgb = intArrayOf(440, 1023, 760)
            val hiQuad = ShortArray(w * h) { idx ->
                val y = idx / w
                val x = idx % w
                val c = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
                hiRgb[c].toShort()
            }
            val hiOut = remosaicFull(hiQuad, w, h, rowsPerStrip = 8, cfa, black, whiteLevel, wb)
            for (y in 4 until h - 4) {
                for (x in 4 until w - 4) {
                    val expected = hiRgb[cfa[((y and 1) shl 1) or (x and 1)].toInt()]
                    assertTrue("highlight bleed at ($x,$y)", abs(hiOut[y * w + x] - expected) <= 1)
                }
            }
        }
    }

    @Test
    fun multiStripParallelRemosaicMatchesSingleStripBitExact() {
        val w = 64
        val h = 48
        val cfa = MaxResDngWriter.cfaPattern(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_GBRG)
        val black = floatArrayOf(64f, 64f, 64f, 64f)
        val wb = floatArrayOf(1.85f, 1.0f, 1.52f)
        val quad = ShortArray(w * h) { idx ->
            val y = idx / w
            val x = idx % w
            val c = cfa[((y ushr 1 and 1) shl 1) or (x ushr 1 and 1)].toInt()
            val pattern = ((x * 37 + y * 53 + (x xor y) * 19) % 700)
            val base = when (c) {
                0 -> 80 + pattern / 2
                1 -> 90 + pattern
                else -> 75 + pattern * 2 / 3
            }
            base.coerceIn(60, 1023).toShort()
        }
        val src = MaxResDngWriter.RowSource { y, dst, off -> System.arraycopy(quad, y * w, dst, off, w) }
        val singleOut = ByteArrayOutputStream()
        val multiOut = ByteArrayOutputStream()
        MaxResDngWriter.writeRemosaicedPixels(w, h, rowsPerStrip = h, cfa, black, 1023, wb, singleOut) { src }
        MaxResDngWriter.writeRemosaicedPixels(w, h, rowsPerStrip = 4, cfa, black, 1023, wb, multiOut) { src }
        assertArrayEquals(singleOut.toByteArray(), multiOut.toByteArray())
    }

    private fun remosaicFull(
        quad: ShortArray,
        w: Int,
        h: Int,
        rowsPerStrip: Int,
        cfa: ByteArray,
        black: FloatArray,
        whiteLevel: Int,
        wb: FloatArray,
    ): IntArray {
        val src = MaxResDngWriter.RowSource { y, dst, off -> System.arraycopy(quad, y * w, dst, off, w) }
        val bos = ByteArrayOutputStream()
        MaxResDngWriter.writeRemosaicedPixels(w, h, rowsPerStrip, cfa, black, whiteLevel, wb, bos) { src }
        val shorts = ByteBuffer.wrap(bos.toByteArray()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        return IntArray(w * h) { shorts.get(it).toInt() and 0xFFFF }
    }
}
