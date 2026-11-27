**Camera: stop viewfinder rendering while Settings is open (Android & iOS, 2026-11-27)**

- Opening Settings in RawBoy Camera now pauses viewfinder GPU rendering and per-frame readbacks (auto-develop, QR, subject tracking) until Settings is dismissed, while keeping active video recordings running without interruption.
- Code: `engine/src/main/java/app/rawboy/gl/ViewfinderRenderer.kt`, `engine/src/main/java/app/rawboy/gl/RawViewfinder.kt`, `app-camera/src/main/java/app/rawboy/camera/ui/Viewfinder.kt`, `app-camera/src/main/java/app/rawboy/camera/ui/CameraScreen.kt`, `ios/Engine/app/rawboy/metal/ViewfinderRenderer.swift`, `ios/Engine/app/rawboy/view/Viewfinder.swift`, `ios/Camera/ui/CameraScreen.swift`, `ios/Camera/CameraViewModel.swift`; Tests: `RawPreviewFramesTest`, `ViewfinderTests`.
