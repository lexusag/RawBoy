<p align="center"><img src="branding/camera.svg" alt="RawBoy logo" width="160"></p>

# RawBoy

Android raw developer with an **AgX** tone mapper (RawBoy also offers Filmic and Sigmoid). Three apps share one engine:

- **RawBoy** (`app-pro`): every control (see [RawBoy controls](docs/rawboy.md)).
- **RawBoy Auto** (`app-auto`): develops raws automatically into a film look, one photo or a whole batch
  (see [RawBoy Auto](docs/auto.md)).
- **RawBoy Camera** (`app-camera`): a camera that previews the film look live and saves each raw shot as a
  JPEG developed by the same engine (see [RawBoy Camera](docs/camera.md)).
- **RawBoy Film** (`app-camera`, flavour `film`, `app.rawboy.camera.film`): the same camera, whose looks are film
  stocks simulated with [spektrafilm](https://github.com/andreavolpato/spektrafilm) (see
  [Film looks](docs/camera.md#film-looks-spektrafilm)). Licensed GPLv3 and developed in its own repository (see [Licence](#licence));
  installs next to RawBoy Camera. On iOS it is the `RawBoyFilm` target (same bundle id), on the `RawBoyFilmEngine` framework.
- **RawBoy Web** (`web/`): RawBoy and RawBoy Auto in the browser, plus **RawBoy Browser** for culling a folder of
  raws, as three tabs (see [RawBoy Web](docs/web.md)). Try it at **[app.rawboy.link](https://app.rawboy.link)**.

- Decoding: **LibRaw 0.21** (CR2/CR3/NEF/ARW/RAF/RW2/ORF/DNG…), with the **Adobe DNG SDK 1.7.1** as fallback for DNGs LibRaw can't read — notably DNG 1.7 with JPEG XL compression (setup: [third_party/README.md](third_party/README.md)). RawBoy Film is built without the DNG SDK (see [Licence](#licence)), so JPEG XL DNGs don't open in it (its own Pixel/iPhone DNGs go through LibRaw).
- Develop pipeline: GLES 3.0 fragment shader, so the preview updates in real time while sliders move.
  Export runs the same shader on full-resolution tiles.
- Export: JPEG (quality 1–100) or TIFF (8/16-bit, lossless LZW compression) to `Pictures/RawBoy/`.

## Documentation

- [RawBoy controls](docs/rawboy.md): sliders, LUTs, lens corrections and output naming
- [RawBoy Auto](docs/auto.md)
- [RawBoy Camera](docs/camera.md), including RawBoy Film's film looks
- [RawBoy Web](docs/web.md)
- [Pipeline](docs/pipeline.md): how a raw is developed
- [Building](docs/building.md), including release builds
- [Installing on your iPhone](docs/ios-install.md): build the iOS apps and sideload them with your Apple ID
- [Known limitations / next steps](docs/limitations.md)
- [Third-party components](docs/third-party.md)
- [Changelog](CHANGELOG.md)

## Licence

RawBoy's own code is licensed under the **PolyForm Shield License 1.0.0** ([LICENSE.md](LICENSE.md)): you can read,
build, change and use it, but not to make a product that competes with RawBoy. Third-party components keep their own
licences (see [Third-party components](docs/third-party.md)). Contributions come with the terms in
[CONTRIBUTING.md](CONTRIBUTING.md).

**RawBoy Film** (RawBoy Camera on spektrafilm's film stocks) is free software under the **GNU General Public License
version 3 or later**, because it includes code ported from spektrafilm (GPLv3). It lives in its own repository, which
holds its complete source: this repository's engine and camera plus the film-only files (`shaders/film/`,
`app-camera/src/film/`, `ios/Camera/film/`, `tools/spektrafilm_luts/`, its notices and the GPLv3 text). Those files
build only there: here the `film` flavours and iOS film passes switch off when they are missing.

The apps in this repository (RawBoy, RawBoy Auto, RawBoy Camera, RawBoy Web, iOS) contain no spektrafilm code; they
bundle spektrafilm's LUTs (CC BY-SA 4.0, see [Third-party components](docs/third-party.md)) for Auto's Film mode, which runs on RawBoy's own
`shaders/film_form.glsl`.
