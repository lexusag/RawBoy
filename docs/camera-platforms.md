# RawBoy Camera: phone profiles

RawBoy Camera (Android) was written and tuned on one phone, a Pixel 9 Pro. Some of what it does depends on the
phone's chip, its maker's camera software or its sensors: how the preview stream relates to the raw, how flash and
exposure compensation behave, black level quirks, how noisy the sensors are, whether the GPU driver accepts the video
encoder's surface. All of that lives in a **phone profile**, built at start from layers that match the phone. The rest
of the camera code holds no phone names and no numbers measured on a single phone.

This page is for whoever adds or changes a profile: how it is built, what each field means, how a new phone is
measured and added, and what is known about the phones done so far. What users see (the *Phone profile* line and
*Share device report* in Settings) is in [RawBoy Camera](camera.md).

## How a profile is built

```
neutral profile  →  chip vendor  →  SoC  →  phone maker  →  model
 generic/            tensor/                  oem/samsung/     oem/oneplus/Cph2447.kt
                     qualcomm/                oem/oneplus/
```

Code: `app-camera/src/main/java/app/rawboy/camera/platform/`.

| Part | Does | Doesn't |
|---|---|---|
| `PlatformDetector` | reads `android.os.Build` into a `PhoneDescription` and recognises the chip maker | choose any value |
| `PlatformRegistry` | applies the matching layers (`layers`) to the neutral profile, by `LayerLevel`, list order within a level | read `Build` |
| Layers (`tensor/`, `qualcomm/`, `oem/<maker>/`) | the values and strategies of one chip, maker or model, with where each number comes from | touch `CameraController`, `ShotSaver` or the UI |
| `ActivePlatform` | resolves the profile once per process, logs it, applies a debug build's chip choice | — |
| Shared camera code | reads the profile it is handed | name a phone or hold a number measured on one |
| `:engine` | takes values as parameters (`BlackFix`, `Frame.linearToe`, `EncoderConfig`) | import anything from `platform/` |

- **Detector rules** (`PlatformDetector.chipOf`): `Build.SOC_MANUFACTURER` decides (API 31+: `Google` → Tensor,
  `QTI`/`Qualcomm` → Qualcomm, `MediaTek`, `Samsung` → Exynos); a value that is set but not recognised gives *unknown*,
  never a guess. Only without it (API 29-30) does `Build.HARDWARE` decide (`qcom`, `mt####`, `exynos…`/`s5e####`).
  Tensor launched on API 31, so it needs no hardware rule. The phone maker never decides the chip: Galaxies come with
  Snapdragon, Exynos and MediaTek chips.
- **Who reads it** (no dependency injection, everything explicit): `ActivePlatform.get` is called by
  `CameraViewModel` only, which hands the profile to `CameraController` (constructor) and to every `Shot`
  (`Shot.platform`: a shot is developed with the profile it was taken under) and passes the noise floors to
  `CameraSettings.develop()`. `VideoRecorder` and the viewfinder renderer get no profile.
- **A layer** = one file: a `PlatformLayer` with its name, level, `matches` (on the `PhoneDescription` only) and a
  `PlatformPatch` written with `copy`, so it replaces only what it sets. A model's layer sits in its maker's (or
  chip's) folder. Pieces several layers share are *traits* in `platform/traits/` (the Pixel 9 Pro's extra black and
  preview colour path, used by Tensor and Samsung).
- **Fields** are added only with a neutral value that is today's behaviour; an existing field never changes its
  meaning, and no field is added before a layer sets it. `CameraPlatform.problems()` range-checks the result; tests run it
  on the neutral profile, each layer on its own and the phones measured.
- **Learned calibration** (viewfinder scales, flash guides) is per lens, stored in `camera` preferences. Each preview
  brightness model has its own key (`PreviewLevel.scalesKey`: `previewScales3`, `previewScalesWb`). A debug build's
  hand-picked profile that differs from the automatic one stores under `…@<layers>` (`calibrationSlot`), so trying a
  profile never spoils what the phone learned.

### Where a finding goes

- **The GPU driver and the video encoder** → the chip vendor's layer. Its values must be safe on most phones with
  that chip: one phone measured is not enough for anything riskier.
- **Camera and preview behaviour** (tone curve, colour, AE, flash, which camera ids stream RAW) → the phone maker's
  layer: that is the maker's camera HAL and ISP tuning, which differs between makers on the same chip.
- **Sensor numbers** (black offsets, noise, a camera's AE ceiling, a lens's saturation) → the model's layer.
- **What goes in a profile at all:** a number measured or tuned on one device, even when the neutral value equals it
  (the Pixel's flash starting points, the noise scales). Limits that already cover several devices, the owner's
  taste, general heuristics and anything read from Camera2 at run time stay in the shared code.
- **The Tensor layer repeats the neutral values the Pixel was tuned with**, with a comment naming the Pixel 9 Pro, so
  a later change to the neutral profile can't move the Pixel unnoticed; `TensorLayerTest` pins every field against the
  constants the code had before profiles, including the ones the layer leaves to the neutral profile
  (`lookContrast`/`lookSaturation`, `compensation`, `aeGainCeilings`): a new field needs the layer line and the test.
- **No empty layers:** a layer is created together with its first value. A phone without its own layer gets the neutral
  profile, which has no workaround for any one ISP.
- **Probe rather than profile** where the phone itself can say what works: video (below).

## The profile's fields

Neutral values first; a layer column is empty where the layer leaves the value alone. Each layer file's KDoc has the
measurements behind its numbers.

| Field | What it changes | Neutral | Tensor | Samsung | Qualcomm | OnePlus | OnePlus 11 (CPH2447) |
|---|---|---|---|---|---|---|---|
| `lenses.standaloneOverLogical` | A stand-alone camera wins over a logical camera's lens of the same focal length (`capture/LensChoice.kt`) | false | false | | | **true** | |
| `preview.color` | Linear preview RGB → Rec.2020 (`ViewfinderRenderer.Frame.color`) | `SrgbPreviewColor` (preview taken as sRGB) | `UndoIspPreviewColor` (undoes the result's gains and CCM, applies the raw decoder's matrix) | `UndoIspPreviewColor` | | | `CameraSaturation`: ultrawide (camera 3) chroma ×1.25 |
| `preview.curveAtEvenPoints` | The preview's sRGB `TONEMAP_CURVE` sent at 64 even input steps (`capture/PreviewCurve.kt`), and the viewfinder decodes the first step as a straight line (`Frame.linearToe`) | false (points packed near black) | false | | | **true** | |
| `preview.level` | What the viewfinder's gain is made of besides calibration (`capture/ViewfinderGain.kt`) | `BOOSTED` (calibration / boost × still gain) | `BOOSTED` | | | **`STILL_WHITE_BALANCED`** (calibration × the frame's smallest neutral) | |
| `preview.liftsShadows` | The ISP's preview already has the backlight shadow lift a shot adds; false = the live develop adds it (not in video mode) | true | true | | | **false** | |
| `still.extraBlack` | Black beyond the DNG's, fraction of white, for shot decoding and the raw meter | 0 | **1.46e-3** | **1.46e-3** | | | |
| `still.maxStillExposureNs` | Longest still exposure AE gives in low light (`stillGain` prediction, AE ceiling) | 1/15 s | 1/15 s | | | | |
| `still.lookContrast` / `lookSaturation` | Added to saved photos only (`ShotDevelop.withIspLook`): the viewfinder shows an ISP rendering that can't be undone | 0 / 0 | | **+25 / +25** | | | |
| `still.exactBlack` | Subtract the DNG's fractional per-site BlackLevel (`app.rawboy.raw.BlackFix`) | false (LibRaw's integer black) | false | | | **true** | |
| `still.blackPedestal` | DN of noise kept below black instead of clipped | 0 | 0 | | | **32** | |
| `still.blackOffsets` | Sensor black beyond the file's, DN per camera id and ISO | none | none | | | | main (2), ultrawide (3) |
| `still.lowPriorityDevelop` | Develop shots in a low-priority GL context (`EGL_IMG_context_priority`) | true | true | true | **false** | | |
| `still.compensation` | How much of Brightness's AE compensation reached the raw (`capture/AppliedCompensation.kt`) | `BOOST_STAYS_DIGITAL` (residual boost, the Pixel's rule) | | | | **`AE_GAIN_IN_RAW`** | |
| `still.aeGainCeilings` | AE's highest gain (s × ISO × boost) by camera id, where it isn't `maxStillExposureNs` × max ISO | — | | | | | selfie (1): 240 |
| `noise.backIsoScale` / `frontIsoScale` | Denoise as for this many times the ISO | 4 / 8 | 4 / 8 | | | | 4 / **10** |
| `noise.lut*Floor`, `experimental*Floor` | Denoise floors of non-Film looks (luma / colour) | 12 / 70, 22 / 70 | same | | | | |
| `flash.defaultGuide`, `referenceFNumber`, `defaultGainNoDistance` | Manual flash's starting points before a lens learns its guide | 16, f/1.7, 4 | same | | | | |
| `flash.metering` | Who exposes a flash still | `MANUAL_GUIDE` (AE off, guide × distance²) | same | | | **`CAMERA_AE`** (pre-flash, AE on) | |
| `flash.cameraAeCompensationEv` | AE compensation for a `CAMERA_AE` flash still, taken back out by the develop | 0 | 0 | | | | **−1** |
| `flash.screenFlashUntilExposed` | Screen flash stays lit until the still's result has come | false | false | | | **true** | |

What the layers stand on:

- **Tensor** (`tensor/Tensor.kt`): everything the camera was tuned with on the Pixel 9 Pro (2026-10 to 2026-11).
  Pixels before the Pixel 6 have Snapdragon chips and get the Qualcomm layer, not this one: the numbers came from
  Google's own ISP.
- **Samsung** (`oem/samsung/Samsung.kt`, any chip): the +25 look from one Galaxy S25 pair, tuned on top of the
  Pixel's extra black and preview colour path, so the layer keeps both (and the low develop priority): Samsung
  phones develop exactly as before chips were told apart. Lift this pinning once someone measures a Samsung.
- **Qualcomm** (`qualcomm/Qualcomm.kt`): normal develop priority only. On a hot OnePlus 11 the low-priority develop
  starved behind the viewfinder (a photo without Film took 45 s to over 5 minutes); normal priority is any GL
  context's default, so it is safe on any Snapdragon. Everything else measured on the OnePlus 11 went to the OnePlus
  layer: one Snapdragon phone is not enough to call it the chip's.
- **OnePlus** (`oem/oneplus/OnePlus.kt`) and **OnePlus 11** (`oem/oneplus/Cph2447.kt`): see below.

## Video: a probe, not a profile

Whether the GPU driver and encoder accept the encoder's input surface is found on the phone itself
(`capture/VideoProbe.kt`), so the profile has no video field. Variants, in order:

1. `STANDARD`: an EGL window surface on the encoder's input surface in the viewfinder's own context (recordable
   RGBA8888 config, else the context's config). The Pixel 9 Pro's, the only one it uses.
2. `OWN_CONTEXT`: the encoder's surface in a GL context of its own sharing the viewfinder's textures
   (`EncoderConfig.RECORDABLE_OWN_CONTEXT`). The OnePlus 11 records this way: its driver refused a recordable surface
   in the viewfinder's context (`EGL_BAD_MATCH`) and Qualcomm's HEVC encoder refused the fallback's 8-bit RGBX buffers
   (`unsupported color format`).
3. `RECORDABLE_VIEWFINDER`: the viewfinder itself on a recordable RGBA config (`Viewfinder(eglConfig)`); the view is
   made again, so the user presses record once more.
4. `SOFTWARE_AVC`: the platform's software H.264 encoder.

A variant works when the encoder hands out its first frame. Definite failures (EGL surface refused, encoder error
before the first frame) and one-off ones (no frame out within 3 s, encoder not made or configured) are told apart; the
camera giving no frame within 4 s or the user pressing stop ends the probe without storing anything. The working
variant is remembered under `Build.DISPLAY` + SDK + the app's `lastUpdateTime` (`video` preferences); the remembered
one gives way only after failing in two recordings in a row, and a variant other than `STANDARD` is remembered only
after `STANDARD` failed definitely. The device report's *Video probe* section and logcat (`RawBoyVideo`,
`RawBoyCamera`) show the variant and the last probe's tries. Debug builds read `video-debug.txt` from
`/sdcard/Android/data/<package>/files` (`DebugProbe.videoDebug`): `variants=`, `avc=1`, `turns=1`,
`fail=codec|egl|silent`, `failVariant=`, `failAfterMs=`.

## Adding a phone

1. **Device report.** On the phone: Settings › *Share device report*. It lists the phone as detected, the profile it
   got, every camera and physical lens with its Camera2 characteristics (RAW and preview sizes, tone map modes and
   curve points, ISO/exposure/boost ranges, session keys, flash, OIS, lens shading), which lenses the camera lists and
   why it skips others, the GPU and EGL configs, the H.264/HEVC encoders and their input formats, the video probe's
   result and the learned calibration. One `key: value` per line in a fixed order: diff it against a known phone's.
2. **Table.** Go through the profile fields above and the shared code's assumptions (below) and write down, per
   field, what this phone does and how you'll know: from the report, from logcat, or by measuring. Start from the
   neutral profile: the phone is running it already.
3. **Measure** (debug build, `./gradlew -Prawboy.debugIdSuffix=.dev :app-camera:installDebug` puts it next to the
   Play version):
   - logcat streamed to a file before each experiment (phones keep ~5 minutes);
   - viewfinder/photo pairs, measured rather than eyeballed: the debug build's `DebugProbe` (tag `RawBoyProbe`) saves
     the viewfinder's and the shot's 512 px linear copies at every shutter (`files/debug/<id>-vf.f16`, `<id>-raw.f16`,
     half-float RGB, a `.txt` beside each with sizes and a note: lens, scale, key, colour matrix).
     `tools/camera_fit/fit.py` pulls nothing itself (its header has the `adb exec-out run-as` lines); it aligns the two
     (crop/zoom search on log luminance) and compares 8×8 cells: median ratio by 1 EV band of the raw, per-channel
     ratio, log-log slope (1.0 = same tone), log-chroma spread (saturation). A screenshot before the shutter against
     the JPEG is the second measure;
   - **done** when, once a lens is calibrated (2-3 shots), the viewfinder is within **0.2 EV** of the JPEG and R/G, B/G
     within **8%**; shadows neutral within 8% at 2⁻⁸…2⁻⁷ of white on merged shots; the flash raw clips below ~0.1%;
   - scenes: a room under artificial light, daylight, a backlit window, dim light (ISO ≥ 3200), every lens and the
     selfie camera; the flash at 0.3, 1 and 3 m; video portrait and landscape, with and without a look.
4. **Layer.** A file in the right folder (see *Where a finding goes*), the numbers' origin in its KDoc (phone, date,
   scene, what was measured), one line in `PlatformRegistry.layers`, a test pinning its values and checking that the
   other layers don't change (`OnePlusLayerTest`, `Cph2447LayerTest`, `SamsungLayerTest` are the pattern). A new field
   needs its neutral value = today's behaviour, the Tensor layer repeating it, and `TensorLayerTest` extended.
5. **Check.** `./gradlew :app-camera:testDebugUnitTest :engine:testDebugUnitTest`, then the scenes again with the
   layer, and the same checks on a Pixel (Tensor must not move). Settings' *Phone profile* line and the `RawBoyPlatform`
   log line show the layers applied. Debug builds can take the phone for another chip (Settings › *Take the phone
   for*, from the next start) to compare profiles on one phone; their calibration is stored apart.
6. Document it here (the table, the phone's section) and in `CHANGELOG.md`.

### Assumptions the shared code still makes

From the review of every Pixel-specific place (2026-11-15). These stayed shared because they hold by Camera2's rules
or held on the OnePlus 11 too; a phone that breaks one needs a field.

- Video stabilization is off on every photo request (the Pixel's templates turn it on and crop the preview ~20%).
- The preview asks for a plain sRGB curve when there is no preset curve but `CONTRAST_CURVE` exists (65 points;
  phones with a 64-point maximum accept it).
- The preview's YUV is BT.601 full range unless its data space says BT.2020 (`ViewfinderRenderer.yuvToRgb`): the Pixel
  labels BT.601 data as sRGB/BT.709, the OnePlus 11 reports the legacy data space `0x102`.
- A focus distance of exactly 0 means unknown, not infinity (the Pixel 9 Pro's ultrawide reports 0 on every frame).
- Different AE fps ranges for preview `[30,30]` and still (lowest minimum at max 30). Where `aeTargetFpsRange` is a
  session key (OnePlus 11) every still reconfigures the session (~0.35 s twice); on a logical camera there it froze.
- The main lens is the logical camera if there is exactly one, else the only camera that opens on its own, else the
  lens nearest 26 mm.
- Learned calibration absorbs the remaining preview/raw gain per lens; a raw frame meters a lens with no calibration
  (not under `STILL_WHITE_BALANCED`, where calibration sits near 1 and the early frame caught AE unsettled).
- `AutoTone.PHONE_KEY` (0.06) and the list of camera-metered makers in `AutoTone.kt` / `noise.cpp` belong to the
  engine and to DNGs from any phone, not to the phone the camera runs on: not in the profile.

## Log lines for a new phone

| Tag | Line | Says |
|---|---|---|
| `RawBoyPlatform` | `platform: chip … (soc …, hardware …), manufacturer …; automatic; layers …; calibration …; LensProfile(…); PreviewProfile(…); …` | what was read, the layers, every value |
| `RawBoyCamera` | `camera <id>/<physical>: RAW …, preview …`, `lenses (facing N): W=2/- 23mm …` | the lens list; rejected cameras give their reason |
| `RawBoyCamera` | `shutter <lens>: preview ISO, µs, boost, tonemap, viewfinder key, preview scale, colour, wb …` | the preview at the shutter |
| `RawBoyCamera` | `still (flash …): … µs, ISO, boost, black … (static …), white …` | the still's capture result |
| `RawBoyCamera` | `calibrate <lens>: …`, `calibrate flash …`, `raw meter: key …` | calibration learning |
| `RawBoyCamera` | `flash metering (compensation … EV)`, `flash exposure: focus … dpt -> …, guide …`, `screen flash: dark … ms after the request` | flash |
| `RawBoyCamera` | `burst: N of M frames …`, `noise ISO … -> denoise …` | merge and denoise |
| `RawBoyViewfinder` | `camera frames: YUV, converted here` / `RGB from the driver`, `camera data space 0x…`, fps and GL ms every 5 s | the viewfinder path |
| `RawBoyVideo` | the probe's tries, `no EGL surface for the encoder`, `video encoder stopped` | video |
| `RawBoy` | `LibRaw decode: … hot pixels N in M ms`, develop vs encode times | decoding and develop |
| `RawBoyProbe` | debug only: `Build.*`, EGL configs, encoder formats, request template defaults, the preview result at the shutter (`shutter <id> <lens> result: CCM, gains, neutral, dynamic black, boost …`), dumped copies | bring-up |

## Phones

| Phone | Chip | Layers | Status |
|---|---|---|---|
| Pixel 9 Pro | Tensor G4 | `neutral+tensor` | Everything tuned on it; values pinned to the pre-profile code by tests, checked by the owner at each milestone |
| Other Tensor Pixels (6 and later) | Tensor | `neutral+tensor` | Same values as the Pixel 9 Pro, as before profiles; not measured |
| OnePlus 11 (CPH2447) | Snapdragon 8 Gen 2 (SM8550) | `neutral+qualcomm+oneplus+cph2447` | Measured and accepted 2026-11-18 (Android 16, `CPH2447_16.0.5.1301(EX01)`) |
| Samsung (Galaxy S25: Snapdragon; Galaxy Tab S11 Ultra: MediaTek) | any | S25 `neutral+qualcomm+samsung`, Tab `neutral+samsung` | Pinned to what they did before profiles (extra black, preview colour path, low develop priority, +25 look); not measured since |
| Pixels before the Pixel 6 | Snapdragon | `neutral+qualcomm` | Got the Pixel 9 Pro's numbers before profiles, the neutral profile + Qualcomm now; not measured |
| Any other phone | — | `neutral` (+ `qualcomm` on Snapdragon) | Neutral profile: preview taken as sRGB, no extra black. Viewfinder calibration learned before profiles settles again over a few shots per lens |

### OnePlus 11

Measured 2026-11-15 to 11-18 on one phone. Findings behind the layers (numbers in the layer files' KDoc):

- **Cameras:** ids 0 (logical back: main + ultrawide), 1 (selfie, fixed focus, no flash), 2 (main, stand-alone, 23 mm,
  4096×3072), 3 (ultrawide, stand-alone, 14 mm, 4000×3000). The telephoto (4) and logical camera 5 are
  `SYSTEM_CAMERA`: third-party apps can't open them, so the app has UW, W and selfie. RAW through logical camera 0
  froze the preview (different preview/still fps ranges, a session key there) and its bursts never got a result;
  camera 2 on its own works. Logical camera 0's ColorMatrix is the selfie camera's, so its DNGs would carry the wrong
  matrix: another reason to list the stand-alone cameras.
- **No maximum-resolution RAW:** no camera has `ULTRA_HIGH_RESOLUTION_SENSOR`, RAW is binned only; the 50 MP switch is
  hidden by the shared code.
- **Preview tone:** the HAL applies `TONEMAP_CURVE` points as if evenly spaced over its input, whatever their x
  (`maxCurvePoints` 64). With the points packed near black the viewfinder was ~2× as contrasty and saturated as the
  photo; at even points it follows the raw within 3% over 6 stops.
- **Preview colour:** the result's `COLOR_CORRECTION_TRANSFORM` is identity while the ISP applies its own matrix, so
  undoing it (the Pixel's path) oversaturated the viewfinder ×2.5; the plain sRGB path is within ±5% per channel.
- **Preview brightness:** the preview is as bright as the still's raw with the ISP's white balance at green 1, whatever
  boost the result reports: gain = calibration × the frame's smallest neutral, calibration ~0.92-0.99 on every lens.
  The preview's tone is global (no local shadow lift in backlight).
- **Black:** the HAL writes a fractional dynamic black (64.62 / 64.81 at ISO 6400), which LibRaw truncates, and LibRaw
  clips noise below black: night shadows went magenta. Plus small per-sensor offsets at high ISO.
- **Flash:** a manual still (AE off) reports the flash fired but its raw gets almost none of the light; the phone's flash
  AE with a pre-flash exposes right (aiming at its own JPEG, hence −1 EV in the raw). The still's exposure starts
  0.36-0.38 s after the request, after the screen flash used to go dark.
- **Brightness:** `DngCreator` writes the post-raw boost as BaselineExposure, so the raw carries AE's whole gain; at AE's
  ceiling (1/15 s × ISO 6400 on the back cameras, 1/30 s × ISO 1600 × boost 5 on the selfie camera) a brighter setting
  adds nothing.
- **Video:** `OWN_CONTEXT` (see above); HEVC 1080p30 and AAC, portrait and landscape.
- **Other:** subject tracking, QR, the HDR gain map, long exposure and the timer work without layer values; stabilization
  is already off in the templates; the YUV is full range in practice.

Accepted with these limitations:

- Flash on a near, light subject (~1 m) comes out +2.4 to +2.8 EV brighter than the same scene without flash (no raw
  clipping); two identical shots differed by 1 EV.
- Brightness in the dark is accurate to about ±0.4 EV (AE's dead band near its ceiling).
- The viewfinder's chroma at ISO 6400 is 10-15% under the photo's (the ISP fades it; a fixed matrix can't follow).
- The preview's black has a ~1 code level pedestal: below 2⁻¹⁰ of white the viewfinder is slightly lighter than the raw,
  and calibration in near darkness drifts low.
- Ultrawide single frames at ISO 6400 and short exposures: shadows R/G +21% (merged shots are within 8%).
- Video has no backlight shadow lift (`liftsShadows` false is not applied in video mode).
- Subject tracking costs ~6 ms of GL thread per frame.
- Not checked: incandescent light, noon sun, long exposure in Lighten, Wi-Fi QR codes, tracking on the ultrawide and
  selfie cameras, Brightness with flash, the HDR gain map with a frame.

## Open proposals

Not done; each needs the owner's decision.

- **Samsung after the Qualcomm layer grows:** every Qualcomm value that changes behaviour should either be put back in
  `oem/samsung` (as `lowPriorityDevelop` is) or named to the owner, since the Samsung pinning covers only the values
  Samsung had before profiles.
- **Calibration outlier guard:** ignore a shot's viewfinder calibration estimate more than ~2 EV from the lens's current
  one (except the first). One shot with the lens covered by a hand moved the OnePlus 11's main camera 0.91 → 0.29.
  The rule is shared, so the Pixel would get it too.
- **Debug tools:** `DebugProbe`'s start-up `Build`/camera/encoder/EGL lines now repeat the device report; drop them or
  keep them for adb-only bring-up. The `rawboy.debugIdSuffix` Gradle property (off by default) can stay or go.
