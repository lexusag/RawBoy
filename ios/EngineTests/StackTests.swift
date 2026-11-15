import XCTest
@testable import RawBoyEngine

/** The native decode must not depend on a big stack: Swift concurrency's threads have ~512 KB (the Desktop crashed opening a raw). */
final class StackTests: XCTestCase {
    func testOpenOnASmallStack() throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(".raw")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
            .filter { !$0.hasDirectoryPath && !$0.lastPathComponent.hasPrefix(".") } ?? []
        try XCTSkipIf(files.isEmpty, "no test files")
        for file in files {
            var result: Result<String, Error>?
            let done = DispatchSemaphore(value: 0)
            let t = Thread {
                result = Result { try RawImage.open(url: file).description }
                done.signal()
            }
            t.stackSize = 256 * 1024
            t.start()
            done.wait()
            XCTAssertNoThrow(try result!.get(), file.lastPathComponent)
        }
    }
}
