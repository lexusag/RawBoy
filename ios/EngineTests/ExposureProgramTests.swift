import XCTest

/** Camera's Exposure program line (`Camera/capture/ExposureProgram.swift`): the same cases as Android's ExposureProgramTest. */
final class ExposureProgramTests: XCTestCase {
    private func program(_ ev: Float, _ t0: Int64, _ iso0: Float, isoMax: Int = 6400, maxStill: Int64 = 66_666_667) -> ExposureProgram.Exposure {
        ExposureProgram.compute(ev: ev, t0Ns: t0, iso0: iso0, isoMin: 50, isoMax: isoMax, expMin: 10_000,
                                expMax: 1_000_000_000, maxStillNs: maxStill)
    }

    private func ev(_ e: ExposureProgram.Exposure, _ t0: Int64, _ iso0: Float) -> Float {
        ExposureProgram.capturedEv(exposureNs: e.exposureNs, iso: Float(e.iso), meteredGain: Double(t0) / 1e9 * Double(iso0))
    }

    func testZeroKeepsTheMeteredExposure() {
        let e = program(0, 4_000_000, 100)
        XCTAssertEqual(e.exposureNs, 4_000_000)
        XCTAssertEqual(e.iso, 100)
    }

    func testBrighterLengthensTheTimeFirst() {
        // Daylight 1/1000 s ISO 50: +2 EV is 1/250 s at the same ISO.
        let e = program(2, 1_000_000, 50)
        XCTAssertEqual(e.exposureNs, 4_000_000)
        XCTAssertEqual(e.iso, 50)
        XCTAssertEqual(ev(e, 1_000_000, 50), 2, accuracy: 0.01)
    }

    func testBrighterRaisesIsoPastTheHandheldLimit() {
        // Indoors 1/30 s ISO 800: +1 EV stays at 1/30 s, ISO 1600.
        let e = program(1, ExposureProgram.handheldNs, 800)
        XCTAssertEqual(e.exposureNs, ExposureProgram.handheldNs)
        XCTAssertEqual(e.iso, 1600)
    }

    func testBrighterAtTheIsoCeilingLengthensUpToTheStillLimit() {
        // Dark: 1/30 s ISO 3200, ceiling 6400, still limit 1/15 s: +3 EV gets 2 EV in the raw, the rest stays digital.
        let e = program(3, ExposureProgram.handheldNs, 3200)
        XCTAssertEqual(e.iso, 6400)
        XCTAssertEqual(e.exposureNs, 66_666_667)
        XCTAssertEqual(ev(e, ExposureProgram.handheldNs, 3200), 2, accuracy: 0.01)
    }

    func testDarkerLowersIsoThenShortensTheTime() {
        // 1/100 s ISO 200: -3 EV = ISO 50 (-2 EV), then 1/200 s.
        let e = program(-3, 10_000_000, 200)
        XCTAssertEqual(e.iso, 50)
        XCTAssertEqual(e.exposureNs, 5_000_000)
        XCTAssertEqual(ev(e, 10_000_000, 200), -3, accuracy: 0.01)
    }

    func testDarkerAtTheSensorLimitStaysPartlyDigital() {
        // Already at the shortest time and lowest ISO: nothing darker reaches the raw.
        let e = ExposureProgram.compute(ev: -2, t0Ns: 10_000, iso0: 50, isoMin: 50, isoMax: 6400, expMin: 10_000,
                                        expMax: 1_000_000_000, maxStillNs: 66_666_667)
        XCTAssertEqual(e.exposureNs, 10_000)
        XCTAssertEqual(e.iso, 50)
    }

    func testFlickerSafeTimesStayWholePeriods() {
        // 50 Hz room at 1/100 s ISO 400: +1 EV wants 20 ms, two whole periods.
        let e = program(1, 10_000_000, 400)
        XCTAssertEqual(e.exposureNs, 20_000_000)
        XCTAssertEqual(e.iso, 400)
        // +0.67 EV wants ~15.9 ms: one period and the ISO makes up the rest.
        let f = program(2.0 / 3.0, 10_000_000, 400)
        XCTAssertEqual(f.exposureNs, 10_000_000)
        XCTAssertEqual(f.iso, 635)
    }

    func testFlickerPeriods() {
        XCTAssertEqual(ExposureProgram.flickerPeriodNs(10_000_000), 10_000_000)
        XCTAssertEqual(ExposureProgram.flickerPeriodNs(30_000_000), 10_000_000)
        XCTAssertEqual(ExposureProgram.flickerPeriodNs(16_666_667), 8_333_333)
        XCTAssertNil(ExposureProgram.flickerPeriodNs(4_000_000))
        XCTAssertNil(ExposureProgram.flickerPeriodNs(13_000_000))
    }

    func testSettingsSnapToThirds() {
        XCTAssertEqual(ExposureProgram.snap(0.4), 1.0 / 3.0, accuracy: 1e-5)
        XCTAssertEqual(ExposureProgram.snap(5), 3)
        XCTAssertEqual(ExposureProgram.snap(-5), -3)
    }
}
