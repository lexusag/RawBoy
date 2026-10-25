import XCTest
@testable import RawBoyEngine

/** Colour and black and white sections in preset lists: the same cases as PresetsTest.kt. */
final class PresetSectionTests: XCTestCase {
    private func params(_ change: (inout DevelopParams) -> Void) -> DevelopParams {
        var p = DevelopParams()
        change(&p)
        return p
    }

    func testBlackAndWhitePresetsHaveTheirOwnSection() {
        let mono = Presets.capture("Mono", params { $0.lut = "asset:luts/Yellow Mono 400.cube" }, [.lut])
        let grey = Presets.capture("Grey", params { $0.saturation = -100 }, [.color])
        let half = Presets.capture("Half", params { $0.lut = "asset:luts/Yellow Mono 400.cube"; $0.lutAmount = 50 }, [.lut])
        let warm = Presets.capture("Warm", params { $0.lut = "asset:luts/Yellow Warm 200.cube" }, [.lut])
        XCTAssertTrue(mono.isMonochrome)
        XCTAssertTrue(grey.isMonochrome)
        XCTAssertFalse(half.isMonochrome)
        XCTAssertFalse(warm.isMonochrome)
        // A film stock drops the LUT, so the photo keeps its colour.
        let film = Presets.capture("Film", params { $0.lut = "asset:luts/Yellow Mono 400.cube"; $0.film = "portra400" },
                                   [.light, .lut])
        XCTAssertFalse(film.isMonochrome)

        func shape(_ s: [(label: String?, presets: [Preset])]) -> [String] {
            s.map { "\($0.label ?? "-"): \($0.presets.map(\.name).joined(separator: ","))" }
        }
        XCTAssertEqual(shape(Presets.sections([warm, mono, half, grey])), ["Color: Warm,Half", "Black & white: Mono,Grey"])
        XCTAssertEqual(shape(Presets.sections([warm])), ["-: Warm"])
        XCTAssertEqual(shape(Presets.sections([mono])), ["Black & white: Mono"])
    }
}
