package app.rawboy.camera.capture

import kotlin.math.ln

/**
 * Measures, frame by frame, how much of Brightness's AE compensation reached the raw
 * ([CompensationModel.BOOST_STAYS_DIGITAL][app.rawboy.camera.platform.CompensationModel.BOOST_STAYS_DIGITAL] phones).
 *
 * The Pixel 9 Pro's AE often doesn't give what is asked, and not in a way a rule can foresee: in an ordinary room
 * (1/30 s, ISO 39) +2.33 EV raised AE's gain by only 0.27 EV, with no post-raw boost either, while -2.33 EV gave all of
 * it; at a candle-lit table +3 EV changed nothing. The develop takes the compensation back out, so crediting the
 * whole +2.33 made the live develop read the scene 2 EV darker than it was and walk its metering there at 0.3 EV per
 * update: Brightness jumped, then drifted for ~2 s, and where it ended up was anyone's guess.
 *
 * So it is measured instead. When the compensation steps change, the frame before is the reference; while AE settles,
 * what reached the raw is the reference's plus AE's whole gain (exposure x ISO x boost) over the reference's, less what
 * went into the post-raw boost the still won't have ([AppliedCompensation.residual]). Once AE has settled, that value is
 * held until the next change, so a scene change afterwards is metered as usual. At 0 steps it is exactly 0, and that
 * frame starts the chain; before one has been seen (the camera opened with Brightness already set) it is unknown (null)
 * and the caller falls back to [AppliedCompensation.ev]. Once settled, never more than asked for, never the opposite way.
 *
 * Camera thread only.
 */
class CompensationTracker {
    private var known = false
    private var lastSteps = 0
    private var lastApplied = 0f
    private var lastGain = 0f
    private var lastResidual = 1f
    private var refApplied = 0f
    private var refGain = 0f
    private var refResidual = 1f
    /** When the steps last changed (ms), or -1 once AE has settled and [held] is in force. */
    private var measuringSince = -1L
    private var held = 0f

    /** Forgets everything (a lens or camera change: a new AE). */
    fun reset() {
        known = false
        measuringSince = -1L
    }

    /**
     * EV of [requestedEv] (the frame's own [steps]) that reached the raw of a frame with AE gain [gain] (exposure s x ISO
     * x post-raw boost) and residual digital gain [residual]; [aeSettled]: the frame's AE state is converged (or locked).
     * Null while unknown.
     */
    fun onFrame(steps: Int, requestedEv: Float, gain: Float, residual: Float, aeSettled: Boolean, nowMs: Long): Float? {
        if (gain <= 0f || residual <= 0f) return if (known && steps == lastSteps) lastApplied else null
        if (steps == 0) {
            known = true
            measuringSince = -1L
            remember(0, 0f, gain, residual)
            return 0f
        }
        if (!known) return null
        if (steps != lastSteps) {
            refApplied = lastApplied
            refGain = lastGain
            refResidual = lastResidual
            measuringSince = nowMs
        }
        val applied = if (measuringSince >= 0L) {
            val t = nowMs - measuringSince
            val measured = refApplied + log2(gain / refGain) - log2(residual / refResidual)
            if (t >= MAX_SETTLE_MS || (aeSettled && t >= MIN_SETTLE_MS)) {
                measuringSince = -1L
                held = clamp(measured, requestedEv)
                held
            } else {
                // On the way, the frames may still carry part of the step before (-2.33 EV going back to -0.33 passes
                // -1.2 on the Pixel), so anything between that and the new compensation counts.
                measured.coerceIn(minOf(0f, requestedEv, refApplied), maxOf(0f, requestedEv, refApplied))
            }
        } else clamp(held, requestedEv)
        remember(steps, applied, gain, residual)
        return applied
    }

    private fun remember(steps: Int, applied: Float, gain: Float, residual: Float) {
        lastSteps = steps
        lastApplied = applied
        lastGain = gain
        lastResidual = residual
    }

    private fun clamp(ev: Float, requestedEv: Float): Float =
        if (requestedEv >= 0f) ev.coerceIn(0f, requestedEv) else ev.coerceIn(requestedEv, 0f)

    private fun log2(x: Float): Float = (ln(x.toDouble()) / LN2).toFloat()

    companion object {
        /**
         * AE may report converged before it has moved for a new compensation: measure at least this long. On the
         * Pixel 9 Pro a step settled within ~0.3-0.7 s.
         */
        const val MIN_SETTLE_MS = 500L
        /**
         * Hold whatever was measured after this long, even if AE never says it converged. The Pixel 9 Pro's AE can take
         * ~5 s over a brighter step (-2 -> +2.5 EV: +0.3 EV at once, then nothing for 2 s, then a slow ramp, SEARCHING all
         * the way); held after 3 s, the viewfinder ended up 0.4 EV too bright.
         */
        const val MAX_SETTLE_MS = 10_000L
        private val LN2 = ln(2.0)
    }
}
