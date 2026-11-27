import RawBoyEngine
import XCTest

/**
 * Unit tests for iOS camera orientation tracking (`Camera/capture/CameraOrientation.swift`): gravity-based quadrant
 * tracking with hysteresis and flat-pose memory, sensor-relative still rotation angles across iPhone models (including
 * iPhone 17's portrait-mounted front sensor), and landscape/portrait video rotation & dimensions.
 */
final class CameraOrientationTests: XCTestCase {
    func testGravityAllFourOrientations() {
        var tracker = DeviceOrientationTracker()
        tracker.update(ax: 0, ay: -1, az: 0)
        XCTAssertEqual(tracker.degrees, 0)
        XCTAssertTrue(tracker.hasGravityReading)

        tracker.update(ax: 1, ay: 0, az: 0)
        XCTAssertEqual(tracker.degrees, 90)

        tracker.update(ax: 0, ay: 1, az: 0)
        XCTAssertEqual(tracker.degrees, 180)

        tracker.update(ax: -1, ay: 0, az: 0)
        XCTAssertEqual(tracker.degrees, 270)

        tracker.update(ax: 0, ay: -1, az: 0)
        XCTAssertEqual(tracker.degrees, 0)
    }

    func testFlatPosePreservesLastOrientation() {
        var tracker = DeviceOrientationTracker()
        tracker.update(ax: 1, ay: 0, az: 0)
        XCTAssertEqual(tracker.degrees, 90)

        // Face up, face down, and nearly flat (|nz| > 0.85) must keep landscape instead of snapping to portrait.
        tracker.update(ax: 0, ay: 0, az: -1)
        XCTAssertEqual(tracker.degrees, 90)
        tracker.update(ax: 0, ay: 0, az: 1)
        XCTAssertEqual(tracker.degrees, 90)
        tracker.update(ax: 0.05, ay: -0.2, az: -0.97)
        XCTAssertEqual(tracker.degrees, 90)

        tracker.update(ax: -1, ay: 0, az: 0)
        XCTAssertEqual(tracker.degrees, 270)
        tracker.update(ax: 0, ay: 0, az: -1)
        XCTAssertEqual(tracker.degrees, 270)
    }

    func testTiltedDownwardOrUpwardStillDetectsLandscape() {
        var tracker = DeviceOrientationTracker()
        // Shooting 45° downward in landscapeRight: |nz| ≈ 0.707 <= 0.85.
        tracker.update(ax: 0.707, ay: 0, az: -0.707)
        XCTAssertEqual(tracker.degrees, 90)

        // Shooting 45° upward in landscapeLeft.
        tracker.update(ax: -0.707, ay: 0, az: 0.707)
        XCTAssertEqual(tracker.degrees, 270)
    }

    func testHysteresisNearDiagonal() {
        func tilt(_ degrees: Double) -> (Double, Double) {
            let r = degrees * .pi / 180.0
            return (sin(r), -cos(r))
        }

        var tracker = DeviceOrientationTracker()
        tracker.update(ax: 0, ay: -1, az: 0)
        XCTAssertEqual(tracker.degrees, 0)

        // 50° CW is past 45° but below 55° hysteresis threshold: stays portrait.
        let (x50, y50) = tilt(50)
        tracker.update(ax: x50, ay: y50, az: 0)
        XCTAssertEqual(tracker.degrees, 0)

        // 60° CW crosses threshold: switches to 90°.
        let (x60, y60) = tilt(60)
        tracker.update(ax: x60, ay: y60, az: 0)
        XCTAssertEqual(tracker.degrees, 90)

        // 40° CW is 50° away from 90°: stays 90°.
        let (x40, y40) = tilt(40)
        tracker.update(ax: x40, ay: y40, az: 0)
        XCTAssertEqual(tracker.degrees, 90)

        // 30° CW is 60° away from 90°: returns to 0°.
        let (x30, y30) = tilt(30)
        tracker.update(ax: x30, ay: y30, az: 0)
        XCTAssertEqual(tracker.degrees, 0)

        // Wrap-around across 0°/360° toward landscapeLeft (270°).
        let (x310, y310) = tilt(310)
        tracker.update(ax: x310, ay: y310, az: 0)
        XCTAssertEqual(tracker.degrees, 0)

        let (x300, y300) = tilt(300)
        tracker.update(ax: x300, ay: y300, az: 0)
        XCTAssertEqual(tracker.degrees, 270)
    }

    func testSeedUsedWhileFlatAndOverriddenByFirstGravityReading() {
        var tracker = DeviceOrientationTracker()
        tracker.seed(degrees: 90)
        tracker.update(ax: 0, ay: 0, az: -1)
        XCTAssertEqual(tracker.degrees, 90)
        XCTAssertFalse(tracker.hasGravityReading)

        // System notification fallback works while no gravity reading exists.
        tracker.updateFromSystem(degrees: 270)
        XCTAssertEqual(tracker.degrees, 270)

        // First non-flat gravity sample snaps immediately at 45° (without hysteresis from seed).
        let r50 = 50.0 * .pi / 180.0
        tracker.update(ax: sin(r50), ay: -cos(r50), az: 0)
        XCTAssertEqual(tracker.degrees, 90)
        XCTAssertTrue(tracker.hasGravityReading)

        // Once gravity is live, stale UIDevice notifications cannot override it.
        tracker.seed(degrees: 0)
        tracker.updateFromSystem(degrees: 0)
        XCTAssertEqual(tracker.degrees, 90)
    }

    func testPortraitAngleFromDefaultVideoAngle() {
        // Back lenses & iPhone ≤ 16 front: default 0° -> portrait 90°.
        XCTAssertEqual(CameraOrientation.portraitAngle(fromDefaultVideoAngle: 0), 90)
        // iPhone 17 / Pro / Pro Max / Air front: default 270° -> portrait 0°.
        XCTAssertEqual(CameraOrientation.portraitAngle(fromDefaultVideoAngle: 270), 0)
        // Spring 2024 iPad front: default 180° -> portrait 270°.
        XCTAssertEqual(CameraOrientation.portraitAngle(fromDefaultVideoAngle: 180), 270)
        XCTAssertEqual(CameraOrientation.portraitAngle(fromDefaultVideoAngle: 90), 180)
    }

    func testPhotoRotationAngleAllSensors() {
        // Back camera (all iPhones): portraitAngle = 90.
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 0, isFront: false), 90)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 90, isFront: false), 180)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 180, isFront: false), 270)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 270, isFront: false), 0)

        // iPhone ≤ 16 front camera: portraitAngle = 90.
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 0, isFront: true), 90)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 90, isFront: true), 0)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 180, isFront: true), 270)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 90, deviceDegrees: 270, isFront: true), 180)

        // iPhone 17 / Pro / Pro Max / Air front camera: portraitAngle = 0.
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 0, deviceDegrees: 0, isFront: true), 0)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 0, deviceDegrees: 90, isFront: true), 270)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 0, deviceDegrees: 180, isFront: true), 180)
        XCTAssertEqual(CameraOrientation.photoRotationAngle(portraitAngle: 0, deviceDegrees: 270, isFront: true), 90)
    }

    func testVideoTurnsAndCodedDimensions() {
        let cases: [(deg: Int, turns: Int, w: Int, h: Int)] = [
            (0, 0, 1080, 1920),
            (90, 1, 1920, 1080),
            (180, 2, 1080, 1920),
            (270, 3, 1920, 1080),
        ]
        for c in cases {
            let turns = CameraOrientation.videoTurns(deviceDegrees: c.deg)
            XCTAssertEqual(turns, c.turns)
            let size = CameraOrientation.videoSize(turns: turns, long: 1920, short: 1080)
            XCTAssertEqual(size.width, c.w)
            XCTAssertEqual(size.height, c.h)
            let sink = VideoSink(width: size.width, height: size.height, turns: turns)
            XCTAssertEqual(sink.width, c.w)
            XCTAssertEqual(sink.height, c.h)
            XCTAssertEqual(sink.turns, c.turns)
        }
    }
}
