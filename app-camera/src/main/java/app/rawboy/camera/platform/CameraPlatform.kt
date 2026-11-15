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
        if (!(noise.backIsoScale > 0f)) add("noise.backIsoScale ${noise.backIsoScale} <= 0")
        if (!(noise.frontIsoScale > 0f)) add("noise.frontIsoScale ${noise.frontIsoScale} <= 0")
        for ((name, v) in listOf(
            "lutLumaFloor" to noise.lutLumaFloor, "lutColorFloor" to noise.lutColorFloor,
            "experimentalLumaFloor" to noise.experimentalLumaFloor, "experimentalColorFloor" to noise.experimentalColorFloor,
        )) if (!(v in 0f..100f)) add("noise.$name $v outside 0..100")
        if (!(flash.defaultGuide > 0f)) add("flash.defaultGuide ${flash.defaultGuide} <= 0")
        if (!(flash.referenceFNumber > 0f)) add("flash.referenceFNumber ${flash.referenceFNumber} <= 0")
        if (!(flash.defaultGainNoDistance > 0f)) add("flash.defaultGainNoDistance ${flash.defaultGainNoDistance} <= 0")
    }
}

/** The live viewfinder: how the ISP's preview frames relate to the raw. */
data class PreviewProfile(
    /**
     * How linear preview RGB becomes Rec.2020 with the raw's colours (`ViewfinderRenderer.Frame.color`). Neutral:
     * [SrgbPreviewColor], the preview taken as plain sRGB.
     */
    val color: PreviewColor,
)

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
)

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
)
