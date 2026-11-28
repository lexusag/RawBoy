import Foundation

/**
 * Camera's Exposure slider as a program line, the way a camera in P mode spends exposure compensation: the phone's AE
 * meters the scene at 0, and a still shot at `ev` != 0 is exposed by hand at the metered exposure x 2^ev. Port of
 * Android's `capture/ExposureProgram.kt` (keep in step; the tests are the same).
 *
 * Brighter (+EV): a longer exposure up to `handheldNs` (or the metered time if that is already longer), then more ISO
 * up to the sensor's highest, then a longer exposure up to the still limit; what is left stays digital (the develop
 * adds it). Darker (-EV): the lowest ISO first (less noise), then a shorter exposure; what is left stays digital.
 * Under flickering light (the metered time a whole number of mains half-periods, `flickerPeriodNs`) a lengthened time
 * is rounded down to whole periods and the ISO makes up the rest, as AE itself does.
 *
 * The raw may clip: that is the point of +EV, and AgX rolls the highlights off.
 */
enum ExposureProgram {
    /** The slider's range either side of 0 (EV) and its steps per EV (thirds, as cameras step). */
    static let rangeEv: Float = 3
    static let stepsPerEv: Float = 3

    /** `ev` on the slider's thirds within ±rangeEv. */
    static func snap(_ ev: Float) -> Float {
        guard ev.isFinite else { return 0 }
        return (min(max(ev, -rangeEv), rangeEv) * stepsPerEv).rounded() / stepsPerEv
    }

    /** Longest exposure the program chooses before it raises the ISO (1/30 s). */
    static let handheldNs: Int64 = 33_333_333

    /** Longest still exposure the program reaches for (1/15 s, Android's neutral `maxStillExposureNs`). */
    static let maxStillNs: Int64 = 66_666_667

    /** Mains half-periods AE avoids banding with: 50 Hz (10 ms) and 60 Hz (8.33 ms) light. */
    private static let flickerPeriodsNs: [Int64] = [10_000_000, 8_333_333]

    /** A metered time within this share of a whole number of periods counts as flicker-safe. */
    private static let flickerTolerance = 0.015

    /** One manual exposure: time (ns) and ISO. */
    struct Exposure: Equatable {
        let exposureNs: Int64
        let iso: Int
        /** Raw gain (exposure s x ISO). */
        var gain: Double { Double(exposureNs) / 1e9 * Double(iso) }
    }

    /**
     * The manual exposure for `ev` of compensation over the metered exposure `t0Ns` x `iso0`, within the sensor's ISO
     * `isoMin`...`isoMax` and time `expMin`...`expMax`, times no longer than `maxStillNs` unless the metered time
     * already is.
     */
    static func compute(ev: Float, t0Ns: Int64, iso0: Float, isoMin: Int, isoMax: Int, expMin: Int64, expMax: Int64,
                        maxStillNs: Int64) -> Exposure {
        let t0 = Double(min(max(t0Ns, expMin), expMax))
        let i0 = min(max(Double(iso0), Double(isoMin)), Double(isoMax))
        let target = t0 * i0 * pow(2.0, Double(ev))
        let longest = min(Double(expMax), max(t0, Double(maxStillNs)))
        var t: Double
        var iso: Double
        if ev >= 0 {
            // Time up to the handheld limit, then ISO, then time up to the still's limit.
            let handheld = min(longest, max(t0, Double(handheldNs)))
            t = min(max(target / i0, t0), handheld)
            iso = target / t
            if iso > Double(isoMax) {
                iso = Double(isoMax)
                t = min(max(target / iso, t), longest)
            }
            if t > t0, let period = flickerPeriodNs(t0Ns) {
                let whole = Int64(t / Double(period))
                if whole >= 1 {
                    let rounded = Double(whole * period)
                    // Only when the ISO can make up the rounding; else keep the exact time (brightness first).
                    if target / rounded <= Double(isoMax) {
                        t = max(rounded, t0)
                        iso = target / t
                    }
                }
            }
        } else {
            // ISO down first, then a shorter time.
            iso = min(max(target / t0, Double(isoMin)), i0)
            t = min(max(target / iso, Double(expMin)), t0)
        }
        let isoOut = Int(min(max(iso, Double(isoMin)), Double(isoMax)).rounded())
        let upper = max(expMin, min(expMax, Int64(longest.rounded())))
        let tOut = min(max(Int64(t.rounded()), expMin), upper)
        return Exposure(exposureNs: tOut, iso: isoOut)
    }

    /**
     * The mains half-period `t0Ns` is a whole multiple of (AE's anti-banding choice), or nil: too short to tell, or no
     * multiple of either.
     */
    static func flickerPeriodNs(_ t0Ns: Int64) -> Int64? {
        for period in flickerPeriodsNs {
            if Double(t0Ns) < Double(period) * (1 - flickerTolerance) { continue }
            let n = (Double(t0Ns) / Double(period)).rounded()
            if n >= 1 && abs(Double(t0Ns) - n * Double(period)) <= n * Double(period) * flickerTolerance { return period }
        }
        return nil
    }

    /** EV of `exposureNs` x `iso` (as the camera applied them) over the metered gain `meteredGain` (s x ISO). */
    static func capturedEv(exposureNs: Int64, iso: Float, meteredGain: Double) -> Float {
        let g = Double(exposureNs) / 1e9 * Double(iso)
        return g > 0 && meteredGain > 0 ? Float(log2(g / meteredGain)) : 0
    }
}
