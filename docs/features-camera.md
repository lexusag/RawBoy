# Feature matrix: RawBoy Camera

What RawBoy Camera does on **Android** (`app-camera`, `app.rawboy.camera`) and on **iOS** (`ios/Camera`), and which
release first shipped each feature. The editors (Pro, Auto, Browse, Packer) are in [features.md](features.md). There is
no web or Desktop camera (a Mac or browser has no RAW camera path here), so those columns don't exist.

Written 2026-11-17 against `main` at 4cbc445; updated 2026-11-22 (at 1af5290) for the iOS Random light leak and the Android
video changes since (motion data, stabilized copies, no dropped frames). The original sources were from the Camera entries of `CHANGELOG.md` (dated by the first tag that
contains each: `git blame` + `git tag --contains`), `docs/camera.md`, `docs/video.md` and the two source trees. Nothing
was run (no phone or emulator in the session). RawBoy Film (`app.rawboy.camera.film`) was merged into Camera's Film mode
in v1.7.0 (2026-10-31); its own history before that is not listed.

Marks: ✓ has it · ✓ 1.x.y has it from that release (shown when later than the first) · ◐ partly · — missing · n/a not
possible or not intended · ? inferred from the changelog, not checked in the code. `≤1.1.1` = before the 2026-10-18
baseline (the history before v1.1.1 was squashed).

The phones differ at the hardware layer, not by neglect: Android drives Camera2 (RAW_SENSOR, one logical + physical
lenses, burst merge), iOS drives AVFoundation (**ProRAW at 12 MP by default**, one physical lens at a time).

## Capture

| Feature | Since | Android | iOS | Notes |
|---|---|---|---|---|
| Live viewfinder developed with Auto's pipeline and a look | ≤1.1.1 | ✓ | ✓ | Same shader as Pro and Auto; the viewfinder is calibrated against the raw after each shot |
| Raw capture (DNG) next to the JPEG | ≤1.1.1 | ✓ Camera2 `RAW_SENSOR` | ✓ ProRAW (Bayer as a setting) | RAW off by default since 1.1.6 |
| Lenses UW / W / T, selfie | ≤1.1.1 | ✓ | ✓ one physical lens at a time | |
| Full-resolution raw (50 MP / 48 MP) | 1.5.7 | ✓ | ? | Android remosaics Quad-Bayer into a standard DNG (`MaxResDngWriter`); iOS follows the system 48 MP option |
| **Merge 8 frames** (burst, align + merge, On / Auto / Off) | ≤1.1.1 | ✓ | — | HDR+-style merge in C++ (`burst_merge.*`); iOS relies on ProRAW's own merge. Frame merging Auto by default 1.5.7; written into the photo's description 1.10.6 |
| Digital zoom up to 10× | 1.10.1 | ✓ | — | Compact zoom control 1.10.2, can be hidden 1.10.3 |
| Tap to focus and meter | ≤1.1.1 | ✓ | ✓ | More precise ring (5% square) 1.5.3; iOS 26 needed for the small square |
| AF LOCK, drag the ring with a 3× loupe | 1.5.3 | ✓ | ✓ | |
| **Track the subject after a tap** (off by default) | 1.6.0 | ✓ | ✓ | `PatternTracker` shared; iOS untested on the phone when added |
| Brightness slider that also sets exposure compensation | 1.6.2 | ✓ | ✓ | Brightness holds in low light: 1.7.3 |
| Warmth slider | ≤1.1.1 | ✓ | ✓ | Becomes the filter in B&W mode |
| Look strength | ≤1.1.1 | ✓ (in Settings since 1.14.8) | ✓ | |
| Flash: Focus-flash (torch focus, then the flash) | ≤1.1.1; only mode 1.3.0 | ✓ manual flash exposure | ◐ the camera's own flash AE | Flash exposure at zoom 1.10.0 |
| Selfie flash (screen flash with a lit frame) | 1.10.0 | ✓ | — | |
| Self-timer (2 / 5 / 10 s), experimental | 1.14.3 | ✓ | — | Behind Settings › Experimental |
| Long exposure (5–60 s), experimental | 1.14.3 | ✓ | — | Gathers light in dark scenes 1.14.5 |
| **Video** (PHOTO / VIDEO pill; HEVC; look baked in; AE LOCK; quality Low / Optimal / High) | 1.10.1 prototype; 1.14.7 not experimental | ✓ | ✓ | HEVC 1.10.3; stabilization 1.10.5 / 1.10.7; AE lock 1.10.7. iOS ported 2026-11-22 (1080p30 HEVC, AAC stereo where offered, saved to Photos › RawBoy Camera; the camera's own stabilization; not compiled or tried on a phone yet) |
| Video: flat video for grading (Apple Log) | 1.10.8 | ✓ | — | Not planned for iOS |
| Volume buttons take a photo | ≤1.1.1 | ✓ | ✓ volume + Camera Control click | Launching from Camera Control would need a LockedCameraCapture extension: not done |
| Shutter sound (optional) | 1.3.0 | ✓ | ✓ 1.4.7 | iOS 18: `isShutterSoundSuppressionEnabled`; always on where the law requires |
| Level and Grid options | 1.10.0 | ✓ | ✓ | Level follows the horizon 1.15.12, moves smoothly 1.15.1 |
| QR codes (Open, Join Wi-Fi, Email, Call, Message, Map, Copy) | 1.5.6 | ✓ ZXing | ✓ AVFoundation | |
| Geotag (JPEG and DNG GPS tags) | 1.4.0 | ✓ | ✓ 1.4.7 | Android writes a full GPS IFD into the DNG (`DngGps`) |
| Landscape layout (controls on the right edge) | 1.7.0 | ✓ | ✓ | |
| **Easy mode** (Settings › Easy mode, off by default; prototype): viewfinder, lenses, RAW, Frames, flash, Photo / Video, Colour / B&W (default film stock, or Film + B&W on the default mono stock) and a 96 dp shutter; a short Settings sheet | unreleased | ✓ | — | Forces a plain shot without changing the stored settings (`CameraSettings.effective`): no leak, Brightness/Warmth, timer, long exposure, tracking, flat video, motion data, histogram, grid, level or zoom buttons; merging on Auto; no hold-to-compare or loupe |
| Lock-screen camera, double-press power button | 1.5.5; 1.5.6 | ✓ | — | iOS: not done (needs LockedCameraCapture) |
| Opens fast and saves while locking right after a shot | 1.5.7 | ✓ foreground service + wake lock | n/a | |
| Saves back off when memory is low | 1.10.9 | ✓ | ? | |
| Samsung tablets / phones match the viewfinder better | 1.8.11; 1.10.8 | ✓ | n/a | |
| **Phone profiles** detected at start (chip, maker, model layers; *Phone profile* line in Settings) | unreleased (branch `camera-device-compat`) | ✓ | n/a | Pixel 9 Pro (Tensor) and OnePlus 11 measured; others neutral. See [camera-platforms.md](camera-platforms.md) |
| Share device report (Settings) | unreleased (same) | ✓ | — | Plain text through the share sheet, for tuning a new phone |
| Collect tuning data (Settings) | unreleased (same) | ✓ | — | Viewfinder/photo 512 px copies of the next 10 shots + the camera's log, zipped with the device report for the share sheet |
| Video motion data + **Stabilize after recording** (experimental, `-stab.mp4` copy) | unreleased | ✓ | — | Gyro/OIS capture and a software stabilizer; Settings › Experimental. Optical stabilization switch for video |
| **Viewfinder from RAW** (Settings › Viewfinder, off by default) | unreleased | ✓ | — | The viewfinder is developed from the RAW_SENSOR stream instead of the ISP's preview; offered where the phone profile allows (Tensor). AVFoundation has no raw video stream, so iOS can't have it |
| Video on phones whose standard encoder path fails (probe) | unreleased (same) | ✓ | — | OnePlus 11 records through the encoder's own GL context |

## Looks and output

| Feature | Since | Android | iOS | Notes |
|---|---|---|---|---|
| Look menu: Color and Experimental sections | ≤1.1.1 | ✓ | ✓ | Movie Green, Redscale, Lagoon, Violet Dust, Unseen; V2 looks 1.15.15 |
| **Film mode** (12 stocks, grain, halation) | 1.7.0 (was RawBoy Film) | ✓ | ✓ | On by default; its own pick |
| **B&W mode** with filters (None, Yellow, Orange, Red, Green) | 1.6.3 | ✓ | ✓ | Filter as a menu 1.8.5; the DNG stays colour |
| Film + B&W together (punchier) | 1.7.0 | ✓ | ✓ | |
| Grain setting (on by default) | 1.16.10 | ✓ | ✓ | |
| JPEG with jpegli (4:4:4, quality 70–100) | ≤1.1.1 | ✓ | ✓ | |
| Smaller photos (3000 px, light sharpening) | 1.3.0 | ✓ | ✓ | |
| EXIF kept (shutter, aperture, ISO, focal length) | 1.2.0 | ✓ | ✓ | |
| **HDR gain map** (Ultra HDR JPEG) | 1.10.1 | ✓ | — | Visible lift 1.15.11; scaled to the look's white 1.16.11 |
| **Lossy JPEG XL DNG** re-save | 1.5.10 | ✓ | n/a | iOS keeps ProRAW |
| Frames: Date stamp (Classic, Red LED, 3 orders) | 1.15.13; refined 1.15.14–1.15.15 | ✓ | ✓ | Pro and Auto got them in 1.16.12 |
| **Random light leak** (one random procedural film leak on saved JPEGs; Frequency 1/5–5/5 in shuffled 5-photo sequences; Short-side sprockets) | unreleased (branch `claude/project-thread-lw6gpc`; Android before that) | ✓ | ✓ | Same generator (`FilmLeaks.randomForCamera`, types edge, blob, sprocket, rebate, flare, start). The DNG and the viewfinder don't get it. iOS ported 2026-11-22, not yet tried on a phone |
| **B&W greys the random light leak** (`monoFx`) | unreleased | ✓ | ✓ | In B&W mode (also with Film on) the random light leak goes grey with the picture |
| Frames: Pentax 645 / Contax 645 rebate with shoot info | 1.15.16 | ✓ | ✓ | |
| Remember camera & settings (off by default) | ≤1.1.1 | ✓ | ✓ | |
| Reset settings to defaults | 1.16.11 | ✓ | ✓ | |
| Settings regrouped, one line per setting | 1.15.0 | ✓ | ? | |
| Burst, Flash, RAW, Frames buttons in the top bar | 1.1.2 | ✓ | ✓ | iOS has no experimental button; its RAW, Frames and Flash hide in video mode |
| TalkBack / VoiceOver labels | 1.8.5 | ✓ | ✓ | |
| **Interface language** (Settings › Language: Phone / English / Українська; Ukrainian translation of the whole Android camera UI, the help sheet and messages) | unreleased | ✓ | — | Follows the phone's language by default, a pick overrides it. `i18n/Strings.kt` + `StringsUk.kt`: the code keeps its English text as the key (`tr("…")`), an untranslated string shows in English. iOS is not translated yet |
| Open-source licences in Settings | ≤1.1.1 | ✓ | ✓ | |

## What iOS lacks that Android has

In order of how much it changes the photo: **burst merge** (iOS is single-frame ProRAW, which the changelog says gives
"far less grain than a single Bayer frame in low light"), **video motion data and stabilized copies** (iOS records video, with the camera's own stabilization only, no flat video), the **viewfinder from RAW** prototype (AVFoundation offers no raw video stream),
**HDR gain map** (Ultra HDR JPEG), **lock-screen and power-button launch**, **digital zoom up to 10×**, **selfie
screen flash**, **self-timer and long exposure**, **lossy JXL DNG**, **full-resolution (remosaic) raw** (iOS follows the
system 48 MP option, unchecked), **phone profiles, Share device report and Collect tuning data** (n/a on iOS: one hardware family),
**Pixel workarounds** (YUV matrix, tone curve, extra black, manual flash exposure: iOS uses the camera's own flash AE).
**Ukrainian translation and the language setting** (Android only: iOS needs its own String Catalog).
**Easy mode** (Android prototype, 2026-11-22).
Random light leak and video recording are no longer on this list (ported 2026-11-22).

## Other platform gaps worth knowing

- iOS-only in Camera: ProRAW as the default raw and the Camera Control click.
- Android has no Lensfun port (Pro on web, Desktop and iOS have it) and no `healStroke` JNI binding (healing brush on web and Desktop).
- Android's Pro light leak overlay has no outline dots (web, iOS and Desktop do). Camera's random leaks are not shown in the viewfinder on either platform.
- There is no web or Desktop camera (see top).

## Known open items (from the code and `CLAUDE.md`)

- **iPhone photos don't match the Pixel's looks** (owner: "need to find a way to match looks"): ProfileGainTableMap
  tried and not adopted; the next step noted is a same-scene Pixel vs iPhone comparison.
- iOS lacks the Pixel workarounds (YUV matrix, tone curve, extra black, manual flash exposure); the iPhone's own flash AE is used.
- Subject tracking and focus-lock changes were marked "untested on the phones when added".
- Video: no 4K, no log capture beyond "flat" (Android only); see `docs/video.md` for the staged plan. iOS video is untried: stabilization may not be offered on the photo preset's format (the log line `video stabilization:` shows what the camera reports).
