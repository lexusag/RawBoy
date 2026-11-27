package app.rawboy.auto.analysis

import app.rawboy.develop.DevelopParams
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Camera scenes recognised from [SceneStats] and capture light metadata ([SceneLight]), each mapped to a develop
 * adjustment in [SceneRecognition.ADJUSTMENTS].
 */
enum class CameraScene {
    /** Clear sunny daylight with visible blue sky: brightens moderately while protecting highlights. */
    SUNNY_BLUE_SKY,
}

/**
 * Exposure and tone offsets applied on top of [AutoTone.develop] for a recognised camera scene.
 * All zeros = neutral (no change).
 */
data class SceneAdjustment(
    /** Exposure shift in EV (positive = brighter). */
    val exposureEv: Float = 0f,
    /** Highlights slider shift (-100..100). */
    val highlights: Float = 0f,
    /** Shadows slider shift (-100..100). */
    val shadows: Float = 0f,
    /** Contrast slider shift (-100..100). */
    val contrast: Float = 0f,
) {
    val isNeutral: Boolean get() = exposureEv == 0f && highlights == 0f && shadows == 0f && contrast == 0f
}

/**
 * Capture light context paired with [SceneStats] for [SceneRecognition].
 *
 * [exposureSeconds] and [postRawBoost] measure how much light the camera's AE needed for the scene
 * (`ISO * exposureSeconds * postRawBoost`, matching Camera's `LowLight.product`: sunny day ~0.05-0.4, bright indoors ~3,
 * night 60+). [captureEv] is the AE compensation applied to the frame (Camera's Brightness slider) so the ambient light
 * estimate stays invariant when the user moves Brightness.
 */
data class SceneLight(
    /** Shutter time in seconds (<= 0 when unknown). */
    val exposureSeconds: Float = 0f,
    /** Post-raw digital gain multiplier (1 = none). */
    val postRawBoost: Float = 1f,
    /** AE compensation applied to the frame (EV, from Camera's Brightness slider). */
    val captureEv: Float = 0f,
)

/** One recognised [scene] and its smooth confidence weight in 0..1. */
data class SceneMatch(
    val scene: CameraScene,
    val confidence: Float,
)

/**
 * Extensible scene recognition map for RawBoy Camera (live viewfinder and saved shots; mirrored in Swift
 * `SceneRecognition.swift`).
 *
 * Recognised scenes carry smooth 0..1 confidences so panning the camera or crossing a threshold never pops brightness,
 * and positive exposure lifts are guarded by highlight headroom so bright clouds and speculars do not clip.
 */
object SceneRecognition {
    /**
     * Full-confidence develop adjustment for each recognised [CameraScene].
     *
     * Add future scene rules by adding a [CameraScene] entry, a rule in [recognize], and its mapping here.
     */
    val ADJUSTMENTS: Map<CameraScene, SceneAdjustment> = mapOf(
        CameraScene.SUNNY_BLUE_SKY to SceneAdjustment(
            exposureEv = 0.45f,
        ),
    )

    /** Bright blue-sky share ramps in from [BLUE_SKY_FROM] (8% of frame) to full confidence at [BLUE_SKY_FULL] (22%). */
    internal const val BLUE_SKY_FROM = 0.08f
    internal const val BLUE_SKY_FULL = 0.22f

    /**
     * Uncompensated exposure product (`ISO * exposureSeconds * postRawBoost * 2^(-captureEv)`):
     * sunny daylight across UW/W/T lenses sits at ~0.02-0.5; fades out by 1.5 so bright indoors (~3) and dusk stay 0.
     */
    internal const val SUNNY_PRODUCT_FULL = 0.5f
    internal const val SUNNY_PRODUCT_END = 1.5f

    /** Fallback ISO thresholds when shutter time is unavailable. */
    internal const val SUNNY_ISO_FULL = 100f
    internal const val SUNNY_ISO_END = 200f

    /**
     * Highlight guard for positive exposure lifts: full lift while the developed 98th-percentile luminance sits at or
     * below [HIGHLIGHT_P98_FULL] EV relative to sensor clip and clipped share is <= [CLIPPED_FULL], fading to 0 by
     * [HIGHLIGHT_P98_ZERO] / [CLIPPED_ZERO].
     */
    internal const val HIGHLIGHT_P98_FULL = -0.6f
    internal const val HIGHLIGHT_P98_ZERO = 0.0f
    internal const val CLIPPED_FULL = 0.03f
    internal const val CLIPPED_ZERO = 0.10f

    /** Recognises active [CameraScene]s and their 0..1 confidences from [stats] and [light]. */
    fun recognize(stats: SceneStats, light: SceneLight = SceneLight()): List<SceneMatch> {
        val matches = ArrayList<SceneMatch>(1)
        val sunnySky = sunnyBlueSkyConfidence(stats, light)
        if (sunnySky > 0f) matches.add(SceneMatch(CameraScene.SUNNY_BLUE_SKY, sunnySky))
        return matches
    }

    /**
     * Combined develop adjustment from [adjustments] for [stats] and [light], with positive exposure lift moderated by
     * highlight headroom at [baseExposureEv] (the auto develop's exposure before scene adjustments).
     */
    fun adjustment(
        stats: SceneStats,
        light: SceneLight = SceneLight(),
        baseExposureEv: Float = 0f,
        adjustments: Map<CameraScene, SceneAdjustment> = ADJUSTMENTS,
    ): SceneAdjustment {
        val matches = recognize(stats, light)
        if (matches.isEmpty()) return SceneAdjustment()
        var exposureEv = 0f
        var highlights = 0f
        var shadows = 0f
        var contrast = 0f
        for (match in matches) {
            val adj = adjustments[match.scene] ?: continue
            val w = match.confidence.coerceIn(0f, 1f)
            exposureEv += adj.exposureEv * w
            highlights += adj.highlights * w
            shadows += adj.shadows * w
            contrast += adj.contrast * w
        }
        if (exposureEv > 0f) {
            exposureEv *= highlightGuard(stats, baseExposureEv)
        }
        return SceneAdjustment(exposureEv = exposureEv, highlights = highlights, shadows = shadows, contrast = contrast)
    }

    /**
     * Applies the recognised camera scene adjustment onto [autoBase] (from [AutoTone.develop]), rounding exposure to
     * 0.05 EV steps and tone sliders to whole units as [AutoTone] does.
     */
    fun apply(
        autoBase: DevelopParams,
        stats: SceneStats,
        light: SceneLight = SceneLight(),
        adjustments: Map<CameraScene, SceneAdjustment> = ADJUSTMENTS,
    ): DevelopParams {
        if (autoBase.displaySource) return autoBase
        val adj = adjustment(stats, light, autoBase.exposure, adjustments)
        if (adj.isNeutral) return autoBase
        val exposure = ((autoBase.exposure + adj.exposureEv).coerceIn(-5f, 5f) * 20f).roundToInt() / 20f
        return autoBase.copy(
            exposure = exposure,
            highlights = (autoBase.highlights + adj.highlights).roundToInt().toFloat().coerceIn(-100f, 100f),
            shadows = (autoBase.shadows + adj.shadows).roundToInt().toFloat().coerceIn(-100f, 100f),
            contrast = (autoBase.contrast + adj.contrast).roundToInt().toFloat().coerceIn(-100f, 100f),
        )
    }

    private fun sunnyBlueSkyConfidence(stats: SceneStats, light: SceneLight): Float {
        val sky = smoothstep(BLUE_SKY_FROM, BLUE_SKY_FULL, stats.blueSky)
        if (sky <= 0f) return 0f
        val sun = sunlightConfidence(stats.iso, light)
        return sky * sun
    }

    private fun sunlightConfidence(iso: Float, light: SceneLight): Float {
        if (iso <= 0f) return 0f
        val uncompensated = 2.0.pow(-light.captureEv.toDouble()).toFloat()
        if (light.exposureSeconds > 0f) {
            val product = iso * light.exposureSeconds * light.postRawBoost.coerceAtLeast(1f) * uncompensated
            return 1f - smoothstep(SUNNY_PRODUCT_FULL, SUNNY_PRODUCT_END, product)
        }
        return 1f - smoothstep(SUNNY_ISO_FULL, SUNNY_ISO_END, iso * uncompensated)
    }

    /**
     * Scales down positive exposure lift as highlights approach clip. `stats.p98 + baseExposureEv` is invariant to
     * `captureEv` because `AutoTone.exposure` already subtracted `captureEv`.
     */
    private fun highlightGuard(stats: SceneStats, baseExposureEv: Float): Float {
        val effectiveP98 = stats.p98 + baseExposureEv
        val byP98 = 1f - smoothstep(HIGHLIGHT_P98_FULL, HIGHLIGHT_P98_ZERO, effectiveP98)
        val byClipped = 1f - smoothstep(CLIPPED_FULL, CLIPPED_ZERO, stats.clipped)
        return min(byP98, byClipped)
    }

    private fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
        val t = ((x - edge0) / (edge1 - edge0)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }
}
