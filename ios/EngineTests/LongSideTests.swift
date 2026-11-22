import XCTest
@testable import RawBoyEngine

final class LongSideTests: XCTestCase {
    func testTakesWholePixelsInRange() {
        XCTAssertEqual(ExportSettings.parseLongSide("1600"), 1600)
        XCTAssertEqual(ExportSettings.parseLongSide(" 64 "), 64)
        XCTAssertEqual(ExportSettings.parseLongSide("20000"), 20_000)
    }

    func testRefusesBlanksTextFractionsAndOutOfRange() {
        for bad in ["", "  ", "abc", "63", "20001", "-5", "12.5", "1e3", "٣٠٠٠", "1,600", "9999999"] {
            XCTAssertNil(ExportSettings.parseLongSide(bad), bad)
        }
    }
}
