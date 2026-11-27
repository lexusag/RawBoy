**Camera: remove persistent top-right loaded-stock badge over the viewfinder (Android, iOS, 2026-11-27)**

- Removed the persistent top-right loaded-stock badge from the viewfinder so the frame stays uncluttered (the active stock remains visible on the stock picker button below the viewfinder and briefly in the transient HUD when swiping or switching modes).
- Code: `app-camera/.../ui/CameraScreen.kt`, `ui/Help.kt`, `i18n/StringsUk.kt`; `ios/Camera/ui/CameraScreen.swift`, `ui/Help.swift`; `docs/camera.md`, `docs/features-camera.md`, `CLAUDE.md`. Tests: `StockSelectionTest`, `StringsTest`.
