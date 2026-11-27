**Camera power double-press default camera and setting (Android, 2026-11-27)**

- Launching RawBoy Camera via a power-button double press (`STILL_IMAGE_CAMERA` / `STILL_IMAGE_CAMERA_SECURE`) now opens the back **W** camera by default (on both cold and warm launches), regardless of which lens was previously active.
- Added **Settings › Power double-press camera** (accessible in both Street and full camera modes) to choose between **Selected camera** (any back lens such as `UW`, `W`, `T`, or `Selfie`, defaulting to `W`) and **Last opened** (reopens whichever camera and lens were used last, even when *Remember camera & settings* is off).
- Code: `app-camera/.../CameraSettings.kt`, `CameraActivity.kt`, `CameraViewModel.kt`, `FastLensCache.kt`, `ui/CameraScreen.kt`, `ui/Help.kt`, `i18n/StringsUk.kt`; Docs: `docs/camera.md`, `docs/features-camera.md`; Tests: `CameraSettingsTest.kt`, `StringsTest.kt`.
