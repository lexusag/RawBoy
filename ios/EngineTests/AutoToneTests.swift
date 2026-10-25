import XCTest
@testable import RawBoyEngine

/** Auto exposure: the same cases as AutoToneTest.kt. */
final class AutoToneTests: XCTestCase {
    private func stats(key: Float, p98: Float) -> SceneStats {
        SceneStats(key: key, p1: -8, p5: -7, p50: -4, p98: p98, p99: p98 + 0.2, clipped: 0, chroma: 0.1, greenBlue: 0,
                   warm: 0, faceArea: 0, skinLuminance: 0, iso: 100, histogram: [0])
    }

    func testPhoneAeIsKeptUnlessItWentDark() {
        // A normal or bright scene (a white wardrobe): the phone's exposure, even with highlights near clip.
        XCTAssertEqual(AutoTone.exposure(stats(key: 0.06, p98: -1), phoneAe: true), 0, accuracy: 1e-6)
        XCTAssertEqual(AutoTone.exposure(stats(key: 0.15, p98: -0.2), phoneAe: true), 0, accuracy: 1e-6)
        // The AE took the scene down for a white bird or a window: lifted back to the phone's normal key, highlights
        // near clip don't hold it down.
        XCTAssertEqual(AutoTone.exposure(stats(key: 0.06 / 2.8284271, p98: -0.1), phoneAe: true), 1.5, accuracy: 1e-4)
        // Capped at +2 EV.
        XCTAssertEqual(AutoTone.exposure(stats(key: 0.001, p98: -3), phoneAe: true), 2, accuracy: 1e-6)
    }
}
