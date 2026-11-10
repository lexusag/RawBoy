import XCTest
@testable import RawBoyEngine

/** Light effects: the same cases as LightEffectsTest.kt (patterns printed by web's generateFx for the same seeds). */
final class LightEffectsTests: XCTestCase {
    private struct Fixture {
        let kind: FxKind
        let seed: Double
        let amount: Int
        let count: Int
        let sum: Double
        let mid: [Double]
    }

    private let fixtures = [
        Fixture(kind: .lightning, seed: 0.123456789, amount: 50, count: 1216, sum: 10886.784548, mid: [0.153890, 0.818387, 0.152923, 0.818436, 0.001027, 0.259327, 0.071573]),
        Fixture(kind: .lightning, seed: 0.987654321, amount: 100, count: 1184, sum: 7214.455287, mid: [-0.229461, 0.672842, -0.233325, 0.680763, 0.000902, 0.201966, -0.187595]),
        Fixture(kind: .sparks, seed: 0.123456789, amount: 50, count: 605, sum: 4382.312778, mid: [-0.256598, -0.156621, -0.256598, -0.156621, 0.002524, 0.516785, 0.016944]),
        Fixture(kind: .sparks, seed: 0.987654321, amount: 100, count: 970, sum: 7490.978020, mid: [-0.044105, -0.074243, -0.044105, -0.074243, 0.002505, 0.576007, 0.286204]),
        Fixture(kind: .trails, seed: 0.123456789, amount: 50, count: 640, sum: 3667.019914, mid: [0.012969, -0.002565, 0.025738, -0.006254, 0.004946, 0.535224, 0.103361]),
        Fixture(kind: .trails, seed: 0.987654321, amount: 100, count: 1024, sum: 7175.851702, mid: [-0.889021, 0.006033, -0.875036, 0.009390, 0.005800, 0.011021, 0.272486]),
        Fixture(kind: .swirl, seed: 0.123456789, amount: 50, count: 960, sum: 7088.557648, mid: [-0.272729, -0.272823, -0.289430, -0.264122, 0.005650, 0.761837, -0.783217]),
        Fixture(kind: .swirl, seed: 0.987654321, amount: 100, count: 1278, sum: 29238.808171, mid: [-0.188635, 0.080000, -0.189565, 0.092034, 0.005807, 0.018966, 1.227260]),
    ]

    func testGeneratesTheSamePatternsAsTheWeb() {
        for f in fixtures {
            let s = LightEffects.generate(f.kind, seed: f.seed, amount: f.amount)
            XCTAssertEqual(s.count, f.count, "\(f.kind) count")
            let sum = s.reduce(0.0) { $0 + $1.x0 + 2 * $1.y0 + 3 * $1.x1 + 5 * $1.y1 + 7 * $1.w0 + 11 * $1.w1 + 13 * $1.b + 17 * $1.h }
            XCTAssertEqual(sum, f.sum, accuracy: 2e-6, "\(f.kind) checksum")
            let g = s[s.count / 2]
            let mid = [g.x0, g.y0, g.x1, g.y1, g.w0, g.b, g.h]
            for (i, v) in mid.enumerated() { XCTAssertEqual(v, f.mid[i], accuracy: 1e-6, "\(f.kind) mid \(i)") }
        }
    }

    func testPacksShownEffectsIntoImagePixelsAndChunkRowsSkippingHiddenOnes() {
        var a = LightEffects.newEffect(.lightning, cx: 0.25, cy: 0.5)
        a.rx = 0.2
        a.ry = 0.1
        a.angle = 90
        a.intensity = 80
        a.hue = 180
        a.spread = 50
        var hidden = LightEffects.newEffect(.sparks)
        hidden.enabled = false
        let u = LightEffects.pack([hidden, a], imageWidth: 4000, imageHeight: 3000)
        XCTAssertEqual(u.count, 1)
        XCTAssertEqual(u.geom[0], 1000, accuracy: 1e-3)
        XCTAssertEqual(u.geom[1], 1500, accuracy: 1e-3)
        XCTAssertEqual(u.geom[2], 800, accuracy: 1e-3)
        XCTAssertEqual(u.geom[3], 400, accuracy: 1e-3)
        XCTAssertEqual(u.shape[0], 0, accuracy: 1e-6)
        XCTAssertEqual(u.shape[1], 1, accuracy: 1e-6)
        XCTAssertEqual(u.color[0], 0.5, accuracy: 1e-6)
        XCTAssertEqual(u.color[2], 0.8, accuracy: 1e-6)
        let data = u.data!
        XCTAssertEqual(data.data.count, LightEffects.row * 4 * data.rows)
        XCTAssertEqual(u.range[0], 0)
        XCTAssertGreaterThanOrEqual(u.range[1], 1)
        // The same pattern while only the placement changes: the very same data object, so dragging never re-uploads it.
        var moved = a
        moved.cx = 0.4
        XCTAssertTrue(LightEffects.pack([moved], imageWidth: 4000, imageHeight: 3000).data === data)
        XCTAssertEqual(LightEffects.pack([], imageWidth: 4000, imageHeight: 3000).count, 0)
        var clear = a
        clear.intensity = 0
        XCTAssertEqual(LightEffects.pack([clear], imageWidth: 4000, imageHeight: 3000).count, 0)
    }

    func testANewEffectCoversTheScaledPhoto() {
        let wide = LightEffects.coverSize(aspect: 1.5)
        XCTAssertEqual(wide.rx, 0.5 * LightEffects.startScale, accuracy: 1e-6)
        XCTAssertEqual(wide.ry, 0.5 * LightEffects.startScale / 1.5, accuracy: 1e-6)
        let tall = LightEffects.coverSize(aspect: 0.5)
        XCTAssertEqual(tall.rx, 0.5 * LightEffects.startScale * 0.5, accuracy: 1e-6)
        XCTAssertEqual(tall.ry, 0.5 * LightEffects.startScale, accuracy: 1e-6)
    }

    func testWithKindKeepsPlaceSizeAndSeed() {
        var e = LightEffects.newEffect(.lightning)
        e.angle = 33
        let s = e.withKind(.sparks)
        XCTAssertEqual(s.hue, FxKind.sparks.hue)
        XCTAssertEqual(s.angle, 33)
        XCTAssertEqual(s.seed, e.seed)
        XCTAssertEqual(s.rx, e.rx)
    }
}
