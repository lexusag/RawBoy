import XCTest
@testable import RawBoyEngine

final class AutoResetTests: XCTestCase {
    private func edited() -> (Look, LookMode, Look, Float, Adjustments, Preset?) {
        var a = Adjustments.none
        a.brightness = 40; a.warmth = -20; a.tint = 5; a.contrast = 10; a.saturation = -30; a.grain = 12; a.denoise = 25
        a.rotation = 1; a.straighten = 3
        return (Looks.ektar100, .film, FilmLooks.byId("vision500t"), 35, a, Preset(id: "p", name: "Mine", groups: [], values: [:]))
    }

    private func run(_ target: AutoReset.Target) -> (Look, LookMode, Look, Float, Adjustments, Preset?) {
        var (look, mode, film, strength, adjust, preset) = edited()
        AutoReset.apply(target, look: &look, mode: &mode, filmLook: &film, strength: &strength, adjust: &adjust, preset: &preset)
        return (look, mode, film, strength, adjust, preset)
    }

    func testResetToALookClearsWhatSitsOnTopOfIt() {
        let r = run(.look(Looks.gold200))
        XCTAssertEqual(r.0.id, Looks.gold200.id)
        XCTAssertEqual(r.1, .looks)
        XCTAssertEqual(r.2.id, FilmLooks.byId("vision500t").id)  // the other mode keeps its own pick
        XCTAssertEqual(r.3, LookApplier.defaultStrength)
        XCTAssertEqual(r.4, Adjustments.none)  // brightness, warmth, tint, contrast, saturation, grain, denoise, rotation, straighten, crop
        XCTAssertNil(r.5)
    }

    func testResetToAFilmStockIsFilmMode() {
        let r = run(.film(FilmLooks.portra400))
        XCTAssertEqual(r.1, .film)
        XCTAssertEqual(r.2.id, FilmLooks.portra400.id)
        XCTAssertEqual(r.0.id, Looks.ektar100.id)
        XCTAssertEqual(r.3, LookApplier.defaultStrength)
        XCTAssertEqual(r.4, Adjustments.none)
        XCTAssertNil(r.5)
    }

    func testAsIsIsTheNaturalLookAndNothingElse() {
        let r = run(.asIs)
        XCTAssertEqual(r.0.id, Looks.natural.id)
        XCTAssertEqual(r.1, .looks)
        XCTAssertNil(LookApplier.develop(DevelopParams(), look: r.0, strength: r.3, adjust: r.4, hasFace: false, preset: r.5, lensPreset: nil).lut)  // no LUT, no stock
        XCTAssertNil(LookApplier.develop(DevelopParams(), look: r.0, strength: r.3, adjust: r.4, hasFace: false, preset: r.5, lensPreset: nil).film)
    }
}
