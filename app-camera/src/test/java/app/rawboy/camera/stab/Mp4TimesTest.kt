package app.rawboy.camera.stab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer

class Mp4TimesTest {
    private fun box(type: String, vararg body: ByteArray): ByteArray {
        val content = ByteArrayOutputStream().apply { body.forEach { write(it) } }.toByteArray()
        return ByteBuffer.allocate(8 + content.size).putInt(8 + content.size).put(type.toByteArray()).put(content).array()
    }

    /** A full box header with times: version 0 (32-bit) or 1 (64-bit), then 8 bytes of other fields. */
    private fun timed(type: String, version: Int, creation: Long, modification: Long): ByteArray {
        val b = ByteBuffer.allocate(if (version == 1) 4 + 16 + 8 else 4 + 8 + 8).putInt(version shl 24)
        if (version == 1) b.putLong(creation).putLong(modification) else b.putInt(creation.toInt()).putInt(modification.toInt())
        b.putLong(0x1122334455667788)
        return box(type, b.array())
    }

    private fun file(bytes: ByteArray) = File.createTempFile("mp4times", ".mp4").apply { writeBytes(bytes); deleteOnExit() }

    private fun <T> open(f: File, block: (Mp4Times.Io) -> T): T =
        RandomAccessFile(f, "rw").use { block(Mp4Times.io(it.channel)) }

    @Test
    fun copiesTimesIntoEveryHeader() {
        val original = file(box("ftyp", ByteArray(8)) + box("mdat", ByteArray(32)) +
            box("moov", timed("mvhd", 0, 3_900_000_000L, 3_900_000_005L)))
        val times = open(original) { Mp4Times.read(it) }!!
        assertEquals(3_900_000_000L, times.creation)
        assertEquals(3_900_000_005L, times.modification)

        // The copy: moov at the end, a 64-bit mdhd, two tracks.
        val track = { box("trak", timed("tkhd", 0, 1, 2), box("mdia", timed("mdhd", 1, 1, 2), box("hdlr", ByteArray(4)))) }
        val copyBytes = box("ftyp", ByteArray(8)) + box("mdat", ByteArray(64)) + box("moov", timed("mvhd", 0, 1, 2), track(), track())
        val copy = file(copyBytes)
        assertTrue(open(copy) { Mp4Times.write(it, times) })
        val after = copy.readBytes()
        assertEquals(copyBytes.size, after.size)
        open(copy) { assertEquals(3_900_000_000L, Mp4Times.read(it)!!.creation) }
        // Every header got the times; the fields after them are untouched.
        val buf = ByteBuffer.wrap(after)
        var stamped = 0
        for (i in 0 until after.size - 4) {
            val type = String(after, i, 4)
            if (type == "tkhd" || type == "mdhd" || type == "mvhd") {
                val v1 = after[i + 4].toInt() == 1
                val c = if (v1) buf.getLong(i + 8) else buf.getInt(i + 8).toLong() and 0xffffffffL
                val m = if (v1) buf.getLong(i + 16) else buf.getInt(i + 12).toLong() and 0xffffffffL
                assertEquals(type, 3_900_000_000L, c)
                assertEquals(type, 3_900_000_005L, m)
                assertEquals(type, 0x1122334455667788, buf.getLong(i + if (v1) 24 else 16))
                stamped++
            }
        }
        assertEquals(5, stamped)
    }

    @Test
    fun noMovieHeader() {
        val f = file(box("ftyp", ByteArray(8)) + box("mdat", ByteArray(8)))
        assertNull(open(f) { Mp4Times.read(it) })
        assertEquals(false, open(f) { Mp4Times.write(it, Mp4Times.Times(1, 2)) })
    }
}
