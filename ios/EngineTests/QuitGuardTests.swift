import XCTest
@testable import RawBoyEngine

final class QuitGuardTests: XCTestCase {
    func testNothingRunningQuitsWithoutAsking() {
        XCTAssertTrue(QuitWork().isEmpty)
        XCTAssertEqual(QuitWork().message, "")
    }

    func testEachKindOfWorkIsReported() {
        var w = QuitWork(); w.proExporting = true
        XCTAssertEqual(w.reasons.count, 1)
        w = QuitWork(); w.autoExporting = true
        XCTAssertTrue(w.reasons[0].contains("batch export"))
        w = QuitWork(); w.packerRunning = true
        XCTAssertTrue(w.reasons[0].contains("Packer"))
        w = QuitWork(); w.proAutoRunning = true
        XCTAssertFalse(w.isEmpty)
        w = QuitWork(); w.unsavedEditsOf = "DSCF1.RAF"
        XCTAssertTrue(w.reasons[0].contains("DSCF1.RAF"))
    }

    func testAutoPhotoCountIsPluralised() {
        var w = QuitWork(); w.autoPhotosInProgress = 1
        XCTAssertEqual(w.reasons, ["Auto is still working on 1 photo."])
        w.autoPhotosInProgress = 12
        XCTAssertEqual(w.reasons, ["Auto is still working on 12 photos."])
    }

    func testExportingBatchDoesNotAlsoCountItsPhotos() {
        var w = QuitWork(); w.autoExporting = true; w.autoPhotosInProgress = 5
        XCTAssertEqual(w.reasons.count, 1)
    }

    func testSeveralReasonsAreListedOnePerLine() {
        var w = QuitWork(); w.proExporting = true; w.packerRunning = true
        XCTAssertEqual(w.message.split(separator: "\n").count, 2)
    }
}
