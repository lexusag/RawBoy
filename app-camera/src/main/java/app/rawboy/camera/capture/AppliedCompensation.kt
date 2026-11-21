package app.rawboy.camera.capture

import app.rawboy.camera.platform.CompensationModel
import kotlin.math.ln

/**
 * How much of the AE compensation Brightness asks for (see [CameraController.setExposureBias]) really reached the raw.
 *
 * In low light AE already holds the preview at its longest exposure (its frame-rate cap) and a high ISO, so a brighter
 * compensation goes into the ISP's post-raw digital boost, which the raw (and the viewfinder, which takes the boost
 * back out) never gets. The develop must take out only what the raw got, or Brightness is undone: the viewfinder
 * brightened when the slider moved and then sank back as the live develop removed compensation that wasn't there.
 *
 * The raw-side gain is measured by the digital gain the still will still need, [residual] = boost / still gain (the
 * still moves boost into exposure time up to the platform's still limit, [CameraController.stillGain]; the viewfinder meters like the
 * still's raw). Compensation that raised [residual] above what it was without compensation ([residualAtZero]) stayed
 * digital; the rest reached the raw.
 */
object AppliedCompensation {
    /**
     * EV of [requestedEv] that reached the raw, given the residual digital gain now ([residual]) and with no
     * compensation ([residualAtZero]). Never more than asked for, never the opposite way.
     */
    fun ev(requestedEv: Float, residual: Float, residualAtZero: Float): Float {
        if (requestedEv == 0f || residual <= 0f || residualAtZero <= 0f) return requestedEv
        val digital = (ln(residual / residualAtZero) / LN2).toFloat()
        val applied = requestedEv - digital
        return if (requestedEv > 0f) applied.coerceIn(0f, requestedEv) else applied.coerceIn(requestedEv, 0f)
    }

    /**
     * [CompensationModel.AE_GAIN_IN_RAW]: EV of [requestedEv] that reached the raw of a frame whose whole AE gain
     * (exposure s x ISO x post-raw boost) is [gain], when AE never goes above [ceiling]. A darker compensation always
     * gets there; a brighter one too, unless the frame is within [CEILING_SHARE] of the ceiling: then AE had no room
     * for it (or only for part of it), and the develop adds Brightness instead of taking it back out.
     */
    fun evBelowCeiling(requestedEv: Float, gain: Float, ceiling: Float): Float =
        if (requestedEv > 0f && ceiling > 0f && gain >= ceiling * CEILING_SHARE) 0f else requestedEv

    /**
     * How close to [evBelowCeiling]'s ceiling a frame counts as on it: the OnePlus 11's preview sat at 0.97-1.0 of it
     * (1/30 s x ISO 6400 x boost 2.0-2.22 against 1/15 s x ISO 6400), its stills at 0.9.
     */
    const val CEILING_SHARE = 0.85f

    /** Digital gain a still from this preview frame still carries after its longer exposure (1 = none). */
    fun residual(postRawBoost: Float, stillGain: Float): Float =
        (postRawBoost.coerceAtLeast(1f) / stillGain.coerceAtLeast(1f)).coerceAtLeast(1f)

    private val LN2 = ln(2.0)
}
