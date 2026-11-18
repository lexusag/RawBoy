import XCTest
@testable import RawBoyEngine

final class WindowPlacementTests: XCTestCase {
    private let main = CGRect(x: 0, y: 0, width: 3440, height: 1410)
    private let right = CGRect(x: 3440, y: 0, width: 1920, height: 1055)  // a second display to the right
    private let window = CGRect(x: 100, y: 100, width: 1280, height: 860)

    func testAWindowOnAScreenStaysWhereItIs() {
        XCTAssertNil(WindowPlacement.corrected(window, screens: [main]))
        XCTAssertNil(WindowPlacement.corrected(CGRect(x: 3500, y: 50, width: 1000, height: 700), screens: [main, right]))
        // Straddling two displays is fine: enough of it is on each.
        XCTAssertNil(WindowPlacement.corrected(CGRect(x: 3000, y: 50, width: 1000, height: 700), screens: [main, right]))
        // Mostly off the edge, but a title bar's worth is still on the screen.
        XCTAssertNil(WindowPlacement.corrected(CGRect(x: 3200, y: 100, width: 1280, height: 860), screens: [main]))  // 240 pt of it on the screen
        XCTAssertNotNil(WindowPlacement.corrected(CGRect(x: 3300, y: 100, width: 1280, height: 860), screens: [main]))  // only 140 pt: too little
    }

    func testAWindowOnAMissingDisplayMovesToTheMainScreen() throws {
        let gone = CGRect(x: 3600, y: 100, width: 1280, height: 860)  // was on the right display
        XCTAssertFalse(WindowPlacement.reachable(gone, screens: [main]))
        let fixed = try XCTUnwrap(WindowPlacement.corrected(gone, screens: [main]))
        XCTAssertEqual(fixed.size, gone.size)
        XCTAssertTrue(main.contains(fixed))
        XCTAssertEqual(fixed.midX, main.midX, accuracy: 1)
        XCTAssertEqual(fixed.midY, main.midY, accuracy: 1)
        // Left of, and below, every screen too.
        XCTAssertNotNil(WindowPlacement.corrected(CGRect(x: -5000, y: 100, width: 800, height: 600), screens: [main]))
        XCTAssertNotNil(WindowPlacement.corrected(CGRect(x: 100, y: -3000, width: 800, height: 600), screens: [main]))
    }

    func testItIsCutDownToASmallerScreenAndPrefersTheGivenOne() throws {
        let small = CGRect(x: 0, y: 25, width: 1440, height: 875)
        let big = CGRect(x: 6000, y: 0, width: 2000, height: 1200)
        let fixed = try XCTUnwrap(WindowPlacement.corrected(CGRect(x: 9000, y: 0, width: 1800, height: 1100), screens: [small, big], preferred: small))
        XCTAssertEqual(fixed.size, CGSize(width: 1440, height: 875))
        XCTAssertTrue(small.contains(fixed))
        // No screens known: nothing to do.
        XCTAssertNil(WindowPlacement.corrected(window, screens: []))
    }

    func testASmallWindowOnlyNeedsItsOwnSizeOnTheScreen() {
        XCTAssertNil(WindowPlacement.corrected(CGRect(x: 3300, y: 100, width: 100, height: 60), screens: [main]))  // all of it is on
        XCTAssertNotNil(WindowPlacement.corrected(CGRect(x: 3400, y: 100, width: 100, height: 60), screens: [main]))  // 40 of 100 pt: too little
    }
}
