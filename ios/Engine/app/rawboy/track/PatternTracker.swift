import Foundation

/**
 * Follows the patch under the camera's focus point from one greyscale frame to the next (one byte per pixel, row 0 =
 * top, upright as the viewfinder shows it; about 320 px on the long side). Zero-mean normalised cross-correlation of a
 * template, searched near where the patch should be, at its last size and a little smaller and larger, so a subject
 * the camera walks up to (or away from) keeps being found as it grows. The region around the predicted spot is
 * resampled to the template's scale, searched at half resolution, then refined.
 *
 * The template slowly takes on the patch's new look while the match is good, so a turning subject keeps being found,
 * but a match must still resemble the patch as first tapped (anchorScore), or the learning would let it drift onto
 * whatever replaced the subject. Among similar matches (a striped door, tiles) the one nearest where the patch was
 * expected wins (prior). A patch expected past the frame's edge counts as not found: what is left inside matches
 * poorly anyway, and a search kept inside the frame would settle on the next thing there.
 *
 * Positions are fractions of the frame (x right, y down). update holds the last position while the match is poor
 * (a brief occlusion) and reports the patch lost once it has been poor for lostAfter, or the frame's size changed.
 * Not thread-safe: one caller at a time. Port of PatternTracker.kt.
 */
public final class PatternTracker {
    /**
     * One frame's answer: where the patch is, how well it matched (-1...1), its size against the tap's (scale),
     * whether it was found in this frame (else its last position is held) and whether it is lost for good.
     */
    public struct Result: Equatable {
        public let x: Float
        public let y: Float
        public let score: Float
        public let lost: Bool
        public let scale: Float
        public let found: Bool
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
    /** Sizes tried each frame against the last one: walking up to a subject grows it a few % a frame. */
    private static let scaleSteps: [Float] = [1, 1 / 1.08, 1.08]
    /** Score a size change must win by, so noise doesn't make the size wander. */
    private static let scalePenalty: Float = 0.02
    private static let minScale: Float = 0.4
    /** How far (px) the expected patch may reach past the frame's edge before it counts as leaving it. */
    private static let edge: Float = 2
    private static let refine = 2
    /** Grey levels (0...255) of spread a patch needs to be followed at all. */
    static let minStd: Float = 4

    private let size: Int
    private let reach: Int
    private let lostAfter: Int64
    private var width = 0
    private var height = 0
    /** Zero-mean template, and the same as first tapped. */
    private var template: [Float]?
    private var anchor: [Float]?
    /** Patch centre (frame px), its last move, and its side in frame px per template px. */
    private var cx: Float = 0
    private var cy: Float = 0
    private var vx: Float = 0
    private var vy: Float = 0
    private var scale: Float = 1
    private var lastGood: Int64 = 0
    /** The search region (template px, size + 2 reach square) and its half-resolution copy, reused between frames. */
    private var region: [Float]
    private var regionHalf: [Float]

    public init(size: Int = PatternTracker.templateSize, reach: Int = PatternTracker.searchReach,
                lostAfterMs: Int64 = PatternTracker.lostAfterMs) {
        self.size = size
        self.reach = reach
        self.lostAfter = lostAfterMs
        region = [Float](repeating: 0, count: (size + 2 * reach) * (size + 2 * reach))
        regionHalf = [Float](repeating: 0, count: (size / 2 + reach) * (size / 2 + reach))
    }

    public var active: Bool { template != nil }

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
        var f = [Float](repeating: 0, count: size * size)
        Self.sample(grey, width, height, px, py, 1, size, &f)
        guard Self.std(f) >= Self.minStd else { return false }
        self.width = width
        self.height = height
        template = Self.zeroMean(f)
        anchor = template
        cx = px
        cy = py
        vx = 0
        vy = 0
        scale = 1
        lastGood = now
        return true
    }

    /** Finds the patch in the next frame; nil when nothing is being followed. */
    public func update(width: Int, height: Int, grey: [UInt8], now: Int64) -> Result? {
        guard var t = template, let a = anchor else { return nil }
        guard width == self.width, height == self.height, grey.count >= width * height else {
            stop()
            return Result(x: cx / Float(max(1, self.width)), y: cy / Float(max(1, self.height)), score: 0, lost: true,
                          scale: scale, found: false)
        }
        // Where the patch's centre should be now.
        let px = cx + vx
        let py = cy + vy
        let half = Float(size) * scale / 2
        let inside = px - half >= -Self.edge && py - half >= -Self.edge && px + half <= Float(width) + Self.edge
            && py + half <= Float(height) + Self.edge
        var found: (x: Float, y: Float, scale: Float, score: Float, rank: Float)?
        if inside {
            for k in Self.scaleSteps {
                let s = min(max(scale * k, Self.minScale), maxScale(width, height))
                let m = search(grey, width, height, t, px, py, s)
                let rank = m.score - (k == 1 ? 0 : Self.scalePenalty)
                if found == nil || rank > found!.rank { found = (m.x, m.y, s, m.score, rank) }
            }
        }
        var score = found?.score ?? 0
        var ok = false
        if let fd = found {
            // Still the tapped subject, not something the template has learned its way onto?
            var patch = [Float](repeating: 0, count: size * size)
            Self.sample(grey, width, height, fd.x, fd.y, fd.scale, size, &patch)
            let first = Self.ncc(patch, a)
            if first < Self.anchorScore { score = min(score, first) }
            if score >= Self.minScore {
                ok = true
                vx = (fd.x - cx) * Self.velocityKeep
                vy = (fd.y - cy) * Self.velocityKeep
                cx = fd.x
                cy = fd.y
                scale = fd.scale
                lastGood = now
                if score >= Self.updateScore {
                    Self.blend(&t, Self.zeroMean(patch))
                    template = t
                }
            } else {
                // Not found where it should be: look around where it was. Expected past the edge, it keeps going out.
                vx = 0
                vy = 0
            }
        }
        let lost = now - lastGood > lostAfter
        let result = Result(x: cx / Float(width), y: cy / Float(height), score: score, lost: lost, scale: scale,
                            found: ok)
        if lost { stop() }
        return result
    }

    public func stop() {
        template = nil
        anchor = nil
    }

    /** Largest patch scale: the patch may grow to 60% of the frame's short side. */
    private func maxScale(_ width: Int, _ height: Int) -> Float {
        max(1, Float(min(width, height)) * 0.6 / Float(size))
    }

    /**
     * The best match of template t around (ex, ey) (frame px) with the frame seen at s frame px per template px: the
     * region within `reach` template px resampled, searched at half resolution (2x2 averages: a fine texture one pixel
     * off doesn't correlate at all), then refined to the pixel. Ranked by correlation less `prior` at the edge of the
     * reach; returns the match's centre (frame px) and plain score.
     */
    private func search(_ img: [UInt8], _ w: Int, _ h: Int, _ t: [Float], _ ex: Float, _ ey: Float,
                        _ s: Float) -> (x: Float, y: Float, score: Float) {
        let rs = size + 2 * reach
        Self.sample(img, w, h, ex, ey, s, rs, &region)
        let prior = Self.prior / Float(reach * reach)
        // Half resolution: the whole reach.
        let hr = rs / 2
        Self.halve(region, rs, &regionHalf)
        var th = [Float](repeating: 0, count: (size / 2) * (size / 2))
        Self.halve(t, size, &th)
        let thNorm = sqrt(th.reduce(Float(0)) { $0 + $1 * $1 })
        var hx = reach / 2
        var hy = reach / 2
        var hRank: Float = -10
        for y in 0...reach {
            for x in 0...reach {
                let dx = 2 * Float(x) - Float(reach)
                let dy = 2 * Float(y) - Float(reach)
                let rank = Self.nccAt(regionHalf, hr, x, y, th, thNorm) - prior * (dx * dx + dy * dy)
                if rank > hRank {
                    hRank = rank
                    hx = x
                    hy = y
                }
            }
        }
        // Full resolution: a pixel or two around it.
        let tNorm = sqrt(t.reduce(Float(0)) { $0 + $1 * $1 })
        var bestX = 2 * hx
        var bestY = 2 * hy
        var bestScore: Float = -2
        var bestRank: Float = -10
        for y in max(0, 2 * hy - Self.refine)...min(2 * reach, 2 * hy + Self.refine) {
            for x in max(0, 2 * hx - Self.refine)...min(2 * reach, 2 * hx + Self.refine) {
                let score = Self.nccAt(region, rs, x, y, t, tNorm)
                let dx = Float(x - reach)
                let dy = Float(y - reach)
                let rank = score - prior * (dx * dx + dy * dy)
                if rank > bestRank {
                    bestRank = rank
                    bestScore = score
                    bestX = x
                    bestY = y
                }
            }
        }
        return (ex + Float(bestX - reach) * s, ey + Float(bestY - reach) * s, bestScore)
    }

    /**
     * n x n samples of the frame, s frame px apart, centred on (cx, cy): bilinear, positions outside the frame clamped
     * to its edge.
     */
    private static func sample(_ img: [UInt8], _ w: Int, _ h: Int, _ cx: Float, _ cy: Float, _ s: Float, _ n: Int,
                               _ out: inout [Float]) {
        let x0 = cx - (Float(n) / 2 - 0.5) * s - 0.5
        let y0 = cy - (Float(n) / 2 - 0.5) * s - 0.5
        img.withUnsafeBufferPointer { px in
            for j in 0..<n {
                let fy = min(max(y0 + Float(j) * s, 0), Float(h - 1))
                let iy = min(Int(fy), h - 2)
                let ty = fy - Float(iy)
                for i in 0..<n {
                    let fx = min(max(x0 + Float(i) * s, 0), Float(w - 1))
                    let ix = min(Int(fx), w - 2)
                    let tx = fx - Float(ix)
                    let p = iy * w + ix
                    let top = Float(px[p]) * (1 - tx) + Float(px[p + 1]) * tx
                    let bottom = Float(px[p + w]) * (1 - tx) + Float(px[p + w + 1]) * tx
                    out[j * n + i] = top * (1 - ty) + bottom * ty
                }
            }
        }
    }

    /** Correlation of zero-mean template t (norm tNorm) with the patch of img (row length n) at (x, y). */
    private static func nccAt(_ img: [Float], _ n: Int, _ x: Int, _ y: Int, _ t: [Float], _ tNorm: Float) -> Float {
        let s = Int(Double(t.count).squareRoot())
        var sum: Float = 0
        var sum2: Float = 0
        var cross: Float = 0
        img.withUnsafeBufferPointer { ip in
            t.withUnsafeBufferPointer { tp in
                var k = 0
                for j in 0..<s {
                    var i = (y + j) * n + x
                    for _ in 0..<s {
                        let v = ip[i]
                        sum += v
                        sum2 += v * v
                        cross += v * tp[k]
                        i += 1
                        k += 1
                    }
                }
            }
        }
        // The template has zero mean, so the patch's mean drops out of the cross term.
        let variance = sum2 - sum * sum / Float(t.count)
        return variance <= 1e-3 || tNorm <= 0 ? 0 : cross / (sqrt(variance) * tNorm)
    }

    private static func ncc(_ patch: [Float], _ t: [Float]) -> Float {
        let tNorm = sqrt(t.reduce(Float(0)) { $0 + $1 * $1 })
        return nccAt(patch, Int(Double(patch.count).squareRoot()), 0, 0, t, tNorm)
    }

    /** 2x2 averages of the n x n square img into out (n / 2 square). */
    private static func halve(_ img: [Float], _ n: Int, _ out: inout [Float]) {
        let m = n / 2
        for y in 0..<m {
            let r0 = 2 * y * n
            let r1 = r0 + n
            for x in 0..<m {
                out[y * m + x] = (img[r0 + 2 * x] + img[r0 + 2 * x + 1] + img[r1 + 2 * x] + img[r1 + 2 * x + 1]) * 0.25
            }
        }
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
}
