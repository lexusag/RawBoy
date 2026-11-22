package app.rawboy.camera.stab

import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * An MP4's creation and modification times (seconds since 1904, as the file stores them), read from its `mvhd` and
 * written into `mvhd`, every `tkhd` and every `mdhd`. Galleries date a video by them, so a stabilized copy carrying the
 * original's times sits next to it instead of at the time it was rendered.
 */
object Mp4Times {
    class Times(val creation: Long, val modification: Long)

    /** Positional reads and writes on a file. */
    interface Io {
        val size: Long
        fun read(buffer: ByteBuffer, position: Long): Int
        fun write(buffer: ByteBuffer, position: Long): Int
    }

    /** [Io] on a channel (opened for writing too if [write] is used). */
    fun io(channel: FileChannel) = object : Io {
        override val size get() = channel.size()
        override fun read(buffer: ByteBuffer, position: Long) = channel.read(buffer, position)
        override fun write(buffer: ByteBuffer, position: Long) = channel.write(buffer, position)
    }

    /** The movie header's times, or null when the file has none. */
    fun read(file: Io): Times? {
        val moov = boxes(file, 0, file.size).firstOrNull { it.type == "moov" } ?: return null
        val mvhd = boxes(file, moov.body, moov.end).firstOrNull { it.type == "mvhd" } ?: return null
        val b = ByteBuffer.allocate(20)
        file.read(b, mvhd.body)
        b.flip()
        if (b.remaining() < 12) return null
        return if (b.get(0).toInt() == 1) {
            if (b.remaining() < 20) return null
            Times(b.getLong(4), b.getLong(12))
        } else {
            Times(b.getInt(4).toLong() and 0xffffffffL, b.getInt(8).toLong() and 0xffffffffL)
        }
    }

    /** Writes [times] into the movie, track and media headers; false when the file has no movie header. */
    fun write(file: Io, times: Times): Boolean {
        val moov = boxes(file, 0, file.size).firstOrNull { it.type == "moov" } ?: return false
        var wrote = false
        fun visit(start: Long, end: Long) {
            for (box in boxes(file, start, end)) when (box.type) {
                "trak", "mdia" -> visit(box.body, box.end)
                "mvhd", "tkhd", "mdhd" -> {
                    stamp(file, box, times)
                    if (box.type == "mvhd") wrote = true
                }
            }
        }
        visit(moov.body, moov.end)
        return wrote
    }

    private fun stamp(file: Io, box: Box, times: Times) {
        val v = ByteBuffer.allocate(1)
        file.read(v, box.body)
        val b = if (v.get(0).toInt() == 1) {
            ByteBuffer.allocate(16).putLong(times.creation).putLong(times.modification)
        } else {
            ByteBuffer.allocate(8).putInt(times.creation.toInt()).putInt(times.modification.toInt())
        }
        b.flip()
        file.write(b, box.body + 4)
    }

    /** A box: [body] is where its content starts (after the size and type), [end] where the next box starts. */
    private class Box(val type: String, val body: Long, val end: Long)

    private fun boxes(file: Io, start: Long, end: Long): List<Box> {
        val list = ArrayList<Box>()
        var at = start
        val header = ByteBuffer.allocate(16)
        while (at + 8 <= end) {
            header.clear()
            file.read(header, at)
            header.flip()
            if (header.remaining() < 8) break
            var size = header.getInt(0).toLong() and 0xffffffffL
            val type = String(ByteArray(4) { header.get(4 + it) }, Charsets.ISO_8859_1)
            var body = at + 8
            if (size == 1L) {
                if (header.remaining() < 16) break
                size = header.getLong(8)
                body = at + 16
            } else if (size == 0L) {
                size = end - at
            }
            if (size < body - at || at + size > end) break
            list += Box(type, body, at + size)
            at += size
        }
        return list
    }
}
