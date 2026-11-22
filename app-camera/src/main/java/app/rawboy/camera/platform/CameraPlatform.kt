package app.rawboy.camera.platform

/**
 * Everything RawBoy Camera does differently on one chip, manufacturer or phone model, resolved for the phone it runs
 * on (see [PlatformRegistry]). The shared camera code reads it and holds no phone names or numbers measured on a
 * single phone.
 *
 * Every field is always set: the neutral profile ([neutralPlatform]) gives each one a value, and layers only replace
 * what they know better. The API only grows by adding fields whose neutral value is today's behaviour; an existing
 * field never changes its meaning.
 */
data class CameraPlatform(
    /** Names of the layers applied, base first ("neutral", then e.g. "tensor"), for logs and Settings. */
    val layers: List<String>,
    /**
     * Where learned calibration (preview scales, flash guides) is stored: empty = the phone's own place. A profile
     * picked by hand in a debug build that differs from the automatic one stores under its own slot, so it never
     * spoils what the automatic profile learned ([ActivePlatform]).
     */
    val calibrationSlot: String,
    val lenses: LensProfile,
    val preview: PreviewProfile,
    val still: StillProfile,
    val noise: NoiseProfile,
    val flash: FlashProfile,
) {
    /** What is out of range, one line each (empty = usable); a layer that produces any is a bug. */
    fun problems(): List<String> = buildList {
        if (layers.isEmpty()) add("no layers")
        if (!(still.extraBlack in 0f..0.05f)) add("still.extraBlack ${still.extraBlack} outside 0..0.05")
        if (still.maxStillExposureNs <= 0L) add("still.maxStillExposureNs ${still.maxStillExposureNs} <= 0")
        if (!(still.lookContrast in -100f..100f)) add("still.lookContrast ${still.lookContrast} outside -100..100")
        if (!(still.lookSaturation in -100f..100f)) add("still.lookSaturation ${still.lookSaturation} outside -100..100")
        if (!(still.blackPedestal in 0f..64f)) add("still.blackPedestal ${still.blackPedestal} outside 0..64")
        addAll(still.blackOffsets.problems().map { "still.blackOffsets: $it" })
        if (!(noise.backIsoScale > 0f)) add("noise.backIsoScale ${noise.backIsoScale} <= 0")
        if (!(noise.frontIsoScale > 0f)) add("noise.frontIsoScale ${noise.frontIsoScale} <= 0")
        for ((name, v) in listOf(
            "lutLumaFloor" to noise.lutLumaFloor, "lutColorFloor" to noise.lutColorFloor,
            "experimentalLumaFloor" to noise.experimentalLumaFloor, "experimentalColorFloor" to noise.experimentalColorFloor,
        )) if (!(v in 0f..100f)) add("noise.$name $v outside 0..100")
        if (!(flash.defaultGuide > 0f)) add("flash.defaultGuide ${flash.defaultGuide} <= 0")
        if (!(flash.referenceFNumber > 0f)) add("flash.referenceFNumber ${flash.referenceFNumber} <= 0")
        if (!(flash.defaultGainNoDistance > 0f)) add("flash.defaultGainNoDistance ${flash.defaultGainNoDistance} <= 0")
        if (!(flash.cameraAeCompensationEv in -3f..3f)) add("flash.cameraAeCompensationEv ${flash.cameraAeCompensationEv} outside -3..3")
    }
}

/** Which cameras the lens list is built from ([app.rawboy.camera.capture.LensChoice]). */
data class LensProfile(
    /**
     * When a stand-alone camera has the focal length of a logical multi-camera's lens, list the stand-alone one. Some
     * HALs expose each sensor twice (a logical camera and a camera of its own) and only the stand-alone one streams
     * RAW reliably. Neutral false: whichever the camera list names first (the logical camera on the OnePlus 11).
     */
    val standaloneOverLogical: Boolean,
    /**
     * Per lens label: how far the picture moves per radian of gyro rotation, over the lens's focal length, sideways
     * ([MotionGain.x]) and up and down ([MotionGain.y]), for stabilizing videos from their motion data. Fitted against
     * the measured image motion of real clips; a lens not listed takes 1 (the focal length's own scale). Neutral:
     * none listed.
     */
    val motionGain: Map<String, MotionGain> = emptyMap(),
)

/** A lens's picture-per-gyro scale over its focal length, sideways and up and down ([LensProfile.motionGain]). */
data class MotionGain(val x: Float, val y: Float)

/** The live viewfinder: how the ISP's preview frames relate to the raw. */
data class PreviewProfile(
    /**
     * How linear preview RGB becomes Rec.2020 with the raw's colours (`ViewfinderRenderer.Frame.color`). Neutral:
     * [SrgbPreviewColor], the preview taken as plain sRGB.
     */
    val color: PreviewColor,
    /**
     * The HAL applies TONEMAP_CURVE's points as if evenly spaced over its linear input, whatever their x (OnePlus 11:
     * a curve of x^4 at even points gave the 4th power, the sRGB curve with points packed near black gave sRGB(x^2)).
     * The preview's sRGB curve is then sent at even input steps, which such a HAL renders exactly (a HAL that honours
     * x would render the toe below 1/63 of white up to 35% dark). Neutral false: points packed near black, where the
     * curve bends most, as the Pixel 9 Pro was tuned with.
     */
    val curveAtEvenPoints: Boolean,
    /**
     * How bright a preview frame is next to the still's raw, i.e. what the viewfinder's gain from linear preview to
     * raw units (`ViewfinderRenderer.Frame.scale`) is made of besides the learned per-lens calibration. Neutral
     * [PreviewLevel.BOOSTED], as the Pixel 9 Pro was tuned with.
     */
    val level: PreviewLevel,
    /**
     * The ISP lifts the preview's dark parts locally in backlit scenes (the Pixel's HDRnet), so the viewfinder already
     * shows the lift a shot adds (`ShotDevelop.backlightShadows`). Neutral true, as the Pixel 9 Pro was tuned. False:
     * a global preview tone; the live develop adds the shot's lift itself.
     */
    val liftsShadows: Boolean,
    /**
     * The phone can stream RAW_SENSOR next to the preview fast enough for a viewfinder built from the raw
     * (`CameraSettings.rawViewfinder`, offered in Settings › Viewfinder only where this is true). Neutral false.
     */
    val rawViewfinder: Boolean = false,
    /**
     * With the raw viewfinder on, the repeating request streams the raw alone, without the ISP's preview (saves the
     * ISP's work and the viewfinder's redraws on its frames). Only where [rawViewfinder] is true and the phone keeps
     * 3A and its frame rate without a preview stream. Neutral false.
     */
    val rawViewfinderAlone: Boolean = false,
)

/** How a preview frame's brightness relates to the still's raw ([PreviewProfile.level]). */
enum class PreviewLevel(
    /** Where the learned preview scales are stored: they mean something else under each level. */
    val scalesKey: String,
) {
    /**
     * The preview carries the ISP's post-raw digital boost, which the raw lacks, and in low light the still exposes
     * longer than the preview (`CameraController.stillGain`): gain = calibration / boost x still gain.
     */
    BOOSTED("previewScales3"),

    /**
     * The preview is as bright as the still's raw whatever boost the result reports, with the ISP's white balance
     * applied at green 1, while the decoder scales the raw by the white balance's largest multiplier: gain =
     * calibration x the frame's smallest as-shot neutral component. The calibration then stays near 1 under any light.
     */
    STILL_WHITE_BALANCED("previewScalesWb"),
}

/** Capturing and developing a still. */
data class StillProfile(
    /**
     * Black beyond the DNG's BlackLevel, as a fraction of the white range, subtracted when a shot is decoded and when
     * a raw frame is metered: the ISP renders the preview's black deeper than the raw's. Neutral 0, as Pro and Auto
     * decode.
     */
    val extraBlack: Float,
    /**
     * Longest exposure (ns) AE gives a still in low light when the preview sits at its frame-rate cap; predicts how
     * much brighter the still's raw is than the preview (`CameraController.stillGain`).
     */
    val maxStillExposureNs: Long,
    /**
     * Added to the shot's Contrast slider (develop units, -100..100) where the viewfinder shows the ISP's own, punchier
     * rendering that can't be undone; saved photos only. Neutral 0.
     */
    val lookContrast: Float,
    /** As [lookContrast], for Saturation; B&W looks keep their grey. Neutral 0. */
    val lookSaturation: Float,
    /**
     * Subtract the DNG's fractional per-site BlackLevel exactly when a shot is decoded (`app.rawboy.raw.BlackFix`):
     * LibRaw drops the fraction, which at a high ISO's black (e.g. 64.81) lifts and reddens the deepest shadows.
     * Neutral false, LibRaw's handling as before (the Pixel 9 Pro's [extraBlack] was tuned on top of it).
     */
    val exactBlack: Boolean = false,
    /**
     * DN of noise kept below black when a shot is decoded instead of clipped at zero, which lifts and tints a noisy
     * single frame's deepest shadows. Neutral 0 (LibRaw's clip).
     */
    val blackPedestal: Float = 0f,
    /** The sensor's black beyond the DNG's, per camera and ISO ([BlackOffsets]). Neutral none. */
    val blackOffsets: BlackOffsets = BlackOffsets.NONE,
    /**
     * Develop shots in a GL context of low GPU priority (EGL_IMG_context_priority), so the viewfinder's frames come
     * first. Neutral true, as the Pixel 9 Pro was tuned. False: normal priority, where a busy viewfinder would starve
     * the develop (a GPU throttled by heat).
     */
    val lowPriorityDevelop: Boolean = true,
    /**
     * How much of Brightness's AE compensation reaches the developed raw (`CameraController.appliedCompensationEv`).
     * Neutral [CompensationModel.BOOST_STAYS_DIGITAL], as the Pixel 9 Pro was tuned.
     */
    val compensation: CompensationModel = CompensationModel.BOOST_STAYS_DIGITAL,
    /**
     * [CompensationModel.AE_GAIN_IN_RAW]: the most gain (exposure s x ISO x post-raw boost) AE gives a frame, measured,
     * by camera id (the stand-alone or physical camera); other cameras: [maxStillExposureNs] x the sensor's highest ISO.
     */
    val aeGainCeilings: Map<String, Float> = emptyMap(),
)

/** Where AE compensation the sensor can't take any more ends up ([StillProfile.compensation]). */
enum class CompensationModel {
    /**
     * In post-raw digital boost, which the developed raw doesn't get: what raised the residual digital gain over the
     * still's longer exposure stayed out of it ([app.rawboy.camera.capture.AppliedCompensation.ev]).
     */
    BOOST_STAYS_DIGITAL,

    /**
     * In the raw: the still carries AE's whole gain (exposure x ISO x a boost the DNG holds as BaselineExposure, which the
     * decoder applies), so compensation reaches it unless AE sits at its own gain ceiling, where a brighter one adds
     * nothing ([app.rawboy.camera.capture.AppliedCompensation.evBelowCeiling]).
     */
    AE_GAIN_IN_RAW,
}

/**
 * Where a camera's real black differs from the BlackLevel its DNGs carry: DN per camera colour (R, G, B) at a few ISOs,
 * by camera id (the stand-alone or physical camera that shot it), interpolated in stops of ISO and held beyond the ends.
 * Positive = the sensor's black lies above the file's (shadows come out lifted).
 */
data class BlackOffsets(val byCamera: Map<String, List<Point>>) {
    /** [rgb] DN at [iso]. */
    data class Point(val iso: Float, val rgb: List<Float>)

    /** DN (R, G, B) to subtract beyond the file's black for [cameraId] at [iso]; zeros for a camera without a table. */
    fun at(cameraId: String?, iso: Float): FloatArray {
        val points = cameraId?.let { byCamera[it] }?.sortedBy { it.iso }
        if (points.isNullOrEmpty() || !(iso > 0f)) return FloatArray(3)
        if (iso <= points.first().iso) return points.first().rgb.toFloatArray()
        if (iso >= points.last().iso) return points.last().rgb.toFloatArray()
        val i = points.indexOfLast { it.iso <= iso }
        val a = points[i]
        val b = points[i + 1]
        val t = (kotlin.math.ln(iso / a.iso) / kotlin.math.ln(b.iso / a.iso)).toFloat()
        return FloatArray(3) { c -> a.rgb[c] + (b.rgb[c] - a.rgb[c]) * t }
    }

    fun problems(): List<String> = buildList {
        for ((id, points) in byCamera) for (pt in points) {
            if (!(pt.iso > 0f)) add("camera $id: ISO ${pt.iso} <= 0")
            if (pt.rgb.size != 3) add("camera $id ISO ${pt.iso}: ${pt.rgb.size} values, not 3")
            if (pt.rgb.any { !(it in -8f..8f) }) add("camera $id ISO ${pt.iso}: ${pt.rgb} outside -8..8 DN")
        }
    }

    companion object {
        val NONE = BlackOffsets(emptyMap())
    }
}

/** Auto denoise for the phone's sensors. */
data class NoiseProfile(
    /**
     * ISO multiplier (back cameras) for picking denoise from the ISO table tuned on camera raws: a phone sensor is
     * about as noisy as those at this many times its ISO.
     */
    val backIsoScale: Float,
    /** As [backIsoScale], for selfie cameras (smaller sensors). */
    val frontIsoScale: Float,
    /** Luma denoise floor (slider units, 0..100) for the non-Film colour looks (LUT and neutral). */
    val lutLumaFloor: Float,
    /** Colour denoise floor (slider units) for the non-Film colour looks; above 65 it reaches the coarse chroma stage. */
    val lutColorFloor: Float,
    /** Luma denoise floor for the experimental looks (colour swaps, Redscale), which steepen the shadows more. */
    val experimentalLumaFloor: Float,
    /** Colour denoise floor for the experimental looks. */
    val experimentalColorFloor: Float,
)

/** Starting points of the flash exposure; each lens then learns its own guide (`CameraSettings.flashGuides`). */
data class FlashProfile(
    /** Flash still gain (exposure s x ISO) at 1 m and [referenceFNumber], before a lens has learned its guide. */
    val defaultGuide: Float,
    /** The f-number [defaultGuide] was set at; other lenses scale it by (f-number / this)^2. Also the f-number a lens without one is taken to have. */
    val referenceFNumber: Float,
    /** Flash still gain for a lens that reports no focus distance, before it has learned its own. */
    val defaultGainNoDistance: Float,
    /** Who exposes a flash still. Neutral [FlashMetering.MANUAL_GUIDE] (the guides above are only read then). */
    val metering: FlashMetering = FlashMetering.MANUAL_GUIDE,
    /**
     * AE compensation (EV) added to the user's for a [FlashMetering.CAMERA_AE] flash still; the develop takes it back
     * out (AutoTone's captureEv), so it only leaves the raw headroom the phone's flash AE (aiming at its own JPEG)
     * doesn't. Neutral 0.
     */
    val cameraAeCompensationEv: Float = 0f,
    /**
     * Screen flash (selfie camera): keep the frame lit until the shot's exposure is over (its result has arrived), not
     * only for the fixed time after the request is sent. Neutral false: the fixed time alone.
     */
    val screenFlashUntilExposed: Boolean = false,
)

/** How a flash still is exposed (`CameraController.captureDng`). */
enum class FlashMetering {
    /**
     * By hand: the shot's gain is the lens's flash guide x the focus distance squared, AE off ([app.rawboy.camera.capture.FlashExposure]),
     * learned per lens from each shot. For HALs whose AE keeps the ambient exposure for a flash still (Pixel 9 Pro).
     */
    MANUAL_GUIDE,

    /**
     * The camera's own flash AE: always-flash AE mode and a precapture trigger (the HAL fires its pre-flash and meters
     * with it), then the still with AE on. For HALs where a manual (AE off) still doesn't get the flash's light.
     */
    CAMERA_AE,
}
