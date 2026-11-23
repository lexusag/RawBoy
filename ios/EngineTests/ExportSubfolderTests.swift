import XCTest
@testable import RawBoyEngine

final class ExportSubfolderTests: XCTestCase {
    private var day: Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: DateComponents(year: 2026, month: 11, day: 3, hour: 12))!
    }
    private var utc: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }

    func testPlainNamesAreTrimmed() {
        XCTAssertEqual(ExportSubfolder.clean("Paris"), "Paris")
        XCTAssertEqual(ExportSubfolder.clean("  Paris 2026  "), "Paris 2026")
        XCTAssertEqual(ExportSubfolder.clean(""), "")
        XCTAssertEqual(ExportSubfolder.clean("   "), "")
    }

    func testDateToken() {
        XCTAssertEqual(ExportSubfolder.clean("Export {date}", now: day, calendar: utc), "Export 2026-11-03")
        XCTAssertEqual(ExportSubfolder.clean("{DATE}", now: day, calendar: utc), "2026-11-03")
    }

    func testSeparatorsAndRefusedCharactersBecomeDashes() {
        XCTAssertEqual(ExportSubfolder.clean("a/b\\c"), "a-b-c")
        XCTAssertEqual(ExportSubfolder.clean("a:b*c?\"d<e>f|g"), "a-b-c--d-e-f-g")
        XCTAssertEqual(ExportSubfolder.clean("x\ny"), "x-y")
    }

    func testNoDotDotAndNoHiddenNames() {
        XCTAssertEqual(ExportSubfolder.clean(".."), "")
        XCTAssertEqual(ExportSubfolder.clean("../.."), "-")
        XCTAssertEqual(ExportSubfolder.clean(".hidden"), "hidden")
        XCTAssertEqual(ExportSubfolder.clean("name."), "name")
        XCTAssertEqual(ExportSubfolder.clean(" . "), "")
    }

    func testLengthCapAndApply() {
        XCTAssertEqual(ExportSubfolder.clean(String(repeating: "a", count: 300)).count, 100)
        let base = URL(fileURLWithPath: "/tmp/out", isDirectory: true)
        XCTAssertEqual(ExportSubfolder.apply("", to: base), base)
        XCTAssertEqual(ExportSubfolder.apply("../x", to: base).path, "/tmp/out/-x")
        XCTAssertEqual(ExportSubfolder.apply("Paris", to: base).path, "/tmp/out/Paris")
    }
}
