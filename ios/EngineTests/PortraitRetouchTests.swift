import XCTest
@testable import RawBoyEngine

/** Web's portraitretouch.test.ts, on the Swift port. */
final class PortraitRetouchTests: XCTestCase {
    private let W = 400, H = 400
    private let face: Float = 300  // face width in pixels: landmarks spread over it

    /** Even skin-coloured image (linear Rec.2020) with [spots]: (x, y, radius, brightness factor). */
    private func image(_ spots: [(Float, Float, Float, Float)]) -> PreviewImage {
        var pixels = [UInt16](repeating: 0, count: W * H * 3)
        for y in 0..<H {
            for x in 0..<W {
                var f: Float = 1
                for (sx, sy, r, k) in spots where (Float(x) - sx) * (Float(x) - sx) + (Float(y) - sy) * (Float(y) - sy) <= r * r { f = k }
                let i = (y * W + x) * 3
                pixels[i] = Float16(0.3 * f).bitPattern
                pixels[i + 1] = Float16(0.2 * f).bitPattern
                pixels[i + 2] = Float16(0.15 * f).bitPattern
            }
        }
        return PreviewImage(width: W, height: H, pixels: pixels, fullWidth: W, fullHeight: H)
    }

    /** Skin everywhere, one face whose 478 landmarks spread over `face` pixels (only their extent matters here). */
    private func skin(hasSkin: Bool = true) -> SkinMask {
        var mesh = [Float](repeating: 0, count: 478 * 2)
        for i in 0..<478 {
            mesh[i * 2] = (50 + face * Float(i) / 477) / Float(W)
            mesh[i * 2 + 1] = 0.05  // regions (under-eyes, lines) up at the top edge, away from the spots
        }
        let data = [Float](repeating: 1, count: 100 * 100)
        return SkinMask(width: 100, height: 100, data: data, sigmaPx: 4, hasSkin: hasSkin, faceDiameterPx: face, face: data,
                        faces: [FaceShape(mesh: mesh)!])
    }

    private func gain(_ m: RetouchMap, _ x: Int, _ y: Int) -> Float { m.data[(y * m.width + x) * 4 + 2] }

    func testHealsASmallDarkSpotAndLeavesEvenSkinAlone() throws {
        let map = try XCTUnwrap(PortraitRetouch.buildMap(image([(200, 250, 2, 0.6)]), skin(), strength: 40))
        XCTAssertEqual(map.width, W)
        XCTAssertGreaterThan(gain(map, 200, 250), 0.2)  // lifted toward the surrounding skin (0.74 EV down)
        XCTAssertLessThan(abs(gain(map, 100, 300)), 0.01)
        XCTAssertEqual(map.data[(300 * W + 100) * 4], 1, accuracy: 1e-3)  // the skin mask rides along in r
    }

    func testKeepsMolesVeryDarkAndSharp() throws {
        let map = try XCTUnwrap(PortraitRetouch.buildMap(image([(200, 250, 3, 0.2)]), skin(), strength: 40))
        XCTAssertLessThan(gain(map, 200, 250), 0.1)
    }

    func testHealsMoreAtHigherStrength() throws {
        let img = image([(200, 250, 2, 0.75)])
        let strong = try XCTUnwrap(PortraitRetouch.buildMap(img, skin(), strength: 80))
        let weak = try XCTUnwrap(PortraitRetouch.buildMap(img, skin(), strength: 20))
        XCTAssertGreaterThan(gain(strong, 200, 250), gain(weak, 200, 250))
    }

    func testIsOffWithoutStrengthOrSkin() {
        XCTAssertNil(PortraitRetouch.buildMap(image([]), skin(), strength: 0))
        XCTAssertNil(PortraitRetouch.buildMap(image([]), skin(hasSkin: false), strength: 40))
        XCTAssertEqual(PortraitRetouch.skinFix(strength: 0, map: nil), 0)
        let m = RetouchMap(width: 1, height: 1, data: [0, 0, 0, 0], strength: 40)
        XCTAssertEqual(PortraitRetouch.skinFix(strength: 60, map: m), 1.5, accuracy: 1e-6)
    }

    func testHelpersAgreeWithTheirDefinitions() {
        let (r, g, b) = PortraitRetouch.fromLab(PortraitRetouch.toLab(0.3, 0.2, 0.15).0, PortraitRetouch.toLab(0.3, 0.2, 0.15).1,
                                                PortraitRetouch.toLab(0.3, 0.2, 0.15).2)
        XCTAssertEqual(r, 0.3, accuracy: 1e-4)
        XCTAssertEqual(g, 0.2, accuracy: 1e-4)
        XCTAssertEqual(b, 0.15, accuracy: 1e-4)
        var impulse = [Float](repeating: 0, count: 61 * 61)
        impulse[30 * 61 + 30] = 1
        for s: Float in [1.5, 6] {
            let g2 = PortraitRetouch.gauss(impulse, 61, 61, s)
            XCTAssertEqual(g2.reduce(0, +), 1, accuracy: 1e-4)
            // Variance along x matches sigma² within the box approximation.
            var v: Float = 0
            for y in 0..<61 { for x in 0..<61 { v += g2[y * 61 + x] * Float((x - 30) * (x - 30)) } }
            XCTAssertEqual(v.squareRoot(), s, accuracy: 0.5)
        }
        var bin = [Float](repeating: 1, count: 81)
        bin[4 * 9 + 4] = 0
        let er = PortraitRetouch.minFilter(bin, 9, 9, 1)
        XCTAssertEqual(er[3 * 9 + 3], 0)
        XCTAssertEqual(er[2 * 9 + 2], 1)
    }

    func testMeshAnchorsFollowTheMediaPipeIndices() throws {
        var mesh = [Float](repeating: 0, count: 478 * 2)
        for i in 0..<478 { (mesh[i * 2], mesh[i * 2 + 1]) = (Float(i) / 1000, Float(i) / 2000) }
        let f = try XCTUnwrap(FaceShape(mesh: mesh))
        XCTAssertEqual(f.lowerLidRight[0].x, 0.033, accuracy: 1e-6)
        XCTAssertEqual(f.lowerLidLeft[8].x, 0.362, accuracy: 1e-6)
        XCTAssertEqual(f.glabella.x, (0.009 + 0.008) / 2, accuracy: 1e-6)
        XCTAssertEqual(f.marionetteRight.x, 0.057 + (0.152 - 0.057) * 0.35, accuracy: 1e-5)
        XCTAssertEqual(f.width, 0.477, accuracy: 1e-5)
        XCTAssertNil(FaceShape(mesh: [0, 0]))
    }
}
