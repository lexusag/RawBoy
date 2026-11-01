package app.rawboy.camera.capture

import kotlin.math.ln

/**
 * How much of the AE compensation Brightness asks for (see [CameraController.setExposureBias]) really reached the raw.
 *
 * In low light the Pixel's AE already holds the preview at its longest exposure (1/30 s) and a high ISO, so a brighter
 * compensation goes into the ISP's post-raw digital boost, which the raw (and the viewfinder, which takes the boost
 * back out) never gets. The develop must take out only what the raw got, or Brightness is undone: the viewfinder
 * brightened when the slider moved and then sank back as the live develop removed compensation that wasn't there.
 *
 * The raw-side gain is measured by the digital gain the still will still need, [residual] = boost / still gain (the
 * still moves boost into exposure time up to 1/15 s, [CameraController.stillGain]; the viewfinder meters like the
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

    /** Digital gain a still from this preview frame still carries after its longer exposure (1 = none). */
    fun residual(postRawBoost: Float, stillGain: Float): Float =
        (postRawBoost.coerceAtLeast(1f) / stillGain.coerceAtLeast(1f)).coerceAtLeast(1f)

    private val LN2 = ln(2.0)
}
