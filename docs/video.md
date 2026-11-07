# RawBoy Camera: video support exploration

Scope: basic video (1080p/30 default) in RawBoy Camera on Android and iOS, then shooting log and grading with LUTs and film stocks in real time.
Method: read the current code (`ViewfinderRenderer.kt`, `CameraController.kt`, `film_form.glsl`, iOS `CameraController.swift` and the Metal viewfinder). **Nothing here was run on a device**: GPU and thermal numbers are estimates from the shader structure and must be measured on the Pixel 9 Pro (the log line `RawBoyViewfinder: N fps, GL thread X ms/frame` already exists) before committing to Stage 2.

## Recommendation in one paragraph

Do Stage 1 as "record what the viewfinder shows": render the existing develop pass a second time into the video encoder's input surface (Android `MediaCodec` surface input, iOS `AVAssetWriter` pixel buffers). The look, film stock, B&W, Strength, Brightness and Warmth then work in video for free, which is the product's identity. Android ~4-5 weeks, iOS ~3-4 weeks. Do **not** do Stage 2 as true log capture first. Do a cheaper "Stage 1.5": record 10-bit HEVC with the look baked in, plus an optional ungraded "flat" recording, and only then decide on in-camera log (details below). Stage 2 as asked (log + real-time LUTs at 30 fps with full film grain/halation, in recorded output) is feasible on the Pixel 9 Pro and recent iPhones for short clips, but thermal throttling on long takes is the real risk, and it needs measuring before it is promised.

## What the pipeline does today (relevant facts)

- Android: Camera2 session = one preview `SurfaceTexture` (4:3, up to 1920 px wide, 8-bit, `TONEMAP_PRESET_CURVE_SRGB`) + a RAW `ImageReader`. Each GL frame: `updateTexImage` -> pass 1 linearize to upright Rec.2020 RGBA16F (mipmapped) -> 512 px base, bloom halo, and bloom tail copies **every frame** -> pass 2 `DevelopProgram` to the screen. A 512 px readback is done every ~300 ms (async, fenced) for the auto develop. Preview stabilization is deliberately off. Frame size, aspect and FOV follow the *raw* (4:3), not 16:9.
- iOS: `AVCaptureVideoDataOutput` already delivers BGRA frames to a Metal `ViewfinderRenderer` (same two passes); the session preset is `.photo`.
- Film stocks are 2-LUT (33³ film LUT, then print LUT) with **Apple Log as the input encoding** (`appleLogEncode` in `film_form.glsl`), plus grain, a 9x9-tap halation loop, and scatter. Looks are 33³ `.cube` LUTs (display-referred). So an internal log domain already exists in the shader chain; this matters for Stage 2.
- Not present at all: any video code, `RECORD_AUDIO`, `MediaCodec`, `AVAssetWriter`, any thermal handling (`PowerManager` is only used for the lock-screen logic).

## Stage 1: basic video, 1080p/30

### Architecture (both platforms): bake the look into the file

| Option | What it is | Verdict |
|---|---|---|
| A. Look baked in | Draw the develop pass into the encoder's surface/pixel buffer | **Recommended.** Matches the viewfinder, ~1 extra draw per frame. |
| B. Clean recording | `MediaRecorder` / plain camera-to-encoder | Trivial, but the product's value is the look. Useful only as the optional "flat" file in Stage 1.5. |

**Android**
- Add an EGL window surface from `MediaCodec.createInputSurface()` and draw the same develop pass into it from `onDrawFrame`, with `eglPresentationTimeANDROID` = `SurfaceTexture.getTimestamp()`. `GLSurfaceView` owns the context, so either swap surfaces with `eglMakeCurrent` inside `onDrawFrame` (small, works, a bit hacky) or move to an own render thread/`TextureView` (cleaner, ~+1 week, also decouples preview and encode cadence). I'd start with the swap and move out only if it bites.
- Session: video needs its own stream config, not the photo one. 1920x1080 (16:9) preview stream, `CONTROL_CAPTURE_INTENT_VIDEO_RECORD`, AE fps range [30,30], video stabilization (OIS, optionally EIS, which crops FOV) turned **on**, RAW reader dropped. Mode switch = session reconfigure (~0.5-1 s, show the viewfinder frozen).
- Encoder: HEVC or AVC `MediaCodec`, 1080p30, ~16 Mbps AVC / ~10 Mbps HEVC, CBR/VBR, 1 s I-frame interval, `MediaMuxer` to MP4.
- Audio: `AudioRecord` (48 kHz, mono/stereo) -> AAC `MediaCodec` -> muxer; timestamps from the same monotonic clock as the camera (`SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME` is the common case; handle UNKNOWN by offsetting).
- Orientation: the frame is already rendered upright, so render to a landscape or portrait encoder size chosen at record start and lock the UI orientation while recording. No rotation hint needed.
- Storage: `MediaStore.Video` at `Movies/RawBoy Camera/VID_<date>_<time>-camera.mp4`, `IS_PENDING` until finalized, written straight to a `ParcelFileDescriptor` (the photo `ShotSaver` queue is not involved: video is realtime). Geotag via `MediaMuxer.setLocation`. Check free space up front and stop cleanly on low space.
- Permissions: `RECORD_AUDIO` asked on first video record (allow silent video if refused), `uses-feature microphone required=false`. Stop recording on `onStop`/screen-off (this also keeps the lock-screen-camera behaviour simple); a camera|microphone foreground service is only needed if we ever allow recording in the background, which I'd leave out.
- A killed process loses an MP4 that was not finalized. Acceptable for v1; fragmented MP4 (Media3 muxer) is the fix if it matters.

**iOS**
- Pick a 1920x1080@30 `activeFormat` (leave `.photo` preset on mode switch), keep the BGRA data output, render the develop pass into a `CVPixelBuffer` from an `AVAssetWriterInputPixelBufferAdaptor` pool via `CVMetalTextureCache`, append with the sample's presentation time. Audio: `AVCaptureAudioDataOutput` -> AAC `AVAssetWriterInput`. Orientation: render upright, set the input transform to identity.
- `NSMicrophoneUsageDescription`; save to the existing Photos album via `PHAssetCreationRequest` (video resource), same as photos today.
- The photo path (`AVCapturePhotoOutput`, ProRAW/Bayer) must be suspended or kept configured but idle during recording; format switching between photo and video modes costs a visible reconfigure.

### Behaviour that has to change for video (not just plumbing)

1. **Auto develop must be temporal.** Exposure, white balance and the other auto values are recomputed from a 512 px readback ~3x/s and applied as-is. In a photo viewfinder that is fine; in a recording the picture would visibly step. Needs smoothing (e.g. EMA with ~1-2 s time constant, rate-limited EV/s) and a lock option. Same for focus/AE hunting: continuous-video AF mode instead of `CONTINUOUS_PICTURE`.
2. **Grain must be time-varying.** `develop.glsl` seeds all grain/denoise hashes by pixel position only ("so preview and export tiles match"), so in video the grain would be a frozen screen-door pattern. Add a frame-index uniform folded into the seeds in video only (photos keep position-only seeding). Small, but it is a hard requirement and easy to miss.
3. **No per-shot finishing in video.** Skin retouch, ISO-driven wavelet denoise and post-sharpening only exist in the photo export path. Video gets the viewfinder look, so low-light video will be noisier than low-light photos; the 8-bit camera stream is also the limit (see Stage 2).
4. Stabilization is deliberately off in the photo viewfinder to match the shot's FOV (CHANGELOG). Video wants it on, so the viewfinder crop changes between modes. Document it.
5. Frame merging, Flash (becomes torch), RAW, Burst, 50 MP and lens switching mid-take: hidden or disabled in video mode. Lens (UW/W/T) selectable before recording, not during, in v1.

### UI

- Photo | Video segmented switch (and swipe on the viewfinder) near the lens row; in landscape it fits the left-edge column.
- Shutter becomes a red record button (circle -> rounded square while recording); a timer pill (mm:ss, red dot) at top centre; optional second small button for a still during recording (Android: skip in v1).
- Volume key starts/stops. Look menu, Film/B&W, Strength, Brightness (maps to AE compensation, already wired), Warmth all stay live while recording.
- Update `ui/Help.kt`, iOS `ui/Help.swift`, `docs/camera.md`, `CHANGELOG.md` (the repo's convention).

### Stage 1 effort (one person, includes tests/polish)

| Item | Android | iOS |
|---|---|---|
| Session/format switching, 16:9 stream, stabilization | 4 d | 3 d |
| Encoder surface + second draw + timestamps | 5 d | 4 d |
| Audio capture, A/V sync, muxing | 3 d | 2 d |
| Storage/MediaStore or Photos, permissions, low-space | 2 d | 2 d |
| Temporal auto-develop + AF/AE video mode + frame-seeded grain | 4 d | 3 d (shared logic, port) |
| UI (mode switch, record button, timer, landscape, Help) | 4 d | 4 d |
| Device testing across lenses/orientations/lock-screen/interruptions | 4 d | 3 d |
| **Total** | **~26 d (≈5 weeks incl. buffer)** | **~21 d (≈4 weeks)** |

Planning figure: Android first, ~4-5 weeks; iOS can reuse the temporal-develop and grain-seed decisions, ~3-4 weeks.

Main risks: EGL surface swapping inside `GLSurfaceView`; A/V drift; the viewfinder's per-frame base/halo/tail copies plus a second develop draw at 1080p holding 30 fps with film on (estimate below).

## Stage 2: log capture and real-time LUTs/film stocks

### What "log" can mean here

1. **Android has no vendor log profile in Camera2.** Available: 10-bit dynamic range profiles (HLG10, HDR10, ...) on the Pixel 9 Pro (`DynamicRangeProfiles`), and custom tonemap curves (`TONEMAP_MODE_CONTRAST_CURVE`) which are device-dependent for YUV streams. So "log" on Android = capture 10-bit HLG10, convert to scene-linear in pass 1 (inverse HLG OETF, which has headroom to ~12x diffuse white), then **encode it ourselves** to a flat log curve (we already ship Apple Log in the shader; a RawBoy-flat variant is an option) and write 10-bit HEVC (Main10). This is real dynamic range, not a flattened 8-bit sRGB stream, which would just band.
2. **iOS (iPhone 15 Pro and later):** real Apple Log is available (`AVCaptureDevice.Format` with Apple Log in `supportedColorSpaces`, 10-bit 4:2:2/4:2:0 `420YpCbCr10BiPlanar`). Our film stocks already take Apple Log in, so the path is nearly direct: Apple Log frame -> optional creative LUT -> record. Older iPhones: HDR/HLG path as on Android.
3. **True raw video** (RAW_SENSOR repeating stream, our own develop to log) is technically possible on Pixel but 12 MP at 30 fps is heavy for bandwidth and thermals. Out of scope; mention only.

### Pipeline for Stage 2

```
10-bit camera frame -> linearize (HLG^-1 / Apple Log^-1) -> [scene-linear Rec.2020 half float]
   -> A) preview: develop + look/film (what the screen shows)
   -> B) recording: log encode (flat) -> 10-bit HEVC          <- "shoot log"
   -> C) recording: develop + look/film -> 10-bit HEVC (HLG/Rec.709) <- "baked look"
```

Product choices (needs Oleksii): **Log + preview LUT** (record flat log, show the look on screen, user grades later) versus **baked look** (what Stage 1 does) versus **both files**. Recording both at once means two encoders at 1080p30: doable on Pixel/recent iPhone hardware, costs heat, doubles file size.

### Preview versus recorded output

- If the preview and recording take the same shader output (the baked look), they are identical by construction, which is the current approach's big advantage.
- If recording log and previewing a look, the log file must be tagged honestly (a custom transfer function has no standard MP4 tag; Apple Log is tagged; for a RawBoy-flat curve ship a `.cube` inverse and name the profile in the file name/docs), otherwise players show a washed-out image. On Android, tag as unspecified/SDR and document it. This is the part most likely to confuse users, so a visible "LOG" badge and an in-app "how to grade" note are part of the work.
- The user wants stocks "in real time": the look must be what they see while shooting. With "preview look, record log" the preview can legitimately differ in sharpening/grain from a post-graded file; say so.

### GPU cost per frame (estimate, to be measured)

Frame at 1920x1080 (2.07 MP), RGBA16F:
- Pass 1 linearize + mipmaps: cheap (~0.3-0.6 ms on a Tensor G4 class GPU). Already runs today at up to 1920x1440.
- Base/halo/tail copies (512 px and 64 px, per frame): small (~0.3-0.5 ms). Already runs today.
- Develop pass with film: per pixel two 33³ 3D-texture fetches (film LUT, print LUT) + a plain LUT fetch for ordinary looks; **film grain (3-5 pcg/hash Box-Muller gaussians per pixel) and the 9x9 halation loop (81 base/halo texture reads, but from a 512 px texture so cache-friendly)** are the expensive parts. Estimate 2-4 ms per 2 MP frame on Pixel 9 Pro, 5-10 ms on older mid-range GPUs. LUT fetches themselves are ~free next to those (33³ RGB16F = 0.2 MB, L2-resident).
- Second draw into the encoder surface repeats the develop cost: total roughly **2x develop cost** per frame (screen + encoder), or 1x if the preview is rendered smaller (e.g. 1280 px) and only the encoder draw is full 1080p.
- Budget: 33 ms/frame at 30 fps. The estimates say there is headroom on the Pixel 9 Pro (and on anything with a recent flagship GPU); mid-range phones will not hold 30 fps with grain + halation on, and v1 should degrade gracefully (drop grain/halation in video below a measured frame-time threshold, or offer "Video look quality").
- Mitigations if needed: halve halation tap count or run it on the 64 px tail copy for video; precompute grain as a tiling blue-noise texture with a per-frame offset (cheaper than hashing and nicer-looking); render preview at lower resolution than the encoder.
- Encode load is in dedicated hardware and is not the bottleneck; the GPU and the thermal budget are.

### Thermal limits

- Sustained camera + GPU + HW encoder + screen at full brightness is the classic thermal-throttle recipe. Expect the Pixel 9 Pro to hold 1080p30 with a look for several minutes, then throttle the GPU (fps drops, frames repeat) or the camera app to fall back on a warning at the system's "severe" thermal level. I cannot give a minute count without measuring; **measure 10 and 30 minute takes at room temperature and in sun**.
- Required handling regardless: `PowerManager.getCurrentThermalStatus()` + `addThermalStatusListener` (API 29, our minSdk): at MODERATE reduce preview cost (lower preview resolution, drop grain/halation in the *preview only*, keep the recorded output intact), at SEVERE show a warning, at CRITICAL stop recording cleanly and finalize the file. iOS: `ProcessInfo.thermalState` with the same ladder.
- Dim the preview and avoid the expensive effects on-screen while recording, so the baked-in look is rendered once per frame at encoder resolution.
- 10-bit HEVC encode costs somewhat more heat than 8-bit AVC; offer 8-bit AVC as the default and 10-bit as the "Log / HDR" option.

### LUT and film grain cost, summarised

| Element | Cost | Note |
|---|---|---|
| Ordinary `.cube` LUT (33³) | negligible | one trilinear 3D fetch |
| Film stock (2 LUTs + Apple Log encode) | low | 2 fetches + a few ALU |
| Grain | medium | needs frame-seeded noise (above), consider a noise texture |
| Halation (9x9 taps) + scatter | medium-high | reduce taps for video |
| Bloom (copies already per frame) | low | already in the viewfinder |

### Stage 2 effort

| Item | Android | iOS |
|---|---|---|
| 10-bit HLG capture stream, inverse OETF, Main10 encode through EGL (needs a 10-bit EGL config; verify on device first - this is the biggest unknown) | 8-10 d | 3 d (Apple Log direct) |
| Flat-log encode + inverse `.cube` + tagging/docs | 3 d | 1 d |
| Dual output (log + baked), encoders, storage | 4 d | 3 d |
| Thermal ladder + quality fallback + measurement harness | 4 d | 3 d |
| UI (LOG toggle, badge, settings, help) | 3 d | 3 d |
| Device testing/tuning | 5 d | 4 d |
| **Total** | **~27-29 d (≈6 weeks)** | **~17 d (≈3.5 weeks)** |

## Staged plan

1. **Spike (3-4 days, do first):** on the Pixel 9 Pro, draw the existing develop pass into a `MediaCodec` 1080p30 surface with a film stock and record 5 minutes while logging `RawBoyViewfinder` frame stats and `getCurrentThermalStatus`. This answers "does 30 fps hold with film on" and "how long until throttle", the two numbers the estimates above hinge on. Verify a 10-bit EGL config + Main10 HEVC works at the same time.
2. **Stage 1 (Android, 4-5 weeks), then iOS (3-4 weeks):** baked look, 8-bit, AVC/HEVC, audio, UI, temporal auto-develop, time-varying grain, thermal ladder (the ladder belongs in Stage 1, not later).
3. **Stage 1.5 (1-2 weeks each):** 10-bit HEVC option + "HDR/LOG-ready" metadata on iOS (Apple Log is nearly free there).
4. **Stage 2 (Android 6 weeks, iOS 3.5 weeks):** log + preview LUT / dual output, only if the spike's numbers and user interest justify it.

## Open decisions for Oleksii

- Baked look only for v1, or also an ungraded/log file? (Recommendation: baked only in Stage 1.)
- Is Pixel 9 Pro the support floor, or must mid-range phones hold 30 fps with film? (Changes how much fallback work.)
- Audio: stereo from one mic is fine for v1?
- Which platform first? (Recommendation: Android, as the owner tests there; iOS Stage 2 is cheaper because Apple Log is native.)

## Prototype status (2026-11-07)

Android, Pixel 9 Pro, baked look, stereo audio, as decided: see the "Video (Android prototype)" section of `docs/camera.md`. Not compiled or run when written (no Android SDK in the authoring environment): the first run on the phone is the spike described above. Things to check first: the EGL surface on the codec's surface (`RawBoyVideo` logcat tag; recordable config, then the context's own), that 30 fps holds with Film on (`RawBoyViewfinder` fps line while recording), A/V sync, the 16:9 crop/orientation of portrait and landscape files, and heat over a 10 minute take.
