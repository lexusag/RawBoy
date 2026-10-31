import CoreVideo
import Foundation
#if FILM_EDITION
import RawBoyFilmEngine
#else
import RawBoyEngine
#endif

/**
 * Follows the tapped subject in the camera's video frames (Track subject after tap): a small upright grey copy of each
 * frame, as the viewfinder shows it (turned and mirrored like linearizeFragment), searched by PatternTracker on a
 * queue of its own. Android makes the same copy on the GPU (ViewfinderRenderer.onTrackLuma).
 *
 * feed runs on the camera's frame queue and drops frames while one is being tracked; results arrive on `onResult`
 * (the tracker's queue) tagged with the start's generation, so a result from before a new tap can be ignored.
 */
final class SubjectTracker: @unchecked Sendable {
    /** Long side of the grey copy (Android's TRACK_MAX_DIMENSION). */
    static let maxDimension = 320

    enum Event {
        /** Following from (x, y); false: too little detail there, the plain focus lock stays. */
        case started(Bool)
        case moved(x: Double, y: Double)
        case lost
    }

    /** Called on the tracker's queue with the generation the event belongs to. */
    var onResult: ((Int, Event) -> Void)?

    private let queue = DispatchQueue(label: "RawBoy-track", qos: .userInitiated)
    private let lock = NSLock()
    private let tracker = PatternTracker()
    // Under lock: the point to start at with the next frame, whether frames are wanted, the generation, busy.
    private var start: CGPoint?
    private var running = false
    private var generation = 0
    private var busy = false
    private var lastFeed: TimeInterval = 0
    /** About 15 frames a second: plenty to follow a subject, and the copy costs a few ms of CPU each. */
    private static let interval: TimeInterval = 1.0 / 15

    /** Starts following the subject at (x, y) (upright normalised, as shown) from the next frame. */
    func begin(_ x: Double, _ y: Double) {
        lock.withLock {
            generation += 1
            start = CGPoint(x: x, y: y)
            running = true
        }
    }

    /** Stops following; returns the new generation. */
    @discardableResult
    func end() -> Int {
        lock.withLock {
            generation += 1
            start = nil
            running = false
            return generation
        }
    }

    var currentGeneration: Int { lock.withLock { generation } }

    /**
     * A camera frame (BGRA): `rotation` clockwise quarter turns from a landscape buffer to upright (portrait buffers,
     * the selfie camera's, aren't turned), `mirror` for the selfie camera, as the viewfinder's Frame says.
     */
    func feed(_ buffer: CVPixelBuffer, rotation: Int, mirror: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        let job: (Int, CGPoint?)? = lock.withLock {
            guard running, !busy, now - lastFeed >= Self.interval else { return nil }
            busy = true
            lastFeed = now
            let s = start
            start = nil
            return (generation, s)
        }
        guard case let (gen, startAt)? = job else { return }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let turn = width > height ? rotation : 0
        guard case let (w, h, grey)? = Self.grey(buffer, rotation: turn, mirror: mirror) else {
            lock.withLock { busy = false }
            return
        }
        queue.async { [self] in
            defer { lock.withLock { busy = false } }
            let ms = Int64(now * 1000)
            let event: Event?
            if let p = startAt {
                let ok = tracker.start(width: w, height: h, grey: grey, x: Float(p.x), y: Float(p.y), now: ms)
                if !ok { lock.withLock { if generation == gen { running = false } } }
                event = .started(ok)
            } else if let r = tracker.update(width: w, height: h, grey: grey, now: ms) {
                if r.lost { lock.withLock { if generation == gen { running = false } } }
                event = r.lost ? .lost : .moved(x: Double(r.x), y: Double(r.y))
            } else {
                event = nil
            }
            // A tap or release since this frame was taken: its answer belongs to the old lock.
            guard let event, lock.withLock({ generation == gen }) else { return }
            onResult?(gen, event)
        }
    }

    /**
     * The frame as an upright grey copy at most maxDimension px on the long side: each pixel the mean of a 4 x 4 grid of
     * buffer samples over its footprint (point samples alias into noise the tracker would chase), luma of the
     * sRGB-encoded values. Nil for a buffer that isn't 32-bit BGRA.
     */
    private static func grey(_ buffer: CVPixelBuffer, rotation: Int, mirror: Bool) -> (Int, Int, [UInt8])? {
        guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA else { return nil }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let bw = CVPixelBufferGetWidth(buffer)
        let bh = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let turned = rotation % 2 == 1
        let uw = turned ? bh : bw
        let uh = turned ? bw : bh
        let scale = min(1, Double(maxDimension) / Double(max(uw, uh)))
        let w = max(1, Int((Double(uw) * scale).rounded()))
        let h = max(1, Int((Double(uh) * scale).rounded()))
        let px = base.assumingMemoryBound(to: UInt8.self)
        let sub = 4
        var out = [UInt8](repeating: 0, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                var sum = 0
                for j in 0..<sub {
                    let v = (Double(y) + (Double(j) + 0.5) / Double(sub)) / Double(h)
                    for i in 0..<sub {
                        var u = (Double(x) + (Double(i) + 0.5) / Double(sub)) / Double(w)
                        if mirror { u = 1 - u }
                        // Buffer position that lands at (u, v) after turning clockwise (linearizeFragment's rule).
                        let b: (Double, Double)
                        switch rotation {
                        case 1: b = (v, 1 - u)
                        case 2: b = (1 - u, 1 - v)
                        case 3: b = (1 - v, u)
                        default: b = (u, v)
                        }
                        let bx = min(bw - 1, Int(b.0 * Double(bw)))
                        let by = min(bh - 1, Int(b.1 * Double(bh)))
                        let p = px + by * stride + bx * 4
                        // BGRA; Rec.709 luma weights in 8-bit fixed point.
                        sum += (Int(p[2]) * 54 + Int(p[1]) * 183 + Int(p[0]) * 19) >> 8
                    }
                }
                out[y * w + x] = UInt8(sum / (sub * sub))
            }
        }
        return (w, h, out)
    }
}
