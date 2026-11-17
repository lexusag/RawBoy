import XCTest
@testable import RawBoyEngine

final class SplitMathTests: XCTestCase {
    func testDragMovesByTheTranslationOverTheWidth() {
        XCTAssertEqual(SplitMath.dragged(start: 0.5, translation: 100, width: 1000), 0.6, accuracy: 1e-9)
        XCTAssertEqual(SplitMath.dragged(start: 0.5, translation: -250, width: 1000), 0.25, accuracy: 1e-9)
    }

    func testTheDividerStaysInsideThePicture() {
        XCTAssertEqual(SplitMath.dragged(start: 0.9, translation: 5000, width: 1000), 1 - SplitMath.margin, accuracy: 1e-9)
        XCTAssertEqual(SplitMath.dragged(start: 0.1, translation: -5000, width: 1000), SplitMath.margin, accuracy: 1e-9)
        XCTAssertEqual(SplitMath.fraction(at: -40, minX: 0, width: 800), SplitMath.margin, accuracy: 1e-9)
    }

    func testAClickIsMeasuredFromThePicturesLeftEdge() {
        XCTAssertEqual(SplitMath.fraction(at: 300, minX: 100, width: 400), 0.5, accuracy: 1e-9)
    }

    func testAnEmptyPictureChangesNothing() {
        XCTAssertEqual(SplitMath.dragged(start: 0.3, translation: 40, width: 0), 0.3)
        XCTAssertEqual(SplitMath.fraction(at: 10, minX: 0, width: 0), 0.5)
    }

    func testTheOriginalIsTheLeftPartOfThePicture() {
        let r = SplitMath.originalRect(CGRect(x: 12, y: 20, width: 800, height: 500), fraction: 0.25)
        XCTAssertEqual(r, CGRect(x: 12, y: 20, width: 200, height: 500))
    }
}
