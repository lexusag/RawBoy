package app.rawboy.camera.capture

import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

/**
 * Camera's Exposure slider as a program line, the way a camera in P mode spends exposure compensation: the phone's AE
 * meters the scene at 0, and a still shot at [ev] != 0 is exposed by hand at the metered exposure x 2^ev.
 *
 * Brighter (+EV): a longer exposure up to [HANDHELD_NS] (or the metered time if that is already longer), then more ISO
 * up to the sensor's highest, then a longer exposure up to the platform's still limit; what is left stays digital (the
 * develop adds it). Darker (-EV): the lowest ISO first (less noise), then a shorter exposure; what is left stays digital.
 * Under flickering light (the metered time a whole number of mains half-periods, [flickerPeriodNs]) a lengthened time is
 * rounded down to whole periods and the ISO makes up the rest, as AE itself does.
 *
 * The raw may clip: that is the point of +EV, and AgX rolls the highlights off.
 */
object ExposureProgram {
    /** Longest exposure the program chooses before it raises the ISO (1/30 s, the preview's own cap). */
    const val HANDHELD_NS = 33_333_333L

    /** Mains half-periods AE avoids banding with: 50 Hz (10 ms) and 60 Hz (8.33 ms) light. */
    private val FLICKER_PERIODS_NS = longArrayOf(10_000_000L, 8_333_333L)

    /** A metered time within this share of a whole number of periods counts as flicker-safe. */
    private const val FLICKER_TOLERANCE = 0.015

    /** One manual exposure: time (ns) and ISO (the post-raw boost is 100, nothing digital). */
    data class Exposure(val exposureNs: Long, val iso: Int) {
        /** Raw gain (exposure s x ISO). */
        val gain: Double get() = exposureNs / 1e9 * iso
    }

    /**
     * The manual exposure for [ev] of compensation over the metered exposure [t0Ns] x [iso0] (what AE would give the
     * still's raw), within the sensor's ISO [isoMin]..[isoMax] and time [expMin]..[expMax], times no longer than
     * [maxStillNs] (the platform's still limit) unless the metered time already is.
     */
    fun compute(
        ev: Float,
        t0Ns: Long,
        iso0: Float,
        isoMin: Int,
        isoMax: Int,
        expMin: Long,
        expMax: Long,
        maxStillNs: Long,
    ): Exposure {
        val t0 = t0Ns.coerceIn(expMin, expMax).toDouble()
        val i0 = iso0.toDouble().coerceIn(isoMin.toDouble(), isoMax.toDouble())
        val target = t0 * i0 * 2.0.pow(ev.toDouble())
        val longest = min(expMax.toDouble(), max(t0, maxStillNs.toDouble()))
        var t: Double
        var iso: Double
        if (ev >= 0f) {
            // Time up to the handheld limit, then ISO, then time up to the still's limit.
            val handheld = min(longest, max(t0, HANDHELD_NS.toDouble()))
            t = (target / i0).coerceIn(t0, handheld)
            iso = target / t
            if (iso > isoMax) {
                iso = isoMax.toDouble()
                t = (target / iso).coerceIn(t, longest)
            }
            if (t > t0) {
                flickerPeriodNs(t0Ns)?.let { period ->
                    val whole = (t / period).toLong()
                    if (whole >= 1) {
                        val rounded = whole * period.toDouble()
                        // Only when the ISO can make up the rounding; else keep the exact time (brightness first).
                        val isoAt = target / rounded
                        if (isoAt <= isoMax) {
                            t = max(rounded, t0)
                            iso = target / t
                        }
                    }
                }
            }
        } else {
            // ISO down first, then a shorter time.
            iso = (target / t0).coerceIn(isoMin.toDouble(), i0)
            t = (target / iso).coerceIn(expMin.toDouble(), t0)
        }
        val isoOut = iso.coerceIn(isoMin.toDouble(), isoMax.toDouble()).roundToLong().toInt()
        val tOut = t.roundToLong().coerceIn(expMin, max(expMin, min(expMax, longest.roundToLong())))
        return Exposure(tOut, isoOut)
    }

    /**
     * The mains half-period [t0Ns] is a whole multiple of (AE's anti-banding choice), or null: too short to tell, or
     * no multiple of either.
     */
    fun flickerPeriodNs(t0Ns: Long): Long? {
        for (period in FLICKER_PERIODS_NS) {
            if (t0Ns < period * (1 - FLICKER_TOLERANCE)) continue
            val n = (t0Ns.toDouble() / period).let { kotlin.math.round(it) }
            if (n >= 1 && abs(t0Ns - n * period) <= n * period * FLICKER_TOLERANCE) return period
        }
        return null
    }

    /** EV of [exposureNs] x [iso] (as the capture result reports them) over the metered gain [meteredGain] (s x ISO). */
    fun capturedEv(exposureNs: Long, iso: Int, meteredGain: Double): Float {
        val g = exposureNs / 1e9 * iso
        return if (g > 0.0 && meteredGain > 0.0) log2(g / meteredGain).toFloat() else 0f
    }
}
