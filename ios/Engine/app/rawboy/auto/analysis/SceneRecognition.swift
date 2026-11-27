import Foundation

/**
 * Camera scenes recognised from SceneStats and capture light metadata (SceneLight), each mapped to a develop
 * adjustment in SceneRecognition.adjustments (port of SceneRecognition.kt).
 */
public enum CameraScene: Hashable, Sendable {
    /** Clear sunny daylight with visible blue sky: brightens moderately while protecting highlights. */
    case sunnyBlueSky
}

/**
 * Exposure and tone offsets applied on top of AutoTone.develop for a recognised camera scene.
 * All zeros = neutral (no change).
 */
public struct SceneAdjustment: Equatable, Sendable {
    /** Exposure shift in EV (positive = brighter). */
    public let exposureEv: Float
    /** Highlights slider shift (-100..100). */
    public let highlights: Float
    /** Shadows slider shift (-100..100). */
    public let shadows: Float
    /** Contrast slider shift (-100..100). */
    public let contrast: Float

    public init(exposureEv: Float = 0, highlights: Float = 0, shadows: Float = 0, contrast: Float = 0) {
        self.exposureEv = exposureEv
        self.highlights = highlights
        self.shadows = shadows
        self.contrast = contrast
    }

    public var isNeutral: Bool {
        exposureEv == 0 && highlights == 0 && shadows == 0 && contrast == 0
    }
}

/**
 * Capture light context paired with SceneStats for SceneRecognition.
 *
 * [exposureSeconds] and [postRawBoost] measure how much light the camera's AE needed for the scene
 * (`ISO * exposureSeconds * postRawBoost`: sunny day ~0.05-0.4, bright indoors ~3, night 60+). [captureEv] is the AE
 * compensation applied to the frame (Camera's Brightness slider) so the ambient light estimate stays invariant when
 * the user moves Brightness.
 */
public struct SceneLight: Equatable, Sendable {
    /** Shutter time in seconds (<= 0 when unknown). */
    public let exposureSeconds: Float
    /** Post-raw digital gain multiplier (1 = none). */
    public let postRawBoost: Float
    /** AE compensation applied to the frame (EV, from Camera's Brightness slider). */
    public let captureEv: Float

    public init(exposureSeconds: Float = 0, postRawBoost: Float = 1, captureEv: Float = 0) {
        self.exposureSeconds = exposureSeconds
        self.postRawBoost = postRawBoost
        self.captureEv = captureEv
    }
}

/** One recognised scene and its smooth confidence weight in 0..1. */
public struct SceneMatch: Equatable, Sendable {
    public let scene: CameraScene
    public let confidence: Float

    public init(scene: CameraScene, confidence: Float) {
        self.scene = scene
        self.confidence = confidence
    }
}

/**
 * Extensible scene recognition map for RawBoy Camera (live viewfinder and saved shots; port of SceneRecognition.kt).
 *
 * Recognised scenes carry smooth 0..1 confidences so panning the camera or crossing a threshold never pops brightness,
 * and positive exposure lifts are guarded by highlight headroom so bright clouds and speculars do not clip.
 */
public enum SceneRecognition {
    /**
     * Full-confidence develop adjustment for each recognised CameraScene.
     *
     * Add future scene rules by adding a CameraScene case, a rule in recognize(_:light:), and its mapping here.
     */
    public static let adjustments: [CameraScene: SceneAdjustment] = [
        .sunnyBlueSky: SceneAdjustment(exposureEv: 0.45),
    ]

    /** Bright blue-sky share ramps in from blueSkyFrom (8% of frame) to full confidence at blueSkyFull (22%). */
    static let blueSkyFrom: Float = 0.08
    static let blueSkyFull: Float = 0.22

    /**
     * Uncompensated exposure product (`ISO * exposureSeconds * postRawBoost * 2^(-captureEv)`):
     * sunny daylight across UW/W/T lenses sits at ~0.02-0.5; fades out by 1.5 so bright indoors (~3) and dusk stay 0.
     */
    static let sunnyProductFull: Float = 0.5
    static let sunnyProductEnd: Float = 1.5

    /** Fallback ISO thresholds when shutter time is unavailable. */
    static let sunnyIsoFull: Float = 100
    static let sunnyIsoEnd: Float = 200

    /**
     * Highlight guard for positive exposure lifts: full lift while the developed 98th-percentile luminance sits at or
     * below highlightP98Full EV relative to sensor clip and clipped share is <= clippedFull, fading to 0 by
     * highlightP98Zero / clippedZero.
     */
    static let highlightP98Full: Float = -0.6
    static let highlightP98Zero: Float = 0.0
    static let clippedFull: Float = 0.03
    static let clippedZero: Float = 0.10

    /** Recognises active CameraScenes and their 0..1 confidences from [stats] and [light]. */
    public static func recognize(_ stats: SceneStats, light: SceneLight = SceneLight()) -> [SceneMatch] {
        var matches: [SceneMatch] = []
        let sunnySky = sunnyBlueSkyConfidence(stats, light)
        if sunnySky > 0 { matches.append(SceneMatch(scene: .sunnyBlueSky, confidence: sunnySky)) }
        return matches
    }

    /**
     * Combined develop adjustment from [adjustments] for [stats] and [light], with positive exposure lift moderated by
     * highlight headroom at [baseExposureEv] (the auto develop's exposure before scene adjustments).
     */
    public static func adjustment(
        _ stats: SceneStats,
        light: SceneLight = SceneLight(),
        baseExposureEv: Float = 0,
        adjustments: [CameraScene: SceneAdjustment] = Self.adjustments
    ) -> SceneAdjustment {
        let matches = recognize(stats, light: light)
        if matches.isEmpty { return SceneAdjustment() }
        var exposureEv: Float = 0
        var highlights: Float = 0
        var shadows: Float = 0
        var contrast: Float = 0
        for match in matches {
            guard let adj = adjustments[match.scene] else { continue }
            let w = match.confidence.clamped(0, 1)
            exposureEv += adj.exposureEv * w
            highlights += adj.highlights * w
            shadows += adj.shadows * w
            contrast += adj.contrast * w
        }
        if exposureEv > 0 {
            exposureEv *= highlightGuard(stats, baseExposureEv: baseExposureEv)
        }
        return SceneAdjustment(exposureEv: exposureEv, highlights: highlights, shadows: shadows, contrast: contrast)
    }

    /**
     * Applies the recognised camera scene adjustment onto [autoBase] (from AutoTone.develop), rounding exposure to
     * 0.05 EV steps and tone sliders to whole units as AutoTone does.
     */
    public static func apply(
        _ autoBase: DevelopParams,
        stats: SceneStats,
        light: SceneLight = SceneLight(),
        adjustments: [CameraScene: SceneAdjustment] = Self.adjustments
    ) -> DevelopParams {
        if autoBase.displaySource { return autoBase }
        let adj = adjustment(stats, light: light, baseExposureEv: autoBase.exposure, adjustments: adjustments)
        if adj.isNeutral { return autoBase }
        var p = autoBase
        p.exposure = Float(((autoBase.exposure + adj.exposureEv).clamped(-5, 5) * 20).roundToInt()) / 20
        p.highlights = Float((autoBase.highlights + adj.highlights).roundToInt()).clamped(-100, 100)
        p.shadows = Float((autoBase.shadows + adj.shadows).roundToInt()).clamped(-100, 100)
        p.contrast = Float((autoBase.contrast + adj.contrast).roundToInt()).clamped(-100, 100)
        return p
    }

    private static func sunnyBlueSkyConfidence(_ stats: SceneStats, _ light: SceneLight) -> Float {
        let sky = smoothstep(blueSkyFrom, blueSkyFull, stats.blueSky)
        if sky <= 0 { return 0 }
        let sun = sunlightConfidence(stats.iso, light)
        return sky * sun
    }

    private static func sunlightConfidence(_ iso: Float, _ light: SceneLight) -> Float {
        guard iso > 0 else { return 0 }
        let uncompensated = exp2f(-light.captureEv)
        if light.exposureSeconds > 0 {
            let product = iso * light.exposureSeconds * max(light.postRawBoost, 1) * uncompensated
            return 1 - smoothstep(sunnyProductFull, sunnyProductEnd, product)
        }
        return 1 - smoothstep(sunnyIsoFull, sunnyIsoEnd, iso * uncompensated)
    }

    /**
     * Scales down positive exposure lift as highlights approach clip. `stats.p98 + baseExposureEv` is invariant to
     * `captureEv` because `AutoTone.exposure` already subtracted `captureEv`.
     */
    private static func highlightGuard(_ stats: SceneStats, baseExposureEv: Float) -> Float {
        let effectiveP98 = stats.p98 + baseExposureEv
        let byP98 = 1 - smoothstep(highlightP98Full, highlightP98Zero, effectiveP98)
        let byClipped = 1 - smoothstep(clippedFull, clippedZero, stats.clipped)
        return min(byP98, byClipped)
    }

    private static func smoothstep(_ edge0: Float, _ edge1: Float, _ x: Float) -> Float {
        let t = ((x - edge0) / (edge1 - edge0)).clamped(0, 1)
        return t * t * (3 - 2 * t)
    }
}
