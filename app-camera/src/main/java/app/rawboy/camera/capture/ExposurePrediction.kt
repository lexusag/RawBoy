package app.rawboy.camera.capture

import app.rawboy.camera.platform.FlashProfile
import app.rawboy.camera.platform.StillProfile
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

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

/**
 * A flash still's manual exposure (`CameraController.flashExposure`), worked out like a flash guide number: the LED's
 * light falls off with the square of the distance, so the gain (s x ISO) is the lens's guide x [falloff] of the
 * distance the lens is focused at; never more than the ambient exposure. [EXPOSURE_NS], shorter when the ISO is at its
 * minimum.
 */
object FlashExposure {
    /** Flash still: exposure time and the frame duration it needs at least. */
    const val EXPOSURE_NS = 33_333_333L
    const val FRAME_NS = 33_333_333L

    /** Extra exponent on distances beyond 1 m, see [falloff]: 2 m needs 1.23x (0.3 EV), 4 m 1.5x (0.6 EV) more. */
    const val FAR_EXPONENT = 0.3f

    /** Focus distances the flash exposure trusts (nearer: macro; farther: the flash hardly reaches). */
    const val MIN_DISTANCE_M = 0.1f
    const val MAX_DISTANCE_M = 5f

    /** The manual exposure, and the guide it amounts to when the flash decided it (to learn from), else null. */
    class Plan(val exposureNs: Long, val iso: Int, val byFlash: Float, val guideUsed: Float?)

    /**
     * The distance (m) the flash is exposed for, or null when unknown. A focus distance of exactly 0 (or none) is
     * taken as unknown, not infinity: the Pixel 9 Pro's UW reports 0 on every frame, even with AF locked close up (as
     * 5 m it got the ambient exposure plus the flash: clipped).
     */
    fun metres(diopters: Float?): Float? =
        if (diopters != null && diopters > 0f) (1f / diopters).coerceIn(MIN_DISTANCE_M, MAX_DISTANCE_M) else null

    /**
     * How much more exposure than at 1 m a subject at [metres] needs: the square of the distance (a point source) and
     * beyond 1 m a bit more ([FAR_EXPONENT]), because the guide is learned on close subjects (a hand's length) while
     * the phone's LED is no point source: the farther the subject, the more of the light is lost to the wide beam's
     * spread over the scene and to the room's own ambient fill-in the flash must overcome.
     */
    fun falloff(metres: Float): Float = metres * metres * max(1f, metres).pow(FAR_EXPONENT)

    /**
     * [guide]: gain at 1 m for a known distance [metres], else the gain itself (null [metres]); [ambientGain]: the
     * preview's s x ISO before any light came on ([Float.MAX_VALUE] if unknown); ISO and exposure-time ranges of the
     * sensor.
     */
    fun plan(guide: Float, metres: Float?, ambientGain: Float, isoMin: Int, isoMax: Int, timeMinNs: Long, timeMaxNs: Long): Plan {
        val falloff = falloff(metres ?: 1f)
        val byFlash = guide * falloff
        val gain = min(byFlash, ambientGain).coerceAtMost(EXPOSURE_NS / 1e9f * isoMax)
        var t = EXPOSURE_NS.coerceIn(timeMinNs, timeMaxNs)
        var iso = gain / (t / 1e9f)
        if (iso < isoMin) {
            t = (gain / isoMin * 1e9f).toLong().coerceIn(timeMinNs, timeMaxNs)
            iso = isoMin.toFloat()
        }
        val isoUsed = iso.toInt().coerceIn(isoMin, isoMax)
        val used = t / 1e9f * isoUsed
        // Calibrate only from shots the flash exposed (not those capped by ambient light or the sensor's range).
        val guideUsed = if (byFlash <= ambientGain && abs(used / byFlash - 1f) < 0.1f) used / falloff else null
        return Plan(t, isoUsed, byFlash, guideUsed)
    }
}

/** AE compensation in the camera's steps (`CONTROL_AE_EXPOSURE_COMPENSATION`). */
object CompensationSteps {
    /** [ev] rounded to whole steps of [step] EV within [lower]..[upper]; 0 when the camera reports no usable step. */
    fun of(ev: Float, step: Float, lower: Int, upper: Int): Int {
        if (!(step > 0f)) return 0
        return (ev / step).roundToInt().coerceIn(lower, upper)
    }
}
