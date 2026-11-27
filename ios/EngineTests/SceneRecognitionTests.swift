import XCTest
@testable import RawBoyEngine

/** Camera scene recognition map (SceneRecognition) and blue-sky pixel classification: mirrors SceneRecognitionTest.kt. */
final class SceneRecognitionTests: XCTestCase {
    private func stats(
        blueSky: Float = 0.25,
        iso: Float = 50,
        p98: Float = -1.2,
        clipped: Float = 0.002,
        key: Float = 0.06
    ) -> SceneStats {
        SceneStats(
            key: key,
            p1: -8,
            p5: -7,
            p50: -4,
            p98: p98,
            p99: p98 + 0.2,
            clipped: clipped,
            chroma: 0.2,
            greenBlue: blueSky,
            warm: 0.05,
            faceArea: 0,
            skinLuminance: 0,
            iso: iso,
            histogram: [0],
            blueSky: blueSky)
    }

    func testSunnyBlueSkyEntryLivesInSceneMapAndBrightens() {
        let entry = SceneRecognition.adjustments[.sunnyBlueSky]
        XCTAssertNotNil(entry)
        XCTAssertGreaterThan(entry?.exposureEv ?? 0, 0)

        let light = SceneLight(exposureSeconds: 1.0 / 1000.0, postRawBoost: 1)
        let matches = SceneRecognition.recognize(stats(blueSky: 0.25, iso: 50), light: light)
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches[0].scene, .sunnyBlueSky)
        XCTAssertEqual(matches[0].confidence, 1, accuracy: 1e-6)

        var base = DevelopParams()
        base.exposure = 0
        let out = SceneRecognition.apply(base, stats: stats(blueSky: 0.25, iso: 50), light: light)
        XCTAssertEqual(out.exposure, 0.45, accuracy: 1e-6)
    }

    func testBlueSkyConfidenceRampsSmoothly() {
        let light = SceneLight(exposureSeconds: 1.0 / 1000.0)
        XCTAssertTrue(SceneRecognition.recognize(stats(blueSky: 0.05), light: light).isEmpty)
        XCTAssertTrue(SceneRecognition.recognize(stats(blueSky: 0.08), light: light).isEmpty)

        let mid = SceneRecognition.recognize(stats(blueSky: 0.15), light: light)
        XCTAssertEqual(mid.count, 1)
        XCTAssertGreaterThan(mid[0].confidence, 0.4)
        XCTAssertLessThan(mid[0].confidence, 0.6)

        let full = SceneRecognition.recognize(stats(blueSky: 0.25), light: light)
        XCTAssertEqual(full[0].confidence, 1, accuracy: 1e-6)
    }

    func testIndoorAndNightScenesWithBlueDoNotTriggerSunnySky() {
        XCTAssertTrue(
            SceneRecognition.recognize(
                stats(blueSky: 0.35, iso: 200),
                light: SceneLight(exposureSeconds: 1.0 / 60.0, postRawBoost: 1)).isEmpty)
        XCTAssertTrue(
            SceneRecognition.recognize(
                stats(blueSky: 0.35, iso: 800),
                light: SceneLight(exposureSeconds: 1.0 / 40.0, postRawBoost: 1)).isEmpty)

        let borderline = SceneRecognition.recognize(
            stats(blueSky: 0.25, iso: 100),
            light: SceneLight(exposureSeconds: 1.0 / 100.0, postRawBoost: 1))
        XCTAssertEqual(borderline.count, 1)
        XCTAssertEqual(borderline[0].confidence, 0.5, accuracy: 1e-4)
    }

    func testIsoFallbackWhenShutterUnknown() {
        XCTAssertEqual(SceneRecognition.recognize(stats(blueSky: 0.25, iso: 50)).first?.confidence ?? 0, 1, accuracy: 1e-6)
        XCTAssertTrue(SceneRecognition.recognize(stats(blueSky: 0.25, iso: 400)).isEmpty)
        XCTAssertTrue(SceneRecognition.recognize(stats(blueSky: 0.25, iso: 0)).isEmpty)
    }

    func testBrightnessCompensationKeepsSunnyLiftInvariant() {
        var base = DevelopParams()
        base.exposure = -2
        let s = stats(blueSky: 0.25, iso: 200, p98: 0.8)
        let light = SceneLight(exposureSeconds: 1.0 / 250.0, postRawBoost: 1, captureEv: 2)
        let adj = SceneRecognition.adjustment(s, light: light, baseExposureEv: base.exposure)
        XCTAssertEqual(adj.exposureEv, 0.45, accuracy: 1e-5)
        let out = SceneRecognition.apply(base, stats: s, light: light)
        XCTAssertEqual(out.exposure, -1.55, accuracy: 1e-5)
    }

    func testHighlightGuardProtectsNearClippedAndClippedScenes() {
        let light = SceneLight(exposureSeconds: 1.0 / 1000.0)
        XCTAssertEqual(SceneRecognition.adjustment(stats(p98: -1.0, clipped: 0.005), light: light).exposureEv, 0.45, accuracy: 1e-5)
        XCTAssertEqual(SceneRecognition.adjustment(stats(p98: -0.3, clipped: 0.005), light: light).exposureEv, 0.225, accuracy: 1e-5)
        XCTAssertEqual(SceneRecognition.adjustment(stats(p98: 0.0, clipped: 0.005), light: light).exposureEv, 0, accuracy: 1e-6)
        XCTAssertEqual(SceneRecognition.adjustment(stats(p98: -1.0, clipped: 0.12), light: light).exposureEv, 0, accuracy: 1e-6)
    }

    func testCustomSceneMapOverridesDefaultAdjustments() {
        let light = SceneLight(exposureSeconds: 1.0 / 1000.0)
        let custom: [CameraScene: SceneAdjustment] = [
            .sunnyBlueSky: SceneAdjustment(exposureEv: 0.6, shadows: 10, contrast: 4),
        ]
        var base = DevelopParams()
        base.exposure = 0
        base.shadows = 5
        base.contrast = 15
        let out = SceneRecognition.apply(base, stats: stats(), light: light, adjustments: custom)
        XCTAssertEqual(out.exposure, 0.6, accuracy: 1e-6)
        XCTAssertEqual(out.shadows, 15, accuracy: 1e-6)
        XCTAssertEqual(out.contrast, 19, accuracy: 1e-6)
    }

    func testBlueSkyPixelClassificationAndAnalyze() {
        XCTAssertTrue(SceneAnalyzer.isBlueSky(0.10, 0.17, 0.35))
        XCTAssertTrue(SceneAnalyzer.isBlueSky(0.25, 0.35, 0.48))
        XCTAssertTrue(SceneAnalyzer.isBlueSky(0.05, 0.10, 0.32))
        XCTAssertFalse(SceneAnalyzer.isBlueSky(0.10, 0.28, 0.08))
        XCTAssertFalse(SceneAnalyzer.isBlueSky(0.40, 0.41, 0.42))
        XCTAssertFalse(SceneAnalyzer.isBlueSky(0.005, 0.008, 0.025))
        XCTAssertFalse(SceneAnalyzer.isBlueSky(0.40, 0.28, 0.12))
        XCTAssertFalse(SceneAnalyzer.isBlueSky(0.25, 0.10, 0.35))

        // Synthetic 4x4 image: top half blue sky, bottom half neutral grey -> blueSky == 0.5.
        let w = 4
        let h = 4
        var pixels = [UInt16](repeating: 0, count: w * h * 3)
        for y in 0..<h {
            let rgb: (Float, Float, Float) = y < 2 ? (0.10, 0.17, 0.35) : (0.06, 0.06, 0.06)
            for x in 0..<w {
                let i = (y * w + x) * 3
                pixels[i] = Float16(rgb.0).bitPattern
                pixels[i + 1] = Float16(rgb.1).bitPattern
                pixels[i + 2] = Float16(rgb.2).bitPattern
            }
        }
        let preview = PreviewImage(width: w, height: h, pixels: pixels, fullWidth: w, fullHeight: h)
        let analyzed = SceneAnalyzer.analyze(preview, skin: nil, iso: 50)
        XCTAssertEqual(analyzed.blueSky, 0.5, accuracy: 1e-6)
    }
}
