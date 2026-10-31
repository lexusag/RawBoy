package app.rawboy.raw

import app.rawboy.engine.BuildConfig

/**
 * JNI surface of the lossy JPEG XL DNG writer (librawboy, engine/src/main/cpp/dng_transcode.cpp; needs the Adobe DNG
 * SDK build). RawBoy Camera uses it on the DNGs that Android's DngCreator writes.
 */
object DngJxlNative {
    init {
        System.loadLibrary("rawboy")
    }

    /** Whether this build can write them: the DNG SDK is in every standard build and never in RawBoy Film. */
    val available: Boolean get() = !BuildConfig.FILM_EDITION

    /** Result of [transcode]. */
    enum class Result { DONE, UNCHANGED, UNAVAILABLE }

    /**
     * Re-saves the DNG behind [fd] (opened for reading and writing) as a lossy JPEG XL DNG, in place. [distance] is
     * libjxl's quality (0.2: visually lossless; larger: smaller and lossier), [effort] 1..9. The file is only
     * rewritten once the new one is complete; if compressing fails it stays as it was (a failed write after that
     * leaves it truncated). Throws java.io.IOException.
     */
    fun transcode(fd: Int, distance: Float = DEFAULT_DISTANCE, effort: Int = DEFAULT_EFFORT): Result =
        when (transcodeNative(fd, distance, effort)) {
            0 -> Result.DONE
            1 -> Result.UNCHANGED
            else -> Result.UNAVAILABLE
        }

    @JvmStatic private external fun transcodeNative(fd: Int, distance: Float, effort: Int): Int

    const val DEFAULT_DISTANCE = 0.2f
    const val DEFAULT_EFFORT = 5
}
