package app.rawboy.camera.report

import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.media.MediaCodecList
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES30
import android.os.Build
import app.rawboy.camera.CameraSettingsStore
import app.rawboy.camera.capture.CameraController
import app.rawboy.camera.platform.ResolvedPlatform
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Gathers [DeviceReportData] on the phone: Camera2 characteristics of every camera and physical lens, the lenses
 * [CameraController.lenses] lists and passes over, the GPU through a short-lived GLES 3 pbuffer context, the H.264 and
 * HEVC encoders, and the learned calibration. Each part is read on its own, so one that fails leaves a line under
 * "Not read" instead of an empty report. Blocking (GL, Camera2 queries): call off the main thread.
 */
object DeviceReportCollector {
    fun collect(context: Context, platform: ResolvedPlatform, controller: CameraController): DeviceReportData {
        val failures = ArrayList<String>()
        fun <T> part(name: String, fallback: T, read: () -> T): T = runCatching(read).getOrElse {
            failures += "$name: ${it.javaClass.simpleName}${it.message?.let { m -> " ($m)" }.orEmpty()}"
            fallback
        }
        val manager = context.getSystemService(CameraManager::class.java)
        val ids = part("camera ids", emptyList()) { manager.cameraIdList.toList() }
        val cameras = part("cameras", emptyList()) { cameras(manager, ids) }
        val skipped = ArrayList<SkippedCamera>()
        val lenses = part("lenses", emptyList()) {
            listOf(CameraMetadata.LENS_FACING_BACK, CameraMetadata.LENS_FACING_FRONT).flatMap { facing ->
                controller.lenses(facing) { camera, why -> skipped += SkippedCamera(camera, why) }.map { lens ->
                    LensFacts(
                        facing = facing,
                        label = lens.label,
                        camera = lens.name,
                        equivalentFocalMm = lens.equivalentFocal,
                        fNumber = lens.fNumber,
                        rawSize = lens.rawSize.toString(),
                        previewSize = lens.previewSize.toString(),
                        maxResSize = lens.maxResSize?.toString(),
                        flash = lens.hasFlash,
                    )
                }
            }
        }
        val gl = part("GPU", null) { gl() }
        val encoders = part("video encoders", emptyList()) { encoders() }
        val calibration = part("calibration", emptyList()) { CameraSettingsStore.calibration(context) }
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = info.longVersionCode
        return DeviceReportData(
            appVersion = "${info.versionName} ($code)",
            packageName = context.packageName,
            debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
            date = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date()),
            platform = platform,
            cameraIds = ids,
            cameras = cameras,
            lenses = lenses,
            skipped = skipped,
            gl = gl,
            encoders = encoders,
            calibration = calibration,
            failures = failures,
        )
    }

    /** Each camera id, then (for a logical camera) its physical lenses as "id/physical", as `lenses()` looks at them. */
    private fun cameras(manager: CameraManager, ids: List<String>): List<CameraFacts> = ids.flatMap { id ->
        // A camera that can't be read gives one "not read" line; the others still come out.
        val c = runCatching { manager.getCameraCharacteristics(id) }.getOrElse { return@flatMap listOf(CameraFacts(id, failure = it.toString())) }
        val logical = CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA in
            (c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0))
        val physical = if (logical) c.physicalCameraIds.sorted() else emptyList()
        listOf(runCatching { facts(id, c) }.getOrElse { CameraFacts(id, failure = it.toString()) }) + physical.map { p ->
            runCatching { facts("$id/$p", manager.getCameraCharacteristics(p)) }.getOrElse { CameraFacts("$id/$p", failure = it.toString()) }
        }
    }

    private fun facts(id: String, c: CameraCharacteristics): CameraFacts {
        val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val step = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)
        return CameraFacts(
            id = id,
            facing = c.get(CameraCharacteristics.LENS_FACING),
            hardwareLevel = c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL),
            capabilities = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList().orEmpty(),
            physicalIds = c.physicalCameraIds.sorted(),
            focalLengthsMm = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.toList().orEmpty(),
            apertures = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.toList().orEmpty(),
            sensorSizeMm = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.let {
                "${DeviceReport.num(it.width, 2)}x${DeviceReport.num(it.height, 2)}"
            },
            pixelArray = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)?.toString(),
            activeArray = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)?.let { "${it.left},${it.top} ${it.width()}x${it.height()}" },
            sensorOrientation = c.get(CameraCharacteristics.SENSOR_ORIENTATION),
            colorFilter = c.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT),
            blackLevels = c.get(CameraCharacteristics.SENSOR_BLACK_LEVEL_PATTERN)?.let { p -> (0 until 4).map { p.getOffsetForIndex(it % 2, it / 2) } }.orEmpty(),
            whiteLevel = c.get(CameraCharacteristics.SENSOR_INFO_WHITE_LEVEL),
            rawSizes = map?.getOutputSizes(ImageFormat.RAW_SENSOR).orEmpty().sortedByDescending { it.width.toLong() * it.height }.map { it.toString() },
            maxResRawSizes = maxResRawSizes(c),
            previewSizes = map?.getOutputSizes(SurfaceTexture::class.java).orEmpty().sortedByDescending { it.width.toLong() * it.height }.map { it.toString() },
            toneMapModes = c.get(CameraCharacteristics.TONEMAP_AVAILABLE_TONE_MAP_MODES)?.toList().orEmpty(),
            maxCurvePoints = c.get(CameraCharacteristics.TONEMAP_MAX_CURVE_POINTS),
            isoRange = c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)?.let { "${it.lower}..${it.upper}" },
            exposureRangeNs = c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)?.let { it.lower to it.upper },
            maxFrameDurationNs = c.get(CameraCharacteristics.SENSOR_INFO_MAX_FRAME_DURATION),
            postRawBoostRange = c.get(CameraCharacteristics.CONTROL_POST_RAW_SENSITIVITY_BOOST_RANGE)?.let { "${it.lower}..${it.upper}" },
            fpsRanges = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES).orEmpty().map { "${it.lower}-${it.upper}" },
            aeCompensationStep = step?.let { "${it.numerator}/${it.denominator}" },
            aeCompensationRange = c.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)?.let { "${it.lower}..${it.upper}" },
            aeModes = c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)?.toList().orEmpty(),
            flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE),
            oisModes = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)?.toList().orEmpty(),
            videoStabilizationModes = c.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES)?.toList().orEmpty(),
            shadingMapModes = c.get(CameraCharacteristics.STATISTICS_INFO_AVAILABLE_LENS_SHADING_MAP_MODES)?.toList().orEmpty(),
            lensShadingApplied = c.get(CameraCharacteristics.SENSOR_INFO_LENS_SHADING_APPLIED),
            distortionModes = c.get(CameraCharacteristics.DISTORTION_CORRECTION_AVAILABLE_MODES)?.toList().orEmpty(),
            faceModes = c.get(CameraCharacteristics.STATISTICS_INFO_AVAILABLE_FACE_DETECT_MODES)?.toList().orEmpty(),
            focusCalibration = c.get(CameraCharacteristics.LENS_INFO_FOCUS_DISTANCE_CALIBRATION),
            minFocusDistance = c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE),
            sessionKeys = c.availableSessionKeys.orEmpty().map { it.name }.filter { it.startsWith("android.") }.sorted(),
            vendorSessionKeys = c.availableSessionKeys.orEmpty().count { !it.name.startsWith("android.") },
        )
    }

    /** RAW_SENSOR / RAW10 sizes of the maximum-resolution sensor mode (Android 12+; what 50 MP lenses offer). */
    private fun maxResRawSizes(c: CameraCharacteristics): List<String> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
        val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP_MAXIMUM_RESOLUTION) ?: return emptyList()
        return listOf(ImageFormat.RAW_SENSOR to "RAW_SENSOR", ImageFormat.RAW10 to "RAW10").flatMap { (format, name) ->
            (map.getOutputSizes(format).orEmpty().toList() + map.getHighResolutionOutputSizes(format).orEmpty().toList())
                .distinct().sortedByDescending { it.width.toLong() * it.height }.map { "$it $name" }
        }
    }

    /**
     * The GPU's strings, the camera's extensions and the window configs, from a 1x1 pbuffer GLES 3 context made and
     * destroyed here. The display is shared with the viewfinder, so it is never terminated.
     */
    private fun gl(): GlFacts {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }
        val eglExtensions = EGL14.eglQueryString(display, EGL14.EGL_EXTENSIONS).orEmpty().split(' ').toSet()
        val configs = eglConfigs(display)
        val attribs = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE,
        )
        val chosen = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        check(EGL14.eglChooseConfig(display, attribs, 0, chosen, 0, 1, count, 0) && count[0] > 0) { "no GLES 3 pbuffer config" }
        val context = EGL14.eglCreateContext(display, chosen[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
        val surface = EGL14.eglCreatePbufferSurface(display, chosen[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        try {
            check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "eglMakeCurrent failed" }
            val glExtensions = GLES30.glGetString(GLES30.GL_EXTENSIONS).orEmpty().split(' ').toSet()
            val maxTexture = IntArray(1).also { GLES30.glGetIntegerv(GLES30.GL_MAX_TEXTURE_SIZE, it, 0) }[0]
            return GlFacts(
                vendor = GLES30.glGetString(GLES30.GL_VENDOR),
                renderer = GLES30.glGetString(GLES30.GL_RENDERER),
                version = GLES30.glGetString(GLES30.GL_VERSION),
                shadingLanguage = GLES30.glGetString(GLES30.GL_SHADING_LANGUAGE_VERSION),
                maxTextureSize = maxTexture.takeIf { it > 0 },
                eglVersion = EGL14.eglQueryString(display, EGL14.EGL_VERSION) ?: "${version[0]}.${version[1]}",
                extensions = DeviceReport.EXTENSIONS.map { it to (it in glExtensions || it in eglExtensions) },
                eglConfigs = configs,
            )
        } finally {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, context)
        }
    }

    /** Window configs a GLES 3 context can draw into, counted per RGBA layout, with how many are recordable. */
    private fun eglConfigs(display: android.opengl.EGLDisplay): List<EglConfigGroup> {
        val count = IntArray(1)
        EGL14.eglGetConfigs(display, null, 0, 0, count, 0)
        val configs = arrayOfNulls<EGLConfig>(count[0])
        EGL14.eglGetConfigs(display, configs, 0, configs.size, count, 0)
        fun attr(c: EGLConfig, a: Int): Int {
            val v = IntArray(1)
            return if (EGL14.eglGetConfigAttrib(display, c, a, v, 0)) v[0] else 0
        }
        return configs.filterNotNull()
            .filter { attr(it, EGL14.EGL_RENDERABLE_TYPE) and EGL_OPENGL_ES3_BIT != 0 && attr(it, EGL14.EGL_SURFACE_TYPE) and EGL14.EGL_WINDOW_BIT != 0 }
            .groupBy { listOf(attr(it, EGL14.EGL_RED_SIZE), attr(it, EGL14.EGL_GREEN_SIZE), attr(it, EGL14.EGL_BLUE_SIZE), attr(it, EGL14.EGL_ALPHA_SIZE)) }
            .map { (rgba, group) -> EglConfigGroup(rgba[0], rgba[1], rgba[2], rgba[3], group.size, group.count { attr(it, EGL_RECORDABLE_ANDROID) == 1 }) }
            .sortedWith(compareByDescending<EglConfigGroup> { it.red + it.green + it.blue + it.alpha }.thenByDescending { it.alpha })
    }

    /** H.264 and HEVC encoders, as MediaCodecList lists them. */
    private fun encoders(): List<EncoderFacts> = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filter { it.isEncoder }
        .flatMap { info ->
            info.supportedTypes.filter { it.equals("video/avc", true) || it.equals("video/hevc", true) }.map { type ->
                val caps = runCatching { info.getCapabilitiesForType(type) }.getOrNull()
                EncoderFacts(
                    name = info.name,
                    type = type,
                    hardware = info.isHardwareAccelerated,
                    vendor = info.isVendor,
                    alias = info.isAlias,
                    takes1080p30 = caps?.videoCapabilities?.let { v ->
                        v.areSizeAndRateSupported(1920, 1080, 30.0) || v.areSizeAndRateSupported(1080, 1920, 30.0)
                    },
                    colorFormats = caps?.colorFormats?.toList().orEmpty(),
                )
            }
        }
        .sortedWith(compareBy({ it.type }, { it.name }))

    private const val EGL_OPENGL_ES3_BIT = 0x40
    private const val EGL_RECORDABLE_ANDROID = 0x3142
}
