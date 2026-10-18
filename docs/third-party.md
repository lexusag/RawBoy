# Third-party components

This product includes DNG technology under license by Adobe.

Every component's copyright notice and licence is in [licenses/THIRD_PARTY_NOTICES.txt](../licenses/THIRD_PARTY_NOTICES.txt),
which the apps (overflow menu, or Camera's Settings → *Open-source licences*) and RawBoy Web (**Licences** in the help) show.
Update it when a dependency is added or upgraded.

- [spektrafilm](https://github.com/andreavolpato/spektrafilm) by Andrea Volpato (code GPLv3; profiles and LUTs
  CC BY-SA 4.0, [SPEKTRAFILM_LICENSE.txt](../luts/spektrafilm/SPEKTRAFILM_LICENSE.txt)): its film stocks. The film/print
  LUTs in `luts/spektrafilm/` are spektrafilm's own bake (attribution in every `.cube` header; RawBoy's changes in
  [CHANGELOG.txt](../luts/spektrafilm/CHANGELOG.txt)), bundled with every app (Auto's Film mode, RawBoy Film). Only
  RawBoy Film (its own repository) ports its code (grain, halation and scatter); the apps here use RawBoy's own
  (`shaders/film_form.glsl`) and stay GPL-free. Film modeling powered by spektrafilm. As its author asks: don't sell the LUTs as a LUT pack,
  don't train commercial AI models on them or their output, and don't use the spektrafilm name in product branding.
- [LibRaw](https://www.libraw.org/) (dual LGPL 2.1 / CDDL 1.0; RawBoy uses it under the **CDDL 1.0**, RawBoy Film under the **LGPL 2.1**; unmodified, source at
  [LibRaw 0.21.3](https://github.com/LibRaw/LibRaw/tree/0.21.3)) — raw decoding. Don't edit LibRaw's own files: under the CDDL,
  modified LibRaw files would have to be published.
- [Adobe DNG SDK 1.7.1](https://helpx.adobe.com/camera-raw/digital-negative.html) ([DNG SDK License Agreement](../third_party/DNG_SDK_LICENSE.txt) and the DNG patent license) with its bundled libjxl (BSD-3-Clause), Brotli (MIT), Highway and skcms (BSD-3-Clause) — DNG 1.7 / JPEG XL DNGs; downloaded from Adobe, not committed, see third_party/README.md
- [jpegli](https://github.com/google/jpegli) (BSD-3-Clause) with [Highway](https://github.com/google/highway) (Apache 2.0 / BSD-3-Clause) and libjpeg-turbo's API headers (IJG / BSD-3-Clause) — RawBoy Camera's JPEG encoder; fetched at build time
- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache 2.0) and its *selfie multiclass segmentation* and *Face Landmarker* models (Apache 2.0, `engine/src/main/assets/models/`) — skin detection and facial-feature protection for Skin retouch and Blemish removal
- Bundled LUTs in `luts/`: the film `.cube` files are generated with [spectral_film_lut](https://github.com/JanLohse/spectral_film_lut) (MIT) by `tools/film_luts/generate.py`; `Redscale.png` is RawBoy's own
