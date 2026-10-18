package app.rawboy.auto

import app.rawboy.gl.PreviewImage
import app.rawboy.raw.RawImage
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The detail view's preview of each analysed photo (the session's own size, [app.rawboy.session.PhotoSession.PREVIEW_MAX_DIMENSION]),
 * kept on disk so swiping to a photo shows its develop at once instead of after a full decode (seconds for a raw).
 * Written by the analysis, which has the full image decoded anyway. About 17 MB per photo; the oldest files go once
 * [maxBytes] is reached, and those photos fall back to the grid thumbnail until decoded. The batch isn't kept across
 * launches, so the folder starts empty. Thread-safe.
 */
class PreviewCache(private val dir: File, private val maxBytes: Long = MAX_BYTES) {
    /** Cached ids, oldest first, with their files. */
    private val entries = LinkedHashMap<String, File>()
    private var total = 0L
    private var nextFile = 0

    init {
        dir.deleteRecursively()
        dir.mkdirs()
    }

    @Synchronized
    fun put(id: String, image: PreviewImage) {
        remove(id)
        val file = File(dir, "${nextFile++}.f16")
        try {
            RandomAccessFile(file, "rw").use { f ->
                val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.nativeOrder())
                header.putInt(image.width).putInt(image.height).putInt(image.fullWidth).putInt(image.fullHeight).flip()
                f.channel.write(header)
                val pixels = image.pixels.duplicate()
                pixels.rewind()
                while (pixels.hasRemaining()) f.channel.write(pixels)
            }
        } catch (e: Exception) {
            file.delete() // disk full or similar: this photo just isn't cached
            return
        }
        entries[id] = file
        total += file.length()
        while (total > maxBytes && entries.size > 1) remove(entries.keys.first())
    }

    /** The cached preview of [id], or null. Blocking (reads ~17 MB): call off the main thread. */
    @Synchronized
    fun get(id: String): PreviewImage? {
        val file = entries[id] ?: return null
        return try {
            RandomAccessFile(file, "r").use { f ->
                val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.nativeOrder())
                while (header.hasRemaining()) if (f.channel.read(header) < 0) return null
                header.flip()
                val w = header.int
                val h = header.int
                val fullW = header.int
                val fullH = header.int
                val pixels = ByteBuffer.allocateDirect(w * h * RawImage.BYTES_PER_PIXEL).order(ByteOrder.nativeOrder())
                while (pixels.hasRemaining()) if (f.channel.read(pixels) < 0) return null
                pixels.rewind()
                PreviewImage(w, h, pixels, fullW, fullH)
            }
        } catch (e: Exception) {
            null
        } catch (e: OutOfMemoryError) {
            null
        }
    }

    @Synchronized
    fun remove(id: String) {
        val file = entries.remove(id) ?: return
        total -= file.length()
        file.delete()
    }

    @Synchronized
    fun clear() {
        entries.keys.toList().forEach(::remove)
    }

    companion object {
        private const val HEADER_BYTES = 16
        /** About 90 photos at 2048 px. */
        const val MAX_BYTES = 1_500_000_000L
    }
}
