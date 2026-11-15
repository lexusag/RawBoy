import XCTest
@testable import RawBoyEngine

/**
 * Desktop Auto against the web's, on Pixel DNGs: the scene stats and the auto develop (exposure, shadows, contrast,
 * denoise) without a face mask, as the web's WASM decode + `analyzeScene` + `autoDevelop` give them in Node (run on the same
 * files; draft decode there, full here). Camera-metered Pixel raws keep the camera's exposure (0), and everything but the
 * face mask comes out the same. With a face the exposure of a camera-metered raw stays the camera's (0 EV), whatever the
 * Mac's Vision mask finds (it lifted four of these by +0.75 to +1.45 EV before); the face still steers the look. Skips the
 * files that aren't on this Mac (CI has none).
 */
final class AutoParityTests: XCTestCase {
    private struct Case {
        let path: String
        let key: Float, p98: Float
        let exposure: Float, shadows: Float, contrast: Float
        let denoise: Float, colorDenoise: Float
    }

    private static let home = NSHomeDirectory()
    private let cases = [
        Case(path: "/_claude/photos/IMG_20261107_163933.dng", key: 0.02345, p98: -2.094, exposure: 0, shadows: 19, contrast: 19, denoise: 0, colorDenoise: 18),
        Case(path: "/_claude/photos/IMG_20261107_163941.dng", key: 0.00712, p98: -2.906, exposure: 0, shadows: 29, contrast: 17, denoise: 0, colorDenoise: 25),
        Case(path: "/_claude/photos/IMG_20261107_215559.dng", key: 0.00612, p98: -1.469, exposure: 0, shadows: 25, contrast: 13, denoise: 0, colorDenoise: 13),
        Case(path: "/_claude/photos/IMG_20261107_215633.dng", key: 0.00588, p98: -1.406, exposure: 0, shadows: 26, contrast: 12, denoise: 0, colorDenoise: 13),
        Case(path: "/Downloads/Telegram Desktop/IMG_20261030_141225.dng", key: 0.01487, p98: -0.469, exposure: 0, shadows: 5, contrast: 17, denoise: 0, colorDenoise: 14),
        Case(path: "/Downloads/Telegram Desktop/IMG_20261031_153812.dng", key: 0.00276, p98: -2.594, exposure: 0, shadows: 28, contrast: 16, denoise: 1, colorDenoise: 39),
    ]

    /** The photos whose face mask (Vision) lifted or dropped a camera-metered exposure: now 0 EV with the mask on. */
    func testAFaceDoesNotMoveACameraMeteredExposure() throws {
        let faces: [(String, String, String)] = [  // path, suggested look, suggested film stock
            ("/Downloads/Telegram Desktop/IMG_20261031_143823.dng", "portra400", "portra400"),
            ("/Downloads/Telegram Desktop/IMG_20261031_142419.dng", "portra400", "portra400"),
            ("/_claude/photos/IMG_20261107_215559.dng", "portra800", "portra800"),
            ("/_claude/photos/IMG_20261107_215633.dng", "portra800", "portra800"),
        ]
        var ran = 0
        for (path, lookId, filmId) in faces {
            let url = URL(fileURLWithPath: Self.home + path)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            ran += 1
            let a = try AutoAnalysis.analyze(url)  // with skin detection, as Auto does
            let name = url.lastPathComponent
            XCTAssertGreaterThan(a.stats.faceArea, 0, "a face is found in \(name)")
            XCTAssertEqual(a.autoBase.exposure, 0, accuracy: 0.001, "exposure \(name)")
            XCTAssertEqual(LookSuggester.suggest(a.stats, asShotKelvin: a.defaults.temperature).id, lookId, name)
            XCTAssertEqual(LookSuggester.suggestFilm(a.stats, asShotKelvin: a.defaults.temperature).id, filmId, name)
        }
        if ran == 0 { throw XCTSkip("none of the Pixel DNGs is on this Mac") }
    }

    func testPixelDngsMatchTheWebWithoutAFaceMask() throws {
        var ran = 0
        for c in cases {
            let url = URL(fileURLWithPath: Self.home + c.path)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            ran += 1
            let name = url.lastPathComponent
            let a = try AutoAnalysis.analyze(url, detectSkin: false)
            XCTAssertEqual(a.stats.key, c.key, accuracy: 1e-4, name)
            XCTAssertEqual(a.stats.p98, c.p98, accuracy: 0.01, name)
            let p = a.autoBase
            XCTAssertEqual(p.exposure, c.exposure, accuracy: 0.001, "exposure \(name)")
            XCTAssertEqual(p.shadows, c.shadows, "shadows \(name)")
            XCTAssertEqual(p.contrast, c.contrast, "contrast \(name)")
            // The web reads the noise on a draft decode; allow a step or two.
            XCTAssertEqual(p.denoise, c.denoise, accuracy: 2, "denoise \(name)")
            XCTAssertEqual(try XCTUnwrap(p.colorDenoise), c.colorDenoise, accuracy: 2, "colour denoise \(name)")
        }
        if ran == 0 { throw XCTSkip("none of the Pixel DNGs is on this Mac") }
    }
}
