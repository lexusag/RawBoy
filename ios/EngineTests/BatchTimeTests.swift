import XCTest
@testable import RawBoyEngine

final class BatchTimeTests: XCTestCase {
    func testDurations() {
        XCTAssertEqual(BatchTime.duration(0), "0:00")
        XCTAssertEqual(BatchTime.duration(65), "1:05")
        XCTAssertEqual(BatchTime.duration(3725), "1:02:05")
    }

    func testEstimateWaitsForAFirstPhotoOrATenth() {
        // 30 s in, 5% of 1 of 10 photos: too early to guess.
        XCTAssertEqual(BatchTime.label(elapsed: 30, done: 0, current: 0.5, total: 10, stopping: false), "0:30 elapsed")
        // One of four done in a minute: three minutes left.
        XCTAssertEqual(BatchTime.label(elapsed: 60, done: 1, current: 0, total: 4, stopping: false), "1:00 elapsed · about 3:00 left")
        // Nearly done.
        XCTAssertEqual(BatchTime.label(elapsed: 100, done: 3, current: 0.99, total: 4, stopping: false),
                       "1:40 elapsed · about a few seconds left")
        // Stopping: no estimate.
        XCTAssertEqual(BatchTime.label(elapsed: 60, done: 1, current: 0, total: 4, stopping: true), "1:00 elapsed")
    }
}
