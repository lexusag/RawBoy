package app.rawboy.raw

import java.nio.ByteBuffer

/**
 * JNI surface of the long exposure stack (librawboy, see engine/src/main/cpp/long_exposure.h); RawBoy Camera's
 * Long exposure mode. Frames are folded in as they arrive; memory stays at one accumulator.
 */
object LongExposureNative {
    init {
        System.loadLibrary("rawboy")
    }

    /** [lighten]: keep the brightest sample (trails); else the mean (smooth water). */
    @JvmStatic external fun create(width: Int, height: Int, lighten: Boolean): Long

    /** Folds in one RAW_SENSOR plane; returns the frames so far. */
    @JvmStatic external fun addFrame(handle: Long, plane: ByteBuffer, width: Int, height: Int, rowStride: Int): Int

    /** The stacked 16-bit samples (a direct buffer valid until [destroy]). Throws if no frame was added. */
    @JvmStatic external fun finish(handle: Long, width: Int, height: Int): ByteBuffer

    @JvmStatic external fun destroy(handle: Long)
}
