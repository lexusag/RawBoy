import XCTest
@testable import RawBoyEngine

/** Stripe mask layers: the same case as MasksTest.kt's packsAStripeLikeALeakStreak. */
final class StripeMaskTests: XCTestCase {
    func testPacksAStripeLikeALeakStreak() throws {
        var bent = Masks.newStripe()
        bent.adjust = LayerAdjust(exposure: 1)
        bent.shape = .stripe(cx: 0.5, cy: 0.5, rx: 0.55, ry: 0.08, angle: 90, feather: 20, bend: 50, taper: -40)
        let u = ShaderParams.packLayers([bent], imageWidth: 4000, imageHeight: 3000, kelvin: 5500, tint: 0, clarityReady: true)
        let expectGeom: [Float] = [2000, 1500, 1 / 2200, 1 / 320]
        for i in 0..<4 { XCTAssertEqual(u.geom[i], expectGeom[i], accuracy: 1e-6) }
        XCTAssertEqual(u.shape[0], 3)
        XCTAssertEqual(u.shape[1], 0, accuracy: 1e-6)
        XCTAssertEqual(u.shape[2], 1, accuracy: 1e-6)
        XCTAssertEqual(u.shape[3], 0.2, accuracy: 1e-6)
        // bend 50 over a 2200 px half length; the ends fade over the sides' 64 px
        let expectForm: [Float] = [0.5 / 2200, -0.4, 64 / 2200, 0]
        for i in 0..<4 { XCTAssertEqual(u.form[i], expectForm[i], accuracy: 1e-7) }
        // Through a preset and the web's JSON; older or partial stripes come back straight and even.
        var params = DevelopParams()
        params.masks = [bent]
        let p = Presets.capture("S", params, [.masks])
        let decoded = try XCTUnwrap(Presets.decode(Presets.encode([p])).first)
        XCTAssertEqual(Presets.apply(decoded, DevelopParams()).masks.first?.shape, bent.shape)
        let json = try JSONSerialization.jsonObject(with: Data(
            #"[{"shape":{"kind":"stripe","cx":0.5,"cy":0.5,"rx":0.5,"ry":0.05,"angle":0,"feather":50}}]"#.utf8))
        let plain = try XCTUnwrap(Masks.parseLayers(json).first)
        XCTAssertEqual(plain.shape, .stripe(cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.05, angle: 0, feather: 50))
        XCTAssertEqual(plain.name, "Stripe")
    }
}
