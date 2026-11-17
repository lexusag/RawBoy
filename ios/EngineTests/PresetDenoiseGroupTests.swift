import XCTest
@testable import RawBoyEngine

/** The Denoise & sharpening preset group: the same cases as web's engine.test.ts and PresetsTest.kt. */
final class PresetDenoiseGroupTests: XCTestCase {
    private func params(_ change: (inout DevelopParams) -> Void) -> DevelopParams {
        var p = DevelopParams()
        change(&p)
        return p
    }

    private func roundTrip(_ preset: Preset) throws -> Preset {
        try XCTUnwrap(Presets.decode(Presets.encode([preset])).first)
    }

    func testTheGroupCarriesBothDenoisesAndSharpening() throws {
        let split = params { $0.denoise = 30; $0.colorDenoise = 60; $0.sharpening = 7 }
        let preset = try roundTrip(Presets.capture("Split", split, [.denoise]))
        let applied = Presets.apply(preset, params { $0.colorDenoise = 5 })
        XCTAssertEqual(applied.denoise, 30)
        XCTAssertEqual(applied.colorDenoise, 60)
        XCTAssertEqual(applied.sharpening, 7)
        // Detail alone leaves them.
        let detail = try roundTrip(Presets.capture("Grain", params { $0.denoise = 30; $0.grain = 40 }, [.detail]))
        XCTAssertEqual(detail.groups, [.detail])
        let kept = Presets.apply(detail, params { $0.denoise = 5 })
        XCTAssertEqual(kept.denoise, 5)
        XCTAssertEqual(kept.grain, 40)
    }

    func testPresetsFromBeforeTheGroupKeepDenoiseOnlyWithoutLight() throws {
        let detail = try XCTUnwrap(Presets.decode(
            #"{"format":"rawboy-preset","version":1,"name":"D","groups":["detail"],"values":{"denoise":40,"colorDenoise":80,"sharpening":9,"grain":20}}"#
        ).first)
        XCTAssertEqual(detail.groups, [.detail, .denoise])
        let a = Presets.apply(detail, DevelopParams())
        XCTAssertEqual(a.denoise, 40)
        XCTAssertEqual(a.colorDenoise, 80)
        XCTAssertEqual(a.sharpening, 9)
        XCTAssertEqual(a.grain, 20)
        let scene = try XCTUnwrap(Presets.decode(
            #"{"format":"rawboy-preset","version":1,"name":"S","groups":["light","detail"],"values":{"contrast":10,"denoise":40,"grain":20}}"#
        ).first)
        XCTAssertEqual(scene.groups, [.light, .detail])
        let b = Presets.apply(scene, params { $0.denoise = 5 })
        XCTAssertEqual(b.contrast, 10)
        XCTAssertEqual(b.denoise, 5)
        XCTAssertEqual(b.grain, 20)
    }

    func testPresetsFromBeforeTheSplitSetBothFromTheOneDenoise() throws {
        let old = try XCTUnwrap(Presets.decode(
            #"{"format":"rawboy-preset","version":1,"name":"Old","groups":["detail"],"values":{"denoise":40}}"#
        ).first)
        let applied = Presets.apply(old, params { $0.colorDenoise = 10 })
        XCTAssertEqual(applied.denoise, 40)
        XCTAssertNil(applied.colorDenoise)
    }

    func testWithoutDenoiseDropsOnlyThatGroup() throws {
        let p = Presets.capture("Night", params { $0.denoise = 50; $0.grain = 30 }, [.detail, .denoise])
        let stripped = try XCTUnwrap(Presets.withoutDenoise(p))
        XCTAssertEqual(stripped.groups, [.detail])
        XCTAssertEqual(stripped.id, p.id)
        XCTAssertNil(stripped.values["denoise"])
        let applied = Presets.apply(stripped, params { $0.denoise = 5 })
        XCTAssertEqual(applied.grain, 30)
        XCTAssertEqual(applied.denoise, 5)
        XCTAssertNil(Presets.withoutDenoise(Presets.capture("Only", DevelopParams(), [.denoise])))
        let plain = Presets.capture("Grain", DevelopParams(), [.detail])
        XCTAssertEqual(Presets.withoutDenoise(plain), plain)
    }

    func testTheSaveDialogLeavesItUnticked() {
        XCTAssertFalse(PresetGroup.defaultGroups.contains(.denoise))
        XCTAssertEqual(PresetGroup.denoise.key, "denoise")
    }

    func testAutoKeepsItsMeasuredNoiseUnlessThePresetHoldsTheGroup() {
        let edited = params { $0.denoise = 5; $0.colorDenoise = 8; $0.sharpening = 40; $0.localContrast = 30 }
        let base = params { $0.denoise = 60; $0.colorDenoise = 75; $0.sharpening = 6 }
        let night = LookApplier.applyPreset(base, preset: Presets.capture("Night", edited, [.detail]), adjust: .none)
        XCTAssertEqual(night.denoise, 60)
        XCTAssertEqual(night.colorDenoise, 75)
        XCTAssertEqual(night.sharpening, 6)
        XCTAssertEqual(night.localContrast, 30)
        let clean = LookApplier.applyPreset(base, preset: Presets.capture("Clean", edited, [.denoise]), adjust: .none)
        XCTAssertEqual(clean.denoise, 5)
        XCTAssertEqual(clean.colorDenoise, 8)
        XCTAssertEqual(clean.sharpening, 40)
    }
}
