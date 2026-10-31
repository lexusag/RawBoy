import Foundation

/**
 * Follows the patch under the camera's focus point from one greyscale frame to the next (one byte per pixel, row 0 =
 * top, upright as the viewfinder shows it; about 320 px on the long side). Zero-mean normalised cross-correlation of a
 * template: searched near where the patch should be at half resolution, then refined at full resolution. The template
 * slowly takes on the patch's new look while the match is good, so a turning subject keeps being found, but a match
 * must still resemble the patch as first tapped (anchorScore), or the learning would let it drift onto whatever
 * replaced the subject. Among similar matches (a striped door, tiles) the one nearest where the patch was expected
 * wins (prior). A patch expected past the frame's edge counts as not found: what is left inside matches poorly
 * anyway, and the search, kept inside the frame, would settle on the next thing there.
 *
 * Positions are fractions of the frame (x right, y down). update holds the last position while the match is poor
 * (a brief occlusion) and reports the patch lost once it has been poor for lostAfter, or the frame's size changed.
 * Not thread-safe: one caller at a time. Port of PatternTracker.kt.
 */
public final class PatternTracker {
    /** One frame's answer: where the patch is, how well it matched (-1...1) and whether it is lost for good. */
    public struct Result: Equatable {
        public let x: Float
        public let y: Float
        public let score: Float
        public let lost: Bool
    }

    /** About 7% of a 320 px frame: larger than the AF box, so the patch holds some texture around it. */
    public static let templateSize = 24
    /** A fast pan moves the subject ~30 px a frame at 15 fps on a 320 px frame; the last move is added on top. */
    public static let searchReach = 24
    /** Correlation the patch must reach to count as found; above updateScore the template learns from it. */
    public static let minScore: Float = 0.6
    public static let updateScore: Float = 0.85
    /** Share of the new look a good match blends into the template. */
    static let learn: Float = 0.15
    /** Share of the last move expected again in the next frame. */
    static let velocityKeep: Float = 0.5
    /** How long the patch may stay unfound (a hand passing in front) before it counts as lost, ms. */
    public static let lostAfterMs: Int64 = 400
    /**
     * Lowest correlation with the patch as first tapped: below it the learned template has wandered onto something
     * else (the subject left, the next thing in the frame looked alike after a few blended frames).
     */
    public static let anchorScore: Float = 0.45
    /** Score taken off a match at the edge of the search reach (less nearer the expected spot): repeated patterns. */
    static let prior: Float = 0.2
    /** How far (px) the expected top left may lie past the frame's edge before the patch counts as leaving it. */
    private static let edge: Float = 2
    /** Grey levels (0...255) of spread a patch needs to be followed at all. */
    static let minStd: Float = 4
    private static let refine = 2

    private let size: Int
    private let reach: Int
    private let lostAfter: Int64
    private var width = 0
    private var height = 0
    /** Zero-mean templates, full and half resolution, and the full one as first tapped. */
    private var full: [Float]?
    private var half: [Float]?
    private var anchor: [Float]?
    /** Patch centre, full-resolution px, and its last move. */
    private var cx: Float = 0
    private var cy: Float = 0
    private var vx: Float = 0
    private var vy: Float = 0
    private var lastGood: Int64 = 0

    public init(size: Int = PatternTracker.templateSize, reach: Int = PatternTracker.searchReach,
                lostAfterMs: Int64 = PatternTracker.lostAfterMs) {
        self.size = size
        self.reach = reach
        self.lostAfter = lostAfterMs
    }

    public var active: Bool { full != nil }

    /**
     * Starts following the patch around (x, y) of this frame at `now` (ms, any monotonic clock). Returns false, and
     * follows nothing, when the patch has too little detail to be found again (a plain wall, the sky).
     */
    @discardableResult
    public func start(width: Int, height: Int, grey: [UInt8], x: Float, y: Float, now: Int64) -> Bool {
        stop()
        guard width >= size * 2, height >= size * 2, grey.count >= width * height else { return false }
        let s = Float(size)
        let px = min(max(x * Float(width), s / 2), Float(width) - s / 2)
        let py = min(max(y * Float(height), s / 2), Float(height) - s / 2)
        let f = Self.patch(grey, width, height, size, Int((px - s / 2).rounded()), Int((py - s / 2).rounded()))
        guard Self.std(f) >= Self.minStd else { return false }
        let h = Self.halve(grey, width, height)
        let hs = size / 2
        self.width = width
        self.height = height
        full = Self.zeroMean(f)
        anchor = full
        half = Self.zeroMean(Self.patch(h, width / 2, height / 2, hs, Int((px / 2 - Float(hs) / 2).rounded()),
                                        Int((py / 2 - Float(hs) / 2).rounded())))
        cx = px
        cy = py
        vx = 0
        vy = 0
        lastGood = now
        return true
    }

    /** Finds the patch in the next frame; nil when nothing is being followed. */
    public func update(width: Int, height: Int, grey: [UInt8], now: Int64) -> Result? {
        guard var f = full, var hf = half, let a = anchor else { return nil }
        guard width == self.width, height == self.height, grey.count >= width * height else {
            stop()
            return Result(x: cx / Float(max(1, self.width)), y: cy / Float(max(1, self.height)), score: 0, lost: true)
        }
        let hw = width / 2
        let hh = height / 2
        let hs = size / 2
        // Where the patch's top left should be now, full resolution.
        let px = cx + vx - Float(size) / 2
        let py = cy + vy - Float(size) / 2
        let inside = px >= -Self.edge && py >= -Self.edge && px <= Float(width - size) + Self.edge
            && py <= Float(height - size) + Self.edge
        let h = inside ? Self.halve(grey, width, height) : nil
        var found: (x: Int, y: Int, score: Float)?
        if let h {
            // Half resolution: around the predicted position, the patch's top left within reach.
            let r = (reach + 1) / 2
            let coarse = Self.best(h, hw, hh, hf, hs, px / 2, py / 2, r)
            // Full resolution: a pixel or two around it.
            let m = Self.best(grey, width, height, f, size, Float(coarse.x * 2), Float(coarse.y * 2), Self.refine)
            // Still the tapped subject, not something the template has learned its way onto?
            let first = Self.best(grey, width, height, a, size, Float(m.x), Float(m.y), 0)
            found = first.score >= Self.anchorScore ? m : (x: m.x, y: m.y, score: min(m.score, first.score))
        }
        let score = found?.score ?? 0
        if let fine = found, score >= Self.minScore {
            let nx = Float(fine.x) + Float(size) / 2
            let ny = Float(fine.y) + Float(size) / 2
            vx = (nx - cx) * Self.velocityKeep
            vy = (ny - cy) * Self.velocityKeep
            cx = nx
            cy = ny
            lastGood = now
            if score >= Self.updateScore, let h {
                Self.blend(&f, Self.zeroMean(Self.patch(grey, width, height, size, fine.x, fine.y)))
                Self.blend(&hf, Self.zeroMean(Self.patch(h, hw, hh, hs, Int((cx / 2 - Float(hs) / 2).rounded()),
                                                         Int((cy / 2 - Float(hs) / 2).rounded()))))
                full = f
                half = hf
            }
        } else if h != nil {
            // Not found where it should be: look around where it was. Expected past the edge, it keeps going out.
            vx = 0
            vy = 0
        }
        let lost = now - lastGood > lostAfter
        let result = Result(x: cx / Float(width), y: cy / Float(height), score: score, lost: lost)
        if lost { stop() }
        return result
    }

    public func stop() {
        full = nil
        half = nil
        anchor = nil
    }

    /**
     * The best match of template t (s px square, zero mean) with its top left within r px of (ex, ey) (kept inside
     * the image), by normalised cross-correlation less `prior` at the edge of the reach; returns its plain score.
     */
    private static func best(_ img: [UInt8], _ w: Int, _ h: Int, _ t: [Float], _ s: Int,
                             _ ex: Float, _ ey: Float, _ r: Int) -> (x: Int, y: Int, score: Float) {
        let tNorm = sqrt(t.reduce(Float(0)) { $0 + $1 * $1 })
        let ix = Int(ex.rounded())
        let iy = Int(ey.rounded())
        let ax = min(max(ix - r, 0), w - s)
        let bx = min(max(ix + r, 0), w - s)
        let ay = min(max(iy - r, 0), h - s)
        let by = min(max(iy + r, 0), h - s)
        let n = Float(s * s)
        let weight = r > 0 ? prior / Float(r * r) : 0
        var bestX = ax
        var bestY = ay
        var bestScore: Float = -2
        var bestRank: Float = -10
        img.withUnsafeBufferPointer { px in
            t.withUnsafeBufferPointer { tp in
                for y in ay...by {
                    for x in ax...bx {
                        var sum: Float = 0
                        var sum2: Float = 0
                        var cross: Float = 0
                        var k = 0
                        for j in 0..<s {
                            var i = (y + j) * w + x
                            for _ in 0..<s {
                                let v = Float(px[i])
                                sum += v
                                sum2 += v * v
                                cross += v * tp[k]
                                i += 1
                                k += 1
                            }
                        }
                        // The template has zero mean, so the patch's mean drops out of the cross term.
                        let variance = sum2 - sum * sum / n
                        let score = variance <= 0 || tNorm <= 0 ? 0 : cross / (sqrt(variance) * tNorm)
                        let dx = Float(x) - ex
                        let dy = Float(y) - ey
                        let rank = score - weight * (dx * dx + dy * dy)
                        if rank > bestRank {
                            bestRank = rank
                            bestScore = score
                            bestX = x
                            bestY = y
                        }
                    }
                }
            }
        }
        return (bestX, bestY, bestScore)
    }

    /** The s px square with its top left at (x0, y0), moved inside the w x h image. */
    private static func patch(_ img: [UInt8], _ w: Int, _ h: Int, _ s: Int, _ x0: Int, _ y0: Int) -> [Float] {
        let ax = min(max(x0, 0), w - s)
        let ay = min(max(y0, 0), h - s)
        var out = [Float](repeating: 0, count: s * s)
        for j in 0..<s {
            for i in 0..<s { out[j * s + i] = Float(img[(ay + j) * w + ax + i]) }
        }
        return out
    }

    private static func zeroMean(_ p: [Float]) -> [Float] {
        let mean = p.reduce(0, +) / Float(p.count)
        return p.map { $0 - mean }
    }

    private static func std(_ p: [Float]) -> Float {
        let mean = p.reduce(0, +) / Float(p.count)
        return sqrt(p.reduce(Float(0)) { $0 + ($1 - mean) * ($1 - mean) } / Float(p.count))
    }

    private static func blend(_ into: inout [Float], _ from: [Float]) {
        for i in into.indices { into[i] = into[i] * (1 - learn) + from[i] * learn }
    }

    /** 2x2 box average, w / 2 x h / 2. */
    private static func halve(_ img: [UInt8], _ w: Int, _ h: Int) -> [UInt8] {
        let hw = w / 2
        let hh = h / 2
        var out = [UInt8](repeating: 0, count: hw * hh)
        for y in 0..<hh {
            let r0 = 2 * y * w
            let r1 = r0 + w
            for x in 0..<hw {
                let s = Int(img[r0 + 2 * x]) + Int(img[r0 + 2 * x + 1]) + Int(img[r1 + 2 * x]) + Int(img[r1 + 2 * x + 1])
                out[y * hw + x] = UInt8((s + 2) / 4)
            }
        }
        return out
    }
}
