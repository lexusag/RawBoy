import XCTest
@testable import RawBoyEngine

/** Light leaks: the same cases as LightLeaksTest.kt and web's lightleaks.test.ts. */
final class LightLeaksTests: XCTestCase {
    func testPacksShownLeaksIntoImagePixelsAndSkipsHiddenOrTransparentOnes() {
        var a = LightLeaks.newLeak(.glow, cx: 0.25, cy: 0.5)
        a.rx = 0.1
        a.ry = 0.05
        a.angle = 90
        a.softness = 40
        a.glow = 50
        a.bend = 50
        a.warp = 20
        a.taper = -30
        a.intensity = 80
        a.hue = 0
        a.seed = 0.3
        var hidden = LightLeaks.newLeak()
        hidden.enabled = false
        var clear = LightLeaks.newLeak()
        clear.intensity = 0
        let u = LightLeaks.pack([hidden, a, clear], imageWidth: 4000, imageHeight: 3000)
        XCTAssertEqual(u.count, 1)
        XCTAssertEqual(u.geom[0], 1000, accuracy: 1e-3)
        XCTAssertEqual(u.geom[1], 1500, accuracy: 1e-3)
        XCTAssertEqual(u.geom[2], 1 / 400, accuracy: 1e-7)
        XCTAssertEqual(u.geom[3], 1 / 200, accuracy: 1e-7)
        XCTAssertEqual(u.shape[0], 0, accuracy: 1e-6)
        XCTAssertEqual(u.shape[1], 1, accuracy: 1e-6)
        XCTAssertEqual(u.shape[2], 0.4, accuracy: 1e-6)
        XCTAssertEqual(u.shape[3], LightLeaks.glowReach(50), accuracy: 1e-6)
        XCTAssertEqual(u.color[3], 0.8, accuracy: 1e-6)
        XCTAssertEqual(u.outer[3], 0.3, accuracy: 1e-6)
        XCTAssertEqual(u.form[0], 0)  // glow
        XCTAssertEqual(u.form[1], 0.5 / 400, accuracy: 1e-9)  // bend 50: the ends move half a length radius over 400 px
        XCTAssertEqual(u.form[2], 0.2, accuracy: 1e-6)
        XCTAssertEqual(u.form[3], -0.3, accuracy: 1e-6)
        XCTAssertEqual(LightLeaks.pack([], imageWidth: 4000, imageHeight: 3000).count, 0)
    }

    func testNumbersTheKindsAndStartsAStreakAsALongThinBeam() {
        var s = LightLeaks.newLeak()
        XCTAssertEqual(s.kind, .streak)
        XCTAssertGreaterThan(s.rx / s.ry, 5)
        XCTAssertEqual(LightLeaks.pack([s], imageWidth: 4000, imageHeight: 3000).form[0], 1)
        XCTAssertEqual(LightLeaks.pack([LightLeaks.newLeak(.triangle)], imageWidth: 4000, imageHeight: 3000).form[0], 2)
        s.bend = 30
        s.hue = 0
        let g = s.withKind(.glow)
        XCTAssertEqual(g.rx, LeakKind.glow.rx)
        XCTAssertEqual(g.glow, LeakKind.glow.glow)
        XCTAssertEqual(g.bend, 30)
        XCTAssertEqual(g.cx, 0.5)
    }

    func testMeasuresEdgesInShapeRadii() {
        XCTAssertEqual(LightLeaks.edge(.glow, qx: 0, qy: 0), -1)
        XCTAssertEqual(LightLeaks.edge(.glow, qx: 0.6, qy: 0.8), 0, accuracy: 1e-6)
        XCTAssertEqual(LightLeaks.edge(.streak, qx: 5, qy: 1), 0)
        XCTAssertEqual(LightLeaks.edge(.triangle, qx: 1, qy: 0), 0, accuracy: 1e-6)  // apex
        XCTAssertEqual(LightLeaks.edge(.triangle, qx: -1, qy: 1), 0, accuracy: 1e-6)  // base corner
        XCTAssertLessThan(LightLeaks.edge(.triangle, qx: 0, qy: 0), 0)
        XCTAssertGreaterThan(LightLeaks.edge(.triangle, qx: 0, qy: 0.6), 0)
    }

    func testMakesPhotoshopsColours() {
        let inner = LightLeaks.color(LightLeaks.hue)  // (255, 156, 0)
        XCTAssertEqual(inner[0], 1)
        XCTAssertEqual(inner[1], 156 / 255, accuracy: 0.02)
        XCTAssertEqual(inner[2], 0, accuracy: 1e-6)
        let outer = LightLeaks.outerColor(LightLeaks.hue)  // (255, 5, 5)
        XCTAssertEqual(outer[0], 1)
        XCTAssertTrue(outer[1] < 0.05 && outer[2] < 0.05)
        XCTAssertGreaterThan(LightLeaks.color(-40)[2], 0.5)  // magenta-red: some blue
    }

    func testTheOverlayShapeKeepsTheGeometry() {
        let l = LightLeaks.newLeak(cx: 0.3, cy: 0.6)
        let moved = l.withShape(.radial(cx: 0.4, cy: l.cy, rx: l.rx, ry: l.ry, angle: 10, feather: 5))
        XCTAssertEqual(moved.cx, 0.4)
        XCTAssertEqual(moved.angle, 10)
        XCTAssertEqual(moved.softness, l.softness)  // the overlay's feather ring only shows softness
    }

    func testPresetsNeverKeepLeaks() {
        XCTAssertFalse(PresetGroup.allCases.contains { $0.fields.contains("leaks") })
    }
}
