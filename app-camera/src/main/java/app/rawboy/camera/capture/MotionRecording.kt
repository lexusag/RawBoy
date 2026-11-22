package app.rawboy.camera.capture

import android.content.Context
import android.hardware.Sensor
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureResult
import android.os.Build
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream

/**
 * The motion data of one recording ([MotionFormat]): gyroscope and accelerometer at their highest rate, each camera
 * frame's timing, rolling shutter skew, focus and OIS samples, and which frames went into the file at which time.
 * Written to the app's external files dir (`Android/data/<package>/files/motion/<video name>.motion`), where adb and
 * a computer over USB reach it. For stabilizing the video afterwards (video-stabilization plan, Phases 0 and 2).
 *
 * Samples come from [MotionSensors], which runs before the recording starts and hands over the last half second, so
 * the first frames have gyro around them.
 *
 * Calls come from three threads: sensors (its own), [onFrame] (camera), [onEncoded] (GL); [MotionWriter] serialises
 * them.
 */
class MotionRecording private constructor(
    val file: File,
    private val writer: MotionWriter,
    private val sensors: MotionSensors,
) : MotionSensors.Sink {
    @Volatile
    private var closed = false

    @Volatile
    var frames = 0
        private set

    private var gyroSamples = 0
    private var firstGyroNs = 0L
    private var lastGyroNs = 0L

    override fun gyro(t: Long, x: Float, y: Float, z: Float, dx: Float, dy: Float, dz: Float) {
        if (closed) return
        writer.gyro(t, x, y, z, dx, dy, dz)
        if (gyroSamples++ == 0) firstGyroNs = t
        lastGyroNs = t
    }

    override fun accel(t: Long, x: Float, y: Float, z: Float) {
        if (!closed) writer.accel(t, x, y, z)
    }

    /** A preview result of the streamed lens (its own result when a physical lens is streamed). Camera thread. */
    fun onFrame(r: CaptureResult) {
        if (closed) return
        val t = r.get(CaptureResult.SENSOR_TIMESTAMP) ?: return
        val crop = r.get(CaptureResult.SCALER_CROP_REGION)
        val ois = r.get(CaptureResult.STATISTICS_OIS_SAMPLES).orEmpty()
        writer.frame(
            MotionFrame(
                t = t,
                exposureNs = r.get(CaptureResult.SENSOR_EXPOSURE_TIME) ?: -1L,
                frameDurationNs = r.get(CaptureResult.SENSOR_FRAME_DURATION) ?: -1L,
                skewNs = r.get(CaptureResult.SENSOR_ROLLING_SHUTTER_SKEW) ?: -1L,
                focusDiopters = r.get(CaptureResult.LENS_FOCUS_DISTANCE) ?: Float.NaN,
                focalLengthMm = r.get(CaptureResult.LENS_FOCAL_LENGTH) ?: Float.NaN,
                oisMode = r.get(CaptureResult.LENS_OPTICAL_STABILIZATION_MODE) ?: -1,
                physicalId = r.get(CaptureResult.LOGICAL_MULTI_CAMERA_ACTIVE_PHYSICAL_ID).orEmpty(),
                crop = crop?.let { intArrayOf(it.left, it.top, it.right, it.bottom) } ?: intArrayOf(-1, -1, -1, -1),
                intrinsics = r.get(CaptureResult.LENS_INTRINSIC_CALIBRATION) ?: FloatArray(0),
                oisT = LongArray(ois.size) { ois[it].timestamp },
                oisX = FloatArray(ois.size) { ois[it].xshift },
                oisY = FloatArray(ois.size) { ois[it].yshift },
            ),
        )
        frames++
    }

    /** A camera frame (its sensor timestamp) went into the video at [ptsNs]. GL thread. */
    fun onEncoded(sensorNs: Long, ptsNs: Long) {
        if (!closed) writer.encoded(sensorNs, ptsNs)
    }

    /** The recording ended and its file was kept: [recordingStartNs] is the video's time 0 on the camera clock (+ offset). */
    fun finish(recordingStartNs: Long, clockOffsetNs: Long) {
        stopSensors()
        writer.end(SystemClock.elapsedRealtimeNanos(), recordingStartNs, clockOffsetNs)
        writer.close()
        closed = true
        val seconds = (lastGyroNs - firstGyroNs) / 1e9
        val rate = if (seconds > 0) (gyroSamples - 1) / seconds else 0.0
        Log.i(TAG, "motion: ${file.name}, $frames frames, $gyroSamples gyro samples (${rate.toInt()} Hz)" +
            (writer.failed?.let { ", write failed: ${it.message}" } ?: ""))
    }

    /** Nothing was recorded: the motion file goes too. */
    fun abort() {
        stopSensors()
        closed = true
        writer.close()
        file.delete()
    }

    private fun stopSensors() {
        sensors.detach(this)
    }

    companion object {
        private const val TAG = "RawBoyMotion"

        /**
         * Starts recording motion for the video called [videoName] (no extension) from [sensors] (started here if they
         * aren't running yet), or returns null when the file can't be made. [lens] is the streamed lens, [turns] the recording's quarter turns,
         * [width] x [height] the video's size.
         */
        fun start(
            context: Context,
            sensors: MotionSensors,
            videoName: String,
            lens: CameraController.Info,
            turns: Int,
            width: Int,
            height: Int,
            flat: Boolean,
        ): MotionRecording? {
            val dir = context.getExternalFilesDir("motion") ?: return null
            val file = File(dir, "$videoName.motion")
            return try {
                val header = header(context, videoName, lens, turns, width, height, flat, sensors.gyro, sensors.accel)
                val writer = MotionWriter(BufferedOutputStream(FileOutputStream(file), 1 shl 16), header.toString())
                val recording = MotionRecording(file, writer, sensors)
                sensors.start()
                sensors.attach(recording)
                recording
            } catch (e: Exception) {
                Log.w(TAG, "no motion data", e)
                file.delete()
                null
            }
        }

        private fun header(
            context: Context, videoName: String, lens: CameraController.Info, turns: Int, width: Int, height: Int,
            flat: Boolean, gyro: Sensor, accel: Sensor?,
        ): JSONObject {
            val c = lens.characteristics
            fun floats(a: FloatArray?) = a?.let { JSONArray().apply { it.forEach { v -> put(v.toDouble()) } } }
            fun ints(a: IntArray?) = a?.let { JSONArray().apply { it.forEach { v -> put(v) } } }
            fun sensor(s: Sensor) = JSONObject()
                .put("type", s.stringType).put("name", s.name).put("vendor", s.vendor)
                .put("minDelayUs", s.minDelay).put("resolution", s.resolution.toDouble()).put("maxRange", s.maximumRange.toDouble())
                .put("fifo", s.fifoMaxEventCount)
            val active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
            val pixels = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
            val physical = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
            return JSONObject()
                .put("format", "rawboy-motion").put("version", MotionFormat.VERSION)
                .put("video", "$videoName.mp4")
                .put("device", JSONObject()
                    .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("build", Build.DISPLAY)
                    .put("sdk", Build.VERSION.SDK_INT)
                    .put("app", runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull()))
                .put("startElapsedRealtimeNs", SystemClock.elapsedRealtimeNanos())
                .put("recording", JSONObject()
                    .put("width", width).put("height", height).put("turns", turns).put("flat", flat).put("fps", 30)
                    .put("fullFrame", width * 3 == height * 4 || height * 3 == width * 4))
                .put("lens", JSONObject()
                    .put("label", lens.label).put("cameraId", lens.openId).put("physicalId", lens.physicalId ?: JSONObject.NULL)
                    .put("facing", if (lens.isFront) "front" else "back")
                    .put("sensorOrientation", lens.sensorOrientation)
                    .put("streamWidth", lens.previewSize.width).put("streamHeight", lens.previewSize.height)
                    .put("previewCropX", lens.previewCropX.toDouble()).put("previewCropY", lens.previewCropY.toDouble())
                    .put("timestampSource", when (c.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)) {
                        CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME -> "realtime"
                        else -> "unknown"
                    })
                    .put("activeArray", active?.let { ints(intArrayOf(it.left, it.top, it.right, it.bottom)) } ?: JSONObject.NULL)
                    .put("pixelArray", pixels?.let { ints(intArrayOf(it.width, it.height)) } ?: JSONObject.NULL)
                    .put("physicalSizeMm", physical?.let { floats(floatArrayOf(it.width, it.height)) } ?: JSONObject.NULL)
                    .put("focalLengthsMm", floats(c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)) ?: JSONObject.NULL)
                    .put("intrinsics", floats(c.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION)) ?: JSONObject.NULL)
                    .put("distortion", floats(c.get(CameraCharacteristics.LENS_DISTORTION)) ?: JSONObject.NULL)
                    .put("poseRotation", floats(c.get(CameraCharacteristics.LENS_POSE_ROTATION)) ?: JSONObject.NULL)
                    .put("poseTranslation", floats(c.get(CameraCharacteristics.LENS_POSE_TRANSLATION)) ?: JSONObject.NULL)
                    .put("poseReference", c.get(CameraCharacteristics.LENS_POSE_REFERENCE) ?: JSONObject.NULL)
                    .put("oisModes", ints(c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)) ?: JSONObject.NULL)
                    .put("oisDataModes", ints(c.get(CameraCharacteristics.STATISTICS_INFO_AVAILABLE_OIS_DATA_MODES)) ?: JSONObject.NULL))
                .put("gyro", sensor(gyro))
                .put("accel", accel?.let(::sensor) ?: JSONObject.NULL)
        }
    }
}
