package app.rawboy.export

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Puts a full GPS IFD into a DNG that DngCreator wrote (RawBoy Camera's geotagging). DngCreator.setLocation writes
 * latitude, longitude and the fix's UTC date and time, but no altitude; this appends a GPS IFD with all of them
 * ([ExifWriter.gpsIfd]) at the end of the file and points IFD0's GPSInfo tag at it. DngCreator's own GPS IFD stays in
 * the file, unreferenced.
 */
object DngGps {
    private const val GPS_IFD = 0x8825
    private const val LONG = 4
    private const val IFD = 13

    /**
     * [read] returns [length] bytes at [offset] (fewer or null past the end), [write] writes bytes at an offset,
     * [size] is the file's length. Returns false (the file unchanged) unless it is a little-endian TIFF whose IFD0
     * has a GPSInfo tag (DngCreator writes "II" files, and the tag when it was given a location).
     */
    fun write(
        gps: ExifMetadata.Gps,
        size: Long,
        read: (offset: Long, length: Int) -> ByteArray?,
        write: (offset: Long, bytes: ByteArray) -> Unit,
    ): Boolean {
        val header = read(0, 8)?.takeIf { it.size == 8 } ?: return false
        if (header[0] != 'I'.code.toByte() || header[1] != 'I'.code.toByte()) return false
        val head = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
        if (head.getShort(2).toInt() != 42) return false
        val ifd = head.getInt(4).toLong() and 0xffffffffL
        val count = read(ifd, 2)?.takeIf { it.size == 2 }
            ?.let { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).getShort(0).toInt() and 0xffff } ?: return false
        val entries = read(ifd + 2, count * 12)?.takeIf { it.size == count * 12 }
            ?.let { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN) } ?: return false
        val pointer = (0 until count).map { it * 12 }.firstOrNull { e ->
            (entries.getShort(e).toInt() and 0xffff) == GPS_IFD && entries.getShort(e + 2).toInt() in setOf(LONG, IFD) &&
                entries.getInt(e + 4) == 1
        } ?: return false
        // IFDs start on a word boundary; TIFF offsets are 32 bits.
        val at = (size + 1) and 1L.inv()
        if (at + 4096 > 0xffffffffL) return false
        write(size, ByteArray((at - size).toInt()) + ExifWriter.gpsIfd(gps, at.toInt())) // a pad byte, then the IFD
        write(ifd + 2 + pointer + 8, ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(0, at.toInt()).array())
        return true
    }
}
