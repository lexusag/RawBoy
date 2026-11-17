import XCTest
@testable import RawBoyEngine

/** The web's 'fills in Auto export name templates' cases (engine.test.ts), plus the free-name search. */
final class NameTemplateTests: XCTestCase {
    private let ctx = NameTemplate.Context(fileName: "DSCF1234.RAF", camera: "FUJIFILM X-T5", lens: "XF 35mm F1.4 R", iso: 800,
                                           look: "Portra 400", date: "2026:11:09 14:30:05", index: 7)

    private func with(index: Int) -> NameTemplate.Context {
        var c = ctx
        c.index = index
        return c
    }

    func testFillsInKeywordsAndCounters() {
        XCTAssertEqual(NameTemplate.apply("{name}-auto", ctx), "DSCF1234-auto")
        XCTAssertEqual(NameTemplate.apply("{date}_{time}_{NAME}_#", ctx), "2026-11-09_14-30-05_DSCF1234_7")
        XCTAssertEqual(NameTemplate.apply("{year}{month}{day}-{hour}{minute}{second}_{yy}", ctx), "20261109-143005_26")
        XCTAssertEqual(NameTemplate.apply("{iso}_{look}_##", ctx), "800_Portra 400_07")
        XCTAssertEqual(NameTemplate.apply("###", with(index: 12)), "012")
        XCTAssertEqual(NameTemplate.apply("{name}_####", with(index: 12345)), "DSCF1234_12345")
    }

    func testMissingUnknownAndEmpty() {
        // Missing values are left out; unknown words stay; an empty result falls back.
        XCTAssertEqual(NameTemplate.apply("{name}{lens}{foo}", .init(fileName: "a.jpg", index: 1)), "a{foo}")
        XCTAssertEqual(NameTemplate.apply("{date}", .init(fileName: "a.jpg", index: 1)), "image")
        XCTAssertEqual(NameTemplate.apply("  ", ctx), "DSCF1234-auto")
    }

    func testRefusedCharacters() {
        // Illegal characters (a camera or lens name with a slash, a folder in the template).
        var c = ctx
        c.lens = "FE 24-70mm F2.8 GM II / 2"
        XCTAssertEqual(NameTemplate.apply("{lens}/x:y", c), "FE 24-70mm F2.8 GM II _ 2_x_y")
        XCTAssertEqual(NameTemplate.sanitize("a*b?."), "a_b_")
        XCTAssertEqual(NameTemplate.sanitize("con"), "_con")
        XCTAssertEqual(NameTemplate.fileName("a", "jpg", 0), "a.jpg")
        XCTAssertEqual(NameTemplate.fileName("a", "jpg", 2), "a-002.jpg")
    }

    func testFreeNameNeverOverwrites() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("name-template-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(NameTemplate.freeName("a", "jpg", in: dir), "a.jpg")
        try Data().write(to: dir.appendingPathComponent("a.jpg"))
        XCTAssertEqual(NameTemplate.freeName("a", "jpg", in: dir), "a-001.jpg")
        try Data().write(to: dir.appendingPathComponent("a-001.jpg"))
        XCTAssertEqual(NameTemplate.freeName("a", "jpg", in: dir), "a-002.jpg")
    }

    func testRetouchAdjustmentAddsToPortraitRetouch() {
        var a = Adjustments.none
        a.retouch = 40
        var base = DevelopParams()
        base.portraitRetouch = 10
        let look = LookApplier.develop(base, look: Looks.natural, strength: 100, adjust: a, hasFace: true, preset: nil, lensPreset: nil)
        XCTAssertEqual(look.portraitRetouch, 50)
        let edits = LookApplier.applyEditsDevelop(base, adjust: a)
        XCTAssertEqual(edits.portraitRetouch, 50)
        a.retouch = 100
        XCTAssertEqual(LookApplier.applyEditsDevelop(base, adjust: a).portraitRetouch, 100)
    }
}
