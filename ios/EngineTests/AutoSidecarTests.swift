import XCTest
@testable import RawBoyEngine
import enum RawBoyBrowseKit.XmpSidecar

/** Web's browse.test.ts Auto cases (`rawboy:Auto`, ui/auto/AutoSidecar.ts) on the Swift port. */
final class AutoSidecarTests: XCTestCase {
    private func saved() -> SavedAuto {
        var p = DevelopParams()
        p.contrast = 20
        p.lut = "gold"
        let preset = Presets.capture("Beach", p, [.light, .lut])
        var adjust = Adjustments.none
        adjust.brightness = 12
        adjust.contrast = -8
        adjust.rotation = 1
        return SavedAuto(mode: .film, look: Looks.natural, filmLook: FilmLooks.portra400, strength: 70, adjust: adjust,
                         preset: preset, edits: ["format": "rawboy-edit", "version": 1, "values": ["exposure": 1.3]])
    }

    func testRoundTripsAPhotosAutoSettingsPresetAndEditsIncluded() throws {
        let s = saved()
        let back = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(s)))
        XCTAssertEqual(back.mode, .film)
        XCTAssertEqual(back.look, Looks.natural)
        XCTAssertEqual(back.filmLook, FilmLooks.portra400)
        XCTAssertEqual(back.strength, 70)
        XCTAssertEqual(back.adjust, s.adjust)
        XCTAssertEqual(back.preset?.name, "Beach")
        XCTAssertEqual(back.preset?.groups, s.preset?.groups)
        XCTAssertEqual(back.preset?.values.count, s.preset?.values.count)
        XCTAssertEqual((back.edits?["values"] as? [String: Any])?["exposure"] as? Double, 1.3)
        // No preset, no edits.
        var plain = s
        plain.preset = nil
        plain.edits = nil
        let none = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(plain)))
        XCTAssertNil(none.preset)
        XCTAssertNil(none.edits)
        // As is, and its auto denoise.
        plain.plain = true
        plain.autoDenoise = true
        let asIs = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(plain)))
        XCTAssertTrue(asIs.plain)
        XCTAssertTrue(asIs.autoDenoise)
        XCTAssertNil(AutoSidecar.decode("{\"format\":\"rawboy-edit\"}"))
        XCTAssertNil(AutoSidecar.decode("not json"))
    }

    func testKeepsWebOnlyAdjustmentsAndACrop() throws {
        var s = saved()
        s.webAdjust = ["retouch": 30]
        s.adjust.lumaContrast = -5
        s.adjust.crop = CropRect(0.1, 0.2, 0.9, 0.8)
        s.adjust.straighten = 3.5
        let back = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(s)))
        XCTAssertEqual(back.webAdjust, ["retouch": 30])
        XCTAssertEqual(back.adjust.lumaContrast, -5)
        XCTAssertEqual(back.adjust.crop, CropRect(0.1, 0.2, 0.9, 0.8))
        XCTAssertEqual(back.adjust.straighten, 3.5)
        // A crop with nothing left, or the whole frame, is none; values are clamped.
        let broken = #"{"format":"rawboy-auto","adjust":{"crop":{"left":0.5,"top":0,"right":0.5,"bottom":1},"brightness":900,"rotation":9},"strength":-5,"look":"nope","mode":"x"}"#
        let d = try XCTUnwrap(AutoSidecar.decode(broken))
        XCTAssertNil(d.adjust.crop)
        XCTAssertEqual(d.adjust.brightness, 100)
        XCTAssertEqual(d.adjust.rotation, 3)
        XCTAssertEqual(d.strength, 0)
        XCTAssertEqual(d.look, Looks.natural)
        XCTAssertEqual(d.mode, .looks)
        let full = #"{"format":"rawboy-auto","adjust":{"crop":{"left":0,"top":0,"right":1,"bottom":1}}}"#
        XCTAssertNil(AutoSidecar.decode(full)?.adjust.crop)
    }

    func testKeepsAPhotosPickedLensPresetOrNone_ByLensIsntStored() throws {
        var base = SavedAuto()
        XCTAssertNil(try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(base))).lensChoice)
        XCTAssertFalse(AutoSidecar.encode(base).contains("plain"))
        XCTAssertFalse(AutoSidecar.encode(base).contains("\"lens\""))
        var p = DevelopParams()
        p.lensDistortion = -6
        p.vignetteAmount = 25
        let helios = Presets.captureLens(p, lens: "Helios 44-2")
        base.lensChoice = helios.id
        base.lensPreset = helios
        let picked = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(base)))
        XCTAssertEqual(picked.lensPreset?.name, "Helios 44-2")
        XCTAssertEqual(picked.lensPreset?.values.count, helios.values.count)
        XCTAssertEqual(picked.lensChoice, picked.lensPreset?.id)
        base.lensChoice = Presets.noLensPreset
        base.lensPreset = nil
        let none = try XCTUnwrap(AutoSidecar.decode(AutoSidecar.encode(base)))
        XCTAssertEqual(none.lensChoice, Presets.noLensPreset)
        XCTAssertNil(none.lensPreset)
    }

    func testBothRawBoyFieldsLiveSideBySideInOneSidecar() throws {
        let first = try XmpSidecar.writeDevelop(nil, #"{"a":1}"#)
        let both = try XmpSidecar.writeAuto(first, AutoSidecar.encode(saved()))
        XCTAssertEqual(XmpSidecar.readDevelop(both), #"{"a":1}"#)
        XCTAssertEqual(AutoSidecar.decode(XmpSidecar.readAuto(both) ?? "")?.strength, 70)
        // Updating one leaves the other; removing Auto leaves Develop.
        let updated = try XmpSidecar.writeAuto(both, AutoSidecar.encode(SavedAuto(strength: 40)))
        XCTAssertEqual(AutoSidecar.decode(XmpSidecar.readAuto(updated) ?? "")?.strength, 40)
        XCTAssertEqual(XmpSidecar.readDevelop(updated), #"{"a":1}"#)
        let removed = try XmpSidecar.writeAuto(updated, nil)
        XCTAssertNil(XmpSidecar.readAuto(removed))
        XCTAssertEqual(XmpSidecar.readDevelop(removed), #"{"a":1}"#)
    }
}
