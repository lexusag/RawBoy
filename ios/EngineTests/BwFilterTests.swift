import XCTest
@testable import RawBoyEngine

/** B&W colour filters (the same cases as BwFilterTest.kt and web's bwfilter.test.ts). */
final class BwFilterTests: XCTestCase {
    private func luma(_ c: [Double]) -> Double { 0.2627 * c[0] + 0.6780 * c[1] + 0.0593 * c[2] }
    private func filtered(_ f: BwFilter, _ rgb: [Double]) -> Double { luma(Mat3.apply(f.matrix(), rgb)) }

    func testGreyKeepsItsBrightnessThroughEveryFilter() {
        for f in BwFilter.allCases { XCTAssertEqual(filtered(f, [0.18, 0.18, 0.18]), 0.18, accuracy: 1e-9, f.key) }
    }

    func testOffIsTheIdentity() {
        XCTAssertEqual(BwFilter.off.matrix(), Mat3.diagonal(1, 1, 1))
    }

    func testAFilterLightensItsOwnColourAndDarkensTheOpposite() {
        let sky = [0.10, 0.17, 0.35], skin = [0.30, 0.17, 0.11], leaves = [0.12, 0.22, 0.06]
        XCTAssertLessThan(filtered(.red, sky), filtered(.orange, sky))
        XCTAssertLessThan(filtered(.orange, sky), filtered(.yellow, sky))
        XCTAssertLessThan(filtered(.yellow, sky), filtered(.off, sky))
        XCTAssertGreaterThan(filtered(.red, skin), filtered(.off, skin))
        XCTAssertLessThan(filtered(.green, skin), filtered(.off, skin))
        XCTAssertGreaterThan(filtered(.green, leaves), filtered(.off, leaves))
    }

    func testKeysRoundTrip() {
        for f in BwFilter.allCases { XCTAssertEqual(BwFilter.fromKey(f.key), f) }
        XCTAssertNil(BwFilter.fromKey("blue"))
    }
}
