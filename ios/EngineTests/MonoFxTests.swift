import XCTest
@testable import RawBoyEngine

/// The B&W rule behind `uMonoFx` (the same cases as the engine's MonoFxTest.kt and web's monofx.test.ts), and a Metal
/// render: a red leak-coloured pixel goes grey with the flag.
final class MonoFxTests: XCTestCase {
    func testMonoRuleIsTheExplicitFlagOrAFullStrengthMonoLut() {
        let mono = "asset:luts/Yellow Mono 400.cube"
        var p = DevelopParams()
        XCTAssertFalse(p.monoFx)
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

    private func render(_ params: DevelopParams) throws -> [Int] {
        let (w, h) = (64, 64)
        var px = [UInt16](repeating: 0, count: w * h * 3)
        for i in 0..<(w * h) {  // a warm, saturated flat picture
            px[i * 3] = Float16(0.4).bitPattern
            px[i * 3 + 1] = Float16(0.05).bitPattern
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
        let i = (32 * w + 32) * 4
        return (0..<3).map { Int(out[i + $0]) }
    }

    func testMonoFxGreysTheFinishedPicture() throws {
        var p = DevelopParams()
        let colour = try render(p)
        XCTAssertGreaterThan(colour[0] - colour[2], 5000)  // coloured
        p.monoFx = true
        let grey = try render(p)
        XCTAssertEqual(grey[0], grey[1], accuracy: 2)
        XCTAssertEqual(grey[1], grey[2], accuracy: 2)
    }
}
