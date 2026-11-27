**Camera: fix DNG embedded preview orientation on Android and iOS (Android + iOS, 2026-11-27)**

- Portrait RAWs (and reverse-landscape / mirrored RAWs) showed sideways or upside-down in gallery apps because embedded processed DNG previews were written already upright while the DNG's IFD0 `Orientation` tag still applied on top of them.
- Embedded DNG previews are now inverse-oriented back into sensor orientation before JPEG encoding (matching the DNG specification, where IFD0 `Orientation` applies to both raw and preview IFDs), and the viewfinder shutter thumbnail re-applies the DNG orientation so it stays upright in RAW-only mode.
- Code: `engine/src/main/java/app/rawboy/export/PreviewOrientation.kt`, `engine/src/main/java/app/rawboy/export/Exporter.kt`, `app-camera/src/main/java/app/rawboy/camera/ShotSaver.kt`, `ios/Engine/app/rawboy/export/PreviewOrientation.swift`, `ios/Engine/app/rawboy/export/Exporter.swift`, `ios/Camera/CameraViewModel.swift`; Tests: `PreviewOrientationTest`.
