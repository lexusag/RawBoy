# Third-party components

This product includes DNG technology under license by Adobe.

Every component's copyright notice and licence is in [licenses/THIRD_PARTY_NOTICES.txt](../licenses/THIRD_PARTY_NOTICES.txt),
which the apps (overflow menu, or Camera's Settings → *Open-source licences*) and RawBoy Web (**Licences** in the help) show.
Update it when a dependency is added or upgraded.

- [spektrafilm](https://github.com/andreavolpato/spektrafilm) by Andrea Volpato (its code is GPLv3; its profiles and
  LUTs are CC BY-SA 4.0, [SPEKTRAFILM_LICENSE.txt](../luts/spektrafilm/SPEKTRAFILM_LICENSE.txt)): the film and print
  LUTs of RawBoy Film's looks and Auto's Film mode. The LUTs in `luts/spektrafilm/` are spektrafilm's own bake
  (attribution in every `.cube` header; RawBoy's changes in [CHANGELOG.txt](../luts/spektrafilm/CHANGELOG.txt)) and stay
  CC BY-SA 4.0. **No spektrafilm code is used**: grain, halation and scatter are RawBoy's own
  (`shaders/film_form.glsl`, parameters in `formation.json`), so no app is GPL. As its author asks: credit it (RawBoy
  Film's Settings, the app help and these notices do), don't sell the LUTs as a LUT pack, don't train commercial AI
  models on them or their output, and don't use the spektrafilm name in product branding.
- [LibRaw](https://www.libraw.org/) (dual LGPL 2.1 / CDDL 1.0; RawBoy uses it under the **CDDL 1.0** in every app; unmodified, source at
  [LibRaw 0.21.3](https://github.com/LibRaw/LibRaw/tree/0.21.3)) — raw decoding. Don't edit LibRaw's own files: under the CDDL,
  modified LibRaw files would have to be published.
- [Adobe DNG SDK 1.7.1](https://helpx.adobe.com/camera-raw/digital-negative.html) ([DNG SDK License Agreement](../third_party/DNG_SDK_LICENSE.txt) and the DNG patent license) with its bundled libjxl (BSD-3-Clause), Brotli (MIT), Highway and skcms (BSD-3-Clause) — DNG 1.7 / JPEG XL DNGs; downloaded from Adobe, not committed, see third_party/README.md
- [jpegli](https://github.com/google/jpegli) (BSD-3-Clause) with [Highway](https://github.com/google/highway) (Apache 2.0 / BSD-3-Clause) and libjpeg-turbo's API headers (IJG / BSD-3-Clause) — RawBoy Camera's JPEG encoder; fetched at build time
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache 2.0) and its *selfie multiclass segmentation* and *Face Landmarker* models (Apache 2.0, `engine/src/main/assets/models/`) — skin detection and facial-feature protection for Skin retouch and Blemish removal
- Bundled LUTs in `luts/` (besides `luts/spektrafilm/`, above): the film `.cube` files are generated with [spectral_film_lut](https://github.com/JanLohse/spectral_film_lut) (MIT) by `tools/film_luts/generate.py`; `Redscale.png` is RawBoy's own
- Android apps: [AndroidX and Jetpack Compose](https://developer.android.com/jetpack), the Kotlin standard library and [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) (Apache 2.0); [ZXing core](https://github.com/zxing/zxing) (Apache 2.0) — RawBoy Camera's QR codes. The iOS apps use only Apple's frameworks besides the native libraries above
- RawBoy Web: [React and React DOM](https://react.dev/) with scheduler (MIT), [fflate](https://github.com/101arrowz/fflate) (MIT) — zip export, [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT) — cross-origin isolation for multithreaded wasm, zlib (zlib licence, Emscripten port) and MediaPipe Tasks Vision (above)

Build-time tools that ship nothing (glslang, SPIRV-Cross, CMake, Gradle) aren't listed.

## Used as inspiration only (no code copied)

- [darktable](https://www.darktable.org) (GPLv3): the idea of Pro's RGB primaries control. Reimplemented from its
  description.
- [spektrafilm](https://github.com/andreavolpato/spektrafilm)'s methods (its code is GPLv3): the diffusion-filter
  bloom model, the log-domain grain and the pre-clip highlight reconstruction in the develop shader follow its
  published approach. Reimplemented, not copied.
- AgX (Troy Sobotka), as in Blender 4, Filament and three.js: the tone mapper's constants. Apple's published *Apple Log
  Profile* curve is used for the film LUTs' input encoding.

RawBoy's rule (see CLAUDE.md): GPL and other copyleft code never goes into this repository, for any app including RawBoy
Film. The earlier GPLv3 RawBoy Film releases were built from the separate `lexusag/RawBoyFilm` repository, which keeps
their source.
