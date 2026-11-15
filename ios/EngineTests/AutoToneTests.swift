import XCTest
@testable import RawBoyEngine

/** Auto exposure: the same cases as AutoToneTest.kt. */
final class AutoToneTests: XCTestCase {
    private func stats(key: Float, p98: Float) -> SceneStats {
        SceneStats(key: key, p1: -8, p5: -7, p50: -4, p98: p98, p99: p98 + 0.2, clipped: 0, chroma: 0.1, greenBlue: 0,
                   warm: 0, faceArea: 0, skinLuminance: 0, iso: 100, histogram: [0])
    }

    func testACameraMeteredRawKeepsItsExposureWhateverTheSkinSays() {
        // A face 3.2% of the frame with dark skin: a metered raw stays at 0 EV; any other raw is steered by the skin.
        let s = SceneStats(key: 0.0286, p1: -8, p5: -7, p50: -5, p98: -1.5, p99: -1.3, clipped: 0, chroma: 0.1, greenBlue: 0,
                           warm: 0, faceArea: 0.032, skinLuminance: 0.0173, iso: 183, histogram: [0])
        XCTAssertEqual(AutoTone.exposure(s, cameraMetered: true), 0, accuracy: 1e-6)
        XCTAssertNotEqual(AutoTone.exposure(s, cameraMetered: false), 0)
        // RawBoy Camera's phone exposure still follows the skin.
        XCTAssertGreaterThan(AutoTone.exposure(s, cameraMetered: true, phoneAe: true), 0.5)
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
