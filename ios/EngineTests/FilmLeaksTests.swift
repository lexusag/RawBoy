import XCTest
@testable import RawBoyEngine

final class FilmLeaksTests: XCTestCase {
    func testDeterministicParityWithWebGenerator() {
        let a = FilmLeaks.random(type: nil, aspect: 1.5, seed: 0.123456)
        XCTAssertEqual(a.type, .blob)
        XCTAssertEqual(a.palette, .magenta)
        XCTAssertEqual(a.turn, 0)
        XCTAssertTrue(a.mirror)
        XCTAssertEqual(a.seed, 0.64161602, accuracy: 1e-6)
        XCTAssertEqual(a.cx, 0.3313671, accuracy: 1e-5)
        XCTAssertEqual(a.cy, 0.24500187, accuracy: 1e-5)
        XCTAssertEqual(a.w, 0.7027342, accuracy: 1e-5)
        XCTAssertEqual(a.h, 0.9239125, accuracy: 1e-5)
        XCTAssertEqual(a.intensity, 68)
        XCTAssertEqual(a.softness, 31)
        XCTAssertEqual(a.texture, 79)
        XCTAssertEqual(a.amount, 45)
        XCTAssertEqual(a.variant, 11)
        XCTAssertEqual(a.warmth, 34)
        XCTAssertEqual(a.tint, 3)
        XCTAssertEqual(a.fade, 29)
        XCTAssertEqual(a.contrast, -7)

        let b = FilmLeaks.random(type: .scratches, aspect: 0.667, seed: 0.777, grade: false)
        XCTAssertEqual(b.type, .scratches)
        XCTAssertEqual(b.palette, .mono)
        XCTAssertEqual(b.turn, 1)
        XCTAssertFalse(b.mirror)
        XCTAssertEqual(b.seed, 0.50736765, accuracy: 1e-6)
        XCTAssertEqual(b.cx, 0.5, accuracy: 1e-6)
        XCTAssertEqual(b.cy, 0.5, accuracy: 1e-6)
        XCTAssertEqual(b.w, 1.0, accuracy: 1e-6)
        XCTAssertEqual(b.h, 1.0, accuracy: 1e-6)
        XCTAssertEqual(b.intensity, 75)
        XCTAssertEqual(b.softness, 71)
        XCTAssertEqual(b.texture, 71)
        XCTAssertEqual(b.amount, 79)
        XCTAssertEqual(b.variant, 80)
        XCTAssertEqual(b.warmth, 0)
        XCTAssertEqual(b.tint, 0)
        XCTAssertEqual(b.fade, 0)
        XCTAssertEqual(b.contrast, 0)

        let roll = FilmLeaks.randomRoll(aspect: 1.5, seed: 0.42)
        XCTAssertEqual(roll.count, 2)
        XCTAssertEqual(roll[0].type, .blob)
        XCTAssertEqual(roll[0].palette, .red)
        XCTAssertEqual(roll[0].turn, 3)
        XCTAssertEqual(roll[0].intensity, 72)
        XCTAssertEqual(roll[1].type, .rebate)
        XCTAssertEqual(roll[1].palette, .red)
        XCTAssertEqual(roll[1].turn, 2)
        XCTAssertEqual(roll[1].intensity, 81)
    }

    func testParsePackEditsAndPresets() throws {
        let raw: [Any] = [
            ["type": "scratches", "cx": 0.5, "cy": 0.5, "w": 1.0, "h": 1.0, "turn": -1, "palette": "cool", "intensity": 120.0],
            ["cx": 0.5],  // invalid: missing w/h
            ["type": "edge", "cx": 0.2, "cy": 0.5, "w": 0.4, "h": 1.0, "enabled": false, "intensity": 50.0],
        ]
        let parsed = FilmLeaks.parseLeaks(raw)
        XCTAssertEqual(parsed.count, 2)
        XCTAssertEqual(parsed[0].turn, 3)
        XCTAssertEqual(parsed[0].intensity, 100)
        XCTAssertEqual(parsed[0].palette, .cool)
        XCTAssertTrue(FilmLeaks.isIdentity(parsed[1]))

        let u = FilmLeaks.pack(parsed, imageWidth: 1000, imageHeight: 800)
        XCTAssertEqual(u.count, 1)
        XCTAssertEqual(u.box[0], 500, accuracy: 1e-4)
        XCTAssertEqual(u.box[1], 400, accuracy: 1e-4)
        XCTAssertEqual(u.form[0], FilmLeakType.scratches.shaderId)
        XCTAssertEqual(u.form[1], 3)

        var params = DevelopParams()
        params.filmLeaks = [parsed[0]]
        let encoded = try XCTUnwrap(Edits.encode(params, defaults: DevelopParams()))
        let decoded = try XCTUnwrap(Edits.decode(encoded, defaults: DevelopParams()))
        XCTAssertEqual(decoded.filmLeaks.count, 1)
        XCTAssertEqual(decoded.filmLeaks[0].type, .scratches)
        XCTAssertEqual(decoded.filmLeaks[0].palette, .cool)

        XCTAssertFalse(PresetGroup.defaultGroups.contains(.leaks))
        let preset = Presets.capture("LeakTest", params, [.leaks])
        let jsonStr = Presets.encode([preset])
        let loaded = try XCTUnwrap(Presets.decode(jsonStr).first)
        var target = DevelopParams()
        target = Presets.apply(loaded, target)
        XCTAssertEqual(target.filmLeaks.count, 1)
        XCTAssertNotEqual(target.filmLeaks[0].id, params.filmLeaks[0].id)
        XCTAssertEqual(target.filmLeaks[0].type, .scratches)
    }
}
