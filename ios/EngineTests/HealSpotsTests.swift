import XCTest
@testable import RawBoyEngine

/** Web's healspots.test.ts, on the Swift port. */
final class HealSpotsTests: XCTestCase {
    func testHandsTheEnginePixelPositionsARadiusOfAtLeast2PxAndMinus1ForNoSource() {
        let auto = HealSpot(x: 0.25, y: 0.5, radius: 0.01, source: nil, feather: 40)
        let chosen = HealSpot(x: 0.5, y: 0.5, radius: 0.0001, source: [0.75, 0.25], feather: 100)
        let s = HealSpots.strokes([auto, chosen], width: 4000, height: 3000)
        XCTAssertEqual(Array(s[0..<6]), [1000, 1500, 40, -1, 0, 0.4])
        XCTAssertEqual(Array(s[6..<12]), [2000, 1500, 2, 3000, 750, 1])
    }

    func testCutsAStrokeIntoDisksAThirdOfARadiusApartEachWithTheStrokeSourceOffset() {
        // 3000 x 2000: radius 0.01 = 30 px, so disks every 10 px along a 100 px drag, plus the start and the end.
        var stroke = HealSpot(x: 0.1, y: 0.5, radius: 0.01, source: [0.2, 0.6], feather: 80)
        stroke.path = [0.1 + 100 / 3000, 0.5]
        let s = HealSpots.strokes([stroke], width: 3000, height: 2000)
        XCTAssertEqual(s.count / 6, 12)
        XCTAssertEqual(s[0], 300, accuracy: 1e-2)
        XCTAssertEqual(s[6], 310, accuracy: 1e-2)
        XCTAssertEqual(s[60], 400, accuracy: 1e-2)
        XCTAssertEqual(s[66], 400, accuracy: 1e-2)
        for i in 0..<12 {
            XCTAssertEqual(s[i * 6 + 3] - s[i * 6], 300, accuracy: 1e-2)  // source = disk + (0.1, 0.1 of the photo)
            XCTAssertEqual(s[i * 6 + 4] - s[i * 6 + 1], 200, accuracy: 1e-2)
        }
    }

    func testBringsUntrustedValuesIntoRange() {
        let json: [Any] = [["x": 2, "y": -1, "radius": 5, "source": [9, 0.5], "feather": 300] as [String: Any],
                           ["x": "a"] as [String: Any], NSNull(),
                           ["x": 0.5, "y": 0.5, "radius": 0, "source": [1]] as [String: Any]]
        let parsed = HealSpots.parse(json)
        XCTAssertEqual(parsed.count, 2)
        XCTAssertEqual(parsed[0].x, 1)
        XCTAssertEqual(parsed[0].y, 0)
        XCTAssertEqual(parsed[0].radius, HealSpots.radiusMax)
        XCTAssertEqual(parsed[0].source ?? [], [1, 0.5])
        XCTAssertEqual(parsed[0].feather, 100)
        XCTAssertEqual(parsed[1].radius, HealSpots.radiusMin)
        XCTAssertNil(parsed[1].source)
        XCTAssertEqual(parsed[1].feather, 80)
        XCTAssertEqual(parsed[1].path, [])
        let many = (0..<(HealSpots.maxSpots + 9)).map { _ in ["x": 0.5, "y": 0.5, "radius": 0.01] as [String: Any] }
        XCTAssertEqual(HealSpots.parse(many).count, HealSpots.maxSpots)
        XCTAssertEqual(HealSpots.parse("nope"), [])
        XCTAssertEqual(HealSpots.parse([["x": 0.5, "y": 0.5, "radius": 0.01, "path": [0.1, 0.2, "a", 3, 0.4]] as [String: Any]])[0].path,
                       [0.1, 0.2, 0, 1])
    }

    func testIsInNoPresetGroupAndItsKeyIgnoresIdsButNotPositions() {
        var p = DevelopParams()
        p.healSpots = [HealSpot(x: 0.1, y: 0.2, radius: 0.01)]
        for g in PresetGroup.allCases { XCTAssertFalse(g.fields.contains("healSpots")) }
        XCTAssertNil(Presets.capture("x", p, Set(PresetGroup.allCases)).values["healSpots"])
        let a = HealSpot(x: 0.1, y: 0.2, radius: 0.01)
        var other = a
        other.id = "other"
        XCTAssertEqual(HealSpots.key([a]), HealSpots.key([other]))
        var moved = a
        moved.x = 0.11
        XCTAssertNotEqual(HealSpots.key([a]), HealSpots.key([moved]))
        var sourced = a
        sourced.source = [0.1, 0.2]
        XCTAssertNotEqual(HealSpots.key([a]), HealSpots.key([sourced]))
        var path = a
        path.path = [0.2, 0.2]
        XCTAssertNotEqual(HealSpots.key([a]), HealSpots.key([path]))
        XCTAssertEqual(HealSpots.key([]), "")
    }

    func testSizeSliderRoundTrips() {
        for v: Float in [0, 25, 50, 100] { XCTAssertEqual(HealSpots.sizeValue(HealSpots.sizeRadius(v)), v, accuracy: 1e-3) }
    }
}
