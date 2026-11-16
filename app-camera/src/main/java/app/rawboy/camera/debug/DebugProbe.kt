package app.rawboy.camera.debug

import android.content.Context
import android.content.pm.ApplicationInfo
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.media.MediaCodecList
import android.opengl.EGL14
import android.os.Build
import android.util.Log
import app.rawboy.camera.capture.VideoDebug
import app.rawboy.camera.capture.VideoVariant
import app.rawboy.gl.PreviewImage
import java.io.File

/**
 * Debug-build diagnostics for bringing RawBoy Camera up on a new phone (logcat tag RawBoyProbe): what the phone is,
 * its EGL configs and encoder input formats, the camera's request template defaults, the preview result at the
 * shutter, and the viewfinder's and the shot's 512 px linear copies (files/debug, read with `run-as`). Off in
 * release builds (not debuggable).
 */
object DebugProbe {
    private const val TAG = "RawBoyProbe"

    @Volatile
    private var enabled = false

    /** Turns the probe on for debuggable builds and logs the phone once. */
    fun init(context: Context) {
        enabled = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!enabled) return
        runCatching { logDevice(context) }.onFailure { Log.w(TAG, "device", it) }
    }

    private fun logDevice(context: Context) {
        val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "${Build.SOC_MANUFACTURER} / ${Build.SOC_MODEL}" else "n/a (API ${Build.VERSION.SDK_INT})"
        Log.d(TAG, "build: soc $soc, hardware ${Build.HARDWARE}, board ${Build.BOARD}, manufacturer ${Build.MANUFACTURER}, " +
            "brand ${Build.BRAND}, model ${Build.MODEL}, device ${Build.DEVICE}, product ${Build.PRODUCT}, sdk ${Build.VERSION.SDK_INT}")
        val manager = context.getSystemService(CameraManager::class.java)
        for (id in manager.cameraIdList) {
            val c = manager.getCameraCharacteristics(id)
            Log.d(TAG, "camera $id: facing ${c.get(CameraCharacteristics.LENS_FACING)}, " +
                "caps ${c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.joinToString()}, physical ${c.physicalCameraIds}, " +
                "focal ${c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.joinToString()}")
        }
        for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
            if (!info.isEncoder) continue
            for (type in info.supportedTypes) {
                if (!type.startsWith("video/avc") && !type.startsWith("video/hevc")) continue
                val formats = runCatching { info.getCapabilitiesForType(type).colorFormats.joinToString { "0x" + it.toString(16) } }.getOrNull()
                Log.d(TAG, "encoder ${info.name} ($type, hw ${if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated else "?"}): colour formats $formats")
            }
        }
        logEglConfigs()
    }

    private fun logEglConfigs() {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        if (!EGL14.eglInitialize(display, version, 0, version, 1)) return
        val count = IntArray(1)
        EGL14.eglGetConfigs(display, null, 0, 0, count, 0)
        val configs = arrayOfNulls<android.opengl.EGLConfig>(count[0])
        EGL14.eglGetConfigs(display, configs, 0, configs.size, count, 0)
        val recordable = 0x3142 // EGL_RECORDABLE_ANDROID
        fun attr(c: android.opengl.EGLConfig, a: Int): Int {
            val v = IntArray(1)
            return if (EGL14.eglGetConfigAttrib(display, c, a, v, 0)) v[0] else -1
        }
        val lines = configs.filterNotNull().map { c ->
            "id ${attr(c, EGL14.EGL_CONFIG_ID)} rgba ${attr(c, EGL14.EGL_RED_SIZE)}${attr(c, EGL14.EGL_GREEN_SIZE)}${attr(c, EGL14.EGL_BLUE_SIZE)}${attr(c, EGL14.EGL_ALPHA_SIZE)} " +
                "depth ${attr(c, EGL14.EGL_DEPTH_SIZE)} renderable 0x${attr(c, EGL14.EGL_RENDERABLE_TYPE).toString(16)} " +
                "surface 0x${attr(c, EGL14.EGL_SURFACE_TYPE).toString(16)} recordable ${attr(c, recordable)} " +
                "native visual 0x${attr(c, EGL14.EGL_NATIVE_VISUAL_ID).toString(16)}"
        }
        Log.d(TAG, "EGL ${version[0]}.${version[1]}: ${lines.size} configs")
        lines.forEach { Log.d(TAG, "EGL config $it") }
    }

    /** Logs a few defaults of the camera's preview, still and record templates (what the app doesn't set itself). */
    fun logTemplates(camera: CameraDevice, label: String) {
        if (!enabled) return
        for ((name, template) in listOf("preview" to CameraDevice.TEMPLATE_PREVIEW, "still" to CameraDevice.TEMPLATE_STILL_CAPTURE, "record" to CameraDevice.TEMPLATE_RECORD)) {
            val b = runCatching { camera.createCaptureRequest(template) }.getOrNull() ?: continue
            Log.d(TAG, "template $label/${camera.id} $name: stabilization ${b.get(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE)}, " +
                "ois ${b.get(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE)}, tonemap ${b.get(CaptureRequest.TONEMAP_MODE)}, " +
                "nr ${b.get(CaptureRequest.NOISE_REDUCTION_MODE)}, edge ${b.get(CaptureRequest.EDGE_MODE)}, " +
                "cc ${b.get(CaptureRequest.COLOR_CORRECTION_MODE)}, fps ${b.get(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE)}, " +
                "zsl ${b.get(CaptureRequest.CONTROL_ENABLE_ZSL)}, intent ${b.get(CaptureRequest.CONTROL_CAPTURE_INTENT)}, " +
                "distortion ${b.get(CaptureRequest.DISTORTION_CORRECTION_MODE)}")
        }
    }

    /** A preview result's colour, exposure and lens fields, for the shutter's log line. */
    fun describe(r: CaptureResult?): String {
        if (!enabled || r == null) return ""
        val ccm = r.get(CaptureResult.COLOR_CORRECTION_TRANSFORM)?.let { t -> (0 until 9).joinToString(" ") { "%.3f".format(t.getElement(it % 3, it / 3).toFloat()) } }
        val g = r.get(CaptureResult.COLOR_CORRECTION_GAINS)
        return "ccm [$ccm] gains ${g?.let { "%.3f %.3f %.3f %.3f".format(it.red, it.greenEven, it.greenOdd, it.blue) }} " +
            "neutral ${r.get(CaptureResult.SENSOR_NEUTRAL_COLOR_POINT)?.joinToString { "%.4f".format(it.toDouble()) }} " +
            "black ${r.get(CaptureResult.SENSOR_DYNAMIC_BLACK_LEVEL)?.joinToString()} white ${r.get(CaptureResult.SENSOR_DYNAMIC_WHITE_LEVEL)} " +
            "boost ${r.get(CaptureResult.CONTROL_POST_RAW_SENSITIVITY_BOOST)} t ${r.get(CaptureResult.SENSOR_EXPOSURE_TIME)} " +
            "frame ${r.get(CaptureResult.SENSOR_FRAME_DURATION)} iso ${r.get(CaptureResult.SENSOR_SENSITIVITY)} " +
            "tonemap ${r.get(CaptureResult.TONEMAP_MODE)} cc ${r.get(CaptureResult.COLOR_CORRECTION_MODE)} " +
            "stab ${r.get(CaptureResult.CONTROL_VIDEO_STABILIZATION_MODE)} crop ${r.get(CaptureResult.SCALER_CROP_REGION)} " +
            "focus ${r.get(CaptureResult.LENS_FOCUS_DISTANCE)} ae ${r.get(CaptureResult.CONTROL_AE_STATE)} " +
            "af ${r.get(CaptureResult.CONTROL_AF_STATE)} flash ${r.get(CaptureResult.FLASH_STATE)} " +
            "fps ${r.get(CaptureResult.CONTROL_AE_TARGET_FPS_RANGE)}"
    }

    /** Saves a 512 px linear copy (half floats, RGB) as files/debug/[name].f16 with a .txt beside it. */
    fun dump(context: Context, name: String, image: PreviewImage, note: String) {
        if (!enabled) return
        runCatching {
            val dir = File(context.filesDir, "debug").apply { mkdirs() }
            val bytes = ByteArray(image.pixels.capacity())
            image.pixels.duplicate().apply { rewind() }.get(bytes)
            File(dir, "$name.f16").writeBytes(bytes)
            File(dir, "$name.txt").writeText("${image.width} ${image.height} ${image.fullWidth} ${image.fullHeight}\n$note\n")
            Log.d(TAG, "dumped $name ${image.width}x${image.height}")
        }.onFailure { Log.w(TAG, "dump $name", it) }
    }

    /**
     * Debug builds: the video overrides in `video-debug.txt` in the app's external files directory
     * (`/sdcard/Android/data/<package>/files`, pushed with adb), read at each recording's start, `key=value` lines:
     * `variants=OWN_CONTEXT,SOFTWARE_AVC` (the probe's list), `avc=1` (hardware H.264), `turns=1` (landscape file),
     * `fail=codec|egl|silent`, `failVariant=STANDARD`, `failAfterMs=2000` (an injected encoder failure). Null in
     * release builds or without the file.
     */
    fun videoDebug(context: Context): VideoDebug? {
        if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) return null
        val file = File(context.getExternalFilesDir(null) ?: return null, "video-debug.txt")
        if (!file.exists()) return null
        return runCatching {
            val v = file.readLines().mapNotNull { l ->
                l.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0].trim() to it[1].trim() }
            }.toMap()
            VideoDebug(
                order = v["variants"]?.split(',')?.map { VideoVariant.valueOf(it.trim()) },
                forceAvc = v["avc"] == "1",
                turns = v["turns"]?.toInt(),
                fault = v["fail"]?.let { kind ->
                    VideoDebug.Fault(
                        VideoDebug.Kind.valueOf(kind.uppercase()),
                        v["failVariant"]?.let { VideoVariant.valueOf(it) },
                        v["failAfterMs"]?.toLong() ?: 0,
                    )
                },
            )
        }.onFailure { Log.w(TAG, "video-debug.txt", it) }.getOrNull()?.also { Log.i(TAG, "video debug: $it") }
    }
}
