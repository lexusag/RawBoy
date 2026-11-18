#if os(macOS)
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import RawBoyEngine

/** The user's LUT folder on the Mac: a chosen folder, importing picked or dropped files, telling LUTs from photos. */
final class LutFolderTests: XCTestCase {
    private var temp: URL!
    private var savedFolder: Any?

    override func setUpWithError() throws {
        temp = FileManager.default.temporaryDirectory.appendingPathComponent("LutFolderTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        savedFolder = UserDefaults.standard.object(forKey: "luts.folder")
    }

    override func tearDownWithError() throws {
        UserDefaults.standard.set(savedFolder, forKey: "luts.folder")
        try? FileManager.default.removeItem(at: temp)
    }

    private func file(_ name: String, in dir: URL, _ text: String = "LUT_3D_SIZE 2\n") throws -> URL {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try Data(text.utf8).write(to: url)
        return url
    }

    private func png(_ name: String, width: Int, height: Int) throws -> URL {
        let url = temp.appendingPathComponent(name)
        let ctx = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        let image = try XCTUnwrap(ctx.makeImage())
        let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        return url
    }

    func testChosenFolderIsReadAndForgottenWhenReset() throws {
        let mine = temp.appendingPathComponent("Mine", isDirectory: true)
        _ = try file("Warm.cube", in: mine)
        _ = try file("notes.txt", in: mine)
        LutRepository.setUserFolder(mine)
        XCTAssertEqual(LutRepository.userFolder.standardizedFileURL.path, mine.standardizedFileURL.path)
        let library = LutRepository.library()
        XCTAssertEqual(library.user.map(\.name), ["Warm"])
        XCTAssertEqual(library.folder?.standardizedFileURL.path, mine.standardizedFileURL.path)
        XCTAssertNoThrow(try LutRepository.open("file:Warm.cube"))

        LutRepository.setUserFolder(nil)
        XCTAssertNil(LutRepository.customFolder)
        XCTAssertEqual(LutRepository.userFolder, LutRepository.defaultUserFolder)
    }

    func testAMissingChosenFolderFallsBackToTheAppsOwn() {
        LutRepository.setUserFolder(temp.appendingPathComponent("Gone", isDirectory: true))
        XCTAssertNil(LutRepository.customFolder)
        XCTAssertEqual(LutRepository.userFolder, LutRepository.defaultUserFolder)
    }

    func testImportCopiesLutsReplacesSameNamesAndSkipsOthers() throws {
        let target = temp.appendingPathComponent("Target", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        LutRepository.setUserFolder(target)
        let source = temp.appendingPathComponent("Downloads", isDirectory: true)
        let cube = try file("Teal.CUBE", in: source, "new")
        _ = try file("Teal.CUBE", in: target, "old")
        let text = try file("readme.txt", in: source)

        XCTAssertEqual(LutRepository.importFiles([cube, text]), 1)
        XCTAssertEqual(try String(contentsOf: target.appendingPathComponent("Teal.CUBE"), encoding: .utf8), "new")
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.appendingPathComponent("readme.txt").path))
        // A file already in the folder counts and stays.
        XCTAssertEqual(LutRepository.importFiles([target.appendingPathComponent("Teal.CUBE")]), 1)
        XCTAssertEqual(LutRepository.library().user.map(\.name), ["Teal"])
    }

    func testOnlyHaldClutShapedPngsAreSurelyLuts() throws {
        XCTAssertTrue(LutRepository.isSurelyLut(try file("a.cube", in: temp)))
        XCTAssertTrue(LutRepository.isSurelyLut(try png("hald8.png", width: 512, height: 512)))  // level 8
        XCTAssertTrue(LutRepository.isSurelyLut(try png("hald4.png", width: 64, height: 64)))  // level 4
        XCTAssertFalse(LutRepository.isSurelyLut(try png("photo.png", width: 600, height: 400)))
        XCTAssertFalse(LutRepository.isSurelyLut(try png("square.png", width: 500, height: 500)))
        XCTAssertFalse(LutRepository.isSurelyLut(try file("a.jpg", in: temp)))
    }
}
#endif
