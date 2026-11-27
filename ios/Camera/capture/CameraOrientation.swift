import Foundation

/**
 * Tracks how the phone is held (0, 90, 180 or 270 degrees clockwise from upright portrait) from the gravity vector,
 * keeping the last orientation while the phone lies flat and using hysteresis near 45° so photos and videos do not
 * flip between portrait and landscape unexpectedly. Works regardless of Portrait Orientation Lock and without relying
 * on `UIDevice.orientation` (which reports `.unknown` or `.faceUp`/`.faceDown` until tilted).
 */
struct DeviceOrientationTracker: Equatable, Sendable {
    /** Beyond this |nz| (within ~31° of flat face-up/face-down), keep the last orientation. */
    static let flatZThreshold = 0.85
    /** Minimum in-plane gravity magnitude required to read an orientation. */
    static let minPlanarMagnitude = 0.35
    /** Degrees past the current quadrant centre before switching (10° past the 45° diagonal). */
    static let hysteresisDegrees = 55.0

    /** Current hold angle clockwise from upright portrait: 0, 90, 180 or 270. */
    private(set) var degrees: Int = 0
    /** True once at least one non-flat gravity sample has been observed. */
    private(set) var hasGravityReading = false

    init(degrees: Int = 0) {
        self.degrees = Self.normalize(degrees)
    }

    /** Rounds any degree angle to the nearest 90° multiple in {0, 90, 180, 270}. */
    static func normalize(_ degrees: Int) -> Int {
        let m = ((degrees % 360) + 360) % 360
        return ((m + 45) / 90 % 4) * 90
    }

    /**
     * Updates [degrees] from a gravity / acceleration sample in CoreMotion's device frame (portrait upright = (0, -1, 0),
     * rotated 90° clockwise / landscapeRight = (+1, 0, 0)). Flat samples keep the previous orientation.
     */
    mutating func update(ax: Double, ay: Double, az: Double) {
        let mag = sqrt(ax * ax + ay * ay + az * az)
        guard mag > 0.1 else { return }
        let nx = ax / mag
        let ny = ay / mag
        let nz = az / mag
        guard abs(nz) <= Self.flatZThreshold, hypot(nx, ny) >= Self.minPlanarMagnitude else { return }

        var angle = atan2(nx, -ny) * 180.0 / .pi
        if angle < 0 { angle += 360.0 }

        if !hasGravityReading {
            degrees = Self.quadrant(for: angle)
            hasGravityReading = true
            return
        }

        var diff = (angle - Double(degrees)).truncatingRemainder(dividingBy: 360.0)
        if diff > 180.0 {
            diff -= 360.0
        } else if diff <= -180.0 {
            diff += 360.0
        }
        if abs(diff) >= Self.hysteresisDegrees {
            degrees = Self.quadrant(for: angle)
        }
    }

    /** Seeds [degrees] from a system orientation (UIDevice / UIWindowScene) before the first gravity reading arrives. */
    mutating func seed(degrees: Int) {
        guard !hasGravityReading else { return }
        self.degrees = Self.normalize(degrees)
    }

    /** Fallback update from system orientation notifications when CoreMotion gravity is unavailable (e.g. simulator). */
    mutating func updateFromSystem(degrees: Int) {
        guard !hasGravityReading else { return }
        self.degrees = Self.normalize(degrees)
    }

    /**
     * Marks any previous gravity reading as stale (called when pausing/backgrounding CoreMotion) so the next session
     * can re-seed while flat and snaps immediately on the first fresh non-flat sample without hysteresis against the
     * previous session's orientation.
     */
    mutating func invalidateGravity() {
        hasGravityReading = false
    }

    private static func quadrant(for angle: Double) -> Int {
        (Int(((angle + 45.0) / 90.0).rounded(.down)) % 4) * 90
    }
}

/**
 * Pure orientation mappings for iOS photo capture and video recording, shared by `CameraController`, `VideoRecorder`
 * and unit tests.
 */
enum CameraOrientation {
    /**
     * The `AVCaptureConnection.videoRotationAngle` that makes this camera upright in portrait, derived from the fresh
     * `AVCaptureVideoDataOutput` connection's default `videoRotationAngle` before it is zeroed:
     * - Back cameras & iPhone ≤ 16 front: default 0° -> 90°
     * - iPhone 17 / Pro / Pro Max / Air front (portrait-mounted sensor): default 270° -> 0°
     * - Spring 2024 iPad front: default 180° -> 270°
     */
    static func portraitAngle(fromDefaultVideoAngle defaultAngle: Int) -> Int {
        DeviceOrientationTracker.normalize(defaultAngle + 90)
    }

    /**
     * `AVCaptureConnection.videoRotationAngle` for a horizon-level still capture given the lens's [portraitAngle], how
     * the phone is held ([deviceDegrees], clockwise from portrait), and whether the lens faces the user ([isFront]).
     * Matches `AVCaptureDevice.RotationCoordinator.videoRotationAngleForHorizonLevelCapture` on all sensor mountings.
     */
    static func photoRotationAngle(portraitAngle: Int, deviceDegrees: Int, isFront: Bool) -> Int {
        let p = DeviceOrientationTracker.normalize(portraitAngle)
        let d = DeviceOrientationTracker.normalize(deviceDegrees)
        return isFront ? (p - d + 360) % 360 : (p + d) % 360
    }

    /**
     * Clockwise quarter turns applied to the upright portrait viewfinder frame to make a recorded video level with the
     * horizon: 0 (portrait), 1 (90° CW / landscapeRight), 2 (upside down), 3 (90° CCW / landscapeLeft).
     */
    static func videoTurns(deviceDegrees: Int) -> Int {
        (DeviceOrientationTracker.normalize(deviceDegrees) / 90) % 4
    }

    /** Coded output frame dimensions (width, height) for a video rotated by [turns] clockwise quarter turns. */
    static func videoSize(turns: Int, long: Int, short: Int) -> (width: Int, height: Int) {
        let k = ((turns % 4) + 4) % 4
        return k % 2 == 1 ? (long, short) : (short, long)
    }

    /**
     * Turns a drag translation (`dx`, `dy`) measured in upright-portrait viewfinder coordinates (inside `Turned`)
     * back into screen coordinates and decides whether it is a horizontal swipe to step stocks:
     * -1 for swipe right (previous stock), +1 for swipe left (next stock), 0 otherwise.
     */
    static func swipeStockDelta(dx: Double, dy: Double, turns: Int, threshold: Double) -> Int {
        let k = ((turns % 4) + 4) % 4
        let screenDx: Double
        let screenDy: Double
        switch k {
        case 0: (screenDx, screenDy) = (dx, dy)
        case 1: (screenDx, screenDy) = (-dy, dx)
        case 2: (screenDx, screenDy) = (-dx, -dy)
        default: (screenDx, screenDy) = (dy, -dx)
        }
        if abs(screenDx) < threshold || abs(screenDx) <= abs(screenDy) * 1.5 { return 0 }
        return screenDx < 0 ? 1 : -1
    }
}
