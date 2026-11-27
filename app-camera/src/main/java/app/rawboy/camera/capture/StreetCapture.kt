package app.rawboy.camera.capture

import kotlin.math.roundToInt

/**
 * Ricoh GR-style zone focus presets for Street mode: setting a fixed focus distance switches Camera2 to
 * `CONTROL_AF_MODE_OFF` with `LENS_FOCUS_DISTANCE` in diopters (`1 / meters`), eliminating autofocus hunting lag.
 */
enum class SnapFocus(val label: String, val uncalibratedLabel: String, val meters: Float?) {
    AF("AF", "AF", null),
    M1_5("1.5m", "Near", 1.5f),
    M2_5("2.5m", "Mid", 2.5f),
    M5("5m", "Far", 5.0f),
    INF("∞", "∞", Float.POSITIVE_INFINITY),
    ;

    fun displayLabel(calibrated: Boolean): String = if (calibrated) label else uncalibratedLabel

    fun next(): SnapFocus = entries[(ordinal + 1) % entries.size]

    /**
     * Focus distance in diopters for `CaptureRequest.LENS_FOCUS_DISTANCE`, or null for continuous autofocus ([AF]).
     * [hyperfocalDiopters]: `LENS_INFO_HYPERFOCAL_DISTANCE` (0 when unreported).
     * [minFocusDiopters]: `LENS_INFO_MINIMUM_FOCUS_DISTANCE` (0 on fixed-focus lenses).
     */
    fun diopters(hyperfocalDiopters: Float, minFocusDiopters: Float): Float? {
        val m = meters ?: return null
        if (minFocusDiopters <= 0f) return null
        if (m.isInfinite()) {
            return if (hyperfocalDiopters > 0f) hyperfocalDiopters.coerceIn(0f, minFocusDiopters) else 0f
        }
        return (1f / m).coerceIn(0f, minFocusDiopters)
    }
}

/**
 * Minimum shutter speed target for Street mode so walking subjects stay crisp instead of dropping to 1/15 s.
 */
enum class StreetShutter(val label: String, val maxExposureNs: Long?) {
    AUTO("Auto", null),
    S125("1/125", 8_000_000L),
    S250("1/250", 4_000_000L),
    S500("1/500", 2_000_000L),
    ;

    fun next(): StreetShutter = entries[(ordinal + 1) % entries.size]
}

/**
 * Computes manual `(exposureNs, iso)` for a Street mode still when AE chose a slower shutter than [maxExposureNs].
 * Returns null when ambient exposure is already fast enough (leaving AE untouched), or when sensor limits are unknown.
 */
object StreetExposure {
    /** Ceiling when ISO is already maxed out, so dark night scenes still expose cleanly rather than going black. */
    private const val FALLBACK_MAX_EXPOSURE_NS = 33_333_333L

    fun compute(
        ambientIso: Float,
        ambientExposureNs: Long,
        maxExposureNs: Long?,
        isoMin: Int,
        isoMax: Int,
        exposureMinNs: Long,
        exposureMaxNs: Long,
    ): Pair<Long, Int>? {
        if (maxExposureNs == null || ambientIso <= 0f || ambientExposureNs <= 0L) return null
        if (isoMin <= 0 || isoMax < isoMin || exposureMaxNs <= 0L) return null
        if (ambientExposureNs <= maxExposureNs) return null

        val clampedMaxExp = maxExposureNs.coerceIn(exposureMinNs.coerceAtLeast(1L), exposureMaxNs)
        val totalGain = ambientIso.toDouble() * ambientExposureNs.toDouble()
        val neededIso = totalGain / clampedMaxExp.toDouble()

        if (neededIso <= isoMax.toDouble()) {
            val iso = neededIso.roundToInt().coerceIn(isoMin, isoMax)
            return clampedMaxExp to iso
        }

        // ISO hit the sensor ceiling: hold at max ISO and allow exposure to lengthen only as much as needed
        // (capped at ambient exposure and 1/30 s) so night streets never come out pitch black.
        val maxAllowed = minOf(ambientExposureNs, maxOf(clampedMaxExp, FALLBACK_MAX_EXPOSURE_NS), exposureMaxNs)
        val exp = (totalGain / isoMax.toDouble()).toLong().coerceIn(clampedMaxExp, maxAllowed)
        return exp to isoMax
    }

    /** Formats exposure time in ns as a compact camera readout (e.g. `1/250`, `1/30`, `0.5s`). */
    fun formatShutter(exposureNs: Long): String {
        if (exposureNs <= 0L) return ""
        val sec = exposureNs / 1e9
        return if (sec >= 0.4) {
            "%.1fs".format(java.util.Locale.ROOT, sec)
        } else {
            val denom = (1.0 / sec).roundToInt().coerceAtLeast(1)
            "1/$denom"
        }
    }
}
