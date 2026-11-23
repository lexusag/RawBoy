package app.rawboy.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile

/** Tests for embedding and reading [DepthMap] trailers ([DngDepth]) in DNG files. */
class DngDepthTest {
    @Test
    fun roundTripsDepthMapTrailerAndPreservesTiffHeader() {
        val file = File.createTempFile("rawboy_depth", ".dng")
        try {
            RandomAccessFile(file, "rw").channel.use { ch ->
                val writer = TiffWriter(ch, 8, 6, 8, ExifMetadata(make = "Google"))
                writer.writeRows(ShortArray(8 * 6 * 3) { 512.toShort() }, 6)
                writer.finish()
            }
            val originalBytes = file.readBytes()
            val pixels = ByteArray(4 * 3) { i -> (i * 21).toByte() }
            val depth = DepthMap(
                width = 4,
                height = 3,
                data = pixels,
                hardware = true,
                subjectDetected = true,
                focusDepth = 0.24f,
            )

            RandomAccessFile(file, "rw").use { raf ->
                DngDepth.write(
                    depth = depth,
                    size = raf.length(),
                    read = { offset, length ->
                        val b = ByteArray(length)
                        raf.seek(offset)
                        b.copyOf(maxOf(0, raf.read(b)))
                    },
                    writeAt = { offset, bytes ->
                        raf.seek(offset)
                        raf.write(bytes)
                        raf.setLength(offset + bytes.size)
                    },
                )
            }

            val withDepth = file.readBytes()
            assertEquals(originalBytes.size + pixels.size + DngDepth.FOOTER_SIZE, withDepth.size)
            assertArrayEquals(originalBytes, withDepth.copyOfRange(0, originalBytes.size))

            val parsed = DngDepth.read(withDepth.size.toLong()) { offset, length ->
                withDepth.copyOfRange(offset.toInt(), minOf(withDepth.size, offset.toInt() + length))
            }
            assertNotNull(parsed)
            parsed!!
            assertEquals(4, parsed.width)
            assertEquals(3, parsed.height)
            assertTrue(parsed.hardware)
            assertTrue(parsed.subjectDetected)
            assertEquals(0.24f, parsed.focusDepth, 1e-4f)
            assertArrayEquals(pixels, parsed.data)
        } finally {
            file.delete()
        }
    }

    @Test
    fun replacesExistingDepthTrailerInsteadOfDuplicating() {
        val base = ByteArray(64) { 0x42 }
        val first = DepthMap(2, 2, byteArrayOf(10, 20, 30, 40), hardware = false, subjectDetected = false, focusDepth = 0.5f)
        val second = DepthMap(3, 2, byteArrayOf(1, 2, 3, 4, 5, 6), hardware = true, subjectDetected = true, focusDepth = 0.15f)

        var fileBytes = base + DngDepth.encodeTrailer(first)
        DngDepth.write(
            depth = second,
            size = fileBytes.size.toLong(),
            read = { offset, length -> fileBytes.copyOfRange(offset.toInt(), minOf(fileBytes.size, offset.toInt() + length)) },
            writeAt = { offset, bytes -> fileBytes = fileBytes.copyOf(offset.toInt()) + bytes },
        )

        assertEquals(base.size + second.data.size + DngDepth.FOOTER_SIZE, fileBytes.size)
        val parsed = DngDepth.read(fileBytes.size.toLong()) { offset, length ->
            fileBytes.copyOfRange(offset.toInt(), minOf(fileBytes.size, offset.toInt() + length))
        }!!
        assertEquals(3, parsed.width)
        assertEquals(2, parsed.height)
        assertTrue(parsed.hardware)
        assertTrue(parsed.subjectDetected)
        assertEquals(0.15f, parsed.focusDepth, 1e-4f)
        assertArrayEquals(second.data, parsed.data)
    }

    @Test
    fun returnsNullWhenNoDepthTrailerIsPresent() {
        val plain = ByteArray(128) { it.toByte() }
        val parsed = DngDepth.read(plain.size.toLong()) { offset, length ->
            plain.copyOfRange(offset.toInt(), minOf(plain.size, offset.toInt() + length))
        }
        assertNull(parsed)
    }

    @Test
    fun sampleUvInterpolatesDepthSmoothly() {
        val depth = DepthMap(
            width = 2,
            height = 2,
            data = byteArrayOf(0, 255.toByte(), 0, 255.toByte()),
            hardware = false,
            subjectDetected = true,
            focusDepth = 0.2f,
        )
        assertEquals(0f, depth.sampleUv(0f, 0f), 1e-4f)
        assertEquals(1f, depth.sampleUv(1f, 1f), 1e-4f)
        assertEquals(0.5f, depth.sampleUv(0.5f, 0.5f), 1e-4f)
        assertFalse(depth.hardware)
    }

    @Test
    fun millimetresWriteVersion2AndReadBack() {
        val mm = ShortArray(6) { i -> (500 + 1000 * i).toShort() }.also { it[5] = 65535.toShort() }
        val depth = DepthMap(3, 2, ByteArray(6) { it.toByte() }, hardware = true, subjectDetected = false, focusDepth = 0.5f, millimetres = mm)
        val file = ByteArray(64) { 7 } + DngDepth.encodeTrailer(depth)
        val footer = file.copyOfRange(file.size - DngDepth.FOOTER_SIZE, file.size)
        assertEquals(2, footer[4].toInt())
        val read = DngDepth.read(file.size.toLong()) { offset, length -> file.copyOfRange(offset.toInt(), offset.toInt() + length) }
        assertNotNull(read)
        assertArrayEquals(depth.data, read!!.data)
        assertArrayEquals(mm, read.millimetres)
        assertEquals(3500, read.millimetresAt(0, 1))
        assertEquals(65535, read.millimetresAt(2, 1))
        assertEquals(64L, DngDepth.trailerOffset(file.size.toLong()) { offset, length -> file.copyOfRange(offset.toInt(), offset.toInt() + length) })
        // Without millimetres the trailer stays version 1 (what older readers accept).
        val plain = DngDepth.encodeTrailer(DepthMap(3, 2, ByteArray(6)))
        assertEquals(1, plain[plain.size - DngDepth.FOOTER_SIZE + 4].toInt())
    }
}
