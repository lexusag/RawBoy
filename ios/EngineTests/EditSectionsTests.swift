import XCTest

@testable import RawBoyEngine

final class EditSectionsTests: XCTestCase {
    func testSwitchedOffSectionRendersDefaultsAndKeepsValues() {
        let defaults = DevelopParams()
        var p = defaults
        p.exposure = 1.5
        p.saturation = 30
        p.disabledSections = [EditSection.light.rawValue]
        let eff = EditSections.effective(p, defaults: defaults)
        XCTAssertEqual(eff.exposure, 0)
        XCTAssertEqual(eff.saturation, 30, "only the switched-off section changes")
        XCTAssertEqual(p.exposure, 1.5, "the values stay in the edit")
    }

    func testNothingOffIsIdentity() {
        var p = DevelopParams()
        p.contrast = 10
        XCTAssertEqual(EditSections.effective(p, defaults: DevelopParams()), p)
    }

    func testLutSectionDropsTheLutAndWhiteBalanceGoesBackToAsShot() {
        var defaults = DevelopParams()
        defaults.temperature = 4800
        var p = defaults
        p.lut = "x"
        p.temperature = 6500
        p.disabledSections = [EditSection.lut.rawValue, EditSection.colour.rawValue]
        let eff = EditSections.effective(p, defaults: defaults)
        XCTAssertNil(eff.lut)
        XCTAssertEqual(eff.temperature, 4800)
    }

    func testDisabledSectionsRoundTripThroughEdits() throws {
        let defaults = DevelopParams()
        var p = defaults
        p.exposure = 1
        p.disabledSections = ["light", "lens"]
        let json = try XCTUnwrap(Edits.encode(p, defaults: defaults))
        XCTAssertEqual(Edits.decode(json, defaults: defaults)?.disabledSections, ["light", "lens"])
        XCTAssertNil(Edits.encode(defaults, defaults: defaults), "no sections off writes nothing")
    }
}
