import XCTest
@testable import RawBoyEngine

/** Film stock scrolling on the Mac: one stock per wheel click, a trackpad swipe a few (web's `stepWheel` cases). */
final class WheelStepperTests: XCTestCase {
    func testEveryMouseClickStepsOnceHoweverFarItAccelerated() {
        var w = WheelStepper()
        XCTAssertEqual(w.step(delta: 1, precise: false, time: 0), 1)
        XCTAssertEqual(w.step(delta: 1, precise: false, time: 0.01), 1)  // a fast second click
        XCTAssertEqual(w.step(delta: 6, precise: false, time: 0.02), 1)  // accelerated
        XCTAssertEqual(w.step(delta: -1, precise: false, time: 0.03), -1)
    }

    func testTrackpadStepsAtTheStartThenEveryStepPoints() {
        var w = WheelStepper()
        XCTAssertEqual(w.step(delta: 3, precise: true, time: 0), 1)
        var total = 0
        for i in 1...10 { total += w.step(delta: 10, precise: true, time: Double(i) * 0.016) }
        XCTAssertEqual(total, 2)  // 100 points after the first: two steps of 40, 20 carried
    }

    func testTrackpadSmallDeltasAddUp() {
        var w = WheelStepper()
        _ = w.step(delta: 1, precise: true, time: 0)
        var steps = 0
        for i in 1...7 { steps += w.step(delta: 6, precise: true, time: Double(i) * 0.016) }
        XCTAssertEqual(steps, 1)  // 42 points
    }

    func testNewGestureAfterAPauseOrTurnStepsAtOnce() {
        var w = WheelStepper()
        XCTAssertEqual(w.step(delta: 5, precise: true, time: 0), 1)
        XCTAssertEqual(w.step(delta: 5, precise: true, time: 0.5), 1)    // paused
        XCTAssertEqual(w.step(delta: -5, precise: true, time: 0.51), -1)  // turned round
    }

    func testZeroAndNonFiniteDeltasDoNothing() {
        var w = WheelStepper()
        XCTAssertEqual(w.step(delta: 0, precise: false, time: 0), 0)
        XCTAssertEqual(w.step(delta: .nan, precise: true, time: 0), 0)
    }

    func testTargetClampsAtTheEnds() {
        let ids = ["a", "b", "c"]
        XCTAssertEqual(WheelStepper.target(in: ids, current: "a", steps: 1), "b")
        XCTAssertEqual(WheelStepper.target(in: ids, current: "a", steps: 5), "c")
        XCTAssertNil(WheelStepper.target(in: ids, current: "c", steps: 1))
        XCTAssertNil(WheelStepper.target(in: ids, current: "a", steps: -1))
        XCTAssertNil(WheelStepper.target(in: ids, current: "zzz", steps: 1))
    }
}
