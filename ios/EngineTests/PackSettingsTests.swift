import XCTest
@testable import RawBoyEngine

/** Web's packer/settings.test.ts on the Swift port. */
final class PackSettingsTests: XCTestCase {
    private func info(make: String = "Sony", model: String = "ILCE-7M3", lensData: String = "Sony", adobeHints: Bool = true,
                      bayer: Bool = true, dng: Bool = false) -> PackInfo {
        var i = PackInfo()
        i.make = make
        i.model = model
        i.format = "ARW"
        i.width = 6024
        i.height = 4024
        i.lensData = lensData
        i.adobeHints = adobeHints
        i.bayer = bayer
        i.dng = dng
        i.bits = 14
        i.compression = "lossless compressed"
        return i
    }

    private func text(_ lines: [PackerInfo.Line]) -> String { lines.map { $0.map(\.text).joined() }.joined(separator: "\n") }
    private func bold(_ lines: [PackerInfo.Line]) -> [String] { lines.flatMap { $0.filter(\.bold).map(\.text) } }

    func testDefaultsToTheSmallRawPreset() {
        let d = PackSettings()
        XCTAssertEqual(d.preset, .small)
        var micro = d
        micro.apply(.micro)
        XCTAssertEqual(micro.preset, .micro)
        var lossless = d
        lossless.apply(.lossless)
        lossless.quality = .compact
        XCTAssertEqual(lossless.preset, .lossless)
        var archive = d
        archive.quality = .archive
        XCTAssertEqual(archive.preset, .custom)
        var jxl = d
        jxl.format = .losslessJxl
        XCTAssertEqual(jxl.preset, .custom)
    }

    func testNamesOutputsWithoutOverwritingDngSources() {
        XCTAssertEqual(PackerInfo.outputName("DSC07421.ARW"), "DSC07421.dng")
        XCTAssertEqual(PackerInfo.outputName("IMG_1.DNG"), "IMG_1-packed.dng")
        XCTAssertEqual(PackerInfo.outputName("DSCF3736.RAF", counter: 2), "DSCF3736-2.dng")
        XCTAssertFalse(PackSettings().nameSuffix)
        XCTAssertEqual(PackerInfo.outputName("DSC1.ARW", suffix: "small-high"), "DSC1-small-high.dng")
        XCTAssertEqual(PackerInfo.outputName("IMG_1.DNG", counter: 1, suffix: "lossless"), "IMG_1-lossless-1.dng")
        var micro = PackSettings()
        micro.format = .micro
        micro.quality = .good
        micro.maxSize = 3000
        XCTAssertEqual(micro.suffix, "micro3000-good")
    }

    func testSharesCoresBetweenFilesAtOnce() {
        XCTAssertEqual(threadsPerFile(1, cores: 8), 6)
        XCTAssertEqual(threadsPerFile(2, cores: 8), 4)
        XCTAssertEqual(threadsPerFile(4, cores: 2), 1)
        XCTAssertEqual(autoFilesAtOnce(cores: 12, memoryGb: 16), 3)
        XCTAssertEqual(autoFilesAtOnce(cores: 4, memoryGb: 16), 1)
        XCTAssertEqual(autoFilesAtOnce(cores: 16, memoryGb: 4), 1)
        XCTAssertEqual(PackSettings().filesAtOnce, 0)
    }

    func testSaysWhatAppliesToTheFiles() {
        let files = [info(), info(make: "Olympus", model: "E-PL9", lensData: ""), info(model: "ILCE-7M5", adobeHints: false), info(bayer: false)]
        let lines = PackerInfo.summarize(PackSettings(), files)
        XCTAssertTrue(text(lines).contains("3 files: the camera's lens corrections"))
        XCTAssertTrue(text(lines).contains("1 file without lens corrections in the file (Olympus E-PL9"))
        XCTAssertTrue(text(lines).contains("Sony ILCE-7M5: "))
        XCTAssertTrue(bold(lines).contains("1 file can't be saved as Small raw"))
        var off = PackSettings()
        off.lensCorrections = false
        XCTAssertTrue(bold(PackerInfo.summarize(off, files)).contains("Lens corrections are dropped. "))
        var jxl = PackSettings()
        jxl.format = .losslessJxl
        XCTAssertTrue(bold(PackerInfo.summarize(jxl, [])).contains("Apple Photos shows it black"))
        var micro = PackSettings()
        micro.format = .micro
        micro.maxSize = 3000
        XCTAssertTrue(text(PackerInfo.summarize(micro, [])).contains("resized to 3000 px"))
    }

    func testDescribesAFinishedRun() {
        XCTAssertEqual(PackerInfo.runMessage(.init(done: 3, failed: 0, stopped: false, before: 150_000_000, after: 50_000_000)).body,
                       "3 files packed: 150 MB → 50 MB (33%).")
        XCTAssertEqual(PackerInfo.runMessage(.init(done: 1, failed: 1, before: 40_000_000, after: 10_000_000)).body,
                       "1 file packed: 40 MB → 10 MB (25%). 1 file failed.")
        XCTAssertEqual(PackerInfo.runMessage(.init(done: 0, failed: 2)).title, "Packing failed")
        XCTAssertEqual(PackerInfo.runMessage(.init(done: 1, failed: 0, stopped: true, before: 40_000_000, after: 10_000_000)).title, "Packing stopped")
    }

    func testListsWhichAppsOpenEachFormat() {
        XCTAssertEqual(PackerInfo.appSupport(.small).map(\.app), ["RawBoy", "Lightroom", "Apple Photos", "Capture One", "darktable"])
        XCTAssertEqual(PackerInfo.appSupport(.losslessJxl)[2].support, .no)
        XCTAssertEqual(PackerInfo.appSupport(.losslessJpeg).map(\.support), [.yes, .yes, .yes, .likely, .yes])
        XCTAssertEqual(PackerInfo.appSupport(.small)[4].support, .no)
    }

    func testSettingsSurviveJsonAndBadValuesFallBack() throws {
        var s = PackSettings()
        s.format = .micro
        s.maxSize = 3000
        let back = try JSONDecoder().decode(PackSettings.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(back, s)
        var bad = s
        bad.maxSize = 1234
        bad.filesAtOnce = 99
        XCTAssertEqual(bad.validated().maxSize, 4000)
        XCTAssertEqual(bad.validated().filesAtOnce, 4)
    }
}
