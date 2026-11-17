import Foundation

/**
 * "1:05 elapsed · about 2:30 left" under Auto's "Export all" progress (port of web's `BatchTime` in AutoApp.tsx). The
 * estimate waits for a first photo (or a tenth of the work) and goes away while stopping.
 */
public enum BatchTime {
    /**
     * The line for an export that has run [elapsed] seconds, with [done] of [total] photos saved and [current] (0..1) of
     * the one being exported.
     */
    public static func label(elapsed: TimeInterval, done: Int, current: Float, total: Int, stopping: Bool) -> String {
        let elapsed = max(0, elapsed)
        let fraction = total > 0 ? min(1, (Double(done) + Double(current)) / Double(total)) : 0
        let estimate = (fraction >= 0.1 || done >= 1) && fraction > 0 && !stopping
        var text = "\(duration(elapsed)) elapsed"
        if estimate {
            let left = elapsed * (1 - fraction) / fraction
            text += " · about \(left < 5 ? "a few seconds" : duration(left)) left"
        }
        return text
    }

    /** m:ss, or h:mm:ss from an hour. */
    public static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
