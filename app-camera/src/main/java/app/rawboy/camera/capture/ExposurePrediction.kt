package app.rawboy.camera.capture

import app.rawboy.camera.platform.FlashProfile
import app.rawboy.camera.platform.StillProfile

/**
 * How much brighter a still's raw will be than the preview frame it follows (raw terms: exposure time x ISO), the
 * core of [CameraController.stillGain]. In low light the preview is held at its frame-rate cap, and for the still AE
 * moves exposure from the post-raw digital boost back into time, up to [StillProfile.maxStillExposureNs], at the same
 * ISO. Otherwise the still matches the preview (1).
 */
object StillGain {
    /**
     * [exposureNs]: the preview frame's exposure (0 = unknown); [postRawBoost]: its digital boost (1 = none);
     * [capNs]: the longest exposure the preview's frame rate allows; [maxStillExposureNs]: the platform's still limit.
     */
    fun over(exposureNs: Long, postRawBoost: Float, capNs: Long, maxStillExposureNs: Long): Float {
        if (exposureNs <= 0L) return 1f
        if (exposureNs < capNs * 9 / 10) return 1f
        return minOf(maxStillExposureNs.toFloat() / exposureNs, postRawBoost).coerceAtLeast(1f)
    }
}

/** Where a lens's flash exposure starts before it has learned its own guide (see `CameraController.flashExposure`). */
object FlashStart {
    /**
     * Flash still gain (s x ISO) at 1 m ([distanceKnown]) or without a focus distance, for a lens at [fNumber]: the
     * platform's default, scaled by the lens's light gathering relative to [FlashProfile.referenceFNumber] (one stop
     * slower passes half the flash's light, so it starts at twice the gain), within 0.5x..8x.
     */
    fun gain(flash: FlashProfile, fNumber: Float, distanceKnown: Boolean): Float {
        val apertureScale = (fNumber / flash.referenceFNumber).let { it * it }.coerceIn(0.5f, 8f)
        return (if (distanceKnown) flash.defaultGuide else flash.defaultGainNoDistance) * apertureScale
    }
}
