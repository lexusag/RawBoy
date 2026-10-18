package app.rawboy.raw

import java.nio.ByteBuffer

/** JNI surface of the burst merge (librawboy, see engine/src/main/cpp/burst_merge.h); RawBoy Camera's burst shots. */
object BurstNative {
    init {
        System.loadLibrary("rawboy")
    }

    /**
     * A merger for [width] x [height] Bayer frames. [black]: per 2x2 CFA position, row-major. [noiseScale] /
     * [noiseOffset]: variance = scale x signal + offset in units of the white-black range (0, 0 = estimate).
     */
    @JvmStatic external fun create(width: Int, height: Int, black: FloatArray, white: Float, noiseScale: Float, noiseOffset: Float): Long

    /** Copies one RAW_SENSOR plane; [gain] = exposure time x ISO. The first frame is the reference. */
    @JvmStatic external fun addFrame(handle: Long, plane: ByteBuffer, width: Int, height: Int, rowStride: Int, gain: Double)

    /** Each frame's exposure (time x ISO) in the order added, when the results arrive after the frames. */
    @JvmStatic external fun setGains(handle: Long, gains: DoubleArray)

    /** The reference's black levels (null: keep [create]'s) and noise model (0, 0 = estimate), before [merge]. */
    @JvmStatic external fun setLevels(handle: Long, black: FloatArray?, noiseScale: Float, noiseOffset: Float)

    /** Aligns and merges; the returned direct buffer holds the 16-bit samples until [destroy]. */
    @JvmStatic external fun merge(handle: Long, width: Int, height: Int): ByteBuffer

    /** Mean tile weight of each frame after the reference, 0..1 (how much of it was used). */
    @JvmStatic external fun frameWeights(handle: Long): FloatArray

    @JvmStatic external fun destroy(handle: Long)
}
