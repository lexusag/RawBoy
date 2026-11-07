package app.rawboy.export

/** JNI surface of the jpegli encoder (librawboyjpeg, see engine/src/main/cpp/jpeg_jpegli.cpp). */
internal object JpegNative {
    init {
        System.loadLibrary("rawboyjpeg")
    }

    @JvmStatic external fun begin(fd: Int, width: Int, height: Int, quality: Int): Long
    /** As [begin], for an Ultra HDR JPEG: [finish] adds the gain map built from the rows written (ultrahdr.h). */
    @JvmStatic external fun beginGainMap(fd: Int, width: Int, height: Int, quality: Int): Long
    /** An APP1 segment with [payload] ("Exif\u0000\u0000" + TIFF block); before the first [writeRows]. */
    @JvmStatic external fun writeExif(handle: Long, payload: ByteArray)
    @JvmStatic external fun writeRows(handle: Long, samples: ShortArray, rows: Int)
    @JvmStatic external fun finish(handle: Long)
    @JvmStatic external fun abort(handle: Long)
}
