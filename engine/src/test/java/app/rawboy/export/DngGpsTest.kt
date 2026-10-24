package app.rawboy.export

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Camera's geotagging: the GPS tags from a fix, and the GPS IFD appended to a DNG ([DngGps]). */
class DngGpsTest {
    @Test
    fun gpsFromAFix() {
        // 2026-10-24 18:05:09.250 UTC, south and west, below sea level.
        val g = ExifMetadata.Gps.of(-33.5, -70.25, -12.5, 1_792_865_109_250L)
        assertEquals("S", g.latitudeRef)
        assertArrayEquals(doubleArrayOf(33.0, 30.0, 0.0), g.latitude, 1e-6)
        assertEquals("W", g.longitudeRef)
        assertArrayEquals(doubleArrayOf(70.0, 15.0, 0.0), g.longitude, 1e-6)
        assertEquals(12.5, g.altitude, 0.0)
        assertTrue(g.belowSeaLevel)
        assertArrayEquals(doubleArrayOf(18.0, 5.0, 9.25), g.timeStamp!!, 1e-9)
        assertEquals("2026:10:24", g.dateStamp)
    }

    /** IFD entries at [offset]: tag -> (type, count, value bytes). */
    private fun entries(file: ByteArray, offset: Int): Map<Int, Triple<Int, Int, ByteArray>> {
        val b = ByteBuffer.wrap(file).order(ByteOrder.LITTLE_ENDIAN)
        val sizes = mapOf(1 to 1, 2 to 1, 3 to 2, 4 to 4, 5 to 8, 7 to 1, 10 to 8)
        return (0 until b.getShort(offset).toInt()).associate { i ->
            val p = offset + 2 + i * 12
            val type = b.getShort(p + 2).toInt()
            val count = b.getInt(p + 4)
            val size = sizes.getValue(type) * count
            val at = if (size <= 4) p + 8 else b.getInt(p + 8)
            (b.getShort(p).toInt() and 0xffff) to Triple(type, count, file.copyOfRange(at, at + size))
        }
    }

    private fun rationals(bytes: ByteArray): List<Double> {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        return (0 until bytes.size / 8).map { (b.getInt(it * 8).toLong() and 0xffffffffL).toDouble() / b.getInt(it * 8 + 4) }
    }

    @Test
    fun appendsAFullGpsIfdAndRepointsIfd0() {
        // A TIFF with latitude and longitude only, as DngCreator.setLocation writes them.
        val partial = ExifMetadata.Gps(doubleArrayOf(48.0, 8.0, 12.5), "N", doubleArrayOf(24.0, 30.0, 1.25), "E", Double.NaN, false)
        val file = File.createTempFile("rawboy", ".dng")
        try {
            RandomAccessFile(file, "rw").channel.use { ch ->
                val writer = TiffWriter(ch, 15, 4, 8, ExifMetadata(make = "Google", gps = partial))
                writer.writeRows(ShortArray(15 * 4 * 3) { 1000.toShort() }, 4)
                writer.finish()
            }
            val before = file.readBytes()
            val full = ExifMetadata.Gps.of(48.136, 24.5, 1840.25, 1_792_865_109_250L)
            val done = RandomAccessFile(file, "rw").use { raf ->
                DngGps.write(
                    full, raf.length(),
                    read = { offset, length ->
                        val b = ByteArray(length)
                        raf.seek(offset)
                        b.copyOf(maxOf(0, raf.read(b)))
                    },
                    write = { offset, bytes -> raf.seek(offset); raf.write(bytes) },
                )
            }
            assertTrue(done)
            val after = file.readBytes()
            val b = ByteBuffer.wrap(after).order(ByteOrder.LITTLE_ENDIAN)
            val ifd0 = entries(after, b.getInt(4))
            val gpsAt = ByteBuffer.wrap(ifd0.getValue(0x8825).third).order(ByteOrder.LITTLE_ENDIAN).getInt(0)
            assertEquals((before.size + 1) and 1.inv(), gpsAt)
            // Everything before the appended IFD is as it was, but for the pointer.
            assertEquals(before.size, after.indexOfFirstDifference(before) ?: before.size)
            val gps = entries(after, gpsAt)
            assertEquals("N", String(gps.getValue(1).third, Charsets.US_ASCII).trimEnd('\u0000'))
            assertEquals(listOf(48.0, 8.0, 9.6), rationals(gps.getValue(2).third).map { Math.round(it * 10) / 10.0 })
            assertEquals(0, gps.getValue(5).third[0].toInt())
            assertEquals(1840.25, rationals(gps.getValue(6).third)[0], 1e-9)
            assertEquals(listOf(18.0, 5.0, 9.25), rationals(gps.getValue(7).third))
            assertEquals("2026:10:24", String(gps.getValue(29).third, Charsets.US_ASCII).trimEnd('\u0000'))
        } finally {
            file.delete()
        }
    }

    /** The first index where this differs from [other] other than in IFD0's GPS pointer, or null. */
    private fun ByteArray.indexOfFirstDifference(other: ByteArray): Int? {
        val ifd = ByteBuffer.wrap(other).order(ByteOrder.LITTLE_ENDIAN).getInt(4)
        val pointer = (0 until ByteBuffer.wrap(other).order(ByteOrder.LITTLE_ENDIAN).getShort(ifd).toInt())
            .map { ifd + 2 + it * 12 }
            .first { ByteBuffer.wrap(other).order(ByteOrder.LITTLE_ENDIAN).getShort(it).toInt() and 0xffff == 0x8825 } + 8
        return other.indices.firstOrNull { it !in pointer until pointer + 4 && this[it] != other[it] }
    }

    @Test
    fun leavesFilesWithoutAGpsPointerAlone() {
        val file = File.createTempFile("rawboy", ".dng")
        try {
            RandomAccessFile(file, "rw").channel.use { ch ->
                val writer = TiffWriter(ch, 4, 4, 8, ExifMetadata(make = "Google"))
                writer.writeRows(ShortArray(4 * 4 * 3), 4)
                writer.finish()
            }
            val before = file.readBytes()
            val done = DngGps.write(
                ExifMetadata.Gps.of(1.0, 2.0, 3.0, 0L), before.size.toLong(),
                read = { offset, length -> before.copyOfRange(offset.toInt(), minOf(before.size, offset.toInt() + length)) },
                write = { _, _ -> error("must not write") },
            )
            assertFalse(done)
        } finally {
            file.delete()
        }
    }
}
