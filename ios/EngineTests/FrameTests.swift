import XCTest
@testable import RawBoyEngine

/// The frame overlay's params (Frame.swift): colours, the preset group, edits and the B&W rule behind `uMonoFx`
/// (the same cases as the engine's FrameTest.kt and web's frame.test.ts).
final class FrameTests: XCTestCase {
    func testDefaultsAreOff() {
        let p = DevelopParams()
        XCTAssertEqual(p.frame, 0)
        XCTAssertEqual(p.frameColor, "#000000")
        XCTAssertFalse(p.monoFx)
    }

    func testColourParsing() {
        XCTAssertEqual(Frame.rgb("#ff0000"), [1, 0, 0])
        XCTAssertEqual(Frame.rgb("FFFFFF"), [1, 1, 1])
        XCTAssertEqual(Frame.rgb("nonsense"), [0, 0, 0])
        XCTAssertEqual(Frame.normalize(" #F1EAD8 "), "#f1ead8")
        XCTAssertNil(Frame.normalize("#12345"))
        XCTAssertNil(Frame.normalize("#gggggg"))
        XCTAssertNil(Frame.normalize(nil))
    }

    func testFrameGroupRoundTripsThroughPresetsAndEdits() throws {
        XCTAssertFalse(PresetGroup.defaultGroups.contains(.frame))
        var edited = DevelopParams()
        edited.frame = 4
        edited.frameColor = "#ffffff"
        let preset = try XCTUnwrap(Presets.decode(Presets.encode([Presets.capture("Border", edited, [.frame])])).first)
        let applied = Presets.apply(preset, DevelopParams())
        XCTAssertEqual(applied.frame, 4)
        XCTAssertEqual(applied.frameColor, "#ffffff")
        XCTAssertEqual(Presets.set(DevelopParams(), "frame", .number(99)).frame, 20)
        XCTAssertEqual(Presets.set(DevelopParams(), "frameColor", .text("red")).frameColor, "#000000")

        let defaults = DevelopParams()
        edited.frame = 6.5
        edited.frameColor = "#808080"
        let back = try XCTUnwrap(Edits.decode(try XCTUnwrap(Edits.encode(edited, defaults: defaults)), defaults: defaults))
        XCTAssertEqual(back.frame, 6.5)
        XCTAssertEqual(back.frameColor, "#808080")
        XCTAssertNil(Edits.encode(defaults, defaults: defaults))
    }

    func testMonoRuleIsTheExplicitFlagOrAFullStrengthMonoLut() {
        let mono = "asset:luts/Yellow Mono 400.cube"
        var p = DevelopParams()
        XCTAssertFalse(ShaderParams.isMono(p))
        p.monoFx = true
        XCTAssertTrue(ShaderParams.isMono(p))
        p = DevelopParams()
        p.lut = mono
        XCTAssertTrue(ShaderParams.isMono(p))
        p.lutAmount = 60
        XCTAssertFalse(ShaderParams.isMono(p))
        p.lutAmount = 100
        p.film = "portra400"
        XCTAssertFalse(ShaderParams.isMono(p))
        p = DevelopParams()
        p.lut = "asset:luts/Movie Green.cube"
        XCTAssertFalse(ShaderParams.isMono(p))
    }

    // MARK: Metal render (the shared GLSL through gen.sh): the border draws, keeps the size and goes grey with monoFx

    private func render(_ params: DevelopParams, size: (Int, Int) = (200, 100)) throws -> [UInt16] {
        let (w, h) = size
        var px = [UInt16](repeating: 0, count: w * h * 3)
        for i in 0..<(w * h) {
            px[i * 3] = Float16(0.05).bitPattern
            px[i * 3 + 1] = Float16(0.03).bitPattern
            px[i * 3 + 2] = Float16(0.02).bitPattern
        }
        let img = PreviewImage(width: w, height: h, pixels: px, fullWidth: w, fullHeight: h)
        let info = LensInfo(lensName: "", width: w, height: h, sensorWidth: w, sensorHeight: h,
                            orientation: 1, warp: nil, vignette: nil, shading: nil, gainMapsApplied: 0)
        let sp = ShaderParams.from(params, asShot: DevelopParams(), lut: nil, lens: LensTransform(info: info, params: params, knownZoom: 1),
                                   base: nil, bloomSources: nil, skinMask: nil)
        var out = [UInt16](repeating: 0, count: w * h * 4)
        try out.withUnsafeMutableBufferPointer {
            try OffscreenDeveloper(imageWidth: w, imageHeight: h).renderPreview(sp, preview: img, width: w, height: h, output: $0.baseAddress!)
        }
        return out
    }

    func testBorderDrawsInsideTheOutputAndGoesGreyWithMonoFx() throws {
        let (w, h) = (200, 100)
        func px(_ o: [UInt16], _ x: Int, _ y: Int) -> [Int] { (0..<3).map { Int(o[(y * w + x) * 4 + $0]) } }
        var p = DevelopParams()
        let plain = try render(p)
        // Default = off: no pixel is touched by the border code.
        p.frame = 10  // % of the 100 px short side = 10 px
        p.frameColor = "#ff0000"
        let framed = try render(p)
        XCTAssertEqual(framed.count, plain.count)  // same output size
        XCTAssertEqual(px(framed, 4, 50), [65535, 0, 0])      // left border
        XCTAssertEqual(px(framed, 100, 3), [65535, 0, 0])     // top border
        XCTAssertEqual(px(framed, 100, 96), [65535, 0, 0])    // bottom border
        XCTAssertEqual(px(framed, 195, 50), [65535, 0, 0])    // right border
        XCTAssertEqual(px(framed, 100, 50), px(plain, 100, 50))  // inside untouched
        XCTAssertEqual(px(framed, 14, 50), px(plain, 14, 50))    // just past the 10 px
        // B&W: the red border goes to grey with the rest of the picture.
        p.monoFx = true
        let grey = try render(p)
        let b = px(grey, 4, 50)
        XCTAssertEqual(b[0], b[1], accuracy: 2)
        XCTAssertEqual(b[1], b[2], accuracy: 2)
        XCTAssertEqual(b[0], Int(0.2126 * 65535), accuracy: 400)
    }
}
