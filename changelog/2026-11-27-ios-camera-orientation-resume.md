**Camera: harden iOS orientation tracking across background resume and CoreMotion errors (iOS, 2026-11-27)**

- Invalidating gravity freshness on background (`DeviceOrientationTracker.invalidateGravity` in `CameraViewModel.stopOrientationTracking`) ensures resuming the camera while flat or near 45° re-seeds cleanly and snaps on the first fresh gravity reading instead of keeping a stale orientation from the previous session.
- `CameraViewModel.startMotion` now logs `CMDeviceMotion` errors and falls back to raw accelerometer updates, and `currentDeviceDegrees` only polls active CoreMotion streams so stopped or errored streams cannot supply stale gravity values under Portrait Orientation Lock.
- Code: `ios/Camera/capture/CameraOrientation.swift`, `ios/Camera/CameraViewModel.swift`. Tests: `ios/EngineTests/CameraOrientationTests.swift` (`testInvalidateGravityAllowsReseedAndImmediateSnap`; compiled and run by CI).
