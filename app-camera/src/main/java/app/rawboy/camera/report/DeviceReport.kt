package app.rawboy.camera.report

import app.rawboy.camera.capture.VideoProbeState
import app.rawboy.camera.platform.ResolvedPlatform
import java.util.Locale

/**
 * What the device report holds, as plain values (gathered by [DeviceReportCollector]), so [DeviceReport.render] is a
 * pure function the JVM tests can feed. Nothing in it identifies the person: no serial numbers, accounts, locations,
 * file names or pictures.
 */
data class DeviceReportData(
    /** versionName (versionCode). */
    val appVersion: String,
    /** The installed package (a debug build may carry a suffix). */
    val packageName: String,
    val debuggable: Boolean,
    /** yyyy-MM-dd. */
    val date: String,
    val platform: ResolvedPlatform,
    /** Camera ids the app can see (`CameraManager.cameraIdList`). */
    val cameraIds: List<String>,
    /** Every camera and physical lens, in the order looked at. */
    val cameras: List<CameraFacts>,
    /** What `CameraController.lenses` made of them, back then front. */
    val lenses: List<LensFacts>,
    /** Cameras `CameraController.lenses` passed over, with why. */
    val skipped: List<SkippedCamera>,
    val gl: GlFacts?,
    val encoders: List<EncoderFacts>,
    /** Learned calibration entries: storage key (e.g. "previewScales3") to its "lens=value;…" text. */
    val calibration: List<Pair<String, String>>,
    /** What the video probe keeps ([VideoProbeState]); null if not read. */
    val video: VideoProbeState? = null,
    /** Whether [video] was stored under this build (another build's is forgotten at the next recording). */
    val videoForThisBuild: Boolean = false,
    /** Parts that couldn't be read, one line each ("cameras: SecurityException"). */
    val failures: List<String> = emptyList(),
)

/** One camera id, or one physical lens of a logical camera ([id] "0/2"), from its `CameraCharacteristics`. */
data class CameraFacts(
    val id: String,
    /** CameraMetadata.LENS_FACING_*; null if not reported. */
    val facing: Int? = null,
    /** INFO_SUPPORTED_HARDWARE_LEVEL_*. */
    val hardwareLevel: Int? = null,
    /** REQUEST_AVAILABLE_CAPABILITIES_*. */
    val capabilities: List<Int> = emptyList(),
    /** A logical camera's physical lenses. */
    val physicalIds: List<String> = emptyList(),
    val focalLengthsMm: List<Float> = emptyList(),
    val apertures: List<Float> = emptyList(),
    /** Physical sensor size in mm, "w x h". */
    val sensorSizeMm: String? = null,
    val pixelArray: String? = null,
    val activeArray: String? = null,
    val sensorOrientation: Int? = null,
    /** SENSOR_INFO_COLOR_FILTER_ARRANGEMENT_*. */
    val colorFilter: Int? = null,
    val blackLevels: List<Int> = emptyList(),
    val whiteLevel: Int? = null,
    /** RAW_SENSOR sizes of the default sensor mode. */
    val rawSizes: List<String> = emptyList(),
    /** The maximum-resolution sensor mode's RAW_SENSOR / RAW10 sizes (Android 12+), "6144x8160 RAW10". */
    val maxResRawSizes: List<String> = emptyList(),
    /** SurfaceTexture (preview) sizes. */
    val previewSizes: List<String> = emptyList(),
    /** TONEMAP_MODE_*. */
    val toneMapModes: List<Int> = emptyList(),
    val maxCurvePoints: Int? = null,
    val isoRange: String? = null,
    /** SENSOR_INFO_EXPOSURE_TIME_RANGE, ns. */
    val exposureRangeNs: Pair<Long, Long>? = null,
    val maxFrameDurationNs: Long? = null,
    val postRawBoostRange: String? = null,
    val fpsRanges: List<String> = emptyList(),
    /** CONTROL_AE_COMPENSATION_STEP as a fraction, "1/6". */
    val aeCompensationStep: String? = null,
    val aeCompensationRange: String? = null,
    /** CONTROL_AE_MODE_*. */
    val aeModes: List<Int> = emptyList(),
    val flash: Boolean? = null,
    /** LENS_OPTICAL_STABILIZATION_MODE_*. */
    val oisModes: List<Int> = emptyList(),
    /** CONTROL_VIDEO_STABILIZATION_MODE_*. */
    val videoStabilizationModes: List<Int> = emptyList(),
    /** STATISTICS_LENS_SHADING_MAP_MODE_* (0 off, 1 on). */
    val shadingMapModes: List<Int> = emptyList(),
    val lensShadingApplied: Boolean? = null,
    /** DISTORTION_CORRECTION_MODE_*. */
    val distortionModes: List<Int> = emptyList(),
    /** STATISTICS_FACE_DETECT_MODE_*. */
    val faceModes: List<Int> = emptyList(),
    /** LENS_INFO_FOCUS_DISTANCE_CALIBRATION_*. */
    val focusCalibration: Int? = null,
    /** Diopters; 0 = fixed focus. */
    val minFocusDistance: Float? = null,
    /** Android's session parameters (`availableSessionKeys` named `android.*`), by key name. */
    val sessionKeys: List<String> = emptyList(),
    /** How many vendor session keys (e.g. `com.oplus.*`) the camera lists besides; counted, not named. */
    val vendorSessionKeys: Int = 0,
    /** Reading this camera failed (then the fields above are left unset). */
    val failure: String? = null,
)

/** One lens as the camera lists it (`CameraController.Info`). */
data class LensFacts(
    /** CameraMetadata.LENS_FACING_*. */
    val facing: Int,
    /** UW, W, T… */
    val label: String,
    /** "3", or "0/2" for a physical lens streamed from logical camera 0. */
    val camera: String,
    val equivalentFocalMm: Float,
    val fNumber: Float,
    val rawSize: String,
    val previewSize: String,
    val maxResSize: String?,
    val flash: Boolean,
)

/** A camera `CameraController.lenses` didn't list. */
data class SkippedCamera(val camera: String, val why: String)

/** The GPU as a GLES 3 context sees it, and the extensions the camera relies on. */
data class GlFacts(
    val vendor: String?,
    val renderer: String?,
    val version: String?,
    val shadingLanguage: String?,
    val maxTextureSize: Int?,
    val eglVersion: String?,
    /** Extension name to whether the GPU has it, in [DeviceReport.EXTENSIONS] order. */
    val extensions: List<Pair<String, Boolean>>,
    /** Window configs a GLES 3 context can use, counted per colour layout. */
    val eglConfigs: List<EglConfigGroup>,
)

/** EGL window configs (GLES 3 renderable) of one colour layout. */
data class EglConfigGroup(val red: Int, val green: Int, val blue: Int, val alpha: Int, val count: Int, val recordable: Int)

/** One video encoder for one type (H.264 or HEVC). */
data class EncoderFacts(
    val name: String,
    /** "video/avc", "video/hevc". */
    val type: String,
    val hardware: Boolean?,
    val vendor: Boolean?,
    val alias: Boolean?,
    /** Takes 1920x1080 at 30 fps (the camera's video size). */
    val takes1080p30: Boolean?,
    /** MediaCodecInfo.CodecCapabilities.COLOR_Format*. */
    val colorFormats: List<Int>,
)

/**
 * The text of RawBoy Camera's device report (Settings › Share device report): what a profile for a new phone is made
 * from, readable by a person and laid out the same on every phone (fixed order, one `key: value` per line, `-` for
 * what the phone doesn't report), so two reports compare line by line. Numbers are written the same in every locale.
 */
object DeviceReport {
    /** Bumped when lines change meaning, so reports of different versions aren't compared as if alike. */
    const val FORMAT = 1

    /** The GL and EGL extensions the camera uses (viewfinder, export, video). */
    val EXTENSIONS = listOf(
        "GL_EXT_color_buffer_float",
        "GL_EXT_YUV_target",
        "GL_OES_EGL_image_external_essl3",
        "EGL_IMG_context_priority",
        "EGL_ANDROID_recordable",
        "EGL_ANDROID_presentation_time",
    )

    fun render(d: DeviceReportData): String = buildString {
        line("RawBoy Camera device report")
        line("format: $FORMAT")
        field("app", listOf(d.appVersion, d.packageName, if (d.debuggable) "debug build" else "").filter { it.isNotBlank() }.joinToString(", "))
        field("date", d.date)
        line("Shared by hand only; it holds no serial numbers, accounts, locations or photos.")

        section("Phone")
        val phone = d.platform.phone
        field("chip", "${phone.chip.title} (${phone.chip})")
        field("soc manufacturer", phone.socManufacturer)
        field("soc model", phone.socModel)
        field("hardware", phone.hardware)
        field("board", phone.board)
        field("manufacturer", phone.manufacturer)
        field("brand", phone.brand)
        field("model", phone.model)
        field("device", phone.device)
        field("android sdk", phone.sdk.takeIf { it > 0 }?.toString())
        field("firmware", phone.firmware)

        section("Profile")
        val p = d.platform.profile
        field("choice", d.platform.chosenChip?.let { "taken for $it by hand" } ?: "automatic")
        field("layers", p.layers.joinToString(" + "))
        field("calibration", p.calibrationSlot.ifEmpty { "own" })
        field("preview", p.preview.toString())
        field("still", p.still.toString())
        field("noise", p.noise.toString())
        field("flash", p.flash.toString())

        section("Lenses")
        field("camera ids", d.cameraIds.joinToString(", "))
        if (d.lenses.isEmpty()) line("none listed")
        for (l in d.lenses) {
            field(
                "${facingName(l.facing)} ${l.label}",
                "camera ${l.camera}, ${num(l.equivalentFocalMm, 1)} mm, f/${num(l.fNumber, 2)}, RAW ${l.rawSize}, " +
                    "preview ${l.previewSize}, max res ${l.maxResSize ?: "-"}, flash ${yesNo(l.flash)}",
            )
        }
        for (s in d.skipped) field("skipped ${s.camera}", s.why)

        for (c in d.cameras) camera(c)

        section("GPU")
        val gl = d.gl
        if (gl == null) line("not read")
        else {
            field("GL_VENDOR", gl.vendor)
            field("GL_RENDERER", gl.renderer)
            field("GL_VERSION", gl.version)
            field("GLSL", gl.shadingLanguage)
            field("max texture size", gl.maxTextureSize?.toString())
            field("EGL", gl.eglVersion)
            for ((name, has) in gl.extensions) field(name, yesNo(has))
            for (g in gl.eglConfigs) {
                field("EGL configs RGBA ${g.red}${g.green}${g.blue}${g.alpha}", "${g.count}, recordable ${g.recordable}")
            }
        }

        section("Video encoders")
        if (d.encoders.isEmpty()) line("none listed")
        for (e in d.encoders) {
            val kind = listOfNotNull(
                e.hardware?.let { if (it) "hardware" else "software" },
                e.vendor?.let { if (it) "vendor" else "platform" },
                e.alias?.takeIf { it }?.let { "alias" },
            ).joinToString(", ").ifEmpty { "-" }
            field("${e.name} (${e.type})", "$kind; 1080p30 ${e.takes1080p30?.let(::yesNo) ?: "-"}")
            field("  colour formats", e.colorFormats.joinToString(", ") { colorFormatName(it) })
        }

        section("Video probe")
        val v = d.video
        if (v == null) line("not read")
        else {
            field(
                "variant",
                when {
                    v.variant == null -> "STANDARD (nothing stored)"
                    v.confirmed -> "${v.variant.name} (recorded)"
                    else -> "${v.variant.name} (next, on the remade viewfinder)"
                },
            )
            field("stored for this build", yesNo(d.videoForThisBuild))
            if (v.lastTries.isEmpty()) field("last probe", null)
            for (t in v.lastTries) field("last probe", t)
        }

        section("Calibration")
        if (d.calibration.isEmpty()) line("none learned")
        for ((key, value) in d.calibration.sortedBy { it.first }) {
            val entries = value.split(';').filter { it.isNotBlank() }
            if (entries.isEmpty()) field(key, null)
            for (e in entries.sorted()) field(key, e)
        }

        if (d.failures.isNotEmpty()) {
            section("Not read")
            for (f in d.failures) line(f)
        }
    }

    private fun StringBuilder.camera(c: CameraFacts) {
        section("Camera ${c.id}")
        field("facing", c.facing?.let(::facingName))
        field("hardware level", c.hardwareLevel?.let { HARDWARE_LEVELS[it] ?: it.toString() })
        field("capabilities", names(c.capabilities, CAPABILITIES))
        field("physical cameras", c.physicalIds.joinToString(", "))
        field("focal lengths mm", c.focalLengthsMm.joinToString(", ") { num(it, 2) })
        field("apertures", c.apertures.joinToString(", ") { "f/" + num(it, 2) })
        field("sensor size mm", c.sensorSizeMm)
        field("pixel array", c.pixelArray)
        field("active array", c.activeArray)
        field("sensor orientation", c.sensorOrientation?.toString())
        field("colour filter", c.colorFilter?.let { COLOR_FILTERS[it] ?: it.toString() })
        field("black level", c.blackLevels.joinToString(" "))
        field("white level", c.whiteLevel?.toString())
        field("RAW sizes", c.rawSizes.joinToString(", "))
        field("max res RAW sizes", c.maxResRawSizes.joinToString(", "))
        field("preview sizes", c.previewSizes.joinToString(", "))
        field("tone map modes", names(c.toneMapModes, TONE_MAP_MODES))
        field("max curve points", c.maxCurvePoints?.toString())
        field("ISO range", c.isoRange)
        field("exposure range", c.exposureRangeNs?.let { "${seconds(it.first)} .. ${seconds(it.second)}" })
        field("max frame duration", c.maxFrameDurationNs?.let(::seconds))
        field("post-raw boost range", c.postRawBoostRange)
        field("fps ranges", c.fpsRanges.joinToString(", "))
        field("AE compensation", c.aeCompensationStep?.let { "step $it EV, range ${c.aeCompensationRange ?: "-"}" })
        field("AE modes", names(c.aeModes, AE_MODES))
        field("flash", c.flash?.let(::yesNo))
        field("OIS modes", names(c.oisModes, ON_OFF))
        field("video stabilization modes", names(c.videoStabilizationModes, VIDEO_STABILIZATION))
        field("lens shading map modes", names(c.shadingMapModes, ON_OFF))
        field("lens shading applied", c.lensShadingApplied?.let(::yesNo))
        field("distortion correction modes", names(c.distortionModes, DISTORTION))
        field("face detect modes", names(c.faceModes, FACE_MODES))
        field("focus calibration", c.focusCalibration?.let { FOCUS_CALIBRATION[it] ?: it.toString() })
        field("min focus distance", c.minFocusDistance?.let { if (it > 0f) num(it, 2) + " dpt" else "0 (fixed focus)" })
        field("session keys", (c.sessionKeys + listOfNotNull(c.vendorSessionKeys.takeIf { it > 0 }?.let { "+$it vendor keys" })).joinToString(", "))
        c.failure?.let { field("not read", it) }
    }

    private fun StringBuilder.line(text: String) {
        append(text).append('\n')
    }

    private fun StringBuilder.section(title: String) {
        append('\n').append("== ").append(title).append(" ==\n")
    }

    /** `key: value`, `-` when the phone reports nothing. */
    private fun StringBuilder.field(key: String, value: String?) {
        line("$key: ${value?.takeIf { it.isNotBlank() } ?: "-"}")
    }

    private fun yesNo(b: Boolean) = if (b) "yes" else "no"

    /** [v] with [digits] decimals at most, in the same notation whatever the phone's locale. */
    internal fun num(v: Float, digits: Int): String {
        val s = String.format(Locale.ROOT, "%.${digits}f", v)
        return if (digits == 0) s else s.trimEnd('0').trimEnd('.')
    }

    /** An exposure time as a photographer writes it: "1/30 s" below a second, "2.5 s" from one. */
    internal fun seconds(ns: Long): String =
        if (ns <= 0L) "$ns ns"
        else if (ns < 1_000_000_000L) "1/${num(1e9f / ns, 0)} s"
        else num(ns / 1e9f, 3) + " s"

    private fun facingName(f: Int) = FACING[f] ?: "facing $f"

    /** Each value by name where known, else its number. */
    private fun names(values: List<Int>, table: Map<Int, String>) = values.joinToString(", ") { table[it] ?: it.toString() }

    private fun colorFormatName(f: Int): String {
        val hex = "0x" + Integer.toHexString(f)
        return COLOR_FORMATS[f]?.let { "$hex $it" } ?: hex
    }

    // Camera2 and MediaCodec constants by name (checked against android.jar, API 36).
    private val FACING = mapOf(0 to "front", 1 to "back", 2 to "external")
    private val HARDWARE_LEVELS = mapOf(0 to "LIMITED", 1 to "FULL", 2 to "LEGACY", 3 to "LEVEL_3", 4 to "EXTERNAL")
    private val CAPABILITIES = mapOf(
        0 to "BACKWARD_COMPATIBLE", 1 to "MANUAL_SENSOR", 2 to "MANUAL_POST_PROCESSING", 3 to "RAW",
        4 to "PRIVATE_REPROCESSING", 5 to "READ_SENSOR_SETTINGS", 6 to "BURST_CAPTURE", 7 to "YUV_REPROCESSING",
        8 to "DEPTH_OUTPUT", 9 to "CONSTRAINED_HIGH_SPEED_VIDEO", 10 to "MOTION_TRACKING", 11 to "LOGICAL_MULTI_CAMERA",
        12 to "MONOCHROME", 13 to "SECURE_IMAGE_DATA", 14 to "SYSTEM_CAMERA", 15 to "OFFLINE_PROCESSING",
        16 to "ULTRA_HIGH_RESOLUTION_SENSOR", 17 to "REMOSAIC_REPROCESSING", 18 to "DYNAMIC_RANGE_TEN_BIT",
        19 to "STREAM_USE_CASE", 20 to "COLOR_SPACE_PROFILES",
    )
    private val COLOR_FILTERS = mapOf(0 to "RGGB", 1 to "GRBG", 2 to "GBRG", 3 to "BGGR", 4 to "RGB", 5 to "MONO", 6 to "NIR")
    private val TONE_MAP_MODES = mapOf(0 to "CONTRAST_CURVE", 1 to "FAST", 2 to "HIGH_QUALITY", 3 to "GAMMA_VALUE", 4 to "PRESET_CURVE")
    private val AE_MODES = mapOf(
        0 to "OFF", 1 to "ON", 2 to "ON_AUTO_FLASH", 3 to "ON_ALWAYS_FLASH", 4 to "ON_AUTO_FLASH_REDEYE",
        5 to "ON_EXTERNAL_FLASH", 6 to "ON_LOW_LIGHT_BOOST_BRIGHTNESS_PRIORITY",
    )
    private val ON_OFF = mapOf(0 to "OFF", 1 to "ON")
    private val VIDEO_STABILIZATION = mapOf(0 to "OFF", 1 to "ON", 2 to "PREVIEW_STABILIZATION")
    private val DISTORTION = mapOf(0 to "OFF", 1 to "FAST", 2 to "HIGH_QUALITY")
    private val FACE_MODES = mapOf(0 to "OFF", 1 to "SIMPLE", 2 to "FULL")
    private val FOCUS_CALIBRATION = mapOf(0 to "UNCALIBRATED", 1 to "APPROXIMATE", 2 to "CALIBRATED")
    private val COLOR_FORMATS = mapOf(
        19 to "YUV420Planar", 20 to "YUV420PackedPlanar", 21 to "YUV420SemiPlanar", 39 to "YUV420PackedSemiPlanar",
        54 to "YUVP010", 0x7f000789 to "Surface", 0x7f420888 to "YUV420Flexible", 0x7f00a000 to "32bitABGR8888",
        0x7f00aaa2 to "32bitABGR2101010", 0x7f36a888 to "RGBAFlexible",
    )
}
