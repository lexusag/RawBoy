<p align="center"><img src="branding/camera.svg" alt="RawBoy logo" width="160"></p>

# RawBoy

Android raw developer with an **AgX** tone mapper (RawBoy also offers Filmic and Sigmoid). Four apps share one engine:

- **RawBoy** (`app-pro`): every control (see [RawBoy controls](docs/rawboy.md)).
- **RawBoy Auto** (`app-auto`): develops raws automatically into a film look, one photo or a whole batch
  (see [RawBoy Auto](docs/auto.md)).
- **RawBoy Camera** (`app-camera`): a camera that previews the film look live and saves each raw shot as a
  JPEG developed by the same engine (see [RawBoy Camera](docs/camera.md)).
- **RawBoy Film** (`app-camera`, flavour `film`, `app.rawboy.camera.film`): the same camera, whose looks are the
  film stocks of RawBoy Auto's Film mode (see [Film looks](docs/camera.md#film-looks)); installs next to RawBoy
  Camera. On iOS it is the `RawBoyFilm` target (same bundle id).
- **RawBoy Web** (`web/`): RawBoy and RawBoy Auto in the browser, plus **RawBoy Browser** for culling a folder of
  raws, as three tabs (see [RawBoy Web](docs/web.md)). Try it at **[app.rawboy.link](https://app.rawboy.link)**.

- Decoding: **LibRaw 0.21** (CR2/CR3/NEF/ARW/RAF/RW2/ORF/DNG…), with the **Adobe DNG SDK 1.7.1** as fallback for DNGs LibRaw can't read — notably DNG 1.7 with JPEG XL compression (setup: [third_party/README.md](third_party/README.md)).
- Develop pipeline: GLES 3.0 fragment shader, so the preview updates in real time while sliders move.
  Export runs the same shader on full-resolution tiles.
- Export: JPEG (quality 1–100) or TIFF (8/16-bit, lossless LZW compression) to `Pictures/RawBoy/`.

## Documentation

- [RawBoy controls](docs/rawboy.md): sliders, LUTs, lens corrections and output naming
- [RawBoy Auto](docs/auto.md)
- [RawBoy Camera](docs/camera.md), including RawBoy Film's film looks
- [RawBoy Web](docs/web.md)
- [Google Drive in RawBoy Web](docs/google-drive.md): setting up opening from and saving to Drive
- [Pipeline](docs/pipeline.md): how a raw is developed
- [Building](docs/building.md), including release builds
- [Publishing to Google Play](docs/google-play.md): the manual Play upload workflow and its one-time setup
- [Installing on your iPhone](docs/ios-install.md): build the iOS apps and sideload them with your Apple ID
- [Known limitations / next steps](docs/limitations.md)
- [Third-party components](docs/third-party.md)
- [Changelog](CHANGELOG.md)

## Repository structure

| Path | What it holds |
| --- | --- |
| `engine/` | Shared Android library (`:engine`): the native C++ decoder and exporter (`src/main/cpp/`: LibRaw, DNG SDK fallback, lens opcodes, blemish healing, jpegli) and the Kotlin engine (GL preview and export, lens math, presets, sessions, Auto's analysis and looks). Anything two apps need lives here. |
| `app-pro/` | **RawBoy** for Android (`:app-pro`): the full editor UI. |
| `app-auto/` | **RawBoy Auto** for Android (`:app-auto`): batch queue, grid and detail screens. |
| `app-camera/` | **RawBoy Camera** (`standard` flavour) and **RawBoy Film** (`film` flavour: `src/film/`, its looks, name and icon) for Android (`:app-camera`). |
| `shaders/` | The develop GLSL (develop, denoise, bokeh, light leaks, film formation): the single source of truth for Android, iOS and the web (see [shaders/README.md](shaders/README.md)). |
| `ios/` | The iOS apps, generated with XcodeGen from `project.yml`: `Pro/`, `Auto/` and `Camera/` app targets (`Camera/` also builds RawBoy Film from `Camera/film/`), `Engine/` (the Swift/Metal port of the engine), `EngineTests/`, `native/` (the C++ engine built as frameworks), `shaders/` (generates the Metal shaders from the root `shaders/`) and `mediapipe/` (model fetch). |
| `web/` | **RawBoy Web** (Vite + React + TypeScript): `src/engine/` is the TypeScript port of the Kotlin engine, `src/ui/` the RawBoy, Auto and Browser tabs, `src/worker/` the Web Workers, `src/drive/` Google Drive, and `native/` the C++ engine compiled to WebAssembly. Also its Dockerfile and nginx config (see [web/README.md](web/README.md)). |
| `luts/` | Bundled `.cube` film-look LUTs, plus `spektrafilm/` (spektrafilm's film stock LUTs, CC BY-SA 4.0). |
| `docs/` | User and developer documentation (see [Documentation](#documentation)). |
| `tools/` | Developer tools: `auto-eval` (measuring Auto's defaults against a tagged dataset), `burst_merge` and `dng_jxl` (host tests for burst merging and lossy JPEG XL DNGs), `display_roundtrip` (display-source round-trip checks), `film_luts` (LUT generation), `icons` (app icons from `branding/`) and `web_ui_stub` (runs the web UI without the WASM build). |
| `branding/` | App logos (SVG) for RawBoy, Auto, Camera and Film. |
| `third_party/` | Where the Adobe DNG SDK goes for builds (see [third_party/README.md](third_party/README.md)). |
| `licenses/` | Third-party notices shipped with the apps. |
| `gradle/`, `*.gradle.kts`, `gradlew` | The Gradle build for the Android modules. |
| `.github/workflows/` | CI: `release.yml` (release APKs of all four apps, and the web deploy) and `play.yml` (run by hand: signed bundles uploaded to Google Play). |

Root files: [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), [LICENSE.md](LICENSE.md),
[UI.md](UI.md) (UI backlog) and [CLAUDE.md](CLAUDE.md) (notes on how the code fits together).

## Licence

RawBoy's own code is licensed under the **PolyForm Shield License 1.0.0** ([LICENSE.md](LICENSE.md)): you can read,
build, change and use it, but not to make a product that competes with RawBoy. Third-party components keep their own
licences (see [Third-party components](docs/third-party.md)). Contributions come with the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).

This covers **RawBoy Film** too. None of the apps (RawBoy, RawBoy Auto, RawBoy Camera, RawBoy Film, RawBoy Web, iOS)
contain spektrafilm code: they bundle spektrafilm's film and print LUTs (CC BY-SA 4.0, see
[Third-party components](docs/third-party.md)), which RawBoy Film's looks and Auto's Film mode render with RawBoy's
own `shaders/film_form.glsl`.

Earlier RawBoy Film releases, built from `lexusag/RawBoyFilm`, included
code ported from spektrafilm and were licensed GPLv3; their complete source stays in that repository, which is no
longer developed.
