import XCTest
@testable import RawBoyEngine

/** Edits JSON: round trips, and the JSON the web's Edits.ts writes (EditsFixtures, from tools/edits_fixtures). */
final class EditsTests: XCTestCase {
    private var defaults: DevelopParams {
        var p = DevelopParams()
        p.temperature = 5200
        p.tint = 4
        return p
    }

    private func decode(_ json: String?) throws -> Edits.Decoded {
        try XCTUnwrap(Edits.decodeAll(try XCTUnwrap(json), defaults: defaults))
    }

    func testUntouchedHasNothingToKeep() {
        XCTAssertNil(EditsFixtures.untouched)
        XCTAssertNil(Edits.encode(defaults, defaults: defaults))
        XCTAssertNotNil(Edits.encode(defaults, defaults: defaults, keepEmpty: true))
    }

    func testRejectsOtherJson() {
        XCTAssertNil(Edits.decode("not json", defaults: defaults))
        XCTAssertNil(Edits.decode(#"{"format":"rawboy-preset","values":{}}"#, defaults: defaults))
        XCTAssertEqual(Edits.decode(#"{"format":"rawboy-edit","version":1}"#, defaults: defaults), defaults)
    }

    func testWebBasicSliders() throws {
        let p = try decode(EditsFixtures.basic).params
        XCTAssertEqual(p.exposure, 0.7, accuracy: 1e-6)
        XCTAssertEqual(p.contrast, -12)
        XCTAssertEqual(p.saturation, 15)
        XCTAssertEqual(p.temperature, 6100)
        XCTAssertEqual(p.tint, -3)
        XCTAssertEqual(p.toneMapper, .filmic)
        XCTAssertEqual(p.denoise, 20)
        XCTAssertEqual(p.sharpening, 33.3, accuracy: 1e-5)
        XCTAssertEqual(p.shadows, defaults.shadows)  // not in the file: the default
    }

    func testWebGeometry() throws {
        let p = try decode(EditsFixtures.geometry).params
        XCTAssertEqual(p.rotation, 3)
        XCTAssertTrue(p.flipHorizontal)
        XCTAssertFalse(p.flipVertical)
        XCTAssertEqual(p.straighten, -4.5)
        XCTAssertEqual(p.perspectiveVertical, 12)
        XCTAssertEqual(p.perspectiveHorizontal, -7)
        XCTAssertEqual(p.scale, 110)
        XCTAssertEqual([p.cropLeft, p.cropTop, p.cropRight, p.cropBottom], [0.1, 0.05, 0.9, 0.8])
    }

    func testWebLooksCurvesAndFlags() throws {
        let p = try decode(EditsFixtures.looks).params
        XCTAssertEqual(p.lut, "portra400")
        XCTAssertEqual(p.lutAmount, 60)
        XCTAssertEqual(p.colorDenoise, 35)
        XCTAssertFalse(p.lensProfile)
        XCTAssertTrue(p.anamorphicGhosts)
        XCTAssertEqual(p.anamorphicColor, .magenta)
        XCTAssertNotEqual(p.curves, ToneCurves.none)
        let film = try decode(EditsFixtures.film).params
        XCTAssertEqual(film.film, "kodachrome64")
        XCTAssertEqual(film.filmAmount, 80)
        XCTAssertEqual(film.halation, 150)
    }

    func testWebMasksKeepStrokesAndLensBlur() throws {
        let m = try decode(EditsFixtures.masks).params.masks
        XCTAssertEqual(m.count, 3)
        XCTAssertTrue(m[0].shape.isBrush)
        XCTAssertEqual(m[0].name, "Sky")
        XCTAssertEqual(m[0].adjust.exposure, -0.5)
        XCTAssertEqual(m[0].adjust.lensBlur, 30)
        XCTAssertEqual(m[0].adjust.retouch, 20)
        XCTAssertEqual(m[0].strokes.count, 2)
        XCTAssertTrue(m[0].strokes[0].auto)
        XCTAssertFalse(m[0].strokes[0].erase)
        XCTAssertEqual(m[0].strokes[0].points.count, 6)
        XCTAssertEqual(m[0].strokes[0].points[0], 0.12346, accuracy: 1e-6)  // the web rounds to 1e-5
        XCTAssertTrue(m[0].strokes[1].erase)
        XCTAssertEqual(m[1].opacity, 80)
        XCTAssertTrue(m[1].invert)
        XCTAssertEqual(m[1].adjust.shadows, 25)
        XCTAssertFalse(m[2].enabled)
    }

    func testWebLeaksAndEffects() throws {
        let p = try decode(EditsFixtures.leaksFx).params
        XCTAssertEqual(p.leaks.count, 2)
        XCTAssertEqual(p.leaks[0].kind, .glow)
        XCTAssertEqual(p.leaks[0].texture, 40)
        XCTAssertEqual(p.leaks[0].cover, 25)
        XCTAssertEqual(p.leaks[0].bend, -30)
        XCTAssertEqual(p.leaks[0].radii, [1, 1.2, 1, 0.8, 1, 1.1, 1, 0.9])
        XCTAssertEqual(p.leaks[1].kind, .streak)
        XCTAssertEqual(p.fx.count, 1)
        XCTAssertEqual(p.fx[0].kind, .sparks)
        XCTAssertEqual(p.fx[0].seed, 0.123456789)  // a Double: a Float would pick another pattern
    }

    func testHealingBrushStrokesDecodeAndWriteBack() throws {
        let d = try decode(EditsFixtures.heal)
        XCTAssertTrue(d.extras.isEmpty)
        XCTAssertEqual(d.params.healSpots.count, 2)
        let a = d.params.healSpots[0]
        XCTAssertEqual(a.x, 0.4, accuracy: 1e-6)
        XCTAssertEqual(a.source ?? [], [0.6, 0.5])
        XCTAssertEqual(a.feather, 25)
        XCTAssertEqual(a.path, [0.4, 0.5, 0.41, 0.52])
        XCTAssertNil(d.params.healSpots[1].source)
        XCTAssertEqual(d.params.healSpots[1].feather, 80)
        // Written back, it reads the same.
        let text = try XCTUnwrap(Edits.encode(d.params, defaults: defaults))
        XCTAssertEqual(stripIds(try decode(text).params), stripIds(d.params))
        XCTAssertNil(Edits.encode(defaults, defaults: defaults))
    }

    func testPortraitRetouchIsAKnownField() throws {
        let d = try decode(EditsFixtures.portrait)
        XCTAssertTrue(d.extras.isEmpty)
        XCTAssertEqual(d.params.portraitRetouch, 35)
        XCTAssertEqual(d.params.skinRetouch, 20)
        let text = try XCTUnwrap(Edits.encode(d.params, defaults: defaults))
        XCTAssertEqual(try decode(text).params.portraitRetouch, 35)
    }

    func testWebOnlyFieldsSurviveASwiftRoundTrip() throws {
        let d = try decode(EditsFixtures.webOnly)
        XCTAssertEqual(d.params.exposure, 0.3, accuracy: 1e-6)
        XCTAssertEqual(Set(d.extras.keys), ["lumaContrast"])
        let again = try XCTUnwrap(Edits.encode(d.params, defaults: defaults, extras: d.extras))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(again.utf8)) as? [String: Any])
        let values = try XCTUnwrap(object["values"] as? [String: Any])
        XCTAssertEqual(values["lumaContrast"] as? Int, 12)
        XCTAssertNil(Edits.encode(defaults, defaults: defaults, extras: [:]))
    }

    /** Whatever the web wrote decodes, and encoding that gives the same decode (idempotent through Swift). */
    func testFixturesRoundTripThroughSwift() throws {
        for json in [EditsFixtures.basic, EditsFixtures.geometry, EditsFixtures.looks, EditsFixtures.film,
                     EditsFixtures.masks, EditsFixtures.leaksFx, EditsFixtures.heal, EditsFixtures.portrait, EditsFixtures.webOnly] {
            let a = try decode(json)
            let text = try XCTUnwrap(Edits.encode(a.params, defaults: defaults, extras: a.extras))
            let b = try XCTUnwrap(Edits.decodeAll(text, defaults: defaults))
            XCTAssertEqual(stripIds(a.params), stripIds(b.params), text)
            XCTAssertEqual(Set(a.extras.keys), Set(b.extras.keys))
            // Written twice, byte for byte the same.
            XCTAssertEqual(text, Edits.encode(b.params, defaults: defaults, extras: b.extras))
        }
    }

    func testSwiftEncodeWritesOnlyChangesAndWebKeys() throws {
        var p = defaults
        p.exposure = 1.5
        p.rotation = 1
        p.cropRight = 0.75
        p.film = "portra400"
        p.masks = [Masks.newBrush(name: "Paint")]
        p.masks[0].strokes = [BrushStroke(id: "x", erase: false, auto: false, radius: 0.05, hardness: 50, flow: 100,
                                          points: [0.1, 0.2, 0.3, 0.4])]
        let text = try XCTUnwrap(Edits.encode(p, defaults: defaults))
        let values = try XCTUnwrap((JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])?["values"] as? [String: Any])
        XCTAssertEqual(Set(values.keys), ["exposure", "rotation", "cropRight", "film", "masks"])
        XCTAssertEqual(values["exposure"] as? Double, 1.5)
        let layer = try XCTUnwrap((values["masks"] as? [[String: Any]])?.first)
        XCTAssertNil(layer["id"])  // as the web's Edits.ts: no layer ids
        XCTAssertEqual((layer["strokes"] as? [[String: Any]])?.first?["points"] as? [Double], [0.1, 0.2, 0.3, 0.4])
        XCTAssertEqual(Edits.decode(text, defaults: defaults)?.masks.first?.strokes.count, 1)
    }

    func testInvalidValuesAreSkipped() {
        let text = #"{"format":"rawboy-edit","version":1,"values":{"exposure":"loud","contrast":12,"cropLeft":0.9,"cropRight":0.2,"rotation":-1,"scale":999,"masks":[{"nope":1}]}}"#
        let p = Edits.decode(text, defaults: defaults)
        XCTAssertEqual(p?.exposure, 0)
        XCTAssertEqual(p?.contrast, 12)
        XCTAssertEqual(p?.cropLeft, 0)   // inverted crop is dropped
        XCTAssertEqual(p?.cropRight, 1)
        XCTAssertEqual(p?.rotation, 3)
        XCTAssertEqual(p?.scale, 200)
        XCTAssertEqual(p?.masks.count, 0)
    }

    private func stripIds(_ p: DevelopParams) -> DevelopParams {
        var p = p
        p.masks = p.masks.map { var l = $0; l.id = ""; l.strokes = l.strokes.map { var s = $0; s.id = ""; return s }; return l }
        p.leaks = p.leaks.map { var l = $0; l.id = ""; return l }
        p.fx = p.fx.map { var l = $0; l.id = ""; return l }
        p.healSpots = p.healSpots.map { var l = $0; l.id = ""; return l }
        return p
    }
}
