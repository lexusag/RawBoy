package app.rawboy.camera

import app.rawboy.auto.analysis.SceneLight
import app.rawboy.auto.analysis.SceneRecognition
import app.rawboy.auto.analysis.SceneStats
import app.rawboy.camera.platform.CameraPlatform
import app.rawboy.camera.platform.NoiseProfile
import app.rawboy.camera.platform.StillProfile
import app.rawboy.develop.DevelopParams
import app.rawboy.raw.BlackFix
import kotlin.math.roundToInt

/**
 * The platform-dependent steps of a shot's develop ([ShotSaver]), kept free of Android objects so they can be checked
 * on the JVM.
 */
internal object ShotDevelop {
    /**
     * Final auto base develop before applying the look:
     * - manual flash shots keep [base] as metered by AutoTone,
     * - AE/WB-locked shots hold [lockedExposureEv] (no post-lock re-metering or scene lift),
     * - normal phone-AE shots apply [SceneRecognition].
     */
    fun autoBase(
        base: DevelopParams,
        stats: SceneStats,
        light: SceneLight,
        isFlash: Boolean,
        lockedExposureEv: Float?,
    ): DevelopParams = when {
        isFlash -> base
        lockedExposureEv != null -> base.copy(exposure = lockedExposureEv)
        else -> SceneRecognition.apply(base, stats, light)
    }

    /**
     * ISO multiplier for picking the shot's denoise from the ISO table: the phone's sensor noise ([NoiseProfile]),
     * divided by the frames a merged burst is worth (as clean as one frame at 1/frames the ISO).
     */
    fun noiseIsoScale(noise: NoiseProfile, front: Boolean, effectiveFrames: Float): Float =
        (if (front) noise.frontIsoScale else noise.backIsoScale) / effectiveFrames

    /** How the shot's raw is decoded ([StillProfile]'s black handling) for the camera [cameraId] at [iso]. */
    fun blackFix(still: StillProfile, cameraId: String?, iso: Float): BlackFix {
        val offset = still.blackOffsets.at(cameraId, iso)
        if (!still.exactBlack && still.blackPedestal <= 0f && offset.all { it == 0f }) return BlackFix.LIBRAW
        return BlackFix(exact = still.exactBlack, pedestal = still.blackPedestal, offset = offset)
    }

    /**
     * Backlit scenes (a window, a lamp in frame): the phone's own preview lifts the dark parts locally, and the plain
     * raw develop left them near black (owner preferred the preview). Shadows rise with the scene's range, p98 - p5:
     * ordinary scenes span 3-5 stops (no change), a room against a window 7 (75, which matched the iPhone's
     * viewfinder on that shot). Fades out from ISO 800 to 3200, where lifting would mostly lift noise. Shots; the
     * viewfinder too where its frames don't come already lifted ([app.rawboy.camera.platform.PreviewProfile.liftsShadows]).
     */
    fun backlightShadows(s: SceneStats): Float {
        val lift = ((s.p98 - s.p5 - 5f) * 37.5f).coerceIn(0f, 80f)
        val t = ((s.iso - 800f) / 2400f).coerceIn(0f, 1f)
        return (lift * (1f - t * t * (3f - 2f * t))).roundToInt().toFloat()
    }

    /** The shot's develop before the high-ISO and backlight floors: the look on [autoBase], then the ISP look. */
    fun looked(settings: CameraSettings, autoBase: DevelopParams, hasFace: Boolean, platform: CameraPlatform): DevelopParams =
        withIspLook(settings.develop(autoBase, hasFace, platform.noise), platform.still)

    /**
     * [p] with the ISP's own look added ([StillProfile.lookContrast] / [StillProfile.lookSaturation]), where the
     * viewfinder shows one the raw doesn't have; saved photos only. B&W keeps its grey (saturation -100). No look:
     * [p] itself.
     */
    fun withIspLook(p: DevelopParams, still: StillProfile): DevelopParams {
        if (still.lookContrast == 0f && still.lookSaturation == 0f) return p
        return p.copy(
            contrast = (p.contrast + still.lookContrast).coerceAtMost(100f),
            saturation = if (p.saturation <= -100f) p.saturation else (p.saturation + still.lookSaturation).coerceAtMost(100f),
        )
    }
}
