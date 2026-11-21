package app.rawboy.camera.capture

import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The `.motion` file written next to a video when Settings › Experimental › *Save motion data with videos* is on: what
 * a stabilizer needs to steady the video afterwards (video-stabilization plan, Phase 0). Pure JVM, no Android types,
 * so the JVM tests and later readers (web, desktop, `tools/motion/dump.py`) share one definition.
 *
 * Layout, little-endian:
 * - `RBMOTION` (8 bytes), u16 [VERSION], u32 header length, the header: UTF-8 JSON (lens, stream, sensors, device).
 * - Records, each a u8 tag then its fields ([GYRO], [ACCEL], [FRAME], [ENCODED], [END]). Times are ns on the
 *   camera's sensor clock (CLOCK_BOOTTIME where the camera's timestamp source is REALTIME, as SensorEvent's).
 *   Unknown longs are -1, unknown floats NaN. A file cut short (the app was killed) still reads up to its last whole
 *   record; [MotionData.ended] tells.
 */
object MotionFormat {
    const val VERSION = 1
    val MAGIC = "RBMOTION".toByteArray(Charsets.US_ASCII)

    /** t, angular rate x y z (rad/s, device axes), the uncalibrated sensor's drift estimate x y z (NaN if calibrated). */
    const val GYRO: Int = 1

    /** t, acceleration x y z (m/s², device axes, gravity included). */
    const val ACCEL: Int = 2

    /** One camera frame's metadata ([Frame]). */
    const val FRAME: Int = 3

    /** A frame that went into the file: its sensor timestamp and its presentation time in the MP4 (ns). */
    const val ENCODED: Int = 4

    /** The recording ended normally: t (elapsedRealtimeNanos), the recording's start (its PTS 0) and the clock offset. */
    const val END: Int = 255
}

/** One camera frame (a preview result of the streamed lens). */
class MotionFrame(
    /** SENSOR_TIMESTAMP: start of exposure of the first row. */
    val t: Long,
    val exposureNs: Long,
    val frameDurationNs: Long,
    /** SENSOR_ROLLING_SHUTTER_SKEW: first row to last row. */
    val skewNs: Long,
    /** LENS_FOCUS_DISTANCE in diopters (0 = infinity). */
    val focusDiopters: Float,
    /** LENS_FOCAL_LENGTH in mm. */
    val focalLengthMm: Float,
    /** LENS_OPTICAL_STABILIZATION_MODE the camera applied (0 off, 1 on, -1 unknown). */
    val oisMode: Int,
    /** LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID, or "" when not reported. */
    val physicalId: String,
    /** SCALER_CROP_REGION left, top, right, bottom (active array pixels), or all -1. */
    val crop: IntArray,
    /** LENS_INTRINSIC_CALIBRATION (fx, fy, cx, cy, s) of this frame, or empty. */
    val intrinsics: FloatArray,
    /** STATISTICS_OIS_SAMPLES: (t, x shift, y shift in active array pixels) triples, flattened as t in [oisT]. */
    val oisT: LongArray,
    val oisX: FloatArray,
    val oisY: FloatArray,
)

/** Thread-safe writer of a `.motion` stream. Every call writes one whole record. */
class MotionWriter(private val out: OutputStream, headerJson: String) {
    private val buf = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)

    @Volatile
    var failed: Throwable? = null
        private set

    init {
        val header = headerJson.toByteArray(Charsets.UTF_8)
        record {
            put(MotionFormat.MAGIC)
            putShort(MotionFormat.VERSION.toShort())
            putInt(header.size)
        }
        out.write(header)
    }

    fun gyro(t: Long, x: Float, y: Float, z: Float, driftX: Float, driftY: Float, driftZ: Float) = record {
        put(MotionFormat.GYRO.toByte()); putLong(t)
        putFloat(x); putFloat(y); putFloat(z); putFloat(driftX); putFloat(driftY); putFloat(driftZ)
    }

    fun accel(t: Long, x: Float, y: Float, z: Float) = record {
        put(MotionFormat.ACCEL.toByte()); putLong(t); putFloat(x); putFloat(y); putFloat(z)
    }

    fun frame(f: MotionFrame) = record {
        put(MotionFormat.FRAME.toByte())
        putLong(f.t); putLong(f.exposureNs); putLong(f.frameDurationNs); putLong(f.skewNs)
        putFloat(f.focusDiopters); putFloat(f.focalLengthMm)
        put(f.oisMode.toByte())
        val id = f.physicalId.toByteArray(Charsets.UTF_8)
        putShort(id.size.toShort()); put(id)
        for (i in 0 until 4) putInt(f.crop.getOrElse(i) { -1 })
        put(f.intrinsics.size.toByte()); f.intrinsics.forEach { putFloat(it) }
        val n = minOf(f.oisT.size, MAX_OIS_SAMPLES)
        putShort(n.toShort())
        for (i in 0 until n) { putLong(f.oisT[i]); putFloat(f.oisX[i]); putFloat(f.oisY[i]) }
    }

    fun encoded(sensorT: Long, ptsNs: Long) = record {
        put(MotionFormat.ENCODED.toByte()); putLong(sensorT); putLong(ptsNs)
    }

    fun end(t: Long, recordingStartNs: Long, clockOffsetNs: Long) = record {
        put(MotionFormat.END.toByte()); putLong(t); putLong(recordingStartNs); putLong(clockOffsetNs)
    }

    fun close() {
        synchronized(this) { runCatching { out.flush() }; runCatching { out.close() } }
    }

    private inline fun record(fill: ByteBuffer.() -> Unit) {
        synchronized(this) {
            if (failed != null) return
            try {
                buf.clear()
                buf.fill()
                out.write(buf.array(), 0, buf.position())
            } catch (e: Exception) {
                failed = e // a full disk: the video goes on, the motion file just ends here
            }
        }
    }

    private companion object {
        /** Far more than a 33 ms frame has (the Pixel's tele reports a handful); keeps a record inside [buf]. */
        const val MAX_OIS_SAMPLES = 2000
    }
}

/** A `.motion` file read back. */
class MotionData(
    val version: Int,
    val headerJson: String,
    /** Per sample: t. */
    val gyroT: LongArray,
    /** Per sample: x, y, z, driftX, driftY, driftZ. */
    val gyro: FloatArray,
    val accelT: LongArray,
    /** Per sample: x, y, z. */
    val accel: FloatArray,
    val frames: List<MotionFrame>,
    /** Pairs (sensor t, pts ns), flattened. */
    val encoded: LongArray,
    /** END's fields (t, recording start, clock offset), or null for a file cut short. */
    val ended: LongArray?,
) {
    companion object {
        /** Reads [bytes]; throws [IllegalArgumentException] when it isn't a `.motion` file this version knows. */
        fun read(bytes: ByteArray): MotionData {
            val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            require(bytes.size >= 14 && bytes.copyOf(8).contentEquals(MotionFormat.MAGIC)) { "not a .motion file" }
            b.position(8)
            val version = b.short.toInt()
            require(version == MotionFormat.VERSION) { "unknown .motion version $version" }
            val headerLen = b.int
            require(headerLen in 0..b.remaining()) { "header cut short" }
            val header = String(bytes, b.position(), headerLen, Charsets.UTF_8)
            b.position(b.position() + headerLen)

            val gyroT = LongList(); val gyro = FloatList()
            val accelT = LongList(); val accel = FloatList()
            val frames = ArrayList<MotionFrame>()
            val encoded = LongList()
            var ended: LongArray? = null
            while (b.hasRemaining()) {
                val start = b.position()
                try {
                    when (val tag = b.get().toInt() and 0xff) {
                        MotionFormat.GYRO -> {
                            val t = b.long
                            val v = FloatArray(6) { b.float }
                            gyroT.add(t); v.forEach(gyro::add)
                        }
                        MotionFormat.ACCEL -> {
                            val t = b.long
                            val v = FloatArray(3) { b.float }
                            accelT.add(t); v.forEach(accel::add)
                        }
                        MotionFormat.FRAME -> frames.add(readFrame(b))
                        MotionFormat.ENCODED -> {
                            val s = b.long
                            val p = b.long
                            encoded.add(s); encoded.add(p)
                        }
                        MotionFormat.END -> ended = longArrayOf(b.long, b.long, b.long)
                        else -> throw IllegalArgumentException("unknown record $tag at $start")
                    }
                } catch (e: java.nio.BufferUnderflowException) {
                    break // the last record was cut off
                }
            }
            return MotionData(version, header, gyroT.toArray(), gyro.toArray(), accelT.toArray(), accel.toArray(), frames, encoded.toArray(), ended)
        }

        private fun readFrame(b: ByteBuffer): MotionFrame {
            val t = b.long; val e = b.long; val d = b.long; val s = b.long
            val focus = b.float; val focal = b.float
            val ois = b.get().toInt()
            val id = ByteArray(b.short.toInt()).also { b.get(it) }
            val crop = IntArray(4) { b.int }
            val intrinsics = FloatArray(b.get().toInt()) { b.float }
            val n = b.short.toInt() and 0xffff
            val ot = LongArray(n); val ox = FloatArray(n); val oy = FloatArray(n)
            for (i in 0 until n) { ot[i] = b.long; ox[i] = b.float; oy[i] = b.float }
            return MotionFrame(t, e, d, s, focus, focal, ois, String(id, Charsets.UTF_8), crop, intrinsics, ot, ox, oy)
        }
    }

    private class LongList {
        private var a = LongArray(1024); private var n = 0
        fun add(v: Long) { if (n == a.size) a = a.copyOf(n * 2); a[n++] = v }
        fun toArray() = a.copyOf(n)
    }

    private class FloatList {
        private var a = FloatArray(1024); private var n = 0
        fun add(v: Float) { if (n == a.size) a = a.copyOf(n * 2); a[n++] = v }
        fun toArray() = a.copyOf(n)
    }
}
