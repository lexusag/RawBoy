import XCTest

/** Desktop Pro's filmstrip pick for batch exports (`Desktop/FilmstripSelection.swift`): Finder's click rules. */
final class FilmstripSelectionTests: XCTestCase {
    private let files = (1...6).map { URL(fileURLWithPath: "/photos/DSCF000\($0).RAF") }

    func testPlainClickOpensAndClearsThePick() {
        var s = FilmstripSelection()
        XCTAssertFalse(s.click(files[2], .command, files: files, current: files[0]))
        XCTAssertTrue(s.click(files[4], .plain, files: files, current: files[0]))
        XCTAssertTrue(s.batch(files).isEmpty)
    }

    func testCommandClickStartsFromTheOpenPhotoAndToggles() {
        var s = FilmstripSelection()
        _ = s.click(files[3], .command, files: files, current: files[1])
        XCTAssertEqual(s.batch(files), [files[1], files[3]])
        _ = s.click(files[5], .command, files: files, current: files[1])
        XCTAssertEqual(s.batch(files), [files[1], files[3], files[5]])
        _ = s.click(files[3], .command, files: files, current: files[1])
        XCTAssertEqual(s.batch(files), [files[1], files[5]])
    }

    func testOnePickedPhotoIsNoBatch() {
        var s = FilmstripSelection()
        _ = s.click(files[3], .command, files: files, current: files[3])
        XCTAssertTrue(s.contains(files[3]))
        XCTAssertTrue(s.batch(files).isEmpty)
    }

    func testShiftClickPicksTheRunFromTheLastClick() {
        var s = FilmstripSelection()
        _ = s.click(files[1], .plain, files: files, current: nil)
        _ = s.click(files[4], .shift, files: files, current: files[1])
        XCTAssertEqual(s.batch(files), Array(files[1...4]))
        // From the same anchor the other way: the run replaces the last one.
        _ = s.click(files[0], .shift, files: files, current: files[1])
        XCTAssertEqual(s.batch(files), Array(files[0...1]))
    }

    func testShiftClickWithoutAnchorStartsFromTheOpenPhoto() {
        var s = FilmstripSelection()
        _ = s.click(files[2], .shift, files: files, current: files[5])
        XCTAssertEqual(s.batch(files), Array(files[2...5]))
    }

    func testSelectAllAndPhotosGoneFromTheFolder() {
        var s = FilmstripSelection()
        s.selectAll(files)
        XCTAssertEqual(s.batch(files), files)
        let left = Array(files.prefix(3))
        s.keep(left)
        XCTAssertEqual(s.batch(left), left)
        s.clear()
        XCTAssertTrue(s.batch(left).isEmpty)
    }
}
