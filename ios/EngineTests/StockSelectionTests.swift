import RawBoyEngine
import XCTest

/** Unit tests for film-stock grouping, notes, look stepping/neighbors, and viewfinder swipe orientation math. */
final class StockSelectionTests: XCTestCase {
    func testFilmStocksAreGroupedByFamilyWithNotes() {
        let sections = FilmLooks.sections(FilmLooks.all)
        XCTAssertEqual(sections.map(\.group), [.natural, .colorNegative, .cinema, .slide])
        XCTAssertEqual(sections.map { $0.looks.count }, [1, 6, 2, 4])
        XCTAssertEqual(sections.reduce(0) { $0 + $1.looks.count }, FilmLooks.all.count)

        let picker = Looks.pickerSections(FilmLooks.all)
        XCTAssertEqual(picker.map(\.label), ["Natural", "Colour negative", "Cinema print", "Slide"])
        XCTAssertEqual(Looks.categoryLabel(FilmLooks.byId("vision500t")), "Cinema print")
        XCTAssertEqual(Looks.categoryLabel(FilmLooks.byId("velvia100")), "Slide")
        XCTAssertEqual(Looks.categoryLabel(Looks.natural), "Natural")

        for look in FilmLooks.all + Looks.all {
            XCTAssertFalse((look.note ?? "").isEmpty, "Missing note on \(look.id)")
        }
    }

    func testStepAndNeighborsWrapCleanly() {
        let list = FilmLooks.all
        XCTAssertEqual(Looks.step(list, currentId: list[0].id, delta: 1)?.id, list[1].id)
        XCTAssertEqual(Looks.step(list, currentId: list[0].id, delta: -1, wrap: true)?.id, list.last?.id)
        XCTAssertNil(Looks.step(list, currentId: list[0].id, delta: -1, wrap: false))
        XCTAssertEqual(Looks.step(list, currentId: list.last!.id, delta: 1, wrap: true)?.id, list[0].id)
        XCTAssertNil(Looks.step(list, currentId: list.last!.id, delta: 1, wrap: false))
        XCTAssertNil(Looks.step([Looks.natural], currentId: Looks.natural.id, delta: 1))
        XCTAssertNil(Looks.step(list, currentId: list[0].id, delta: 0))

        let neighbors = Looks.neighbors(list, currentId: list[0].id)
        XCTAssertEqual(neighbors.map(\.id), [list[1].id, list.last!.id])
        XCTAssertTrue(Looks.neighbors([Looks.natural], currentId: Looks.natural.id).isEmpty)
    }

    func testSwipeStockDeltaAcrossAllTurns() {
        let threshold = 44.0
        // Portrait (turns = 0)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: -80, dy: 10, turns: 0, threshold: threshold), 1)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 80, dy: -10, turns: 0, threshold: threshold), -1)
        // 90° CW (turns = 1): screenDx = -dy
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 8, dy: 80, turns: 1, threshold: threshold), 1)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: -8, dy: -80, turns: 1, threshold: threshold), -1)
        // 180° (turns = 2): screenDx = -dx
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 80, dy: 5, turns: 2, threshold: threshold), 1)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: -80, dy: 5, turns: 2, threshold: threshold), -1)
        // 270° CW (turns = 3): screenDx = dy
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 5, dy: -80, turns: 3, threshold: threshold), 1)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 5, dy: 80, turns: 3, threshold: threshold), -1)

        // Rejected: short, vertical, diagonal
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: -30, dy: 0, turns: 0, threshold: threshold), 0)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: 0, dy: -120, turns: 0, threshold: threshold), 0)
        XCTAssertEqual(CameraOrientation.swipeStockDelta(dx: -70, dy: 60, turns: 0, threshold: threshold), 0)
    }
}
