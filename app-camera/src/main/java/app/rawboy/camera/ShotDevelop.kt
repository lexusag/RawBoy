package app.rawboy.camera

import app.rawboy.camera.platform.CameraPlatform
import app.rawboy.camera.platform.NoiseProfile
import app.rawboy.camera.platform.StillProfile
import app.rawboy.develop.DevelopParams

/**
 * The platform-dependent steps of a shot's develop ([ShotSaver]), kept free of Android objects so they can be checked
 * on the JVM.
 */
internal object ShotDevelop {
    /**
     * ISO multiplier for picking the shot's denoise from the ISO table: the phone's sensor noise ([NoiseProfile]),
     * divided by the frames a merged burst is worth (as clean as one frame at 1/frames the ISO).
     */
    fun noiseIsoScale(noise: NoiseProfile, front: Boolean, effectiveFrames: Float): Float =
        (if (front) noise.frontIsoScale else noise.backIsoScale) / effectiveFrames

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
