package app.rawboy.camera

import android.content.Context
import app.rawboy.auto.looks.Adjustments
import app.rawboy.auto.looks.Look
import app.rawboy.auto.looks.LookApplier
import app.rawboy.color.BwFilter
import app.rawboy.develop.DevelopParams
import app.rawboy.camera.capture.CameraController
import app.rawboy.camera.capture.FlashGuides
import app.rawboy.camera.capture.FlashMode

/** The look controls, camera choice and output settings. */
data class CameraSettings(
    val lookId: String = Edition.defaultLookId,
    val strength: Float = LookApplier.DEFAULT_STRENGTH,
    val brightness: Float = 0f,
    val warmth: Float = 0f,
    /**
     * B&W mode ([Edition.monoLooks]): the photo is black and white, on [monoLookId]'s stock seen through
     * [filter]. Colour mode keeps [lookId] and [warmth], so switching back and forth keeps each mode's picks.
     */
    val mono: Boolean = false,
    val monoLookId: String = Edition.defaultMonoLookId,
    /** B&W mode's colour filter; Yellow, the classic default (it also keeps the noisy blue channel out of night shots). */
    val filter: BwFilter = BwFilter.YELLOW,
    /** JPEG quality, [MIN_QUALITY]..100. */
    val jpegQuality: Int = 95,
    /** Keep the raw as DNG in Pictures/<Edition.FOLDER>/RAW. */
    val keepDng: Boolean = false,
    /** Save the kept raw as a lossy JPEG XL DNG (a fraction of the size) instead of an uncompressed one. */
    val lossyDng: Boolean = false,
    /** Save photos at [SMALL_LONG_SIDE] px on the long side instead of full size. */
    val smallExport: Boolean = true,
    /**
     * Shoot at the lens's maximum-resolution sensor mode (50 MP on a Pixel 9 Pro) on lenses that have one; others keep
     * their normal size. One raw per shot: no frame merging.
     */
    val maxRes: Boolean = false,
    /**
     * Keep the camera (facing, lens), look and sliders between launches. Off: each launch starts on the back
     * W lens with the default look and sliders. Output settings and calibration are always kept.
     */
    val rememberLast: Boolean = false,
    /** A live RGB histogram in a corner of the viewfinder. */
    val showHistogram: Boolean = false,
    /** Whether each shot (without flash) takes [BURST_FRAMES] raws and merges them into one: see [BurstMode]. */
    val burstMode: BurstMode = BurstMode.AUTO,
    /** Play the camera shutter click on each shot. Where the law requires it, Android plays it regardless (ShutterSound). */
    val shutterSound: Boolean = false,
    /** Save where each photo was taken (GPS tags in the JPEG and DNG). Needs location permission, asked when turned on. */
    val geotag: Boolean = false,
    /** Look for QR codes in the viewfinder and offer to open them, as the phone's own camera does. */
    val scanQr: Boolean = true,
    /** After a tap, keep focus on what was tapped as it moves (CameraViewModel's tracker); off = the focus stays put. */
    val trackFocus: Boolean = false,
    /**
     * Per camera ([lensKey]): gain from the linearised preview to raw units (1.0 = sensor clip), learned
     * from each shot (raw key / viewfinder key), so the viewfinder's auto exposure matches the final.
     */
    val previewScales: Map<String, Float> = emptyMap(),
    /**
     * Per camera ([lensKey]): the flash's guide (still gain at 1 m, see CameraController.flashExposure), learned from
     * each flash shot, so flash raws come out neither clipped nor dark.
     */
    val flashGuides: Map<String, Float> = emptyMap(),
    /** Selfie camera instead of the back cameras. */
    val front: Boolean = false,
    /** Lens label within the current side: UW, W, T, T2… */
    val lens: String = "W",
    /** Flash for the next shots (used only on lenses with a flash). */
    val flash: FlashMode = FlashMode.OFF,
) {
    /** The lens's key for per-lens values: the label, prefixed with "H" in maximum-resolution mode, "F" on the front side. */
    fun lensKey(hiRes: Boolean = false): String = lensKey(front, lens, hiRes)
    val lensKey: String get() = lensKey(false)

    fun previewScale(hiRes: Boolean = false): Float = previewScales[lensKey(hiRes)] ?: previewScales[lensKey] ?: 1f
    val previewScale: Float get() = previewScale(false)

    /** The current lens's flash guides; the one for shots without a focus distance is kept under "<lens>?". */
    fun flashGuide(hiRes: Boolean = false): FlashGuides {
        val k = lensKey(hiRes)
        return FlashGuides(
            flashGuides[k] ?: flashGuides[lensKey] ?: CameraController.DEFAULT_FLASH_GUIDE,
            flashGuides[flashGuideKey(k, distanceKnown = false)] ?: flashGuides[flashGuideKey(lensKey, distanceKnown = false)] ?: CameraController.DEFAULT_FLASH_GAIN_NO_DISTANCE,
        )
    }
    val flashGuide: FlashGuides get() = flashGuide(false)

    /** B&W mode is on and this edition has one. */
    val monoMode: Boolean get() = mono && Edition.monoLooks.isNotEmpty()

    /** The look in effect: B&W mode's stock or the colour look. */
    val look: Look get() = if (monoMode) Edition.monoLook(monoLookId) else Edition.look(lookId)

    /**
     * [base] (the auto develop) with the look and the sliders, as the viewfinder shows it and the shot is saved. B&W mode:
     * the filter, then grey (Saturation -100 makes the scene grey before the stock and keeps the stock's output grey, see
     * `applyLut`), so Strength blends the stock's tones with plain AgX grey and the picture stays black and white;
     * Warmth isn't shown there and doesn't apply.
     */
    fun develop(base: DevelopParams, hasFace: Boolean): DevelopParams {
        val bw = monoMode
        val p = LookApplier.apply(base, look, strength, Adjustments(brightness = brightness, warmth = if (bw) 0f else warmth), hasFace)
        return if (bw) p.copy(saturation = -100f, bwFilter = filter) else p
    }

    /** The long side to save at, or null for full size. */
    val maxLongSide: Int? get() = if (smallExport) SMALL_LONG_SIDE else null

    /** Raws per shot: [BURST_FRAMES] when the mode merges (for AUTO: when [lowLight]), else 1. */
    fun burstFrames(lowLight: Boolean): Int = if (burstMode.merges(lowLight)) BURST_FRAMES else 1

    companion object {
        const val MIN_QUALITY = 70
        const val SMALL_LONG_SIDE = 3000
        /** Light sharpening after the downscale to [SMALL_LONG_SIDE] (luma unsharp mask, `band_ops.h`); full size gets none. */
        const val SMALL_SHARPEN = 0.5f
        /** Raws merged per shot with [BurstMode]: noise about 1/sqrt of it where nothing moves (~2.8x less). */
        const val BURST_FRAMES = 8

        /** Range of the preview calibration; the Pixel's lenses need 0.5 (selfie) to ~9 (T3). */
        const val MIN_SCALE = 1f / 32
        const val MAX_SCALE = 32f

        fun lensKey(front: Boolean, lens: String, hiRes: Boolean = false) =
            (if (hiRes) "H" else "") + (if (front) "F" else "") + lens

        fun flashGuideKey(lensKey: String, distanceKnown: Boolean) = if (distanceKnown) lensKey else "$lensKey?"
    }
}

object CameraSettingsStore {
    private const val PREFS = "camera"

    /**
     * Calibration storage. "previewScales3": learned with the explicit sRGB preview curve and the still-exposure
     * prediction (CameraController.stillGain); earlier values were learned without them and are dropped.
     */
    private const val SCALES_KEY = "previewScales3"
    private const val FLASH_GUIDES_KEY = "flashGuides"

    @Synchronized
    fun load(context: Context): CameraSettings {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val d = CameraSettings()
        val always = CameraSettings(
            jpegQuality = p.getInt("jpegQuality", d.jpegQuality).coerceIn(CameraSettings.MIN_QUALITY, 100),
            keepDng = p.getBoolean("keepDng", d.keepDng),
            lossyDng = p.getBoolean("lossyDng", d.lossyDng),
            smallExport = p.getBoolean("smallExport", d.smallExport),
            maxRes = p.getBoolean("maxRes", d.maxRes),
            rememberLast = p.getBoolean("rememberLast", d.rememberLast),
            showHistogram = p.getBoolean("showHistogram", d.showHistogram),
            burstMode = runCatching { BurstMode.valueOf(p.getString("burstMode", null)!!) }.getOrDefault(d.burstMode),
            shutterSound = p.getBoolean("shutterSound", d.shutterSound),
            geotag = p.getBoolean("geotag", d.geotag),
            scanQr = p.getBoolean("scanQr", d.scanQr),
            trackFocus = p.getBoolean("trackFocus", d.trackFocus),
            previewScales = parseScales(p.getString(SCALES_KEY, null)),
            flashGuides = parseScales(p.getString(FLASH_GUIDES_KEY, null), min = 1e-2f, max = 1e4f),
            // "FLASH" (plain flash, since removed) becomes Focus-flash.
            flash = when (val f = p.getString("flash", null)) {
                "FLASH" -> FlashMode.FOCUS_FLASH
                else -> runCatching { FlashMode.valueOf(f!!) }.getOrDefault(d.flash)
            },
        )
        if (!always.rememberLast) return always
        val remembered = always.copy(
            lookId = p.getString("look", d.lookId) ?: d.lookId,
            strength = p.getFloat("strength", d.strength).coerceIn(0f, 100f),
            brightness = p.getFloat("brightness", d.brightness).coerceIn(-100f, 100f),
            warmth = p.getFloat("warmth", d.warmth).coerceIn(-100f, 100f),
            mono = p.getBoolean("mono", d.mono),
            monoLookId = p.getString("monoLook", d.monoLookId) ?: d.monoLookId,
            filter = BwFilter.fromKey(p.getString("filter", null)) ?: d.filter,
            front = p.getBoolean("front", d.front),
            lens = p.getString("lens", d.lens) ?: d.lens,
        )
        // A black and white look picked before RawBoy Camera had B&W mode now opens that mode on it.
        if (Edition.monoLooks.none { it.id == remembered.lookId }) return remembered
        return remembered.copy(mono = true, monoLookId = remembered.lookId, lookId = d.lookId)
    }

    /**
     * Saves user controls, so switching [CameraSettings.rememberLast] on later starts from the current state.
     * Calibration maps are written by [updatePreviewScale] and [updateFlashGuide] so background develops never race a
     * slider edit.
     */
    @Synchronized
    fun save(context: Context, s: CameraSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("look", s.lookId)
            .putFloat("strength", s.strength)
            .putFloat("brightness", s.brightness)
            .putFloat("warmth", s.warmth)
            .putBoolean("mono", s.mono)
            .putString("monoLook", s.monoLookId)
            .putString("filter", s.filter.key)
            .putInt("jpegQuality", s.jpegQuality)
            .putBoolean("keepDng", s.keepDng)
            .putBoolean("lossyDng", s.lossyDng)
            .putBoolean("smallExport", s.smallExport)
            .putBoolean("maxRes", s.maxRes)
            .putBoolean("rememberLast", s.rememberLast)
            .putBoolean("showHistogram", s.showHistogram)
            .putString("burstMode", s.burstMode.name)
            .putBoolean("shutterSound", s.shutterSound)
            .putBoolean("geotag", s.geotag)
            .putBoolean("scanQr", s.scanQr)
            .putBoolean("trackFocus", s.trackFocus)
            .putBoolean("front", s.front)
            .putString("lens", s.lens)
            .putString("flash", s.flash.name)
            .apply()
    }

    /** Updates one lens's [CameraSettings.previewScales] entry in storage, returning the new scale. */
    @Synchronized
    fun updatePreviewScale(context: Context, lens: String, estimate: Float): Float {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val scales = parseScales(p.getString(SCALES_KEY, null))
        val known = scales[lens]
        val scale = if (known == null) estimate else known * kotlin.math.sqrt(estimate / known)
        val clamped = scale.coerceIn(CameraSettings.MIN_SCALE, CameraSettings.MAX_SCALE)
        val updated = scales + (lens to clamped)
        p.edit().putString(SCALES_KEY, updated.entries.joinToString(";") { "${it.key}=${it.value}" }).apply()
        return clamped
    }

    /** Updates one lens's [CameraSettings.flashGuides] entry in storage, returning the new guide. */
    @Synchronized
    fun updateFlashGuide(context: Context, key: String, estimate: Float, min: Float, max: Float): Float {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val guides = parseScales(p.getString(FLASH_GUIDES_KEY, null), min = min, max = max)
        val known = guides[key]
        val guide = (if (known == null) estimate else known * kotlin.math.sqrt(estimate / known)).coerceIn(min, max)
        val updated = guides + (key to guide)
        p.edit().putString(FLASH_GUIDES_KEY, updated.entries.joinToString(";") { "${it.key}=${it.value}" }).apply()
        return guide
    }

    /** "W=1.1;T=0.95;FW=1.0" -> map; malformed entries are skipped. */
    private fun parseScales(text: String?, min: Float = CameraSettings.MIN_SCALE, max: Float = CameraSettings.MAX_SCALE): Map<String, Float> =
        text.orEmpty().split(';').mapNotNull { entry ->
            val (key, value) = entry.split('=').takeIf { it.size == 2 } ?: return@mapNotNull null
            value.toFloatOrNull()?.takeIf { it > 0f }?.let { key to it.coerceIn(min, max) }
        }.toMap()
}

/** Frame merging for each shot (the burst button): cycles ON -> AUTO -> OFF. */
enum class BurstMode {
    /** Always merge [CameraSettings.BURST_FRAMES] frames. */
    ON,

    /** Merge only in low light ([LowLight]); one frame otherwise. The default: stacking is not obvious to users. */
    AUTO,

    /** Always one frame. */
    OFF;

    fun merges(lowLight: Boolean): Boolean = this == ON || (this == AUTO && lowLight)

    fun next(): BurstMode = when (this) {
        ON -> AUTO
        AUTO -> OFF
        OFF -> ON
    }
}

/**
 * Low-light criteria for [BurstMode.AUTO]. TUNE HERE.
 *
 * The measure is the preview's exposure product `ISO x exposure time (s) x postRawBoost` (what the camera's AE
 * needed for the scene; higher = darker). Rough scale: sunny day ~0.1, bright indoors ~3, dim indoors ~15-30,
 * night street 60+. A Schmitt trigger avoids flicker at the edge: low light switches ON at or above
 * [ENTER_PRODUCT] and OFF again only below [EXIT_PRODUCT] (e.g. ISO 400 at 1/60 s, 6.7, enters; bright indoors
 * at ~3 does not): check the logcat line "shutter ..." (ISO, exposure, boost) in real scenes, and adjust. Flash
 * shots never merge, whatever the light.
 */
object LowLight {
    const val ENTER_PRODUCT = 6f
    const val EXIT_PRODUCT = 4f

    fun product(iso: Float, exposureNs: Long, postRawBoost: Float): Float =
        iso * (exposureNs / 1e9f) * postRawBoost.coerceAtLeast(1f)

    /** Next low-light state given the previous one (hysteresis). Unknown exposure keeps [previous]. */
    fun next(previous: Boolean, iso: Float, exposureNs: Long, postRawBoost: Float): Boolean {
        if (iso <= 0f || exposureNs <= 0L) return previous
        val v = product(iso, exposureNs, postRawBoost)
        return if (previous) v >= EXIT_PRODUCT else v >= ENTER_PRODUCT
    }
}
