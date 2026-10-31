import XCTest
@testable import RawBoyEngine

/** The camera's subject tracker on synthetic frames (the same cases as PatternTrackerTest.kt). */
final class PatternTrackerTests: XCTestCase {
    private let w = 320
    private let h = 240
    private lazy var background = texture(seed: 1, w, h)
    private lazy var subject = texture(seed: 2, 40, 40)

    /** A textured 3x3-smoothed noise image (a small LCG, so no platform random), as a busy background or subject. */
    private func texture(seed: UInt64, _ tw: Int, _ th: Int) -> [Int] {
        var state = seed &* 6364136223846793005 &+ 1442695040888963407
        let raw = (0..<(tw * th)).map { _ -> Int in
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Int(state >> 56)
        }
        return (0..<(tw * th)).map { i in
            let x = i % tw, y = i / tw
            var s = 0, n = 0
            for dy in -1...1 {
                for dx in -1...1 where (0..<tw).contains(x + dx) && (0..<th).contains(y + dy) {
                    s += raw[(y + dy) * tw + x + dx]
                    n += 1
                }
            }
            return s / n
        }
    }

    /** img box-blurred radius px each way (a box of that radius, twice: soft shading), stretched to full contrast. */
    private func smooth(_ img: [Int], _ radius: Int) -> [Int] {
        var cur = img
        for _ in 0..<2 {
            let prev = cur
            cur = (0..<(w * h)).map { i in
                let x = i % w, y = i / w
                var s = 0, n = 0
                for dy in -radius...radius {
                    for dx in -radius...radius where (0..<w).contains(x + dx) && (0..<h).contains(y + dy) {
                        s += prev[(y + dy) * w + x + dx]
                        n += 1
                    }
                }
                return s / n
            }
        }
        let lo = cur.min() ?? 0, hi = cur.max() ?? 255
        return cur.map { ($0 - lo) * 255 / max(1, hi - lo) }
    }

    /** The background with the subject's top left at (sx, sy); gain scales the whole frame (exposure). */
    private func frame(_ sx: Int, _ sy: Int, gain: Float = 1, covered: Bool = false) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let inside = (0..<40).contains(x - sx) && (0..<40).contains(y - sy)
                let v = inside ? (covered ? 128 : subject[(y - sy) * 40 + x - sx]) : background[y * w + x]
                out[y * w + x] = UInt8(min(max(Int(Float(v) * gain), 0), 255))
            }
        }
        return out
    }

    func testFollowsAMovingSubject() throws {
        let t = PatternTracker()
        var sx = 60
        let sy = 100
        XCTAssertTrue(t.start(width: w, height: h, grey: frame(sx, sy), x: Float(sx + 20) / Float(w),
                              y: Float(sy + 20) / Float(h), now: 0))
        for i in 1...25 {
            sx += 7
            let r = try XCTUnwrap(t.update(width: w, height: h, grey: frame(sx, sy + i), now: Int64(i) * 66))
            XCTAssertFalse(r.lost)
            XCTAssertEqual(r.x, Float(sx + 20) / Float(w), accuracy: 2 / Float(w))
            XCTAssertEqual(r.y, Float(sy + i + 20) / Float(h), accuracy: 2 / Float(h))
        }
    }

    func testKeepsFollowingThroughAnExposureChange() throws {
        let t = PatternTracker()
        XCTAssertTrue(t.start(width: w, height: h, grey: frame(100, 80), x: 120 / Float(w), y: 100 / Float(h), now: 0))
        let r = try XCTUnwrap(t.update(width: w, height: h, grey: frame(104, 82, gain: 0.6), now: 66))
        XCTAssertFalse(r.lost)
        XCTAssertEqual(r.x, 124 / Float(w), accuracy: 2 / Float(w))
        XCTAssertEqual(r.y, 102 / Float(h), accuracy: 2 / Float(h))
    }

    func testAPlainPatchIsNotFollowed() {
        let t = PatternTracker()
        XCTAssertFalse(t.start(width: w, height: h, grey: [UInt8](repeating: 90, count: w * h), x: 0.5, y: 0.5, now: 0))
        XCTAssertFalse(t.active)
    }

    func testHoldsThroughABriefOcclusionThenLoses() throws {
        let t = PatternTracker()
        XCTAssertTrue(t.start(width: w, height: h, grey: frame(100, 80), x: 120 / Float(w), y: 100 / Float(h), now: 0))
        let held = try XCTUnwrap(t.update(width: w, height: h, grey: frame(100, 80, covered: true), now: 100))
        XCTAssertFalse(held.lost)
        XCTAssertEqual(held.x, 120 / Float(w), accuracy: 1 / Float(w))
        // Back in view within the grace time: found again.
        let back = try XCTUnwrap(t.update(width: w, height: h, grey: frame(103, 80), now: 300))
        XCTAssertFalse(back.lost)
        XCTAssertGreaterThan(back.score, PatternTracker.minScore)
        // Covered for longer than lostAfterMs: lost, and nothing is followed any more.
        XCTAssertFalse(try XCTUnwrap(t.update(width: w, height: h, grey: frame(103, 80, covered: true), now: 400)).lost)
        XCTAssertTrue(try XCTUnwrap(t.update(width: w, height: h, grey: frame(103, 80, covered: true), now: 800)).lost)
        XCTAssertFalse(t.active)
    }

    func testASubjectLeavingTheFrameIsLostNotSwapped() throws {
        // A smooth room the subject leaves by the left edge; once it's gone, something a bit like it (half its
        // texture) sits where it was last seen.
        let soft = smooth(texture(seed: 4, w, h), 6)
        let other = texture(seed: 5, 40, 40)
        func room(_ sx: Int, _ sy: Int) -> [UInt8] {
            (0..<(w * h)).map { i in
                let x = i % w, y = i / w
                if (0..<40).contains(x - sx) && (0..<40).contains(y - sy) { return UInt8(subject[(y - sy) * 40 + x - sx]) }
                if sx <= -40 && (0..<40).contains(x - 2) && (0..<40).contains(y - sy) {
                    let k = (y - sy) * 40 + x - 2
                    return UInt8((subject[k] * 3 + other[k] * 2) / 5)
                }
                return UInt8(soft[i])
            }
        }
        let t = PatternTracker()
        var sx = 40
        let sy = 100
        XCTAssertTrue(t.start(width: w, height: h, grey: room(sx, sy), x: Float(sx + 20) / Float(w),
                              y: Float(sy + 20) / Float(h), now: 0))
        var lost = false
        for i in 1...30 {
            sx -= 6
            let r = try XCTUnwrap(t.update(width: w, height: h, grey: room(sx, sy), now: Int64(i) * 66))
            if r.lost {
                lost = true
                break
            }
            // Followed while in view, then held near the edge: never on the background or the look-alike.
            XCTAssertLessThanOrEqual(r.x * Float(w), max(Float(sx + 20), 12) + 3, "frame \(i)")
            XCTAssertEqual(r.y, Float(sy + 20) / Float(h), accuracy: 3 / Float(h))
            XCTAssertTrue(sx > -40 || r.score < PatternTracker.minScore, "frame \(i): following the look-alike")
        }
        XCTAssertTrue(lost)
    }

    func testARepeatingPatternIsFollowedWithoutSkipping() throws {
        // A striped door: the same 16 px tile over and over (plus a little noise), panning 5 px a frame.
        let tile = texture(seed: 3, 16, 16)
        func striped(_ offset: Int, _ seed: UInt64) -> [UInt8] {
            var state = seed &* 6364136223846793005 &+ 1442695040888963407
            return (0..<(w * h)).map { i in
                state = state &* 6364136223846793005 &+ 1442695040888963407
                let x = i % w + offset, y = i / w
                let v = Float(tile[(y % 16) * 16 + ((x % 16) + 16) % 16]) * 0.8 + 25 + Float(state >> 60)
                return UInt8(min(max(Int(v), 0), 255))
            }
        }
        let t = PatternTracker()
        XCTAssertTrue(t.start(width: w, height: h, grey: striped(0, 0), x: 0.5, y: 0.5, now: 0))
        for i in 1...20 {
            let r = try XCTUnwrap(t.update(width: w, height: h, grey: striped(i * 5, UInt64(i)), now: Int64(i) * 66))
            XCTAssertFalse(r.lost)
            XCTAssertEqual(r.x, (Float(w) / 2 - Float(i * 5)) / Float(w), accuracy: 2 / Float(w))
        }
    }

    func testADifferentFrameSizeIsLost() throws {
        let t = PatternTracker()
        XCTAssertTrue(t.start(width: w, height: h, grey: frame(100, 80), x: 120 / Float(w), y: 100 / Float(h), now: 0))
        XCTAssertTrue(try XCTUnwrap(t.update(width: 160, height: 120, grey: [UInt8](repeating: 0, count: 160 * 120),
                                             now: 66)).lost)
        XCTAssertFalse(t.active)
    }
}
