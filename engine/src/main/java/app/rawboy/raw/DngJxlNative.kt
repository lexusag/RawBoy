package app.rawboy.raw

/**
 * JNI surface of the Adobe DNG SDK rewriter (librawboy, `engine/src/main/cpp/dng_transcode.cpp`; needs the Adobe DNG
 * SDK build). RawBoy Camera uses it to embed a developed JPEG preview into DNGs and/or compress them as lossy JPEG XL.
 */
object DngJxlNative {
    init {
        System.loadLibrary("rawboy")
    }

    /** Result of [transcode] / [rewrite]. */
    enum class Result { DONE, UNCHANGED, UNAVAILABLE }

    /**
     * Re-saves the DNG behind [fd] (opened for reading and writing), in place: optionally compressing a 2x2 Bayer
     * mosaic as lossy JPEG XL ([lossyJxl], libjxl [distance] / [effort]) and/or embedding an upright sRGB JPEG preview
     * ([previewJpeg]). Preserves any RawBoy Camera depth trailer (`"RBDP"`). The file is only rewritten once the new
     * one is complete; if rewriting fails it stays as it was. Throws `java.io.IOException`.
     */
    fun rewrite(
        fd: Int,
        lossyJxl: Boolean = false,
        distance: Float = DEFAULT_DISTANCE,
        effort: Int = DEFAULT_EFFORT,
        previewJpeg: ByteArray? = null,
    ): Result =
        when (rewriteNative(fd, lossyJxl, distance, effort, previewJpeg)) {
            0 -> Result.DONE
            1 -> Result.UNCHANGED
            else -> Result.UNAVAILABLE
        }

    /** Re-saves the DNG behind [fd] as a lossy JPEG XL DNG, in place, without an embedded preview. */
    fun transcode(fd: Int, distance: Float = DEFAULT_DISTANCE, effort: Int = DEFAULT_EFFORT): Result =
        when (transcodeNative(fd, distance, effort)) {
            0 -> Result.DONE
            1 -> Result.UNCHANGED
            else -> Result.UNAVAILABLE
        }

    @JvmStatic private external fun rewriteNative(
        fd: Int,
        lossyJxl: Boolean,
        distance: Float,
        effort: Int,
        previewJpeg: ByteArray?,
    ): Int

    @JvmStatic private external fun transcodeNative(fd: Int, distance: Float, effort: Int): Int

    const val DEFAULT_DISTANCE = 0.2f
    const val DEFAULT_EFFORT = 5
}
