import XCTest
@testable import RawBoyEngine

/** Luma contrast (web's `lumaContrast`): the uniform's exponent, Auto's adjustment, presets and the sidecar. */
final class LumaContrastTests: XCTestCase {
    private func uniform(_ luma: Float) -> Float {
        var d = DevelopParams()
        d.lumaContrast = luma
        let lens = LensTransform(info: LensInfo.none(width: 100, height: 100), params: d)
        return ShaderParams.from(d, asShot: d, lut: nil, lens: lens, base: nil, bloomSources: nil, skinMask: nil).lumaContrast
    }

    /** The web's engine test: neutral 0 exponent by default and 2^0.7 - 1 at +100. */
    func testExponentIsNeutralByDefaultAndMatchesTheWeb() {
        XCTAssertEqual(uniform(0), 0)
        XCTAssertEqual(uniform(100), powf(2, 0.7) - 1, accuracy: 1e-6)
        XCTAssertEqual(uniform(-100), powf(2, -0.7) - 1, accuracy: 1e-6)
        XCTAssertEqual(uniform(50), powf(2, 0.35) - 1, accuracy: 1e-6)
    }

    func testAutoAddsItsAdjustmentInEveryPath() {
        var base = DevelopParams()
        base.lumaContrast = 10
        var adjust = Adjustments.none
        adjust.lumaContrast = 20
        XCTAssertEqual(LookApplier.applyEditsDevelop(base, adjust: adjust).lumaContrast, 30)
        XCTAssertEqual(LookApplier.applyEditsDevelop(base, adjust: .none).lumaContrast, 10)
        let looked = LookApplier.apply(base, look: Looks.natural, strength: 100, adjust: adjust, hasFace: false)
        XCTAssertEqual(looked.lumaContrast, 30)
        let preset = Presets.capture("Flat", DevelopParams(), [.light])
        XCTAssertEqual(LookApplier.applyPreset(base, preset: preset, adjust: adjust).lumaContrast, 20)
        adjust.lumaContrast = 500
        XCTAssertEqual(LookApplier.applyEditsDevelop(base, adjust: adjust).lumaContrast, 100)
    }

    func testItIsPartOfTheLightPreset() throws {
        var p = DevelopParams()
        p.lumaContrast = -35
        let preset = try XCTUnwrap(Presets.decode(Presets.encode([Presets.capture("Soft", p, [.light])])).first)
        XCTAssertEqual(Presets.apply(preset, DevelopParams()).lumaContrast, -35)
        // A Colour-only preset leaves it alone.
        let colour = Presets.capture("C", p, [.color])
        XCTAssertEqual(Presets.apply(colour, DevelopParams()).lumaContrast, 0)
    }

    func testSidecarKeepsItAsAnAdjustment() throws {
        var s = SavedAuto()
        s.adjust.lumaContrast = -12
        let text = AutoSidecar.encode(s)
        let back = try XCTUnwrap(AutoSidecar.decode(text))
        XCTAssertEqual(back.adjust.lumaContrast, -12)
        XCTAssertNil(back.webAdjust["lumaContrast"])
        // What the web wrote before this slider existed here reads the same way.
        let web = #"{"format":"rawboy-auto","adjust":{"lumaContrast":30,"retouch":10}}"#
        let d = try XCTUnwrap(AutoSidecar.decode(web))
        XCTAssertEqual(d.adjust.lumaContrast, 30)
        XCTAssertEqual(d.webAdjust, ["retouch": 10])
    }
}
