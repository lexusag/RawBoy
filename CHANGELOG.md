**Camera (Android, experimental): stabilize after recording (2026-11-22)**

- With **Save motion data with videos** on, **Stabilize after recording** (on by default) renders a steadied copy of each video from its `.motion` file in the background and saves it beside the original as `VID_…-stab.mp4` (70% crop, the owner's pick from the prototype renders). `stab/StabPlan.kt` is the Python prototype's model ported (gyro integration with each lens's fitted picture-per-gyro scale, `LensProfile.motionGain`, set for the Pixel 9 Pro in the Tensor layer; rolling shutter per output point; OIS samples; Gaussian path σ 0.5 s; easing near the crop's limit; held frames), `StabRenderer.kt` decodes into a SurfaceTexture, draws a 33×33 warped mesh into the encoder and copies the audio. Checked against the prototype on three clips (paths within 0.02°, warps within 1.6 px; the prototype's path flipped on a clip turned through 180°, the port's doesn't) and with JVM tests (`StabPlanTest`); tried on the Pixel 9 Pro (2026-11-22, W and T2): owner "W pretty good, T2 pretty shakey, but MUCH better than before"; T2's motion gain is still a guess, to fit on OIS-off clips. Frames whose capture result the camera dropped (T2: two 100 ms holes in the results, not in the video) are kept, from the file's own frame times.

**Camera (Android, experimental): motion data from the first frame, and no unreadable OIS (2026-11-22)**

- The gyroscope started with the recording, and its first sample came 23-106 ms after the video's first frame (all 23 test clips of 2026-11-21), so the start of every clip couldn't be stabilized. The sensors now run while video mode with motion data is on (`MotionSensors`, stopped when the app leaves the screen) and keep the last half second, which a recording takes over at its start.
- Lenses whose OIS sends no lens-shift samples (Pixel 9 Pro T2 and T3: their picture moved only 0.57-0.80 of what the gyro said, so the stabilizer over-corrected) get OIS off while motion data is on. Found by watching the preview before recording: OIS on and no samples for 30 frames (`CameraController.watchOisSamples`); the advertised OIS data modes don't tell (W and T send samples without listing them, T3 lists them and sends none). The Optical stabilization switch still decides for W and T.

**Camera (Android): videos no longer drop frames (2026-11-21)**

- Videos lost 1-8% of their frames in landscape and about 12% in portrait (counted from the motion data: camera frames with no encoded frame), in short runs about every 300 ms. Every 300 ms the viewfinder reads its 512 px copy back for the live auto develop; read from the half-float copy as GL_FLOAT, the driver converted on the CPU and made `glReadPixels` wait for the GPU, holding the GL thread past the next camera frame (the SurfaceTexture keeps only the newest). The copy is now drawn a second time into a 32-bit float target (`ViewfinderRenderer.baseRead`, where `GL_EXT_color_buffer_float` exists) and read from there without conversion. Pixel 9 Pro, two 10 s clips (landscape and portrait, W): 0 frames dropped while recording.
- While recording, `RawBoyVideo` logs each dropped camera frame with the GL thread's timings around it (idle, latch, copies, readbacks, develop, video) and a summary every 5 s.

**Web: picking a photo on iPhone (home-screen app) could do nothing (2026-11-21)**

- `pickFiles` (and the folder picker) made an `<input type=file>` that nothing referenced once the picker was up. iOS WebKit can garbage-collect such an input, so the change event never fired and a photo chosen from the Photos library was silently ignored, often but not always. The input is now attached to the page (hidden) and held until it reports a choice or a cancel, and files are read before it is removed. Cause inferred from the known WebKit behaviour and the code: not reproduced on the phone (no Web Inspector session available), not tested on a device.

**Camera: Brightness brightens in the dark (2026-11-21)**

- In a dark scene (a candle-lit table, Pixel 9 Pro) Brightness +65 and +100 brightened the viewfinder for a moment, then it dropped back to where it was at 0 (measured on the owner's screen recording: +100 held 0.3 s, then back within 0.05 of 0's brightness); −100 still darkened by about 3 EV. AE was already at its longest preview exposure and highest gain, so the extra compensation changed nothing in the frames, neither the raw nor the post-raw boost. The Pixel's rule (`AppliedCompensation.ev`) counts compensation as reaching the raw unless it shows up as extra boost, so it credited all of it and the develop took Brightness back out (in photos too). Now, while AE is pinned (the frame at the preview's frame-rate cap and within 85% of the highest gain the camera reached there this session), the compensation is measured: AE's whole gain (exposure × ISO × boost) against the last frame shot without compensation, less what went into the boost (`AppliedCompensation.evPinned`, `CameraController.isPinned`). Below the ceiling, and when no uncompensated frame was seen since the camera opened (Brightness kept from an earlier session), the old rule holds. Same for photos, which take the compensation at the shutter from the same function. JVM tests in `AppliedCompensationTest`; not built or run on a phone here.

**Camera: Brightness no longer overshoots in the viewfinder (2026-11-21)**

- Moving **Brightness** made the viewfinder overshoot and then sink back: at +100 (+3 EV, of which the camera's AE compensation gives up to +2 EV on the Pixel and the develop the rest) the develop's +3 EV showed at once, then the camera's AE put its +2 EV into the frames within a few frames, while the live develop took that compensation back out only at its metering ease of 0.3 EV per update (~300 ms). The picture went to about +4.4 EV and drifted back to +3 over ~2 s, and the same downwards (−4.4 back to −3, and about −1.4 EV under normal for ~2 s on returning to 0). Now only the metering eases (a tap, a release, a tracked subject, the scene changing: auto exposure keeps working at any Brightness) and the compensation is taken out in the same update the frame carries it (`LiveExposure.ease`; iOS `CameraViewModel.easedExposure`). Modelled with AE converging half the step on the first analysed frame: one update about 0.7 EV short of the new setting, then exactly on it. Steady state was already right (0 = the phone's exposure lifted to the usual key, ±100 = ±3 EV) and photos are unchanged. JVM test `LiveExposureTest`; not built or run on a phone here.

**RawBoy Desktop: pin RawBoy Viewer 0.2.13 (2026-11-21)**

- **Videos in the browser** (opened in the default player), **all metadata in the viewer's details panel**, a **collage maker** (with 3:4, 2:3, 4:3, and 3:2 size presets, `_collages` output folder, and a JPEG quality slider with live file-size prediction), and a fix for **thumbnails and previews stalling in folders of ~1000 compressed DNGs**. Comes with RawBoy Viewer v0.2.13 (PRs 64, 65, 66, 67, 68, 69); the pin moves from 0.2.10 to 0.2.13. Not tried by hand (no Mac): CI's `desktop` job is the first build.

**Camera (Android, experimental): motion data with videos (2026-11-21)**

- Settings › Experimental › **Save motion data with videos**: videos record the whole 4:3 frame, and a `.motion` file beside them (in the app's own folder, `Android/data/app.rawboy.camera/files/motion/`) keeps the gyroscope and accelerometer at their highest rate plus each frame's timing, rolling shutter skew, focus and lens data. It is the groundwork for stabilizing videos afterwards; nothing is stabilized yet. `tools/motion/dump.py` summarises a file.
- docs/camera.md no longer describes the old electronic video stabilization: the setting is the lens stabilizer only.

**RawBoy: anamorphic flare Ghosts now show (2026-11-21)**

- The **Ghosts** switch did nothing: its tall-oval source was blurred so widely that even a clipped lamp fell far under the flare's brightness knee, so no ghost was ever drawn. The ghost band is now scaled back up to about 1 for a clipped light (capped for lamps covering several texels) and read without the knee, and the ghosts are a little fainter (strength 0.8). Same fix in the web, Android and iOS/Desktop engines (the shader is shared).
- What it is: faint reflections of the bright lights (two soft tall ovals each, cyan-green and pink) mirrored through the middle of the frame, like internal lens reflections. They follow the Anamorphic slider. Docs, Help and the web chip's tooltip now say so.
- Checked by reading the code and the numbers only; **not rendered or built here** (no web dependencies or SDKs in the session): look at a night shot with a lamp, Anamorphic 60+, Ghosts on.

**Camera (Android): faster start (2026-11-21)**

- Measured on the Pixel 9 Pro (release build): about 1.15 s to the first screen, and the camera only began connecting ~1.7 s after the viewfinder surface existed, because lens discovery (reading ~10 cameras' characteristics) started only after the GL context had compiled its shaders. Discovery now starts when the screen's view model is made, and the viewfinder hands over its camera texture before compiling the shaders, so discovery, camera open and session set-up overlap the shader compile instead of following it. Nothing about the picture changes.

**Camera (Android): Optical stabilization switch now takes effect (2026-11-21)**

- Settings › Optical stabilization changed nothing on the Pixel 9 Pro: the camera's preview template already has the lens stabilizer on, and the app only ever asked for it on. In video mode the switch now sends the lens stabilizer mode either way (off really turns it off); photos still leave the camera's own setting. Back lenses only: the front camera has no OIS.

**Desktop and iOS Pro: 🎲 Random replaces the previous leak with a type picked (2026-11-21)**

- With a specific film-leak type chosen, 🎲 Random added another leak on top of the earlier ones each press. It now replaces the selected leak (or the last one when the layers are full), as with *Any* and as on the web; only **+ Add** creates a new layer.

**Camera (Android): Zoom buttons off by default (2026-11-21)**

- Settings › Zoom buttons now starts off (pinch zoom is unchanged) and says it only helps the viewfinder and does not affect the picture. A choice already saved stays as it was; the Help text no longer claims the buttons are shown by default.

**Pro, Auto and Camera: sprocket holes on the long sides by default (2026-11-19)**

- Randomly generated `sprocket` film leaks now sit on the long edges of the frame only (before, 15% landed on the short edges). New **Short-side sprockets** option (off by default) allows the short edges too: a toggle beside the leak buttons in Pro's Light leaks panel and Auto's photo view (web, Android, iOS and Desktop), and under **Random light leak** in Camera's Settings (Android). Added with #432.

**Camera (Android): Video quality setting (2026-11-21)**

- Docs for **Settings › Video quality** (Low 8, Optimal 16, High 24 Mbit/s; flat video 14, 28, 38), added with #431 and tuned in #441: `docs/camera.md` still said a fixed 16 and 28 Mbit/s.

**RawBoy Web: ACES, PBR Neutral, GT, OpenDRT, Reinhard, Hable and Lottes tone mappers (2026-11-20)**

- Added 7 new tone mappers to RawBoy Web's Light tab (`shaders/develop.glsl`, `web/src/engine/develop/DevelopParams.ts`): **ACES** (Stephen Hill's RRT+ODT fit with Rec.2020 ↔ AP1 matrices), **Neutral** (Khronos PBR Neutral), **GT** (Gran Turismo / Uchimura), **OpenDRT** (Michaelis–Menten tone scale with hue-preserving highlight dechroma), **Reinhard** (Reinhard-Jodie), **Hable** (Uncharted 2 filmic), and **Lottes** (AMD GDC 2016). All are exposure-aligned to AgX's middle grey (`0.4967` in display 2.2) so switching tone mappers keeps overall brightness consistent, and round-trip in Light presets. Web only for now (Android, iOS and Desktop keep AgX / Filmic / Sigmoid).

**Camera (Android): fewer dropped video frames (2026-11-19)**

- Muxer writes moved to their own thread (`RawBoy-muxer`) so the encoder's output buffers are released at once, the encoder is asked for real-time priority without B-frames, and while recording a look the develop shader runs once per frame (at encoder size) for both the screen and the encoder. QR scanning pauses while recording. High video quality is now 24 Mbit/s (38 Mbit/s flat).

**RawBoy Desktop: pin RawBoy Viewer 0.2.10 (2026-11-19)**

- **Drag multiple selected files and folders to other apps**, **show selected files' total size in the browser status line**, **copy dropped files into the open folder**, and **warn before moving to Trash in the viewer**. Comes with RawBoy Viewer v0.2.10 (PRs 61, 62, 63); the pin moves from 0.2.9 to 0.2.10. Not tried by hand (no Mac): CI's `desktop` job is the first build.

**Pro, Auto, and Camera (Android): procedural film light leak and film damage generator (2026-11-18)**

- **Pro & Auto:** Ported the procedural film leak generator to Android (`Shaders.kt`, `FilmLeaks.kt`, `DevelopParams.kt`, `Edits.kt`, `Presets.kt`, `ShaderParams.kt`, `GlCommon.kt`, `LeaksPanel.kt`, `FilmLeakOverlay` + `rememberFilmLeakGestures` in `MaskOverlay.kt`, `EditorViewModel.kt`, `EditorScreen.kt`, `AutoViewModel.kt`, `DetailScreen.kt`), with deterministic seed-parity tests against `FilmLeaks.ts` (`FilmLeaksTest.kt`).
- **Camera (`CameraSettings.kt`, `CameraViewModel.kt`, `CameraScreen.kt`, `ShotSaver.kt`):** Added a **Random light leak** setting (off by default) that adds a completely random film light leak per shot from `edge`, `blob`, `sprocket`, `rebate`, `flare`, or `start`.

**Pro and Auto (Desktop, iOS): procedural film light leak and film damage generator (2026-11-18)**

- Ported the procedural film leak generator from Web to Desktop and iOS (`ios/shaders/gen.sh`, `FilmLeaks.swift`, `DevelopParams.swift`, `Edits.swift`, `Presets.swift`, `ShaderParams.swift`, `MetalCommon.swift`, `LeaksPanel.swift`, `FilmLeakOverlay` in `MaskOverlay.swift`, `EditorViewModel.swift`, `EditorScreen.swift`, `AutoSidecar.swift`, `AutoViewModel.swift`, `DetailScreen.swift`), with deterministic seed-parity tests against `FilmLeaks.ts` (`FilmLeaksTests.swift`).

**RawBoy Web and Packer: no thread-pool failure on iPhone or single-threaded pages (2026-11-18)**

- **Root cause:** `parallelRows` (`rawboy.h`), `taskThreads` (`libraw_parallel.cpp`), `PackHost` (`dng_pack.cpp`) and `decodeJxl` (`wasm_bridge.cpp`) asked for `std::thread::hardware_concurrency()` threads without checking `emscripten_has_threading_support()` (which can be false even when `hardwareConcurrency > 1`) and without catching `std::system_error` when `pthread_create` returns `EAGAIN` (`thread constructor failed: Resource temporarily unavailable`). `parallelRows` and `PackHost::PerformAreaTask` also spawned up to 8 worker threads while leaving the calling thread idle in `join()`, and destroying a non-empty `std::vector<std::thread>` on a mid-loop throw would call `std::terminate()`.
- **Fix:** all four paths now check `emscripten_has_threading_support()` under Emscripten, run slice/band 0 on the calling thread (spawning at most `threads - 1` workers), and catch `std::system_error` when spawning a worker thread to finish the remaining work on the calling thread.

**Pro and Auto (web): procedural film light leak and film damage generator (2026-11-18)**

- **Generate in Light leaks (`shaders/film_leak.glsl`, `FilmLeaks.ts`, `LeaksPanel.tsx`, `MaskOverlay.tsx`):** 13 seeded procedural film leak and defect types (**Edge burn**, **Blob**, **Streak**, **Sprocket holes**, **Fog**, **Rebate glow**, **Flare**, **Start of roll**, **End of roll**, **Film tear**, **Dust & scratches**, **Chemical stain**, **Scratches**) with 7 spectral exposure palettes (**Warm**, **Amber**, **Red**, **Magenta**, **Cool**, **Green**, **Mono**) and whole-photo colour adjustment (**Warmth**, **Tint**, **Fade**, **Contrast**), sharing the 4-layer `MAX_LEAKS` budget. **🎲 Random** rolls a full multi-layer film leak (**Any**) or a single chosen type; **New variation** rerolls only the pattern seed. Each layer sits in an axis-aligned box dragged to move and stretched along x and y by 8 corner/edge handles (no rotation knob or mesh warp), with edge orientation controls (**←**, **↑**, **→**, **↓**, or **↔ Horizontal** / **↕ Vertical** for scratches, plus **Flip**).
- **Presets and Auto (`Presets.ts`, `AutoStore.ts`, `AutoApp.tsx`):** new opt-in **Light leaks (generated)** (`leaks`) preset group (off by default; layers on top of Auto looks without replacing them), plus a minimal **🎲 Leak** button in Auto's photo view (click to place or reroll a random film leak, × or long-press to remove it).

**RawBoy Camera (Android): Brightness and long exposure in the dark on the OnePlus 11 (2026-11-17)**

- **Brightness at the exposure ceiling:** in a dark room the OnePlus 11's AE tops out at a gain (exposure x ISO x post-raw boost) of 1/15 s x ISO 6400 on the main and ultrawide cameras (preview 1/30 s x boost 2.0-2.22; stills 1/15 s at boost 1 or 1/30 s at boost 2) and 1/30 s x ISO 1600 x boost 5.0 on the selfie camera; a brighter Brightness adds nothing there. The develop took the compensation back out all the same, so +1 EV came out +0.25 to +0.36 EV (single and merged shots); the Pixel's rule (`AppliedCompensation.ev`, which counts compensation raising the post-raw boost as digital) read the same frames either way by which side of its 30 ms threshold the preview's exposure fell, so two merged +1 shots of one scene came out +1.03 and +0.29 EV. On OnePlus the boost does reach the developed raw: `DngCreator` writes the still's boost as BaselineExposure (0.99 EV at boost 2), which the decoder applies. New `StillProfile.compensation` (`CompensationModel`): neutral `BOOST_STAYS_DIGITAL` (today's), the OnePlus layer `AE_GAIN_IN_RAW`: compensation reaches the raw in full, except a brighter one when the frame's gain is within 85% of AE's ceiling (`AppliedCompensation.evBelowCeiling`; the ceiling is `StillProfile.aeGainCeilings` by camera id, else the still's longest exposure x the highest ISO; the OnePlus 11's layer gives its selfie camera 240). Bursts and long exposures judge it on the frame at the shutter (AE moves on during them). Main camera in the dark: +0.83 EV merged → +0.86 to +0.90 EV, the viewfinder within 0.01 EV of the photo; ultrawide +0.83 → +0.70 EV (its develop's +2 EV lift limit binds); −1 EV single and merged −0.93 / −0.96 EV; a lamp-lit room (AE below the ceiling) +0.83 → +0.84 EV, +2 → +1.98 EV.
- **Long exposure's frames:** the scene key the frames are lifted from missed the OnePlus brightness model's neutral floor (`ViewfinderGain.longExposureKey`): it read 0.039 for a raw at 0.019 and lifted the frames 0.63 EV instead of 1.7 EV (frames at ISO 1315 instead of 2750, the rest lifted digitally). The viewfinder's gain ahead of the shutter took the frames' gain over the still the Pixel's way (x boost / still gain); under the OnePlus model it is the frames' time x ISO over the preview's whole gain (/ boost). The two errors had cancelled before the shutter; with both fixed, the viewfinder before the shutter equals the one without Long exposure (−3.81 / −3.75 EV), and the photo comes out within 0.2 EV of a merged shot of the scene (key 0.069 for 0.06; 10 s: 18 frames, no clipping, luma noise 0.0035 against 0.0073 merged). Under that model the viewfinder's gain switches at once when an exposure starts or ends (the frames change with it) instead of easing: eased over the OnePlus 11's ~1.4 s updates during the exposure, it showed the first seconds up to 1.7 EV too bright; now 0.35-0.4 EV over the picture before the shutter in the dark (in a lit room one +0.9 EV flash in the first ~0.75 s, then within 0.1 EV). Turning Long exposure on or off still eases. Pixel and Samsung keep the Pixel's rules (pinned by tests).
- The shutter's log line adds the live develop's exposure and Brightness (`live exposure … + brightness … EV`).

**RawBoy Camera (Android): flash and screen flash work on the OnePlus 11 (2026-11-17)**

- **Flash exposure:** RawBoy exposes flash stills by hand (AE off, the lens's flash guide x the focus distance squared, `FLASH_MODE_SINGLE`), because the Pixel 9 Pro's AE keeps the ambient exposure for a flash still. On the OnePlus 11 such a still reports the flash fired but its raw gets almost none of the light: a white sheet at 1 m came out black. New `FlashProfile.metering` (`FlashMetering`): neutral `MANUAL_GUIDE` (today's), the OnePlus layer `CAMERA_AE`: always-flash AE mode and a precapture trigger (the HAL fires its pre-flash and meters; 0.6-0.9 s), then the still with AE on (`CameraController.flashMetering`). Such shots are developed like ordinary ones (the phone's exposure kept, lifted to the usual key) and don't learn a flash guide. `FlashProfile.cameraAeCompensationEv` adds AE compensation for that still, taken back out by the develop like Brightness: the OnePlus 11's layer sets −1 EV (its ultrawide's AE clipped white paper at 1 m, 0.5% of the frame). Main and ultrawide cameras at 0.3, 1 and 3 m: under 0.1% of the raw clipped (specular highlights), repeated shots within 3%, the JPEG's centre within 0.1-0.2 EV of the uncompensated shot's; against a merged shot without flash (3 m, a lamp behind the phone) the white sheet came out −0.29 EV and the centre −0.43 EV (both developed to the same key; the flash lights the foreground). Focus locked by a tap (no torch first) works the same.
- **Screen flash:** the frame around the viewfinder went dark 0.25 s after the shot's request, but the OnePlus 11 starts the exposure 0.36-0.38 s after it, so its selfies got none of the screen's light (raw key 0.07, against 0.11-0.12 with the frame held). New `FlashProfile.screenFlashUntilExposed` (neutral false, today's; on in the OnePlus layer) keeps it lit until the still's result has arrived, at least the 0.25 s (`CameraController.captureDng(onExposed)`); the log line `screen flash: dark … ms after the request` shows it (487 ms on the OnePlus 11).
- The manual exposure moved into `capture/FlashExposure` (with `CompensationSteps`), tested against the former code; the Pixel's flash, Tensor and Samsung keep the manual guide and the fixed screen-flash time (pinned by tests).

**RawBoy Camera (Android): neutral night shadows and no stalled develops on the OnePlus 11 (2026-11-17)**

- **Black level:** LibRaw keeps a DNG's per-site BlackLevel (BlackLevelRepeatDim 2 2, as `DngCreator` writes it) as integers, dropping the fraction (the OnePlus 11 writes 64.62 / 64.81 at ISO 6400, decoded as 64), and clips noise below black at zero; both lift and tint the deepest shadows. New engine option `app.rawboy.raw.BlackFix` (`RawImage.open(…, black)`, `rawboy::BlackFix` in `decodeWithLibRaw`, LibRaw unmodified: it subtracts an integer `user_black` a pedestal below the lowest site, the rest is taken off in float with the scale restored): `exact` (the fractional black), `pedestal` (DN of noise kept below black; such pixels near black keep negative values, `floatToHalfSigned`), `offset` (DN per colour). Default = LibRaw's handling, so Pro, Auto, the web and iOS decode as before. Camera reads it from the profile: `StillProfile.exactBlack`, `blackPedestal`, `blackOffsets` (`BlackOffsets`: DN per camera id and ISO); the shot carries its camera id (`Shot.cameraId`). The OnePlus layer sets the exact black and a 32 DN pedestal; the OnePlus 11's layer adds its sensors' offsets (main −0.48 / −0.35 / −0.29 DN R/G/B at ISO 6400; ultrawide +0.27 / +0.14 / +0.04 at 1/30 s, the exposure AE gives at high ISO: its offset falls with exposure time, +0.72 / +0.60 / +0.42 at 0.3-11 ms; ~0 at ISO 400). Measured against a frame of the same scene at ISO 100, 4 stops under: merged shadows at 2⁻⁸ / 2⁻⁷ of white within +5.5% R/G and B/G (main camera before: up to +14%, single ISO 6400 frames +49%); an ultrawide night shot (ISO 6400, 1/30 s, merged) at 2⁻⁹ went from R/G +22%, B/G +37% to +2…+3%; a night corridor without Film went from magenta deep shadows (R/G/B 12 / 5 / 10 levels) to neutral (5 / 7 / 6), grain and colour noise unchanged. Tensor, Samsung and the neutral profile keep LibRaw's handling (pinned by tests).
- **Develop priority:** shots are developed in a low-priority GL context so the viewfinder comes first (Pixel 9 Pro). On a hot OnePlus 11 (thermal status 3-4 after an hour of shooting) the throttled Adreno gave the viewfinder all of it: photos without Film took 45 s to over 5 minutes (196 s for a 4 MP selfie), leaving the viewfinder finished them in seconds. New `StillProfile.lowPriorityDevelop` (neutral true, today's) and the first Qualcomm layer (`platform/qualcomm/Qualcomm.kt`), which develops at normal priority: 3.0-3.1 s on the same hot phone, the viewfinder dipping 30 → 25 fps for those seconds. Samsung keeps the low priority on any chip. Cool, both paths take ~3.5 s for 12 MP (the coarse colour denoise of non-Film looks ~0.9 s of it).
- **Selfie denoise:** the OnePlus 11's selfie camera measured 1.45-1.73x the main camera's noise at equal ISO (~2.6x the ISO), so its layer denoises it as for 10x its ISO (neutral 8); the back cameras stay at 4 (main and ultrawide within 5%). Shots log the measured noise and the denoise chosen (`noise ISO … -> denoise …`).
- Exposure on the OnePlus 11: its AE keeps highlights (rooms and backlit windows at a key of 0.03, lifted to 0.06 as on the Pixel), and Brightness reaches the raw in ordinary light (±1 EV gave ×0.48-0.55 and ×1.9-1.96). At the ISO ceiling it doesn't (+1 EV gave +0.25 EV, −1 EV gave −1.6 EV): a known limitation for now.

**RawBoy Camera (Android): the OnePlus 11's viewfinder matches its photos in daylight, backlight and dim light (2026-11-17)**

- **Brightness model:** on the OnePlus 11 the raw's grey is the preview's times the frame's smallest as-shot neutral component, within 0.97-1.04 on 20 shots (main, ultrawide, selfie; LED room, dawn window, dim rooms; ISO 150-6400, post-raw boost 1-4.25, the still exposed 1-2x the preview): the preview already has the still's brightness and the ISP's white balance at green 1, while the decoder normalises to the largest multiplier. The Pixel's model (calibration / boost x still gain) made the learned scale follow the light instead (0.37-0.47 by illuminant, 0.95 for the selfie camera at boost 4.25, which then put the next normal-light shot 0.3 EV off). New `PreviewProfile.level` (`PreviewLevel`): neutral `BOOSTED` (today's), the OnePlus layer `STILL_WHITE_BALANCED` (gain = calibration x neutral floor). Its calibration is stored apart (`previewScalesWb`, the old `previewScales3` stays for `BOOSTED`), so OnePlus phones updating from earlier builds (0.38-0.95, or ~3.9 under the old lens labels) start from the default 1.0, which the first shot confirms (0.977-0.99 on every lens). No raw metering before the first shot under it: a raw frame 0.3 s after a lens starts caught AE unsettled (0.36-0.6 on the main camera, 3.4 on the ultrawide). A lens starts at the calibration times the last frame's neutral floor and takes its first target at once (it used to ease over ~1.5 s from twice the target); calibration keys are taken as if drawn at the calibrated gain (`capture/ViewfinderGain.kt`, with a test that `BOOSTED` is the former expression).
- **Toe:** below the evenly spaced curve's first point (1/63 of white) the HAL draws a straight line from black; read as sRGB, raws 9-10 stops under clip came out 27% dark in the viewfinder, and backlit scenes calibrated 9% high. The viewfinder decodes that segment along the same line (`ViewfinderRenderer.Frame.linearToe`, set by `CameraController.previewLinearToe` when the profile sends the curve at even points; 0 = the exact sRGB inverse, as before). The viewfinder copy now follows the raw within 0.95-1.08 down to 10 stops under clip (a ~1 code level pedestal remains below that).
- **Backlight:** the OnePlus 11's preview tone is global (the copy over the raw was equal at equal raw level in every third of a window shot), so the shadow lift that shots get in backlit scenes (`ShotDevelop.backlightShadows`, moved unchanged from `ShotSaver`) wasn't in the viewfinder: the photo's foreground came out 0.3-0.8 EV brighter. New `PreviewProfile.liftsShadows` (neutral true, today's: the Pixel's preview is lifted by its ISP); the OnePlus layer sets false and the live develop adds the shot's lift, eased by 15 per update (~1.6 s from 0 to the full 80) and not in video mode, so recordings keep the plain develop. Window shots: shadows within +0.00…+0.11 EV of the JPEG on main and ultrawide; a partial lift (range 6.3 stops) was 49 in both the viewfinder and the shot.
- **Ultrawide saturation:** the OnePlus 11's ultrawide preview (camera 3) was 0.71-0.85 of the raw's chroma against the main camera's 0.87-1.13. A new model layer (`oem/oneplus/Cph2447.kt`) gives it x1.25 chroma at equal luminance (`CameraSaturation`, the camera id now in `PreviewColorInput.cameraId`): 0.71 → 0.96-0.97 on the same ISO 6400 scene, level with the main camera. Both previews still lose 10-15% chroma at ISO 6400 (the ISP's), which a fixed matrix can't follow.
- Pixel and Samsung: unchanged (`BOOSTED`, `liftsShadows` true, no linear toe; pinned by tests). Viewfinder/JPEG pairs on the OnePlus 11 across all scenes: within 0.2 EV and 8% R/G, B/G once calibrated.

**RawBoy Camera (Android): the OnePlus 11's viewfinder matches its photos; lenses labelled right (2026-11-16)**

- **Preview curve:** the OnePlus 11's camera applies the TONEMAP_CURVE points as if they were evenly spaced over its linear input, whatever their x (a curve of x⁴ gave the 4th power; the sRGB curve with its points packed near black, as sent to every phone, gave sRGB(x²)). The viewfinder, which undoes a plain sRGB curve, was therefore about twice as contrasty as the raw (log-log slope 1.8-2.0) and twice as saturated, and the learned viewfinder brightness jumped between shots. A new OnePlus layer sends the sRGB curve at 64 evenly spaced points (`PreviewProfile.curveAtEvenPoints`, `capture/PreviewCurve.kt`). On the OnePlus 11 the viewfinder's linear copy now follows the raw within 3% from 4 stops under the median to 2 stops over it (slope 0.99; above that the 8-bit preview clips first); the learned brightness gives the same estimate shot after shot (±1%), and once learned the viewfinder screenshot is within 0.1 EV of the JPEG, R/G and B/G within 8% (main, ultrawide and selfie cameras, room light). Before: 0.3 EV, and the main camera's viewfinder half as blue as the photo. Other phones keep the curve they had: only one Snapdragon phone was measured, and a camera that honours the points' x would render the evenly spaced curve's toe darker.
- **Lenses:** the main lens (W) is the logical back camera if there is exactly one, else the only camera that opens on its own, else the lens nearest 26 mm (`capture/LensChoice.kt`); before, it was the widest camera without a physical id, so on the OnePlus 11 the 14 mm ultrawide was "W" and the main camera "T". The OnePlus layer lists stand-alone cameras rather than the logical camera covering the same lens (`LensProfile.standaloneOverLogical`): RAW through logical camera 0 froze the preview, its stand-alone main camera (2) streams, merges and saves. The OnePlus 11 now offers UW (14 mm) and W (23 mm) at the back; its telephoto is a system-only camera. Phones with one logical camera per side (the Pixels) list their lenses as before (a test checks the old and new rules on generated layouts). Learned calibration of phones whose labels change settles again over a few shots.
- Settings and the device report show the OnePlus layer (*Phone profile: OnePlus*) and the `lenses` line of the profile.

**RawBoy Camera (Android): video records on phones the standard path fails on (2026-11-16)**

- On the OnePlus 11 (Snapdragon 8 Gen 2) video never recorded: the timer ran, and at the end *Nothing was recorded*. The driver refused the encoder's recordable surface in the viewfinder's context, and Qualcomm's encoder refused the 8-bit RGBX buffers of the fallback (`unsupported color format`). The camera now finds a working way by trying (`capture/VideoProbe.kt`): the standard path first (unchanged, the Pixel 9 Pro's), then the encoder's surface in a GL context of its own sharing the viewfinder's textures (`EncoderConfig.RECORDABLE_OWN_CONTEXT`: the frame is drawn into a texture and copied over), then the viewfinder on a recordable RGBA config (needs the view made again: the viewfinder restarts once and asks to press record again), then the software H.264 encoder. A way works when the encoder hands out its first frame; a failure (refused EGL surface, encoder error, no frame out within 3 s) takes that try down and starts the next at once. The working way is remembered per system and app build. The way a phone records with gives way only after failing in two recordings in a row (the first time, another way is used for that recording only), and another way than the standard one is remembered only after the standard one failed outright, so a one-off bad start never moves a phone off its way.
- Honest errors on every phone: when no way works the message comes at once, naming the failures; an encoder or encoder surface that breaks during a recording stops it, keeps the file and says so at once. The device report gained a *Video probe* section (the way in use, the last probe's tries).
- OnePlus 11: the standard path fails within ~0.2 s and the own-context way records (HEVC 1080p30 and AAC: portrait and landscape, look and flat, with and without sound, stabilization on, hardware H.264 forced in debug); the first two recordings after an install or update start ~0.5 s later, then the own-context way goes first. Debug builds read `video-debug.txt` (forced variants, hardware H.264, landscape file, injected encoder failures) to try every path on one phone.

**RawBoy Camera (Android): device report (2026-11-16)**

- Settings › **Share device report** (under the phone profile) writes a plain text report about the phone and opens the system share sheet with it (`camera/report/`: `DeviceReportCollector` gathers, `DeviceReport.render` writes; shared through the app's FileProvider, `cache/reports`). It is what a profile for a new phone is made from, which so far took adb: the phone and profile as detected, every camera and physical lens with its Camera2 characteristics, the lenses the camera lists and why it skips the others (`CameraController.lenses(onSkip)`), the GPU and the extensions the camera relies on, EGL window configs with their recordable counts, the H.264 / HEVC encoders and their input colour formats, and the learned calibration of every slot.
- Fixed order, one `key: value` per line, `-` for what the phone doesn't report, numbers in the same notation in any locale: two phones' reports diff line by line. No serial numbers, accounts, locations, file names or photos; nothing is sent by the app, and no permission was added.

**RawBoy Camera (Android): phone profile detected at start (2026-11-16)**

- The camera now tells phones apart: at start it reads the chip maker (`Build.SOC_MANUFACTURER`; `Build.HARDWARE` on Android 10-11), manufacturer and model (`platform/PlatformDetector.kt`) and builds the profile from the neutral one plus the layers that match (`PlatformRegistry`): Google Tensor, then Samsung. Before, every phone ran with the Pixel 9 Pro's numbers.
- **What changes:** Tensor Pixels keep every value (pinned by tests). Samsung phones keep theirs on any chip: their layer carries the Pixel's extra black and preview colour path besides the +25 look. Every other phone, older Snapdragon Pixels included, gets the neutral profile: the viewfinder takes the preview as plain sRGB instead of undoing the colour matrix the camera reports, and shots and the raw meter are decoded without the 1.46e-3 extra black. Their learned viewfinder calibration was learned under the old profile and settles again over a few shots per lens.
- **Diagnostics:** one logcat line at start (tag `RawBoyPlatform`: the Build strings read, the chip recognised, the layers and every value); Settings ends with *Phone profile: …* and the chip and model detected. Debug builds can take the phone for another chip (Settings › *Take the phone for*, from the next start); calibration learned under a profile that differs from the automatic one is stored apart (`previewScales3@<layers>`, `flashGuides@<layers>`).

**RawBoy Desktop: Browse selects on right-click, folders can be renamed (2026-11-18)**

- **Right-clicking an unselected photo or folder selects it first** (grid and list; Control-click too); right-clicking a selected one keeps the whole selection. **Folders get Rename…** in their right-click menu (favourites and Recent follow the new name; not undoable with ⌘Z). Comes with RawBoy Viewer v0.2.9 (PR 60); the pin moves from 0.2.8 to 0.2.9. Not tried by hand (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Pro opens a photo as Auto developed it (2026-11-17)**

- A photo that is in Auto's batch and has no saved Pro edits (`rawboy:Develop`) now opens in Pro with its Auto develop (look or preset, adjustments) as the starting edits, from Browse's E, the filmstrip's arrows or the Open panel as well as from Edit in Pro. So the pipeline Browse → Auto → presets → Pro (heal strokes, blemishes) no longer restarts from the bare as-shot develop, and the strokes Pro saves are kept in the photo's sidecar. Once Pro has saved edits, its sidecar wins. Not compiled here (no Swift toolchain in the cloud session): CI's `desktop` job builds it.
- **Replacing Pro's edits asks first.** In Auto (Desktop and iOS), applying a preset to the batch or a selection, Apply to All, or Copy previous onto photos that carry RawBoy edits (Pro's heal strokes, masks, crop...) shows "Replace the RawBoy edits of N photos?" (Replace / Cancel) instead of silently dropping them; each photo keeps its undo step. Not compiled here either.

**RawBoy Desktop: Browse has a scroll bar (2026-11-17)**

- **The grid and the list show a draggable scroll bar when the photos don't fit** (Viewer 0.2.8): a thin line at the right edge with a pill to drag; a click on the line beside the pill scrolls a page. The system's overlay bar was switched off there, so with a mouse there was nothing to grab.

**RawBoy Desktop: one RawBoy Auto entry in Browse's photo menus (2026-11-17)**

- **"Send to ▸" no longer repeats RawBoy Auto.** In the viewer's, the grid's and the list's right-click menus RawBoy Auto was at the top and again inside "Send to ▸". Now the RawBoy entries stay on top and "Send to ▸" (other apps) sits right under them; the viewer's menu gets the same submenu instead of loose "Send to <app>" items. Folder menus keep RawBoy Auto inside "Send to ▸". Comes with RawBoy Viewer v0.2.7 (PR 58); the pin moves from 0.2.6 to 0.2.7. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

  **RawBoy Desktop: Auto's grid keeps its place after a photo (2026-11-17)**

- **Leaving a photo scrolls the grid to it.** Back or Esc from Auto's photo view used to bring the grid back from the top; it now opens scrolled so the photo just viewed is on screen at its place (and has the keyboard focus). Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: mouse-only Browse (2026-11-17)**

- **Double-click in the viewer goes back to the browser** instead of zooming (zoom stays on the wheel, press-and-hold and pinch; Compare and the crop tool keep the double-click zoom).
- **Right-click sends any photo to Pro or Auto.** The viewer has a right-click menu now (Send to RawBoy Pro, Send to RawBoy Auto as Looks, Film or As is, other apps, Rotate, Export…, Show in Finder, Back to Browser, Move to Trash…), and the grid's and the list's photo menus list Send to RawBoy Pro and Send to RawBoy Auto at the top (the list had no send items). Raw, JPEG, HEIC, PNG and TIFF all go; with several photos selected Pro opens the first. Comes with RawBoy Viewer v0.2.6 (PR 57); the pin moves from 0.2.5 to 0.2.6. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: ⌘C copies the picture in Browse's viewer (2026-11-17)**

- **⌘C in the viewer copies the picture on screen** to the clipboard as an image (orientation applied, real preview if it is on), to paste into a document, chat or editor; ⌥⌘C still copies the file. Comes with RawBoy Viewer v0.2.5 (PR 55); the pin in `ios/project.yml` moves from 0.2.4 to 0.2.5. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: lens presets in Auto, for the batch, a selection or one photo (2026-11-17)**

- **Lens presets saved in Pro now reach Auto.** Desktop's Auto kept its own list (filled only by the iPhone's Send to Auto link or a sidecar), so a lens preset saved in Pro's Lens tab never showed up and Auto had no lens preset picker. Auto now lists the lens presets in Pro's presets file, as the web's Auto lists the RawBoy tab's: saving, renaming or deleting one in Pro reaches Auto at once, and one Auto keeps from a sidecar or removes is so in Pro too (`LensPresetStore` on macOS, `PresetStore.changed`). Lens presets in the old `lens-presets.json` move over once. **Send to Auto** in Pro's Lens tab and Presets switches to Auto and applies the preset there (a lens preset: matched by lens, with the count).
- **Pick one per batch, selection or photo**, as on the web: the sidebar's **Lens preset** menu (By lens, None, a preset; for every photo and photos added later; **Manage…** removes one), a **Lens preset** menu in the selection's toolbar, and a **Lens preset** section in the photo panel (with By lens it names the preset the photo got). Kept in each photo's `rawboy:Auto` sidecar as before. `LensPresetMenu` (GridScreen.swift), `DetailScreen.macPanel`.
- **Apply to all and Copy previous carry the lens preset choice** (all platforms: web, Android, iOS and Desktop): the same pick, or By lens worked out for each photo's own lens. Before, they kept each photo's own.
- Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: room under the mode switch in Browse (2026-11-17)**

- **The Pro / Auto / Browse switch no longer crowds Browse's toolbar.** The grid's toolbar (icons, search, sort) started right under the switch; Browse now leaves 14 pt more above it (`ViewerOptions.toolbarTopInset`, set in `DesktopModel.browse`; the standalone Viewer keeps its layout). Needs a RawBoy Viewer tag that has the option and the pin in `ios/project.yml` moved to it. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**All apps with the shared decoder: exports keep the ISO and the rest of the camera's EXIF (2026-11-17)**

- **Pixel DNGs exported with no ISO, and raws with no exposure compensation.** Desktop (and web) JPEG and TIFF exports take their EXIF from the decoder, and LibRaw doesn't read the Exif tags Android's DngCreator keeps in IFD0 (ISO, shutter, aperture, focal length, date) nor Fujifilm's exposure compensation (a RAF's EXIF is in its embedded JPEG). After decoding, the missing fields are now filled from the file's own EXIF: IFD0 and the Exif IFD of TIFF-based files (also ISOSpeed when ISOSpeedRatings is absent, and the lens and GPS tags), or the embedded JPEG of a RAF. Values LibRaw or the DNG SDK already read are never replaced. Checked on the project's files: a Pixel 9 Pro DNG now reports ISO 22 (was 0), GFX 50R RAFs their exposure compensation (was missing); Sony, Fujifilm DNG unchanged. Orientation stays 1 and no thumbnail or source dimensions are copied, so nothing stale is written. `exif_reader.cpp` `fillMissingMetadata`, called from `decode.cpp`. Host-checked the reader on Linux; the apps were not built when written: CI's `desktop` job is the first Swift build.

**RawBoy Desktop: Auto keeps the selection after a preset (2026-11-17)**

- **Preset on a selection keeps it selected.** Preset (and Lens) in the selection bar no longer clears the selection, so the same photos can be rotated, given a lens preset or exported next. Esc or Cancel clears it. Export still clears it so the badges show each photo's progress. Shared Swift code, so the iPhone's Auto does the same; web and Android still clear it.
- **Esc starts a fresh selection.** Esc (or Cancel) now also forgets where the last ⇧-click range started, and a ⇧-click with nothing selected selects only that photo and makes it the start, so a new batch is ⇧-click on the first photo, ⇧-click on the last. Before, the first ⇧-click selected everything from the previously clicked (or focused) photo. `AutoViewModel.clearSelection`, `selectRange`. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: batch export from Pro (2026-11-17)**

- **Export several photos from Pro.** ⌘-click or ⇧-click photos in the filmstrip (⌘A, or Photo › Select All in Filmstrip, for the whole folder; a check marks each), then ⌘E: the sheet becomes "Export N Photos" with the usual options, and each photo is exported in turn with its own saved edits (the sidecar's `rawboy:Develop`, as Pro would open it; the open photo as it is on screen). A bar over the filmstrip shows the photo being written, the progress, the time left and Stop; a failure skips to the next. The editor stays usable while it runs. Quitting mid-batch asks first. Desktop only. `Desktop/ProBatchExport.swift`, `Desktop/FilmstripSelection.swift` (`FilmstripSelectionTests`). Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Send to Auto › As is brings only the sidecar (2026-11-17)**

- **As is from Browse adds nothing.** Photos sent to Auto as As is used to come in without the crop or turn made in Browse (Auto read only `rawboy:Auto`) and, for raws, with the measured denoise added. Now each photo comes with its sidecar and nothing else: its own Auto settings if it was in Auto before; otherwise its RawBoy edits (`rawboy:Develop`: the Viewer's crop and turn, Pro's edits, decoded against the as-shot defaults once the photo is analysed, as Pro reads them) develop it in place of a look ("RawBoy edits"); otherwise it stays the file as it is. No measured denoise, batch preset or lens preset is added. Looks and Film, and As is from Auto's own sidebar, are unchanged. `AutoViewModel.add(sidecarOnly:)`, `AutoPersistence.sidecarEdits`, `SidecarEdits.develop` (Pro's sidecar read, now shared). Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Pro's crop starts on the photo's own shape (2026-11-17)**

- **Crop & rotate in Pro opens on Original**: the frame is locked to the photo's own proportions and orientation (a portrait photo crops portrait), so dragging a corner keeps its shape, as Auto's crop already did. A photo that already has a crop opens on Free, so the tool never reshapes an earlier crop; Reset crop goes back to Original. Pick Free (or any other shape) to unlock it. Shared Swift code, so iOS Pro gets it too; web and Android Pro still start on Free. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Interface size for the whole app (2026-11-17)**

- **Settings › Interface size now sizes every mode**, not only Browse: Pro's bar, side panel and filmstrip, Auto's grid and sidebar, its photo view's bar and panel, and the Packer window are drawn at the chosen 85, 100, 115, 130 or 150 %, and follow a change at once. The side panels widen with it (still at most 45% of the window); the photo itself is never scaled, so it stays sharp. The window's own toolbar and the sheets keep the system size. `view/InterfaceScale.swift` (`interfaceScaled()`, the Viewer's method: laid out smaller, then scaled), `DesktopModel.interfaceScale` reads the Viewer's `app.uiScale` under `desktop.browse.`. Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop and web Pro: rotate the crop with the mouse (2026-11-17)**

- **Drag outside the crop frame to straighten**, as in the web's Auto: in Crop & rotate (Pro and Auto), press outside the frame and circle its centre; the picture turns with the pointer (clockwise drag = clockwise turn, -45° to 45°, 0.01° steps), the Straighten slider follows, and the drag undoes like a slider drag. On the Mac the pointer is an open hand outside the frame and resize arrows on its edges and corners. Shared Swift code (`CropOverlay.rotate`), so the iPhone apps get the drag too. **Web Pro** gets the same drag: its Crop & rotate passes `rotate` to `CropOverlay`, which until now only Auto did. Not compiled when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Auto catches up with the web (2026-11-17)**

- **Export file names.** The export sheet has the web's **File name** template, remembered: `{name}`, `{camera}`, `{lens}`, `{iso}`, `{look}`, `{date}`, `{time}`, `{year}` `{yy}` `{month}` `{day}` `{hour}` `{minute}` `{second}` and `#` counters (`##` = 01), with a preview of the first and last names and the keywords as buttons. Default `{name}-auto`, as before. A name already taken in the folder gets `-001`, `-002`: Auto no longer replaces an earlier export. `NameTemplate.swift` is a port of `NameTemplate.ts`, with its tests (`NameTemplateTests`).
- **Retouch** in the photo view's panel (its own section): the web's natural portrait retouch (40 is about Reblum Natural 40), on top of the look, preset or Pro edits. It is `Adjustments.retouch` (sidecar `retouch`, which Desktop used to keep without a slider), copied by Apply to All and Copy previous, cleared by Reset all photos; exports with it go through the session, as the photo view makes the map.
- **Keys as on the web.** In a photo: Space next and ⌫ previous (as → and ←), ⌦ (fn-Delete) takes the photo out of the batch and opens the next, C opens Crop & rotate (C, Return or Esc put it down). Mode menu: Crop & Rotate Photo, Remove Photo from Batch.
- **ISO** beside each photo's name in the grid and in the photo view's bottom-left corner (iPhone too).
- **Time left on Export all**: "1:05 elapsed · about 2:30 left" under the progress bar, the web's estimate (`BatchTime.swift`; iPhone too).
- **Quicker paging.** Once a photo is open, the next one is decoded ahead at full resolution (`PhotoSession.prepare` / `adopt`) and the cached previews of the next three and previous two are read ahead with their LUT or film stock, as the web does. Only where Auto analyses in more than one lane (Macs); iPhones decode the photo shown, as before.
- Not compiled or tried when written (no Mac): CI's `desktop` job is the first build.

**RawBoy Desktop: Packer sorts and folds folders (2026-11-17)**

- **Sort: Shoot date / File name** over the Packer's list orders each folder's files (remembered, `packer.sort`); a run packs them in that order. Folders stay in the order they were added, as on the web.
- **Folder headers fold.** Click a folder's header to collapse it to one line, which shows its progress while folded ("2 packing… · 1 done", "1 failed", "all done", "3 of 5 done"); **Collapse all / Expand all** do every folder; ✕ on a header removes that folder from the list. Files added by themselves sit under "Other files". `PackerInfo.groupByFolder` / `folderStatus` are ports of the web's `groupByFolder` / `folderStatusSummary` with their test cases (`PackSettingsTests`). Not compiled when written (no Mac): CI is the first build.

**RawBoy Desktop, iOS and Android: Denoise & sharpening preset group (2026-11-17)**

- **Save preset has a Denoise & sharpening group**, as on the web: Denoise, Color denoise and Sharpening moved out of Detail into it, off by default. Detail now holds local contrast, grain, bloom and flare only.
- **RawBoy Auto keeps each photo's measured noise** unless a preset holds that group; with it, the preset's denoise and sharpening apply as saved (the Denoise adjustment still works on top). **Auto denoise all** takes the group off the presets (the batch preset's too, when no photos are selected), as on the web.
- Presets saved before the split: Detail-only ones keep their denoise (they get the new group), ones with Light leave it to Auto, the same rule as `Presets.ts`. A Light + Detail preset applied in Pro no longer sets denoise; re-save it with the group ticked.
- Code: `PresetGroup.DENOISE` / `.denoise`, `Presets.withoutDenoise` (Kotlin and Swift), `LookApplier.applyPreset` no longer forces the auto values. Tests: `PresetsTest`, `LookApplierTest`, `PresetDenoiseGroupTests` (web's cases). Not compiled or run here (no Android SDK or Swift toolchain): CI compiles the Kotlin (unit tests compiled, not run) and the Desktop job builds and runs the Swift tests.

**RawBoy Desktop: your own LUTs are reachable (2026-11-17)**

- **Your LUTs on the Mac.** Pro's LUT section now shows where your LUTs live (`~/Library/Application Support/RawBoy Desktop/LUTs` until you choose another) with **Add files…** (copies `.cube` / HaldCLUT `.png` files in), **Show in Finder** (also on each of your LUTs' right-click menu) and **Choose folder…** (read them from a folder of your own, remembered; **Use RawBoy's folder** goes back). Drop LUT files on the section or on the window to add them, as on the web: on the window a `.png` counts as a LUT only when it is HaldCLUT-shaped, otherwise it opens as a photo. The note no longer says "Files app" on the Mac (the iPhone keeps it). `LutRepository.setUserFolder` / `importFiles` / `isSurelyLut`, tests in `LutFolderTests`. Not compiled when written (no Mac): CI is the first build.

**RawBoy Desktop: Browse reopens the last folder (2026-11-17)**

- **Back in the last folder.** A plain launch now opens Browse in the folder you left it in (Browse's Settings › "Open the last folder at launch", on by default). Opening a photo or folder from Finder, `--open`, `--browse` or `--auto` takes precedence. Not compiled when written (no Mac): CI is the first build.

**RawBoy Desktop: Pro copies the previous photo's settings on demand (2026-11-17)**

- **Opening a photo no longer carries the last photo's edits over** (Mac only; the iPhone, Android and web still do). A photo starts from its own sidecar, or as shot. **Copy** in the bar, ⇧C, or Photo › Copy Previous Photo's Settings gives it the settings of the photo you had open before (white balance only if you had changed it; crop, rotation, masks, leaks, effects and healing stay its own), as one undo step. Not compiled when written (no Mac): CI is the first build.

**RawBoy Desktop: starts in Browse (2026-11-17)**

- **Pro's Curve section starts closed** (until you open it once; your own open and closed choices are kept).
- **Browse is the first screen.** RawBoy Desktop opens in Browse (⌘3) on every launch, whichever mode it was in when it quit (the last mode is no longer remembered). A photo opened from Finder or with `--open` still goes straight to Pro, `--auto` to Auto. Not compiled when written (no Mac): CI is the first build.

**RawBoy Desktop: Browse takes the Viewer 0.2.3 (2026-11-17)**

- **Pin folders to Recent.** Right-click a folder in Places, Favourites, Recent or the grid › Pin to Recent. Pinned folders stay at the top of Recent (pin icon) however many other folders you open; Unpin from Recent puts it back. Kept under `desktop.browse.browser.pinnedRecentFolders`.
- Pin: `from: 0.2.3` (`ios/project.yml`, `ios/viewer-source.sh`).

**RawBoy Desktop: the wheel steps film stocks (2026-11-16)**

- **Wheel over Stock or the tone mapper** (Pro, Film on) moves to the next or previous stock, one per mouse click, as on the web; a trackpad swipe steps at its start and then every 40 points, so it passes a few stocks, not dozens. The panel doesn't scroll under the pointer there, but a wheel that was just scrolling the panel keeps scrolling it. `WheelStepper` (engine, tested in `WheelStepperTests`) is the Swift port of web's `stepWheel`. Not compiled or tried by hand when written (no Mac): CI is the first build.

**RawBoy Desktop: Pro's before/after slider (2026-11-16)**

- **Y, or View › Before/After Slider.** A divider over the photo: the as-shot render (with the edit's rotation, flips and crop, as Compare) on its left, the edit on its right, labelled. Drag it anywhere; it stays between 2% and 98% and keeps its place from photo to photo. The as-shot half is developed once and only drawn clipped while you drag or move sliders. On the whole-photo view only (zoomed in or inside a tool it steps aside); press-and-hold and `\` Compare still show the whole photo as shot.

**RawBoy Desktop and iOS: Luma contrast in Pro and Auto (2026-11-16)**

- **Luma contrast** (-100..+100) under Contrast in Pro's Light section and (-50..+50) under Contrast in Auto's Light section, as on the web: the same log slope on luminance only, so colour saturation holds. It is a `DevelopParams.lumaContrast` field (Light preset group, so presets, Edits JSON and Send to Auto carry it) and an `Adjustments.lumaContrast` in Auto (kept in the `rawboy:Auto` sidecar, copied by Apply to all and Copy previous, cleared by Reset all photos). The shader already had `uLumaContrast`; `ShaderParams.lumaContrast` = 2^(0.7 x value / 100) - 1 as on the web. Edits and sidecars the web wrote with it read as a slider now, not a kept extra.
- Tests: `LumaContrastTests`, `EditsTests`, `AutoSidecarTests`. Not built here (no Swift toolchain); CI's `desktop` job compiles and runs them. Android still has no slider.

**RawBoy Desktop: asks before quitting mid-work (2026-11-16)**

- **Quit (⌘Q) or closing the window** asks "Quit RawBoy Desktop?" when something would be cut short: Pro's export or Auto Dev running, Auto's batch export or photos still being analysed, the Packer converting, or edits whose sidecar could not be written. Cancel is the default; Quit Anyway leaves. Edits themselves never prompt: they are already in the sidecar (the web asks about unexported edits only because it has no sidecar). Browse has no long work of its own, so it is not asked.

**RawBoy Desktop: Settings… for Browse (2026-11-16)**

- **Settings… (⌘,)** in the app menu opens the bundled Viewer's Settings window (`ViewerSettingsRoot`), which until now Desktop never showed. It holds Browse's choices (kept under `desktop.browse.`, not the standalone Viewer's); Pro and Auto have none of their own there.

**RawBoy Desktop: Browse takes the Viewer 0.2.2 (2026-11-16)**

- **Top bar zoom.** Double-clicking Browse's toolbar (or the strip above Places) expands the window to fit the screen and again puts it back, like the title bar's Zoom (it follows the system's double-click setting).
- **Copy Folder Name / Copy Folder Path** in the right-click menu of a folder in Places, Favourites, Recent and the grid.
- **Finder opens.** Desktop no longer claims photo types from the OS (document types are rank Alternate: listed under Open With and selectable, never the default on its own) and lists every type Browse shows (WebP, AVIF, JPEG XL, kdc, x3f too). Open With, a Dock drop or `open -a` on a photo or folder always opens it in Browse, whichever mode was showing; edit from there with E or Send to Auto.
- Pin: `from: 0.2.2` (`ios/project.yml`, `ios/viewer-source.sh`). Needs the Viewer's v0.2.2 tag to exist before CI can resolve it.

**RawBoy Desktop: the Viewer's libraries by path or by tag (2026-11-16)**

- **Switch.** `ios/viewer-source.sh local|git` sets where `ios/project.yml` takes RawBoy Viewer's libraries from: its git tag (`from: 0.2.1`, the first with the root `Package.swift` SwiftPM needs; the committed default, used by CI and releases, which cache the resolved package) or a sibling checkout for development.

**RawBoy Desktop: Browse's full-screen viewer (2026-11-16)**

- **Full-Screen Viewer in Browse.** A Mode menu setting (remembered) opens the Viewer's screen-filling window, with its edge panels, press-and-hold peek and the menu bar and Dock hidden, instead of the in-window viewer; ⌥⌘↩ opens the selection the other way once. E hands the photo to Pro and closes the window; leaving Browse closes it. Compare follows the same choice. It opens on the display Desktop's window is on, follows a display being unplugged, and gives the menu bar and Dock back when it closes, when the app resigns active and on quit.

**RawBoy Desktop: Browse's real preview is the engine's develop (2026-11-16)**

- **R and Compare in Browse.** Real previews now show RawBoy's own as-shot develop, the picture Pro opens (`Desktop/EngineRealPreview.swift`, through `Exporter.renderCGImage`), instead of Core Image's. It is pixel-identical to a Pro export at that size, one raw at a time, falling back to Core Image for what the engine can't open. Slower than Core Image on ARW/RAF (0.5–0.8 s for 24–33 MP, 2.3 s for 102 MP at screen size), faster on a Sony DNG; the standalone Viewer keeps Core Image.

**RawBoy Desktop: Browse mode, and the Viewer's libraries replace Desktop's own copies (2026-11-16)**

- **Browse (⌘3).** A third mode next to Pro and Auto: RawBoy Viewer's grid, sidebar, viewer and culling (`ViewerUI`) inside the window, with the Browse menu (rename, export, copy and move, compare, slideshow, Send to RawBoy Auto, Move to Trash). Its settings are kept apart (`desktop.browse.`); the menu bar and Dock are not hidden.
- **Hand-offs in-process.** E in the viewer opens the photo in Pro, also while Auto is showing (its batch stays); Send to RawBoy Auto adds photos and folders to Auto as Looks, Film or As is. No Open With or `rawboy-desktop://` round trip.
- **One XmpSidecar, PhotoOrder and filmstrip scan.** Desktop and the engine use `RawBoyBrowseKit`'s `XmpSidecar`, `PhotoSidecar`, `ExifOrientation` and `PhotoOrder`, and Pro's filmstrip uses the Kit's folder scan, RAW + JPEG grouping and `ThumbnailStore` (thumbnails now cached on disk). The engine's `XmpSidecar.swift`, `PhotoOrder` and `Desktop/Filmstrip.swift` are gone; the shared XMP fixtures stay checked on both sides. The iOS targets use the same Kit (it declares iOS 17), but could not be built here (no iOS slice of the native frameworks).

**RawBoy Web: Copy previous edits in Pro (2026-11-16)**

- **Copy previous edits.** Pro's desktop toolbar has a **Copy previous edits** button (and `Shift+C` everywhere) to copy the previously open photo's edits onto the current photo as one undo step: white balance is copied only if changed on the previous photo, while the current photo's crop, rotation, flips, perspective, masks, light leaks, effects and healing spots stay.

**RawBoy Desktop and Web: ISO filter fix and focal length filter (2026-11-16)**

- **ISO filter (Desktop).** Auto's Min ISO and Max ISO menus now show the batch's ISOs with their counts: switched the range pickers to string tags (`GridScreen.rangeMenu`), matching the Camera, Lens and Date menus so macOS `Picker` populates them once analysis finishes.
- **Focal length filter (Desktop and Web).** Added Min mm and Max mm range filters to Auto's grid filter (`AutoFilter`, `Analysis.focalLength` from `metadata.focalLength`), with counts per rounded focal length. Bumped `AnalysisCache` versions (`2` on Desktop, `5` on Web) so cached analyses record focal lengths.

**RawBoy Desktop: Look selector drag fix (2026-11-16)**

- **Look selector.** Dragging the window (or its corner) no longer makes it jump back and forth: the drag is measured in the photo's space, not the window's own, which moved with it.

**RawBoy Desktop and Web: Auto's mouse, presets, edits from Pro, As is and filters; presets without a photo (2026-11-16)**

- **Wheel in Auto (Desktop).** The mouse wheel over a slider in Auto's photo view moves it (Shift big steps, ⌘ fine), as Pro's and the web's sliders do; over the photo it zooms around the pointer, and the middle button pans. `PointerSurface` and `SliderWheel` moved from Pro into the engine (`view/MacPointer.swift`) so both modes share them.
- **⇧C in Auto (Desktop).** Copy previous, as on the web (also on the bar's Copy button's tooltip).
- **Auto's Preset (Desktop).** Lists the presets saved in Pro, in their Colour and Black & white sections, for the batch or the selected photos, instead of opening a file dialog. Preset files are imported in Pro's Presets.
- **Edit in Pro and back (Desktop).** Edit in Pro opens the photo with its Auto develop (look or preset and Auto's sliders) as the starting edits, and To Auto in Pro brings it back with Pro's edits: they develop it in Auto in place of its look, Auto's sliders adjust on top, and Use a look drops them, as on the web. They're kept in the photo's `rawboy:Auto` sidecar (the web's `edits`), copied by neither Apply to all nor Copy previous, and Export all renders them through the session, so masks, lens blur and healing strokes come out. Before, Edit in Pro opened the photo with its own Pro sidecar and To Auto gave it the look again.
- **As is (Desktop).** Auto's New photos gains As is, as on the web: no auto develop, no suggested look (Natural, labelled "As is") and no skin detection; a preset, look or slider is all a photo gets. Raws matched to a lens preset by lens still get it; JPEG, HEIC, PNG and TIFF aren't matched (a preset picked by hand still applies) and get no non-RAW note. Auto denoise all gives As is photos the denoise measured on them (`Analysis.measured`, `asIs()`). Kept in the sidecar's `plain` / `autoDenoise`, which the web reads.
- **As is denoises raws (Desktop and Web).** Raws added As is start with their measured denoise (Auto denoise), as described for As is; finished files still get nothing. Undo or Denoise −100 takes it off. Auto denoise no longer makes a photo count as edited for the Unedited filter.
- **Filter (Desktop).** Auto's sidebar has the web's Filter: camera (from the file's EXIF), lens, Min and Max ISO, shoot day, each with its count, and Unedited (photos still As is). The grid, ← → in the photo view, ⌘A and Export all follow the photos shown; the summary reads "5 of 24 shown"; Clear filter shows all again.
- **From RawBoy Viewer as Looks, Film or As is (Desktop).** RawBoy Viewer's Send to RawBoy Auto asks how the photos join the batch; RawBoy Desktop takes them through a `rawboy-desktop://auto?as=looks|film|plain&path=…` link (it starts the app if needed), or `--auto … --import-as film` on the command line, overriding the sidebar's New photos for those photos.
- **Look selector (Desktop).** Pro's bar has the web's Looks: click it, then the photo, and a window over that spot shows it through every LUT and film stock as labelled stripes; click one to use it. Drag the window and the stripes follow; drag its corner to resize it (remembered); ← → turn the page, Esc closes. `Pro/ui/LookSelector.swift`, a port of `LookSelector.tsx`: each look of the page is developed over the whole preview (`ThumbnailRenderer`) with the photo's own parameters, LUT or stock swapped.
- **Presets without a photo (Desktop and Web).** Pro's Presets button (and the Photo › Presets menu item) works with no photo open: import, export, rename and delete; applying and saving wait for a photo.

**RawBoy Desktop: small fixes from the UI review (2026-11-16)**

- **Camera name.** DNGs read by the Adobe DNG SDK (JPEG XL DNGs, packed DNGs) named the camera by the DNG's UniqueCameraModel, which Android writes as "Pixel 9 Pro-Google-google". They now use the EXIF Make and Model as LibRaw does ("Google Pixel 9 Pro"; the model alone when it already starts with the make). Shared C++, so Android and the web too.
- **Colour.** "Colour" in the Apple apps' labels: Pro's tab, Colour denoise, Grain's Colour, the look and preset groups, the export frame's and Camera's frame Colour.
- **Mac wording.** Auto's help on the Mac describes the grid, sidebar, bar, panel, clicks and keys instead of taps, swipes and long presses; the curve's note, the white balance picker and the sliders' VoiceOver hint say click and double-click.
- **Curve.** The channel picker (RGB, Red, Green, Blue) is the tone mapper's small size on the Mac, so it no longer runs wider than the panel's other rows.
- Sixth and last step of the desktop redesign.

**RawBoy Desktop: a filmstrip under Pro's photo (2026-11-16)**

- **Filmstrip.** The other photos in the open photo's folder sit in a strip under the photo, by file name; a RAW + JPEG pair shows once, as the raw (as in RawBoy Viewer). Click one to open it, or press ← / → for the previous and next photo (a slider focused with Full Keyboard Access keeps the arrows). The mouse wheel scrolls the strip sideways. The open photo has an amber outline and stays in view. Thumbnails are the files' own embedded previews (ImageIO), not developed; files only in iCloud show a cloud and aren't downloaded until opened. The folder is listed again when you come back to the app. Hidden with the panels (Tab, F), and absent when the folder has just the one photo.
- iPhone and iPad are unchanged. Fifth step of the desktop redesign.

**RawBoy Desktop: Auto's photo view in Pro's layout (2026-11-16)**

- **Bar.** Auto's photo view has Pro's one-row bar instead of the window toolbar: Grid (back), the photo's name and "Photo 3 of 12", Previous and Next; Crop and Preset in the middle; Edit in Pro, Copy (the previous photo's look and adjustments), Apply to All, Remove, Undo, Redo and Export (amber) on the right, each named on hover. Apply to all and Remove were in a "…" menu.
- **Panel.** The Look / Adjust tabs are sections that open and close, as Pro's: Look (Looks / Film, the look's name, Strength and every look as a thumbnail in rows that wrap, under its group's heading), Light (Brightness, Contrast), Colour (Pick white balance, Warmth, Tint, Saturation) and Detail (Grain, Denoise). One slider to a row everywhere (the Adjust tab had pairs). Sections with adjustments show the amber dot and their own reset. The looks scroll with the mouse wheel along with the panel; the horizontal strip only scrolled with Shift or a trackpad.
- **Photo.** One photo with a 12 pt margin round it, no pager: no scroll bar under the photo any more, and the photo no longer runs into the window's edges. The arrow keys and the bar's arrows move between photos.
- iPhone and iPad are unchanged (their pager no longer draws a scroll bar either). Fourth step of the desktop redesign; Pro's and Auto's bar buttons and sections are now one shared piece (`view/MacBar.swift`).

**RawBoy Desktop: Auto's grid and batch sidebar (2026-11-16)**

- **Grid.** Auto's grid on the Mac is even cells, as in RawBoy Viewer: each photo whole in a 3:2 tile (no cropping), the file name and the look under it instead of over the picture, a thin amber outline when selected. The justified rows gave every row its own height and covered the bottom of each photo with text. The arrow keys move by the new columns.
- **Sidebar.** The batch settings that ran along the top of the grid sit in a sidebar on the left: New photos (Looks / Film), Order (Shoot date / File name), Preset, Lens presets, Auto denoise all, and a line with the batch's count, how many are still to analyse and how many are saved.
- iPhone and iPad are unchanged. Third step of the desktop redesign.

**RawBoy Desktop: one-row bar, a sectioned slider panel, photo only (2026-11-16)**

- **Bar.** Pro's two rows are one: the photo's name and exposure line on the left, Crop, Masks, Light, Heal and Presets in the middle, Auto Dev, To Auto, Reset, Undo, Redo and Export (amber) on the right, each with its name and key on hover.
- **Inspector.** The Light / Color / Detail / LUTs / Lens tabs are one scrolling column of sections that open and close: Light, Curve, Colour, Primaries, Detail, Portrait, Effects, LUT, Lens. Related sliders are seen together, and a section with edits shows an amber dot and its own reset (the arrow beside it), so changes can be found with the sections closed. Which sections are open is remembered (Light, Curve, Colour and Detail at first). The histogram stays on top.
- **Photo only.** Tab or F (View › Photo Only) hides the bar and the panel; again, or Esc, brings them back. Tab is left to Full Keyboard Access when that is on.
- iPhone and iPad are unchanged. Second step of the desktop redesign; Auto in the same shell comes next.

**RawBoy Desktop: sliders show what you changed, less amber (2026-11-16)**

- **Sliders.** The Mac's sliders were the system slider, filled with amber from the left end: a slider at 0 on a −100…100 range was half amber, so untouched sliders looked edited and the one-sided ones (Denoise, Bloom) looked untouched when moved. They now draw a hairline track with a tick at the default and fill amber **only between the default and the value**; the thumb is grey at the default and white once moved, the value readout white. Still the system slider underneath (`MacSlider`: an NSSlider with its own cell), so clicks, thumb drags, the wheel, the keyboard and VoiceOver work as before; double-click resets. Rows are 30 pt (were 40), so more fits without scrolling. Pro and Auto both.
- **Less amber.** Segmented controls (tabs, tone mapper, curve channel, Looks/Film, Pro/Auto…) select in graphite instead of amber; Pro's bar icons are white, amber only for the open tool and Export; section headings are small caps in grey, as in RawBoy Viewer's details panel. iPhone and iPad are unchanged.
- First step of the desktop redesign from the UI review (title-bar toolbar and a sectioned inspector come next).
- Checked: built and run on the Mac (Debug), screenshots of Pro's Light tab at defaults and with Exposure moved, Auto's photo view. Not checked: the Colour tab's hue tracks (the screenshot run opened on the Light tab), dragging by hand.

**RawBoy Pro (all platforms): the open tab lasts for the session (2026-11-16)**

- A fresh start of RawBoy Pro (web page load, Android, iOS, Desktop) always opens the Light tab. The tab you pick is kept while the app runs (also when a panel closes or a photo loads), but no longer saved between starts; the saved value of older versions is dropped.

**RawBoy Desktop: a photo handed over at launch drew blank (2026-11-16)**

- **Bug:** a photo opened by RawBoy Viewer's E (or Finder's Open With, or `open -a`) in a **cold-started** RawBoy Desktop left the photo area blank (dark, nothing drawn) while the panel and histogram already had the photo; Auto and back to Pro, which makes the view again, fixed it. Cause: the photo's view is set while its window is still coming up, and a paused MTKView draws only when AppKit displays it; in that state it never did, and nothing asked again (its `drawableSizeWillChange` did nothing).
- **Fix:** the preview view redraws when its drawable size changes and when it joins a window, and after every update it checks that a frame was drawn within 60 ms and draws one directly if not (normally AppKit has: the check costs nothing). `DevelopRenderer.drawCount` counts frames.
- Checked in the running Mac app, Debug build, screenshots of the photo area: cold launch with the photo (before: blank; after: the photo), cold launch in the background (`open -g`), first photo into a running app (Pro, and from Auto mode), and a second photo over the first (a different portrait photo at its own aspect, no stale first photo, not stretched). Not checked: Finder's Open With and a Dock drop by hand (they arrive through the same `application(_:open:)` as `open -a`), and RawBoy Viewer's E itself (it uses `NSWorkspace.open(_:withApplicationAt:)`, the same route); no unit test (it needs a window and the GPU).

**RawBoy Desktop: version in Help (2026-11-16)**

- The Help sheet (the "?" button, ⌘/; Pro and Auto, and the iPhone apps' sheets, which share it) starts with **RawBoy Desktop <version> (<build>)**, selectable, and the Mac's Help menu has a disabled "About RawBoy Desktop <version> (<build>)" line at the top; the standard About panel stays in the app menu.
- **The DMG now says its real version.** `Desktop-Info.plist` had a literal 1.0 (1), so the release workflow's `MARKETING_VERSION` (the tag) and `CURRENT_PROJECT_VERSION` (the run number) never reached the app; the plist now follows them (checked: a build with 9.8.7 / 654 shows 9.8.7 (654)).
- Fixed on the way: the Help sheet on the Mac had no size and collapsed to its title and Done; it is now 560 × 680.
- Checked by hand in the running app: the Help menu's items and the Help sheet with the version on its first line. Not checked: the iPhone sheets (compiled only), and a real release DMG.

**RawBoy Desktop (macOS): Auto look names, Reset all photos, Pro panel width, Pixel DNG check (2026-11-15)**

- **Look and film stock names.** In Auto's photo view nothing said which look or stock was selected: the names under the strip's chips were hidden under a Mac scroll bar. The name is now in bold above the strip ("Yellow Portrait 400 · suggested"), the strip's scroll bar is off, and the grid cells use caption type on the Mac, with the whole text on hover. VoiceOver reads "Look: …" / "Film stock: …".
- **Reset all photos…** (Auto toolbar next to Clear batch, Mode menu): every photo back to a look, a film stock or As is; clears Strength, adjustments (incl. rotation and crop) and presets; asks first with the count; one undo step per photo; sidecars written (`AutoReset`, `AutoViewModel.resetAll`, tests).
- **Pro panel stretching.** The Light tab's tone-mapper row (label + the Mac's segmented control, which can't shrink below its natural width) was wider than the 360 pt panel, so the whole panel's content (every slider track, the curve box, the tabs) was laid out at 408-457 pt, centred in the panel: shifted left and running off the right edge. The row now stacks its label above the control when it doesn't fit (small control size), the panel's scroll bars no longer take layout width, and the panel clips what is left over. Measured on every tab and tool panel: content now 328 pt (panel 360) in all of them. Debug builds have `SliderWidthLog` / `RAWBOY_PROBE_SLIDERS`.
- **Pixel DNG Auto vs web.** Checked on 9 Pixel DNGs: without a face mask Desktop's decode, scene stats and auto develop equal the web's (`AutoParityTests`). With a face the Mac's Vision mask (it finds faces in dark scenes that MediaPipe doesn't) steered the exposure of camera-metered raws by +0.75 to +1.45 EV (and −0.6 on two night shots). **A camera-metered raw (Pixel, iPhone, Samsung: `cameraMetered`) now keeps the camera's exposure whatever the skin says**, in Swift, Kotlin and the web (`AutoTone`); faces still steer the look suggestion, and RawBoy Camera's phone-AE path keeps following the skin. Photos IMG_20261031_143823 / 142419 / IMG_20261107_215559 / 215633: exposure +1.45 / +0.75 / −0.65 / −0.60 → 0 EV, looks unchanged (portra400, portra400, portra800, portra800). The analysis cache holds no develop, so its version stays.

**RawBoy Desktop (macOS): displays and accessibility (2026-11-15)**

- **Displays.** The photo is now tagged sRGB (it was untagged: on a wide-gamut display the same numbers drew over-saturated, and a window moved to another display kept that display's wrong colours); the system converts for each display, and the view redraws when the window changes screen, scale or colour profile. A window restored onto a display that is gone, or left behind when one is unplugged or changes resolution, moves onto the main screen (`WindowPlacement`, with tests); the Packer window too.
- **VoiceOver and keyboard.** Sliders say name and value with a Reset action; mask, leak, effect, look, LUT and tone-mapper choices are real buttons (selected state, Tab focus ring with Full Keyboard Access, Space); value readouts reset on press; section titles are headings; Auto's grid cells say name, status and look and have Select/Deselect; the photo, mask handles and curve are described; messages are announced. **Reduce Motion** stops the fades and scrolls; **Increase Contrast** firms up chip outlines. Pro's Help has a VoiceOver and keyboard item.
- Checked: `RawBoyEngineTestsMac` (new `WindowPlacementTests`), `RawBoyDesktop` builds; the preview layer's colour space (sRGB) and the off-screen fallback were confirmed in the running app (a window put where a disconnected display was, then the screens-changed notice: moved to the centre of the main screen, preview redrawn). Not checked: a second display (this Mac has one: moving a window between displays, per-display profile and scale), a wide-gamut screen's look, and the VoiceOver wording (no assistive access for scripting here, so the tree was not read); mouse handles still can't be moved from the keyboard.

**RawBoy Desktop (macOS): speed on big files (2026-11-15)**

- **Auto analyses up to 3 photos at once** (a third of the cores, at most 3, one per 6 GB of memory; one lane on iPhone) and **keeps each analysis on disk** (`AnalysisCache`: path + size + modified time; 512 px copies, bloom copies, lens data, ISO, noise, skin mask, as-shot white; the develop is worked out again, so tuning it needs no cache bump). **TIFF export compresses its strips in parallel** (same bytes).
- Release, 10 cores, 30 raws (5 Fuji RAF, Canon CR2/CR3, Sony ARW, iPhone DNGs, 4.9 s of RAF decode each): Auto first pass **33.1 → 22.7 s** with lanes (peak memory 3.9 GB), **0.33 s** when the folder is added again (91 MB of cache); same looks for all 30. 48 MP iPhone DNG TIFF export **2.9 → 1.0 s**, 24 MP **1.6 → 0.5 s**; both exports byte-identical to before.
- Measured, not changed: full decode of a 48 MP iPhone DNG 1.9 s (1.5 s of it single-threaded LibRaw `unpack`), X-E5 RAF 5.0 s (3.8 s X-Trans demosaic, already on all cores), CR3 1.6 s; the preview draw 15-17 ms a frame, the 1.5 MP preview copy 17 ms. Draft (half-size) decode left out: RAF 3.8 → 0.5 s, but the denoise suggestion moves (RAF 1 → 4, CR2 0 → 3), so Auto's look would change; the other formats gain little. Not measured: 100% tile loads and Auto's export of a batch.

**RawBoy Desktop and iOS: light leak outline dots (2026-11-15)**

- A glow leak now shows the web's 8 hollow **outline dots** (at 22.5° + k·45° of its own frame) and drags them with the mouse (touch on iOS, the same code): each follows the pointer along its own direction from the centre, limited to 0.1–4 shape radii, and the size dots then sit on the reshaped outline (dragging one divides by the outline radius there). **Round outline** in the Light panel puts the ellipse back. The Swift side already stored, saved and rendered `radii`; this adds the maths (`LightLeaks.radius`, the closed Catmull-Rom of the shader, and `edge(radii:)`) and the overlay drawing, hit-testing and dragging, ported from web's `OverlayLayer`.
- Checked: new tests port web's "reshapes a glow through its outline points" (spline passes through the points, wraps, floor 0.05, edge inside/outside) and the radii JSON limits; `RawBoyEngineTestsMac` 148 run, 7 skipped, 0 failed. Driven on the Mac with posted mouse events on a real DNG: an outline drag set radius 6 to 1.658 and a size-dot drag on the reshaped outline grew `rx` 0.09 → 0.125; a screenshot shows the reshaped outline and glow. Not checked: touch on an iPhone (iOS isn't compiled here), dragging in a rotated/bent/tapered leak by hand, and the mouse hover cursor.

**RawBoy Desktop and iOS: Film scan 1.5× export (2026-11-15)**

- The Film scan option of the web and Android is ported to the Swift engine: in Film mode (Pro's Film tone mapper, Auto's Film looks or any film stock) the export sheet offers **Film scan: Off / 1.5× size**, rendering the photo 1.5× larger by iterative back-projection upscale plus a light luma sharpen before the grain, with the grain at the finer pitch (`ScanScale`: 1.5, margin 16, grain 0.86, sharpen 1.0, same as the web). The Size setting doesn't apply to a scan. Auto's batch export applies it to its Film photos and leaves the others alone.
- `shaders/scan.frag` is the shared shader: `gen.sh` builds it into `scan.metal` (layout in `DevelopLayout.scanUniforms`), `ScanUpscaler.swift` runs the six passes in RGBA32F/16F targets, `SampleGeometry.renderScale` drives `uRenderScale`, `uOutOrigin/uOutSpan` and the grain, `Exporter` renders tiles in output pixels with even source regions. `ExportSettings.filmScan` is remembered with the export settings (`export.filmScan`, `auto.exportFilmScan`); as on the web it is not in a photo's edits or in `rawboy:Auto`.
- Checked: the Metal upscale of a test image equals the web's WebGL2 run of the same shader in Chrome (mean absolute difference 1.1e-4, maximum 1e-3 on 0..1 values; channel means within 0.04% and standard deviations within 0.03%); a real photo exported with the scan is 1.5× the size (9000×6000 from 6000×4000, about 3 s) with the plain export's mean colour within 0.1%; Auto's batch export produces the 1.5× files. Not checked: the whole export against the web's (the grain, tile geometry and film render were not compared with a web export), and the iPhone is not compiled here.

**RawBoy Desktop (macOS): Packer (2026-11-15)**

- **File › Pack Raws…** (⇧⌘P): RawBoy Packer in a window of its own, the web's Packer on the Mac: camera raws and DNGs re-saved as DNG 1.7 (Small raw, Lossless, Lossless JPEG XL, Micro) through `dng_pack.cpp` and the Adobe DNG SDK. Presets, Advanced settings, the live summary and the "Opens in" table are the web's `settings.ts`, ported (`PackSettings.swift`, with its tests); drop or add raws and folders, output next to each file or in a folder, never over an existing file, originals untouched, files in parallel (Auto: a third of the cores, one under 8 GB), per-file progress, Stop after the current files.
- Native: `rb_pack_inspect` / `rb_pack` in `ios/native/rawboy_pack.cpp` (macOS slice only: the iOS slices don't build `dng_pack.cpp`), the Swift wrapper `Packer` (macOS), previews rendered by ImageIO instead of jpegli, each pack on a 64 MB-stack thread, the source memory-mapped.
- Checked against the web's own WASM Packer run in Node on the same files (a Sony A7 III JPEG XL DNG and a Pixel 9 Pro DNG, all four formats): output sizes within 0–3.6%, and the packed DNGs decode to the same picture and size in RawBoy's decoder (means equal to 6 digits); ImageIO and `sips` open them.
- Not tried by hand beyond launching the window and driving it from a debug probe; no camera raw (ARW, RAF…) was available on this Mac: only DNG sources were packed.

**RawBoy Desktop (macOS): fixes from the first hand test (2026-11-15)**

- **Sliders** didn't respond to the mouse. Cause (found by driving the app with posted mouse events): the Mac's slider was kept at 2% opacity over a hand-drawn track, and a hand-drawn drag gesture took no mouse in Auto's signed sliders. On the Mac the system slider is now drawn as it is (a small mark at 0 on signed ranges, a colour bar beneath for colour sliders); click, drag and the double-click reset work in Pro and Auto.
- **Pro | Auto**: **Edit in Pro** (⌘↩; photo view toolbar, Mode menu, one selected photo) opens the Auto photo in the editor with its `rawboy:Develop`; **Send to Auto** (⇧⌘A, the **To Auto** button in the editor's bar) adds the open photo to the batch. A photo opened from the Finder or RawBoy Viewer always opens in Pro (the batch stays).
- **Auto's grid**: ⌘A selects all, ⇧-click selects the range from the last clicked photo, ⌘-click toggles, Esc clears the selection; **Clear batch** (button and Mode menu) asks first, naming the count, and only takes photos out of the batch.
- The photo view's title pill (name over "1 / 8", beside the mode switch) overflowed: on the Mac the window title has the name and the position is a small label in the toolbar.
- Pro's **Tone mapper** row has fixed label, segment and stock widths, so it doesn't re-flow (the label wrapped letter by letter) when Film is chosen.
- Checked by driving the running app (posted mouse and key events; screenshots) and the debug probes `RAWBOY_PROBE_MOUSE` and `RAWBOY_PROBE_SELFTEST` (⌘A, Esc, ⇧-click range, ⌘↩, the hand-over, Send to Auto, Clear batch, files left alone).

**RawBoy Desktop (macOS): Auto mode, a batch developed automatically (2026-11-15)**

- A **Pro | Auto** switch in the title bar (⌘1 / ⌘2, Mode menu). Auto is RawBoy (iOS) Auto's SwiftUI grid and photo screens, shared by the Desktop target the way Pro's are (`ios/Auto/` minus `AutoApp.swift`; toolbar placements and the Photos library fenced for macOS): add photos with ⌘O, a folder with ⇧⌘O, by drag and drop or `--auto`; grid with thumbnails and keyboard (arrows, Return, Esc, ← →, ⌘-click selects, ⌘E exports); photo view with looks / Film, Strength, adjustments, crop and rotate, presets, Copy previous, Apply to all; **Export all** into a chosen folder or next to each photo (`NAME-auto.jpg`). Files are used in place (the iPhone app copies them).
- **`rawboy:Auto` sidecars**: `AutoSidecar.swift` is a port of the web's `AutoSidecar.ts` (same JSON, its tests ported: `AutoSidecarTests`), `XmpSidecar`/`PhotoSidecar` read and write the field beside `rawboy:Develop`, `Desktop/SidecarAuto.swift` writes 800 ms after a change and restores a photo's look, strength, adjustments, preset and lens preset when it is added again. The web-only parts (RawBoy edits, As is, retouch adjustments) are kept and written back.
- Skin analysis uses the new Vision-based skin mask. `AutoViewModel` got hooks (`persistence`, `saveExported`, `destinationLabel`, keyboard helpers), `LookMode` moved into the engine, `Auto/ui/Help.swift` became `AutoHelp.swift` (file names must be unique in a target). Debug builds can measure a batch from a script (`RAWBOY_AUTO_PROBE`, `AutoBatchProbe.swift`).
- Not tried by hand beyond launching it (grid and photo view look right); the iPhone app is unchanged in behaviour but not compiled here.

**RawBoy Desktop (macOS): Skin retouch, Blemish removal and Portrait retouch (2026-11-15)**

- The Mac app had no skin features (MediaPipe has no macOS build). It now finds faces and skin with **Apple's Vision framework** (no new dependency): face contour, forehead cap and the 76 landmarks carve out eyes, brows, lips and nostrils; a skin-colour model sampled from the face trims the forehead cap and finds neck, arms and hands inside Vision's person mask. Differences from MediaPipe's trained skin classes are listed in `docs/desktop.md` (tone-alike garments or hair can count as skin; skin in very different light is missed; the hairline is an estimate; small and side-on faces are found less well). A dark scene is tried at several exposures until the detector finds a face.
- **Portrait retouch** (Detail tab, 0–100, and per layer in the Masks panel): the web's natural retouch (spots, under-eyes, lines, evening) ported with its numbers (`retouch/PortraitRetouch.swift`; `FaceShape` carries the face anchors, from Vision here and from MediaPipe's 478-point mesh via `FaceShape(mesh:)`). The gains map is packed with the skin mask into the skin texture and applied by the develop shader (`uSkinFix`, `uLayerRetouch`), so preview, 100% view and export match; `PhotoSession.scheduleRetouch` makes it 250 ms after the slider settles. `portraitRetouch` is now a known edits/preset field (it was passed through as an extra); the fixtures were regenerated.
- Skin retouch and Blemish removal, which only needed the mask, work on the Mac now too.
- Tests: the web's `portraitretouch.test.ts` cases (`PortraitRetouchTests`), `EditsTests` (`portrait` fixture), and `PortraitRealTests` (a real portrait, with `RAWBOY_PORTRAIT=<raw>`; skipped without). Measured on a Fujifilm GFX portrait photographed off a monitor (phone DNG): see the report. iOS keeps MediaPipe and its sliders hidden for now (its landmarks aren't handed to `SkinMask.faces` yet).

**RawBoy Desktop (macOS): lens blur in mask layers (2026-11-15)**

- The Masks panel's **Lens blur** slider (0..100) works on the Mac, as on the web and Android: a round, lens-like defocus inside the mask (up to 3% of the long side) where small bright lights become clean discs and the sharp part next to the mask is never smeared. Preview, 100% view and export agree (it works on a small whole-image copy, so no tile seams).
- Port of the web's two GPU passes to Metal: `shaders/bokeh_prep.glsl` is built by `ios/shaders/gen.sh` into `bokeh_prep.metal` (with its own layout in `DevelopLayout`), the disc gather is `bokehGatherFragment` in `Helpers.metal`, `metal/BokehTexture.swift` runs both into the texture the develop shader reads (`uBokeh`; iOS used to bind a dummy one), `LayerUniforms.blur`, `ShaderParams.bokehSource`, `PhotoSession.ensureBokehSource`. The shader is shared, so RawBoy (iOS) gets the engine side too; its Masks panel shows the slider as well.
- Tests: `BokehTests` (sizing and uniforms; a Metal render of a bright spot, which spreads into a disc of the expected radius while the dark field stays put). Not tried by hand yet.

**RawBoy Desktop (macOS): healing brush (2026-11-15)**

- **Heal** in the top bar (or **B** outside Masks; inside Masks B stays the mask brush, as on the web): click a spot or drag a stroke over dust, a blemish or a small object and it is healed away in the full-resolution image by seamless cloning. **Auto source** lets the engine pick the cleanest nearby area; **Choose source** shows a dashed copy to drag onto the area to clone from. Size and Feather (new strokes), the stroke list (pick, change source, delete, Clear all), **[ ]** size, **Delete** removes the selected stroke, Space pans, a ring shows the brush size.
- Swift port of the web's `HealSpots.ts` (`develop/HealSpots.swift`: parse, `strokes` = the disks the engine heals, `key`), `DevelopParams.healSpots`, `Edits` reads and writes `healSpots` (same JSON; the web's fixtures check it), `PhotoSession` heals the strokes together with Blemish removal (the brush does not wait for the skin mask, which the Mac build never has), `Pro/ui/HealPanel.swift` and `HealOverlay.swift`. The native library gets `rb_heal` (spots + brush disks; `blemish.cpp`'s `healStroke` was only reachable from the web and is now bound for iOS and macOS too). Android is not ported (its JNI has no `healStroke` binding).
- Tests: `HealSpotsTests` (the web's cases), `EditsTests` (the new `heal` fixture), `HealBrushTests` (a real raw: strokes change only their neighbourhood, an empty list restores the photo). Not tried by hand yet.

**RawBoy Desktop (macOS) and RawBoy (iOS): Auto WB area and Reset WB (2026-11-15)**

- Color tab: **Auto WB** shows a frame on the photo; temperature and tint are solved so what is inside renders neutral (clipped pixels left out), again whenever the frame is dragged or resized. **Reset WB** returns to as shot. As on the web and Android (`WhitePicker.area`, the web's `autoWhiteArea`, with its test). Esc or Close Tool closes the frame on the Mac.
- Compiled and unit-tested by CI on macOS only: not yet tried by hand.

**RawBoy Desktop (macOS) and RawBoy (iOS): lens corrections from the Lensfun database (2026-11-15)**

- The Lens tab's **Use Lensfun profile** switch, as on the web: distortion, chromatic aberration and vignetting from the Lensfun lens database for raws with no embedded profile. **Auto** matches the camera and lens from the EXIF, **Pick lens** searches the camera and lens lists, **Generic** describes a lens that is not in the database (crop factor or sensor size, focal length, aperture, type incl. fisheyes with **Straighten fisheye**, optional known terms). Off by default; the switch, mode, generic lens and picked camera are remembered. Not in presets or sidecars.
- Swift port of the web's code (`lens/Lensfun.swift`, `LensfunData.swift`, `Pro/LensfunStore.swift`, `Pro/ui/LensfunPanel.swift`; no Lensfun code), with the web's unit tests (`LensfunTests`). The database (CC BY-SA 3.0, 1.8 MB, the web's `web/public/lensfun` folder) is bundled in the app; nothing is downloaded.
- Compiled and unit-tested by CI on macOS only: not yet tried by hand on a Mac or an iPhone.

**RawBoy Desktop (macOS, new, in development): RawBoy's editor on the Mac with edits kept in XMP sidecars (2026-11-15)**

- New native macOS app `RawBoyDesktop` (`app.rawboy.desktop`, `ios/Desktop` + RawBoy Pro's SwiftUI views in `ios/Pro`): one window with the full RawBoy editor, Open (⌘O, drop, Finder Open With), export of JPEG or TIFF next to the photo or into a chosen folder, a menu bar with every shortcut and a Help sheet. Documented in [docs/desktop.md](docs/desktop.md).
- A photo's edits are saved into its XMP sidecar (`rawboy:Develop`, the web's `Edits` JSON; NAME.xmp, else darktable's NAME.EXT.xmp, else a new NAME.xmp) 800 ms after you stop, only that field, everything else kept byte for byte, atomic writes. RawBoy Viewer's turn (`tiff:Orientation`) and crop are read.
- Keys match the web: Z, D, C, B, E, V, [ ], \, ⌘Z / ⇧⌘Z, by physical key so non-Latin layouts work; wheel zoom around the pointer, wheel over a slider (Shift big steps, ⌘ fine), double-click resets.
- Engine: macOS slices of the native libraries (arm64 + x86_64, `ios/native/build.sh`), `RawBoyEngineMac` target (arm64; Float16 is unavailable on Intel Macs), `Edits.swift` (port of Edits.kt, round-trips the web's JSON incl. brush strokes, leaks, effects; web-only fields are kept), `XmpSidecar.swift`. Skin retouch and blemish removal are off on macOS (MediaPipe has no macOS slice).
- Opening a raw no longer depends on the thread's stack: the decode runs on a 64 MB thread (and Apple worker threads of LibRaw's parallel steps get 16 MB), after RawBoy Desktop crashed on a stack guard page opening one.
- A release attaches `RawBoy-Desktop-<tag>.dmg` (ad-hoc signed, not notarised).
- Fixed on iOS: saving a Detail preset crashed (`grain`, `grainSize`, `highpassContrast` missing from `Presets.numberFields`).

**RawBoy Camera, Pro, and Auto (Android, iOS, web): Frames and Date stamps in Pro/Auto + frame rendering refinements (2026-11-14)**

- Ported RawBoy Camera's **Frames** (`Pentax 645`, `Contax 645`) and **Date stamp** (`Classic`, `Red LED`) to **RawBoy Pro** and **RawBoy Auto** across Android, iOS, and the web (`DateStamp.kt`/`.swift`/`.ts`, `Pentax645Frame.kt`/`.swift`/`.ts`, `ExportSettings.kt`/`.swift`/`.ts`, `Exporter.kt`/`.swift`/`.ts`).
- Added shared **Frame** controls to Pro's Export dialog and Auto's Export sheet (`ExportFrameControls.kt`, `ExportFrameSections.swift`, `ExportFrameControls.tsx`):
  - **Date stamp**: **Style** (**Classic** or **Red LED**) and **Date format** (`DD MM 'YY`, `'YY MM DD`, `MM DD 'YY`), using the photo's EXIF shoot date (`DateStamp.parseExifDate`, falling back to the current date).
  - **Pentax 645** / **Contax 645**: **Color** (**Amber**, **Slide**, **Red**, **Green**), **Flip info upside down**, **Date format** (`DD MM 'YY`, `'YY MM DD`, `MM DD 'YY`, `jan 26`), **Time format** (`24h`, `12h (AM/PM)`), and toggleable, reorderable **Shoot info** fields available from photo EXIF (**Frame #** — `1..N` across batch exports in Auto, `#1` in Pro — **Shutter**, **Aperture**, **Focal length**, **ISO**, **Date**, **Time**).
- Reduced LED edge softness, reach, halo spread, and film-gate edge softness by 30% across all frames (**Date stamp** Classic and Red LED, **Pentax 645**, and **Contax 645**).
- Reshaped the **Pentax 645** data-bar side cutouts into an iPhone-notch ("monobrow") profile (`pentaxMonobrowDist`): open side cutouts (`distFromEnd <= infoBar * 1.25`), a tight concave top fillet, a steep straight side wall (~67°), and a generous convex bottom corner, evaluated with perpendicular signed distance.
- Replaced the **Contax 645** frame counter's 5×7 dot-matrix glyphs with a continuous film edge-marking stamp (`ContaxCounterStamp`, `sdContaxTriangle`, `sdContaxDigit`): a smooth elongated acute triangle pointing at rounded, continuous-stroke sans-serif numerals.
- Exports in black and white (`saturation <= 0` or a monochrome LUT at full strength) automatically imprint the date stamp and film rebate in neutral black and white. Checked by `frames.test.ts` and `tsc --noEmit` on the web; Android and iOS not built in the sandbox.

**RawBoy Camera (Android): scale HDR gain map to the look's white level and tame highlight curve (2026-11-14)**

- **HDR gain map** now normalizes display luma by the active film stock's or LUT's white level (`Exporter.lookWhiteLuma` → `JpegNative.beginGainMap` → `GainMapBuilder` in `ultrahdr.h`): paper-white dimmed print and slide films (~0.81–0.87 luma) reach the same highlight lift as AgX (1.0) without pulling the knee into midtones. For film stocks, white is evaluated through `film.film` at `(1, 1, 1)` into `film.print` (so slide films whose `Dmin` sits at ~0.06 get their true 0.81–0.86 white rather than the unused `(0, 0, 0)` print LUT corner) and full `Whites`/`Blacks` levels.
- Set `kHeadroomEv = 2.0` (4× max boost), `kKnee = 0.72`, `kWhite = 0.98`, with a quadratic ease-in (`t * t`) so upper midtones stay natural while peak highlights pop. Checked by `tools/ultrahdr/run.sh`.

**RawBoy Camera (Android, iOS): Reset settings to defaults button in Settings (2026-11-14)**

- Added **Reset settings to defaults** with a confirmation dialog at the bottom of Settings (`CameraSettings.resetToDefaults`, `CameraViewModel.resetSettings` on Android and iOS). Resets photo, capture, video, viewfinder, experimental, look and camera/lens settings to their defaults while keeping learned per-lens calibration (`previewScales` and `flashGuides`), and updates the active camera/lens and viewfinder overlays (including clearing the live histogram immediately on Android and keeping the active camera/recording state intact if triggered during video recording). Checked by `CameraSettingsTest`.

**RawBoy Camera (Android, iOS): Grain setting, on by default (2026-11-14)**

- Added **Settings → Grain** (`CameraSettings.grain`, default on). Off takes the grain out of the viewfinder and the saved photos, Film's included (`develop` zeroes `grain` and `filmGrain`); on is the same as before. Unit test in `CameraSettingsTest`; not built or run on a device (no Android SDK in the sandbox).

**RawBoy Camera (Android, iOS): fixes found reviewing the Frames changes (2026-11-14)**

- Shutter speeds between about 0.67 s and 0.95 s on the Pentax/Contax rebate now read `0.8s` instead of `1/1`.
- Switching to **Date stamp** (or toggling frames back on) with the Pentax/Contax-only `jan 26` date format selected now resets the date format to `DD MM 'YY`, so the setting matches what the Date stamp picker shows. Checked by `Pentax645FrameTest`; not built or run on a device.

**RawBoy Camera (Android, iOS): Pentax 645 film frame with shoot info, Frames submenu, and B&W frame rendering (2026-11-13)**

- Moved **Date stamp** into a **Frames** submenu in Settings (`PhotoFrame`: **Off**, **Date stamp**, or **Pentax 645**, mutually exclusive; migrates existing `dateStamp` preferences).
- Added **Pentax 645** (`Pentax645Frame` in `Pentax645Frame.kt` and `ExportSettings.swift`), wrapping the photo in a dark film-base rebate with convexly rounded black stripe ends and 5×7 dot-matrix LED shoot info always placed along the shorter side of the photo (top edge for portrait/square, left vertical edge for landscape): today's 1-based frame counter (`#1`, `#17`, via `CameraSettingsStore.nextFrameNumber`), mode (`FILM` / `LOOK` / `BW`), shutter speed, aperture, exposure compensation EV (following the Brightness slider), metering icon (larger 7×7 multi-pattern frame for auto metering, smaller spot icon for tap metering), lens focal length without space (`24mm`), ISO (`ISO400`), separate **Date** (`DD MM 'YY`, `'YY MM DD`, `MM DD 'YY`, or `'jan 26'`) and **Time** (`24h` or `12h (am/pm)`), an option to **Flip info upside down** (rotating the LED shoot-info text 180° like on real film), and drag-and-drop reordering of shoot-info items in Settings (`pentax645Order`).
- In **B&W** mode (`monoMode`), both **Date stamp** and **Pentax 645** render in neutral black and white (`monochromeImprint`). Checked by unit tests (`Pentax645FrameTest`, `DateStampTest`, `CameraSettingsTest`) and iOS `xcodebuild`; not yet run on a device.

**RawBoy Camera (Android, iOS): date stamp format option (`DD MM 'YY` default, `'YY MM DD`, `MM DD 'YY`) (2026-11-13)**

- Added a **Date format** choice under **Date stamp** (shown while Date stamp is on) supporting `DD MM 'YY` (now the default), `'YY MM DD`, and `MM DD 'YY` (`DateStampFormat` in `DateStamp.kt` and `ExportSettings.swift`). Checked by unit tests (`DateStampTest`, `CameraSettingsTest`) and iOS `xcodebuild`; not yet run on a device.

**RawBoy Camera (Android, iOS): Digital-7 style chamfered segments and halved glow on the date stamp (2026-11-13)**

- Switched the **Date stamp**'s 7-segment geometry from rounded-capsule bars to Digital-7 style 45°-chamfered hexagonal segments with tight interlocking corner gaps and slightly crisper proportions (implemented procedurally in `DateStamp.kt` and `ExportSettings.swift` so no commercial-restricted font file is bundled), and cut the outer halation glow in half (`0.35` -> `0.175`, tighter reach and edge ramp). Checked by unit tests (`DateStampTest`, `CameraSettingsTest`), a rendered preview from the Swift code, and the iOS `xcodebuild`; not yet run on a device.

**Movie Green V2 and Redscale V2 looks (2026-11-13)**

- Added two new Rec.709 AgX `.cube` looks in the **Experimental** section across RawBoy Auto, RawBoy Camera (colour Look menu with Film off) and RawBoy Pro (LUTs tab and Web Look Selector), on Android, iOS and the web: **Movie Green V2** (`Movie Green V2.cube`) and **Redscale V2** (`Redscale V2.cube`), each with grain 20 and vignette -10 on top.

**RawBoy Camera (Android, iOS): the date stamp looks like a real film data back (2026-11-13)**

- The **Date stamp** is now drawn the way a quartz date back exposes it: orange LED light shining through the film base. The digits are light added to the picture (bright on dark areas, fading into bright ones, where they only leave a faint yellow tint), soft-edged as the out-of-focus LEDs are, with a hot yellow core that falls off to red-orange at the fringe, a wider reddish halation glow, segments a little uneven in brightness (90-100%, fixed per segment) and grain in the light. Before, they were crisp flat digits painted over the picture. Same rendering on Android (`DateStamp.kt`) and iOS (`DateStamp` in `ExportSettings.swift`). Checked by unit tests (`DateStampTest`), a rendered preview from the Swift code, and the iOS `xcodebuild`; not yet run on a phone.

**RawBoy Camera (Android, iOS): film-style date stamp option, off by default (2026-11-13)**

- New Settings switch **Date stamp** in the Photo section, off by default. When turned on, each exported JPEG gets today's (the shot's) date imprinted in classic 35mm data-back format (`'YY MM DD`, e.g. `'26 11 13`) in the bottom-right corner, drawn in a slanted 7-segment clock font in yellowy-orange (`#FFB81A` with a warm orange halo). Checked by unit tests (`DateStampTest`, `CameraSettingsTest`), Android debug build, and iOS `xcodebuild` (`RawBoyCamera`); not yet run on a physical device.

**RawBoy Camera (Android, iOS): the Level line always follows the horizon (2026-11-13)**

- The level line is no longer affected by the app's own orientation (or auto-rotate being off). Previously, the tilt angle was wrapped modulo 90° and drawn in window coordinates, so turning the phone past 45° with auto-rotate off flipped the line perpendicular to the horizon, and turning with auto-rotate on jumped it twice (at 45° and again when the window rotated). Now `CameraViewModel` reports the continuous unwrapped angle from upright portrait with deadband around every 90° upright, and `LevelOverlay` is drawn in the fixed upright viewfinder coordinates (`turned`) with its reference marks aligned to the nearest 90° axis. Checked by unit tests (`TiltFilterTest`) and Android debug compilation; iOS not built here, and neither app was run on a device.

**RawBoy Camera (Android): the HDR gain map now lifts highlights visibly (2026-11-13)**

- The setting wrote a valid Ultra HDR file, but the gain map asked for almost nothing: a photo of a dim desk with a bright lamp got a peak boost of 0.56 stops on about 2% of the picture (map peak 72/255 measured from a shot), because the boost started at 75% brightness and reached its 2 stops only at pure white, which the tone mapper's output (about 90%) never hits. Now the boost starts at 60%, reaches the full amount at 90%, and the full amount is 3 stops (`kKnee` 0.6, `kWhite` 0.9, `kHeadroomEv` 3), so the lamp and bright screens get about 3 stops and bright midtones about 1. The SDR picture is unchanged. HDR needs screen headroom to show: raise the brightness and view in an app that supports Ultra HDR (Google Photos, Chrome).
- Host test `tools/ultrahdr/run.sh` updated for 3 stops. Not run on a device (no Android SDK in the sandbox).

**RawBoy Web, Pro: the healing stroke shows in red while you paint (2026-11-12)**

- While you drag a healing stroke it is drawn as a red semi-transparent band at the brush size (one shape, so overlaps don't get darker), then returns to the usual outline when you lift. Before, only a faint white tint showed, which was hard to see.

**RawBoy Web, Pro: Enter finishes the healing session (2026-11-12)**

- In the Healing brush, Enter does what Done does: the tool closes and the strokes stay. Ignored while typing in a text field and on a focused button (which keeps its own Enter).

**RawBoy Web, Auto: the next photo is decoded ahead of time (2026-11-12)**

- On desktop-class devices (the same ones that get several analysis lanes: not phones, 8 GB or more) Auto also decodes the photo after the open one at full resolution once the open photo is ready and the browser is idle. Stepping forward then swaps it in at once instead of waiting seconds for the decode; the zoom, taps and Export are ready as soon as you arrive. It holds a second raw in the WASM heap, freed when you open anything else, go back to the grid, hand the photo to the RawBoy tab or export. A decode already running can't be cancelled, so stepping elsewhere during it waits for it to finish. The previous two photos are still only warmed (preview), not decoded. Typecheck only, not run in a browser.

**RawBoy Web, Auto and Pro: C is Crop & rotate, Shift+C is Copy previous (2026-11-12)**

- Swapped: **C** opens Crop & rotate in Auto's photo view and in Pro (Pro has no other use for C; it closes the tool too), and **Shift+C** is Copy previous in Auto (it used to be C). Help sheets and the button tooltips follow. Typecheck only, not run in a browser.

**RawBoy Web, Auto: neighbouring photos preload in the photo view (2026-11-12)**

- Once the open photo has finished decoding, Auto quietly warms the next three photos and the previous two (their cached previews are read back and their LUT or film stock loaded), one at a time while the browser is idle, so stepping through photos shows them at once. Moving to another photo cancels the running preload and starts around the new one, and only those five are kept in memory. The full-resolution decode still happens only for the open photo (a full decode per neighbour would hold hundreds of MB each in the WASM heap). Typecheck and unit tests only, not run in a browser.

**RawBoy Web, Pro: healing brush size only affects new strokes (2026-11-12)**

- Changing Size, Feather or `[` `]` after painting a stroke no longer resizes that stroke (the last stroke stays selected, so the sliders used to edit it). They set the brush for the next strokes only; strokes keep the size and feather they were painted with. The Auto/Choose source switch still applies to the selected stroke.

**RawBoy Web, Pro: much smaller healing brush (2026-11-12)**

- The Healing brush's smallest size is now 0.04% of the photo's long side (about 2-3 px on a 6000 px photo, was 12 px), for single hot pixels and hairline dust. The Size slider stays logarithmic over the whole range, so the small end keeps fine steps; `[` and `]` step it the same way. Saved sizes are unchanged (only the slider position moves).
- **B** opens and closes the Healing brush from any other tool (inside Masks, B remains the mask brush).

**RawBoy Web (Auto and Pro): Shift+C opens Crop & rotate (2026-11-12)**

- **Shift+C** opens Crop & rotate in Auto's photo view and in Pro (in Pro it also closes it, like the top bar button; in Auto it closes it too). It works by key position, so it also works on a Ukrainian layout, and is ignored while typing in a field. Listed in both help sheets. Typecheck only, not run in a browser.

**RawBoy Web, Auto: drag to rotate in Crop & rotate (2026-11-12)**

- In Crop & rotate, press outside the crop box and drag around it to rotate the photo, as in Lightroom: the angle follows the pointer around the frame's centre (clockwise = clockwise, ±45°, smooth across the 180° line) and the **Straighten** slider moves with it; the usual Undo step and auto crop apply. `CropOverlay` (shared with Pro) takes an optional `rotate` prop, which only Auto passes; Pro's presses outside the box still fall through to the preview. The cursor over the area outside the box is a grab hand. Touch rotate on Android and iOS isn't done. Typecheck only, not run in a browser.

**RawBoy Auto (web, Android, iOS): Crop starts on Original, remembers the shape, Enter confirms (2026-11-12)**

- The crop shape now starts on **Original** (the frame keeps the photo's own proportions while dragging; Free is one tap away) and the last shape chosen stays for the session (until the page or app is closed), so the next photo opens with it; a remembered shape other than Original / Free shapes the frame as the tool opens. Reset goes back to Original. Web: **Enter** confirms the crop like Done (Esc too). Typecheck only on the web; Android and iOS not built here.

**RawBoy Auto (Android): Crop & rotate (2026-11-12)**

- Same as the web's: **Crop & rotate** in the photo view's ⋯ menu opens Pro's crop frame (`CropOverlay`, moved from app-pro into the engine's `view/` so both apps share it) with a panel under the photo (beside it in landscape): shape chips (Free, Original, 1:1, 5:4, 4:3, 3:2, 16:9, 2:1, 2.39:1 and Portrait / Landscape), ↺ Left / Right ↻, **Straighten** (±45°, auto-cropped), Reset and Done. `Adjustments` gets `straighten` and `crop` (`LookApplier` applies them after the look, preset or RawBoy edits), so the photo view, thumbnails, Export all and Export, and Undo / Redo follow; turning a photo turns its crop with it, and Apply to all and Copy previous leave it alone. Swiping between photos, zoom and compare pause while the tool is open. Help, `docs/auto.md` and `LookApplierTest` updated. **Not compiled or run**: the cloud session has no Android SDK, so build `:app-auto:assembleDebug` and `:app-pro:assembleDebug` (Pro only changed the `CropOverlay` import) and try it on the phone.

**RawBoy Auto (iOS): Crop & rotate (2026-11-12)**

- Same as the web's and Android's: **Crop & rotate** in the photo view's ⋯ menu opens Pro's crop frame (`CropOverlay.swift`, compiled into the Auto target too) with a panel in place of the look strip and sliders: shape chips (Free, Original, 1:1, 5:4, 4:3, 3:2, 16:9, 2:1, 2.39:1 and Portrait / Landscape), ↺ Left / Right ↻, **Straighten** (±45°, auto-cropped), Reset and Done. `Adjustments` gets `straighten` and `crop` (`LookApplier.swift`), so the photo view, thumbnails, Export all and Export, and Undo / Redo follow; turning a photo turns its crop with it, and Apply to all and Copy previous leave it alone. Swiping between photos, zoom and compare pause while it is open. Help, `docs/auto.md` and `AutoCropTests` updated. **Not built or run** (no Xcode in the cloud session): run `xcodegen` (project.yml gained the shared source), build `RawBoyAuto` and `xcodebuild test -scheme RawBoyEngineTests`.

**RawBoy Web, Pro: middle mouse button pans (2026-11-12)**

- Dragging with the middle mouse button now pans the zoomed photo in every tool, including the Healing brush where the left button paints (Space+drag still works). A middle press never counts as a click or a hold-to-compare.

**RawBoy Web, Auto: Crop & rotate (2026-11-12)**

- New **Crop** button in the photo view (phones: **Crop & rotate** in the ⋯ menu) with Pro's crop frame and a small panel: shapes (Free, Original, 1:1, 5:4, 4:3, 3:2, 16:9, 2:1, 2.39:1 and Portrait / Landscape), turn left / right and **Straighten** (±45°, auto-cropped). The crop and straighten angle are part of the photo's `Adjustments` (`crop`, `straighten`), applied after the look, preset or RawBoy edits by `LookApplier` (a crop replaces the edits' own), so the photo view, thumbnails, Export all and Export, the sidecar (`rawboy:Auto`) and Undo / Redo all follow. Turning a photo turns its crop with it. Apply to all and Copy previous leave the crop alone, as they do rotation. Flip and perspective stay in the RawBoy tab. Help, `docs/auto.md` and a test (`autostore.test.ts`) updated. Typecheck and the Auto store tests only: no WASM build in the cloud session, so the screen itself wasn't run. Android and iOS Auto still to port.

**RawBoy Web, Pro: healing brush paints, seamless at any feather (2026-11-12)**

- **Heal now works as a brush**: drag to paint a stroke over what should go (a click is still one spot). Strokes are healed as overlapping disks along the path, each with the stroke's source offset when you chose a source (drag the dashed copy of the stroke; new strokes keep the offset). The list holds strokes; Delete and `[` `]` as before.
- **Feather defaults to 80**, and the repair no longer shows a ring at lower feathers. Found on a portrait (`DSCF7403.RAF`, knee and cheek skin, 14-28 px brush): the old fill (smoothed membrane x donor texture ratio) took its edge tone from a blur that the spot's own darkness had leaked into, so the disk sat as a lighter patch with a dark rim. `healStroke` now does seamless cloning (Poisson, Gauss-Seidel with over-relaxation, in log space): the disk's inside = harmonic fill of the photo's own pixels around it + the donor's high-pass detail, so its edge matches exactly whatever the donor's tone; the feather only sets how much of the old picture is kept near the edge (0 = fully healed, no seam; 100 = the outer half of the radius fades). The auto donor is now the lowest-detail of 16 areas 2.4 and 3.4 radii away, by detail variation and tone. Host-checked on the RAF with 0/40/80 feathers (auto and chosen source, a 26-disk stroke over a bump); not run in the app (no WASM build in the cloud session).

**RawBoy Camera (Android, iOS): the Level line moves smoothly (2026-11-12)**

- The level line no longer jumps in whole degrees. The phone's angle is low-passed (about 0.2 s, averaged as a direction so 359 to 1 degrees doesn't swing through 180), a hair either side of straight (under 0.4 degrees) reads as straight, and the line turns with a critically damped spring while its colour fades to yellow over 150 ms. Yellow is entered within 1 degree and left only past 1.5, so it doesn't flicker on the edge; the line fades out when the phone lies flat. Android reads the orientation sensor at the UI rate (about 60 ms) for this. Not built or run here (no Android SDK or Xcode in the cloud session).

**RawBoy Web, Pro: healing brush (2026-11-12)**

- New **Heal** button in the top bar: click or tap a dust spot, blemish or small object and it is healed away. Each spot is a circle with a **Size** and a **Feather**; the tone inside is filled in from around it and the texture comes from the cleanest nearby area (**Auto source**) or from a dashed circle you drag onto an area of the same kind (**Choose source**). Drag a circle to move it (its source goes along), Delete removes it, `[` `]` change the size, up to 64 spots a photo. It reuses Blemish removal's engine: the spots heal the full-resolution image (`healStroke` in `blemish.cpp`, `healBlemishes` in the WASM bridge now takes the brush's spots too), so preview, 100% view and export agree, and they are in Undo/Redo, edits sidecars and Auto's RawBoy edits export. Spots reset per photo and aren't in presets; Auto's 512 px grid thumbnails don't show them. Help, `docs/rawboy.md` and tests (`healspots.test.ts`) updated. The WASM build wasn't available in the cloud session: the C++ is host-tested (ASan/UBSan, `healStroke` on a synthetic image) and the overlay and panel were driven in headless Chrome on a stub, but the full path in the app needs a `npm run wasm` build and a try on real photos.

**RawBoy Web, Auto: Export all shows elapsed time and time left (2026-11-12)**

- The progress bar under the toolbar now has a line below it: "1:05 elapsed · about 2:30 left". The estimate comes from the time spent so far, counting the photo being exported by its progress, and appears once the first photo is done (or a tenth of the work). It is left out while Stop is pending. Single-photo exports from the photo view show the elapsed time too. Not run in a browser here (typecheck only).

**RawBoy Camera (Android, iOS): Settings regrouped, one line per setting (2026-11-12)**

- Settings is now in groups: **Photo** (JPEG quality, Look strength, Smaller photos, 50 MP, Keep raw, HDR gain map), **Capture** (Merge 8 frames, Shutter sound, Geotag, Track subject, QR codes), **Video** (Android), **Viewfinder** (Zoom buttons, Grid, Level, Histogram), **Opening the camera** and **Experimental**. The two sliders take one row each (double-tap resets), the long descriptions are cut to one line, the Merge choice is a segmented control, and the whole row toggles, not just the switch. The Experimental switch now reads "Self-timer and long exposure"; its Average / Lighten choice appears below it. No setting was added, removed or renamed in behaviour. Android: Brightness and Warmth now have a value area as wide as their label, so the slider's centre (the zero mark) sits at the middle of the screen. Not checked on a device yet.

**RawBoy Camera (Android, iOS): Strength moved to Settings; video settings are no longer orange (2026-11-12)**

- The **Strength** slider left the main screen (and its **S** chip in landscape); it is now **Settings › Look strength**, with the same 0-100 range and default. Brightness and Warmth stay under the look menu. The value is still remembered and used by the viewfinder and the shots. Help and `docs/camera.md` updated.
- Android: **Flat video for grading** and **Optical video stabilization** are drawn like any other setting; only **Experimental features** (self-timer, long exposure) stays orange. iOS has no video settings or orange entries. Not built here (no Android SDK or Xcode in the cloud session).

**RawBoy Web, Auto: "As is" leaves JPEG, HEIC, PNG and TIFF files untouched (2026-11-12)**

- Auditing "As is" for files that aren't raws: no auto develop, no look, no auto denoise, no skin detection and no lens correction was already the case, except that a lens preset was still matched automatically by the file's EXIF lens name, adding distortion and vignette corrections to an already finished picture. Non-raw "As is" photos are no longer matched by lens; a lens preset picked by hand (per photo, selection or batch) still applies. Batch presets (e.g. grain) still apply, as documented.

**RawBoy Camera (Android): video is no longer experimental; Photo / Video switch by the shutter (2026-11-12)**

- Video mode is always available. The movie camera button left the top bar: a **PHOTO | VIDEO** pill now sits above the shutter row (swipe sideways on the shutter area for the same; in landscape the pill is in the shutter column), the way Google Camera does it. The flat video and optical stabilization settings no longer need Experimental features.
- Experimental features now cover only the self-timer and long exposure, and their buttons moved from the top bar to either side of the pill (hidden in video mode). The top bar keeps RAW, Burst, Flash, ? and Settings. iOS has no video mode and its top bar has no experimental buttons, so nothing changes there. Help and `docs/camera.md` updated. Not compiled or tried on a phone yet (no Android SDK in the cloud session).

**RawBoy Camera (Android): the Video button is a movie camera icon (2026-11-11)**

- The experimental video mode switch in the top bar was the word VIDEO; it is now a movie camera icon (Material "videocam", drawn like the other top bar icons), dimmed when off and in the accent colour when video mode is on. TalkBack still reads "Video mode". Help and `docs/camera.md` updated. Android only (iOS Camera has no video button, the web has no Video entry in the app switchers). Not built here (no Android SDK in the session).

**RawBoy Camera (Android): long exposure gathers light in dark scenes (2026-11-11)**

- A long exposure kept AE's exposure (at most 1/30 s), so a dark scene stayed dark however long it ran and Brightness could not lift it. Each frame is now exposed by hand: the preview's whole gain (time x ISO x post-raw boost) times Brightness's compensation and a lift of up to +4 EV that brings a dark scene to the key AutoTone aims for (0.06), spent as exposure time first (up to 0.5 s a frame, the ISO falls to match, so the same picture with much less noise) and then as ISO. A bright scene still uses a short frame at the lowest ISO. The Brightness slider now raises or lowers the exposure of the frames. Not built or run on a phone here; the lift (`LONG_EXPOSURE_MAX_LIFT_EV`, `LONG_EXPOSURE_KEY`) and the 0.5 s frame are first guesses to tune on the Pixel.

**RawBoy Camera (Android): self-timer and long exposure, experimental (2026-11-11)**

- Two new buttons in the top bar, shown only with Settings › Experimental features on. **Timer** (Off, 2, 5, 10 s) counts down over the viewfinder before the shot so the phone can settle on a tripod; the shutter cancels it. **Long exposure** (Off, 5, 10, 30, 60 s) shoots frames back to back with the preview's exposure and white balance locked and stacks them into one raw as they arrive: Average (smooth water, like an ND filter) or Lighten (light trails), chosen in Settings. The shutter ends it early. The stack is a running sum in native code (`engine/src/main/cpp/long_exposure.h`, `LongExposureNative`), so memory stays at one 12 MP accumulator; the host test is `tools/burst_merge/long_exposure_test.cpp` (passes). Not built or run on a phone here (no Android SDK in the session): the Kotlin, the JNI glue and the frame pacing (3 requests queued whenever fewer than 4 are in flight) need a try on the Pixel. iOS Camera not ported.

**RawBoy Auto (web): name exported files with a template (2026-11-11)**

- The export sheet (Export all, Export on a selection, the photo view's Export) has a **File name** box: a template with keywords and a counter, remembered in this browser, with a live preview of the first (and last) name and a row of keywords to click. `{name}` original name, `{camera}`, `{lens}`, `{iso}`, `{look}` (look, preset or RawBoy edits), `{date}` 2026-11-11, `{time}` 14-30-05, `{year}` `{yy}` `{month}` `{day}` `{hour}` `{minute}` `{second}` (shoot date, else the file's date), and `#` for the photo's number in the export: `#` = 1, `##` = 01, `###` = 001 (a run of #s sets the width). The default `{name}-auto` gives the names of before. A keyword with no value for a photo (no lens name) is left out; characters file systems refuse (`/ \ : * ? " < > |`, control characters), trailing dots and spaces and reserved Windows names are fixed; a name already in the folder, on Google Drive or earlier in the ZIP gets `-001`, `-002` (ZIP names are compared ignoring case). Used by every web export path (folder, Google Drive, ZIP, selected photos and the single photo). Help text and `docs/auto.md` updated. Web only: Android and iOS Auto have their own export code and are unchanged. Checked by a unit test of the template and the type check; not tried in a browser here.

**RawBoy Pro (web): resize the Looks window with the mouse (2026-11-11)**

- A grip in the bottom-right corner of the Looks window lets you drag it larger or smaller (mouse only; touch devices keep the default size and nothing changes for them). The size is kept within what fits: at least two stripes wide, at most the visible part of the photo (and 2400 px wide), and still at most 8 looks a page, so a wider window shows more stripes per page up to 8. The size is remembered between sessions (browser storage); double-click the grip to go back to the default size. Help text updated. Web only. Type-checked and the existing web tests pass; not tried in a browser here.

**Auto (web): Auto denoise on "As is" photos uses the measured noise; the ISO table's luma is half of its colour (2026-11-11)**

- Photos added "As is" skipped the noise measurement, so Auto denoise on them used the ISO table, which left Color denoise following Denoise: luma equalled colour at every ISO (seen on Sony ARWs). Now "As is" photos are measured at import too (about 30 ms each), and Auto denoise gives them the same measured Denoise / Color denoise / Sharpening as the looks modes, about 1 luma to 2 colour. Raws analysed before this are measured again (the analysis cache version moved to 4). Without a measurement (JPEG/HEIC sources) the ISO table is used, and its luma is now half of its colour at every ISO (Color denoise keeps the table's value; before, colour followed luma). That table is also Pro's Auto button's fallback and Android and iOS Auto's; RawBoy Camera keeps its own (`splitLuma = false`). Checked by unit tests (web run; Kotlin and Swift tests written but not run here: no Android or Xcode toolchain in the session) and by a rough port of the noise estimator on four Sony ARWs (luma 2-6, colour 42-77 on its scale).

**RawBoy Pro, Auto, Camera (Android, iOS, web): crisper, more film-like grain (2026-11-11)**

- The Grain effect's texture is redone in the shared develop shader, so every app and platform gets it. Grains now come in three sizes (the set size plus a half and a quarter of it, the smaller ones fading out below about one full-resolution pixel), so the grain is crisper at 100% and a large Size keeps a fine grainy texture inside its clumps instead of turning into soft blotches. Like film, the grain is skewed by the tone: sparse light specks in the shadows, sparse dark specks in the highlights, even in the midtones. Two old artefacts are gone: grains one cell away were cut off (faint seams along the grain's cell lattice) and each grain cost two hashes (now one). Amount, Size, Roughness and Color keep their meaning: the grain's strength at every tone is the same as before (within 5%) and its correlation length at the default Size about the same; Roughness now adds clumps twice the size of the largest grains. Grain costs about 1.4× the GPU time it did. RawBoy Camera's small (downscaled) photos keep about 13% more of the grain than before, since the half-size grain there is a little less fine. Checked with a WebGL harness on the real shader functions against GFX 50R raws (100% crops in the project's grain-quality folder), and both full develop shaders (preview and export) compile in WebGL 2; not run in the apps here.

**RawBoy Pro (web): lens corrections from the Lensfun database (2026-11-11)**

- The Lens tab has a **Use Lensfun profile** switch: distortion, chromatic aberration and vignetting from the community Lensfun lens database, for raws with no embedded profile (Fuji, Sony, Canon, Nikon...). **Auto** matches the camera and lens from the photo's EXIF; **Pick lens** has searchable camera and lens lists (all mounts for adapted lenses); **Generic** takes a crop factor (or sensor size), focal length, aperture and lens type for a lens that is not in the database, including fisheye types (equidistant, equisolid, stereographic, orthographic) with a **Straighten fisheye** button that sets the existing Fisheye slider, and optional known distortion/vignetting terms. The profile replaces the file's embedded warp and vignette and works with the existing sliders (Distortion, Fisheye, Crop, Vignetting, Red/Cyan, Blue/Yellow add on top). No shader change: Lensfun's ptlens/poly3/poly5 distortion, TCA and "pa" vignetting models are re-implemented (`engine/lens/Lensfun.ts`, no Lensfun code) and fitted into the per-plane warp and radial vignette the DNG opcodes already use (within about a pixel at the corner of a 24 MP frame). **Licence/size:** Lensfun's database is CC BY-SA 3.0 (its code is LGPL and not used), so the data is a separate compact JSON conversion in `web/public/lensfun/` (made by `tools/lensfun/convert.mjs`, with its licence and attribution, also in the notices); the app bundle is unchanged: a 27 kB gzipped index is fetched when the switch is first turned on, then one calibration file for the lens (the whole converted database is 1.8 MB). Not in presets or sidecars. Checked by unit tests (matching, the models against Lensfun's formulas, the transform, the store) and screenshots of the panel; not run on a real photo in a browser here (no WebAssembly build in the session). Android and iOS do not have it yet.

**RawBoy Pro (web): D changes the frame colour (2026-11-11)**

- Press **D** to cycle the frame around the photo (grey, white, black), the same as clicking outside the photo, which still works; the choice is remembered. It does nothing while typing in a text field or with a modifier key held. Help text updated. Web only. Checked by reading the code; not type-checked or run in a browser here.

**RawBoy Pro (web): Looks window at most 8 stripes and wider; Esc puts down the active tool (2026-11-11)**

- The Looks window shows at most 8 looks a page, and each stripe is at least twice as wide as before (176 px; the window may grow to 2400 px), so big screens get fewer, larger stripes and more pages. Esc now also deselects the active tool, one per press: white picker, auto white balance rectangle, Looks, Crop & rotate, Masks, Light leaks, Light effects, Presets. It does nothing while typing in a text field or with a dialog (Export, Help, menus) open. Checked by reading the code; not type-checked or run in a browser here.

**RawBoy Pro (Android, iOS, web): Vertical and Horizontal perspective sliders in Crop & rotate (2026-11-11)**

- Crop & rotate has **Vertical** and **Horizontal** sliders (−100–100) under Straighten for keystone correction: the picture is re-projected as if the camera had been tilted by up to 30° (a lens about as wide as 36 mm on full frame, shifted so the centre stays put), so converging verticals of buildings come out parallel. Vertical below 0 widens the top (buildings shot looking up), Horizontal above 0 widens the right side. They auto-crop like Straighten (the largest same-aspect frame with no empty corners; Scale zooms in from there), act before Straighten, turn with ↺/↻ and mirror with ⇆/⇅ like the crop, reset per photo, are never in presets, and are kept in edits sidecars and Send to Auto edits. Masks, light leaks and effects stay on the content. The output-to-image map (`LensTransform.outToImage`, `uOutToImage`) becomes projective when they are set; the shader divides by its z. Checked by unit tests on web and the Kotlin engine (corners on real picture, tight crop, centre fixed, lines straightened, turns and flips exact); the web, Android and iOS UIs were not run here, and the Swift port was not compiled.

**RawBoy Pro (Android, iOS, web): the Auto button is called Auto Dev (2026-11-10)**

- Pro's top-bar **Auto** button (automatic light and colour, keeps the LUT) now reads **Auto Dev**, so it is not confused with **Send to Auto** and the Auto app; those keep their names, as does the app switcher. Help text updated. Not built or run here: the longer label's fit on a 360 dp / narrow phone toolbar is untested.

**RawBoy web (Pro, Auto, Packer, Video): warning before closing the tab mid-work (2026-11-10)**

- Closing, reloading or leaving the tab now brings up the browser's own "leave site?" confirmation while work would be lost: Pro with an export or Auto button running, or edits not yet exported (not with Edits in sidecars on, which keeps them); Auto with a batch export running or photos still being analysed; Packer while files are being packed; Video during either export. Nothing is asked when idle (the listener is only on the page while work is in progress). The browser's text can't be customised. Checked by type-check and a unit test, not in a browser here.

**RawBoy Pro (web): Portrait retouch inside a mask (2026-11-10)**

- Each mask layer has a **Portrait retouch** slider (0-100) with its other adjustments: the Reblum-style skin retouch (spots, under-eyes, lines, evening) shows only inside the mask, scaled by its weight, opacity and Invert, and adds to the Detail tab's global slider. Brush it over a face, or put a radial on one, to retouch just that person. It needs a face in the photo (as the global slider); the gains map is made at the strongest value any layer or the global slider asks for and scaled for the rest. Masks in RawBoy edits sent to Auto, and Auto's batch export, carry it. Android and iOS have no Portrait retouch yet, so the slider is web only. Checked by type-check and unit tests, not in a browser here.

**RawBoy Pro (web): wheel and trackpad zoom out past the whole photo (2026-11-10)**

- The mouse wheel, a trackpad pinch (Ctrl+wheel) and touch pinch on the web now zoom out past the whole photo like the phones: it stops there once, then shrinks the photo down to a quarter, centred, so masks, light leaks and effects can be dragged and reshaped beyond the picture's edges (handles were never limited to the photo). Double-click, or **Z**, from any zoom goes back to the whole photo. Auto's web photo view shares the zoom. Not tried in a browser here.

**RawBoy Pro (Android, iOS): zoom out past the whole photo (2026-11-10)**

- Pinching out past the whole photo no longer snaps back to it: it stops there once, then shrinks the photo down to a quarter, centred, so masks, light leaks and effects can be dragged and reshaped beyond the picture's edges. A double-tap from any zoom (in or out) goes back to the whole photo. Not built or run here (no Android or Xcode tooling in the session).

**RawBoy Pro (Android, iOS, web): Fisheye finds the picture circle by itself (2026-11-10)**

- Lens › Fisheye has a switch, **Find the circle automatically** (on by default). On a circular fisheye (Sony 4 mm class, Fuji ~4 mm on a crop body) the circle's size and centre are found on the 512 px copy: the four corners must be black, the bright area round, and the ring just outside it dark, otherwise nothing is found (frame-filling fisheyes such as the 11 mm, and ordinary photos, are left alone). When a circle is found the size and centre sliders are replaced by a line saying what was found; switch it off, or when none is found, they work as before. The switch is in the Lens preset group, so Auto's lens presets use the circle found in each photo. Checked on six of the owner's samples on the web (`FisheyeCircle.ts`, `FisheyeCircle.kt/.swift` are ports of it); the Android and iOS code was not built or run here. Auto's web analysis cache does not keep the circle, it is found again on load.

**RawBoy Pro (Android, iOS, web): Fisheye is on the phones, and its settings are hidden like Grain's (2026-11-10)**

- The auto crop of a straightened fisheye now stops where the picture would be stretched more than 4× along the radius (stretch = 1 + (t·r/fe)², all platforms): beyond that a source pixel is smeared over a strip of blocks and colour fringes with no real detail. Crop below 0 still shows those edges. Picked by the owner from a mock-up of six options (cap at 60°, stretch crop, cubic sampling, chroma fade); cubic sampling and the fade were not done.
- Lens › **Fisheye** (the slider that straightens a fisheye lens) is now in RawBoy on Android and iPhone, with the same maths and defaults as the web (`LensTransform.kt/.swift` mirror `LensTransform.ts`, the shared `lensPre` shader gets the uniforms). Tapping its name opens **Lens field of view**, **Image circle size** and **Circle centre X / Y** under it, as Grain opens Size, Roughness and Color; they open by themselves while any of them is changed. The web's panel works the same way now. Fisheye is in the Lens preset group on all platforms, so Auto applies it with a lens preset. Not built or run here (no Android or Xcode tooling in the session): see the PR.

**RawBoy Pro (web): Straighten fisheye, a fisheye mode in the Lens tab (2026-11-10)**

- A new **Straighten fisheye** slider (0-100) in Lens › Fisheye turns an equidistant fisheye picture towards a rectilinear one: the output radius is `fe * tan(t * angle) / t`, so 0 is untouched and larger values straighten more, down to the 75 degree mark of the lens's view (a 180 degree rectilinear picture would be infinitely wide). Once it is above 0, **Lens field of view** (90-220 degrees, default 180), **Image circle size** and **Circle centre X / Y** describe the lens: a frame-filling fisheye (Sony 11 mm class) needs none of them, a circular fisheye (4 mm class) needs the circle's size and centre, and the auto crop then stays inside the circle. It stacks with Distortion and the profile, auto-crops to real picture like them (Crop below 0 shows more), and is in the Lens preset group.
- `LensTransform.ts` and `shaders/develop.glsl` (`lensPre`). The shader's new uniforms are 0 when unbound, so Android and iOS render as before; they have no slider yet. Tested with unit tests and a numpy prototype on the owner's fisheye samples; see the PR.

**RawBoy Video (web): export quality and format, and a full-size frame view (2026-11-10)**

- The export panel has **Quality** (Compact, Optimal, High quality; Optimal is the default, High quality is what the export always used) and **Format** (H.264 or HEVC). The format list only enables what this browser can encode at the clip's size; if the picked one is not available at export time, the other is used and the status line says so. The real-time export uses the same two choices through MediaRecorder when it supports them. A **Full size** button under the preview opens the current graded frame at the clip's own resolution, fit to the screen or 1:1 with scrolling. Checked in headless Chromium (H.264 only there): the three qualities gave 0.2 / 0.7 / 1.3 MB on a 2 s 720p test clip, and the viewer's fit and 1:1 sizes. HEVC encoding and the real-time export were not run.

**RawBoy Pro (Android and iOS): light effects, "lomo" lightning, sparks, trails and swirls (2026-11-10)**

- The web's light effects (lightning, sparks, trails, swirls) are in RawBoy on Android and iPhone. The top bar's old **Leaks** button is now **Light**: its panel has a **Light leaks / Effects** switch (the bar has no room for another tool). Effects work as on the web: **+ Lightning**, **+ Sparks**, **+ Trails**, **+ Swirl** add a new random one (up to 4), starting as a box 1.75 times the photo with the denser patterns, dragged, sized and turned on the photo; the same sliders (Intensity, Branches/Sparks/Strands, Size, Stretch, Rotation, Thickness, Glow, Colour, Colour mix) and **New random**.
- Same patterns on every platform: the generators are ports of the web's (mulberry32 from the seed, the same random calls in the same order) and `LightEffectsTest.kt` / `LightEffectsTests.swift` check them against numbers printed by the web's `generateFx` for the same seeds (the seed is a Double, a Float would pick another pattern). The shader is the web's `shaders/light_fx.glsl` in every Android and iOS build (it only runs when an effect is on); the segment data is an RGBA32F texture on unit 15 (Metal: `uFx`).
- Effects are in `DevelopParams.fx`, in the edits JSON as `fx` (same format as the web's, so Android's Send to Auto keeps them), reset for each new photo and in no preset. iOS has no edits file yet. Not tested on a device or emulator; see the PR.

**RawBoy Pro (web): light effects start 1.75 times the photo and are denser (2026-11-09)**

- A new effect now starts as a box 1.75 times the size of the photo, centred on it, so most of the effect sits outside the frame and only a part of it overlaps the picture, like the lightning in the references. Size and Stretch reset to that size by double-tap. The patterns have more detail to match (bolts with one more level of kinks, three times the sparks, twice the points on trails and swirls; up to 1280 segments an effect), so the visible part stays sharp and busy at 12 MP exports as at 100%.

**RawBoy Pro: a covering light leak is whiter and covers only its middle (2026-11-09)**

- The owner wanted Cover "closer to the centre, far from the borders, and more whitish". Cover now replaces the photo only from the leak's centre to about halfway to its outline (fading out well inside it, so the leak's edge is light and colour over the photo, not a flat patch), the wash under the light is a warm cream instead of a dim orange, and the middle of a covering leak burns whiter. A leak hides a little less area than before at the same size: make it a bit larger than what it covers. Code: `shaders/light_leak.glsl` (all platforms). Checked on two photos with a standalone page around the shader; not on a phone.

**RawBoy Auto (web): an Unedited filter in the grid (2026-11-09)**

- A new **Unedited** toggle beside the grid's filters keeps only photos that are still "As is": added with Import as "As is" (no auto develop), the Natural look, and no preset, lens preset, RawBoy edits, Auto denoise or adjustment slider. These are the same fields Auto keeps in the XMP sidecar, so a photo restored from a sidecar with settings counts as edited. Photos added in a look mode always have the auto develop and are never unedited. Combines with the other filters; Clear filter resets it. Web only (Auto's Android app has no grid filters). Web test added; not looked at in a browser.

**RawBoy Pro (web): a Luma contrast slider that leaves colour alone (2026-11-09)**

- New **Luma contrast** (-100..+100) under Contrast in Pro's Light tab (part of the Light preset group). Contrast slopes each of R, G and B in AgX's log space, which scales the channel ratios, so colour saturation followed it (measured on three RAFs in a numpy copy of the path: chroma about 0.66x at -100 and 1.3x at +100). Luma contrast is the same log slope (same 0.7-stop range) on luminance only, `c *= pow(Y / 0.18, slope - 1)` after Saturation and before the tone mapper, so channel ratios, and saturation, hold (within about 5% at +-50). The existing Contrast is unchanged, so saved edits render as before. `uLumaContrast` is in the shared `develop.glsl` as an exponent with 0 neutral, so Android and iOS ignore it until their params and sliders are added; not built there. **RawBoy Auto (web)** has it too: **Luma contrast** (-50..50) on the Adjust tab, kept in sidecars (older sidecars read as 0), copied by Apply to all and Copy previous. The Adjust sliders are now one per row, in the order Brightness, Contrast, Luma contrast, (Pick white balance), Warmth, Tint, Saturation, Grain, Denoise, Retouch, instead of Brightness/Contrast and Warmth/Tint side by side. Checked with `tsc` and the web tests; not looked at in a browser. Research: project files `saturation-contrast/`.

**RawBoy Pro (web, Android, iOS): Save preset starts with Detail unticked (2026-11-09)**

- The Save preset dialog no longer ticks Detail (grain, bloom, flare, local contrast) first, only Lens, Masks and Denoise stay unticked as before; tick it to include it. Not built here (no Android or iOS toolchain); web test added.

**All apps: a "Support me on Ko-fi" link (2026-11-09)**

- A plain link to https://ko-fi.com/U7U011XOE in the help sheet of RawBoy Web (Pro, Auto, Browser and Packer), Android (Pro, Auto and Camera, in the shared `HelpSheet`) and iOS (the shared `HelpView`), on the web About page, in the Readme and as `.github/FUNDING.yml` (GitHub's Sponsor button). Deliberately not Ko-fi's `Widget_2.js`: it would load third-party script into a site that promises nothing leaves the device. Not built or run here (no Android/iOS toolchain, web dependencies not installed); the Play listing is unchanged and Play's donation policy is unchecked.

**RawBoy Pro (web): light effects cover the whole photo and stay crisp on big photos (2026-11-09)**

- New effects start as big as the photo (the box covers the whole frame, any aspect; Size and Stretch reset to that), and switching an effect's kind keeps its place, size and angle. On a 50 MP photo the owner saw blocks: the generated points of a bolt are far apart there, so its straight facets showed. Lightning and sparks now crackle in the shader: the core and glow are bent by two octaves of smooth noise in the effect's own scale (`uFxRange.w`; the wide halo stays unwarped), so the lines have fine detail at any zoom and no facets. Wide soft glows (swirls, trails) banded on dark pictures, so the light is dithered by one level. Segments beyond an effect's reach skip their glow maths, which makes the shader cheaper. Checked on a 6208 x 8280 export and four kinds at fit size in headless Chrome; not on a phone.

**RawBoy web, Pro and Auto: Portrait retouch, a natural skin retouch modelled on Reblum (2026-11-09)**

- New **Portrait retouch** slider (0–100) in Pro's Detail tab, and **Retouch** on Auto's Adjust tab (copied by Apply to all and Copy previous, kept in Auto sidecars, so a whole series can be retouched in one batch export). Modelled on what Reblum's Natural preset does at 40, measured on the owner's 13 before/after pairs: **40 is about Reblum Natural 40**; higher retouches more and catches fainter flaws, lower less. On all skin (face and body), sized by the face width: spots and small dark or red marks healed to their surroundings in brightness and colour (light bumps half), dark shading under the eyes lifted part-way, dark lines in the frown, forehead, nasolabial and marionette areas softened, and a light evening of mid-scale unevenness away from the skin's outline. Pores and grain are never touched; moles, tattoo ink, eyes, brows, lips and nostrils are kept. No eyes or teeth work, nothing leaves the computer.
- How: `engine/retouch/PortraitRetouch.ts` (port of the Python prototype in the project's retouch folder, tuned parameters at 40) works out a map of per-channel gains from the session preview (only the skin's bounding box, faces over 600 px on a downscaled copy) in `worker/retouch.worker.ts`; the map rides in the skin texture (unit 6, RGBA16F: r = skin mask, gba = log2 gains) and the shader multiplies it in before Skin retouch (`uSkinFix`, 0 = off, so Android and iOS are unchanged). While the slider moves the last map is scaled; the new one follows ~250 ms after it rests. Export (Pro) and batch export (Auto) make the map for the exported strength. `SkinSegmenter` now keeps the face-skin confidence and the face landmarks in `SkinMask` (`face`, `faces`); Auto's analysis cache version is 3, so photos are analysed again once. Presets: Retouch group. Web only so far.
- Checked: unit tests (`portraitretouch.test.ts`); on two of the owner's pairs at 3000 px the app's change correlates 0.92 with the prototype's (about 1.2x its strength at 40); the develop shader compiles and links in headless Chromium (preview and export variants). Speed in Node: 2.6–3 s for a headshot at 3000 px (face downscaled), ~7 s for a large skin area at 6.7 MP; at the app's 2048 px preview about half that. Not run in the full app (no WASM build here), so not seen on screen yet.

**RawBoy Pro (web): lomo light effects: lightning, sparks, light trails and neon swirls (2026-11-09)**

- New **Effects** button in Pro's top bar (a lightning bolt icon), next to Leaks and built like it: **+ Lightning**, **+ Sparks**, **+ Trails** and **+ Swirl** each add a new random effect (up to 4), dragged, sized, stretched and turned on the photo like a leak; **New random** redraws the selected one with the same settings. Sliders: Intensity, Branches/Sparks/Strands, Size, Stretch, Rotation, Thickness, Glow, Colour, Colour mix. Each effect is a seeded pattern of glowing line segments (`LightEffects.ts`: midpoint-displacement bolts with forks, spark clusters, wobbling trails, spirals) drawn analytically by `shaders/light_fx.glsl` after the leaks: a white-hot core, a coloured glow and a wide halo (Gaussian line integrals with erf, so polylines glow evenly), exposed into the picture per channel with the grain laid back over it, sharp at any export size (lightning gets extra kinks within each segment). Segments go to the shader in an RGBA32F data texture (unit 15) of 16-segment chunks with bounding boxes, so pixels far from a chunk skip it; dragging changes only uniforms. Effects are per photo like leaks: in the edits sidecars (`fx`), not in presets, reset for a new photo. Web only: Android and iOS ignore `fx` (their shader assembly doesn't include the file). New tests `lighteffects.test.ts`. Checked in headless Chrome (software GL) on a night photo: preview and a full-size JPEG export match (means within 0.2 levels); not on a phone, so its speed on a phone GPU is unmeasured.

**RawBoy Pro (web; Android and iOS in part): light leaks look like real film leaks and can hide what they cover (2026-11-09)**

- The owner found the leaks "too perfect" to pass for real ones; in Affinity they warp and shape a leak by hand. Leaks now have **Texture**: the light is exposed into the picture like light on film, so it burns white in the middle, yellow and orange around it and red at the edge, mottled, streaked along its length, its colour drifting between the two hues. **Warp** now gives an organic outline (noise pushes it around and grows lumps) instead of a sine wobble, and only ever grows the leak. **Cover** replaces the photo inside the outline with a dim wash of the leak's colours under the light, so nothing shows through however the texture falls (the tool's main job: covering nudity for social media). On the web a glow has 8 hollow dots on its outline to drag it into any shape around the area it should hide (**Round outline** resets it). New leaks start with Warp 35, Texture 70 and Cover 100; leaks saved before keep their clean look (Texture and Cover 0). **New warp** is now **New pattern**. Android and iOS get the Texture and Cover sliders and render reshaped glows from web edits, but can't reshape one yet. Code: `shaders/light_leak.glsl` (`uLeakLook`, `uLeakRadii`), `LightLeaks.ts/.kt/.swift`, web `MaskOverlay.tsx` (`outline` handle), `LeaksPanel`. Unit tests pass; checked in headless Chrome (software GL, stand-in decoder) and on two real photos with a standalone page around the shader; not on a phone, and Android and iOS weren't built here.

**RawBoy web: the Browser app is hidden on phones (2026-11-09)**

- The app switcher no longer lists Browser on phones (width up to 560 px, or a landscape phone up to 480 px tall); tablets and desktops, including a phone's "desktop site" mode, keep all three. A phone that had Browser saved as its last app, or is turned from a wide window to a narrow one while Browser is open, shows Auto instead (the Browser page and its folder stay loaded). Code: `PHONE_SCREEN` in `useMediaQuery.ts`, `AppSwitcher`, `App`. Type-checked and unit tests pass; not checked on a real phone.

**RawBoy web, Pro: the look selector drags smoothly on phones and tablets (2026-11-08)**

- Each look of the shown page is developed once, whole, at 640 px (and kept while the edit stays the same, so turning back to a page is instant); moving the window only copies pixels out of those, with no GPU readback or LUT upload per move. Once the window rests for 150 ms its stripes are developed at full resolution for that spot. The owner found the first version "super slow" on the phone and tablet. On software GL in headless Chrome the same 30-step drag went from 2.0-3.0 s with frames up to 217 ms to 0.5-0.6 s with none over 17 ms; not measured on a real phone or tablet. Costs memory: up to about 37 thumbnails of 640 x 480 (~45 MB) per photo and edit.

**RawBoy web, Pro: the look selector can be dragged past the photo's edges (2026-11-08)**

- The Looks window can hang over the photo's edges and off the preview (96 px of it stays in view; its bar stays at the top, with its buttons and labels sliding back into view), so any stripe can sit over any spot, including the corners. Only the part over the photo is developed; the rest of the window stays empty.

**RawBoy web, Auto: a partial preset layered on another keeps all the other's values (2026-11-08)**

- `layerPreset` (a partial preset applied over a photo's or the batch's preset) used to drop every field of the new preset's groups from the old one, even fields the new preset didn't hold (a preset file may leave some out), so those fell back to the auto develop. Now only the fields the new preset actually holds replace the old values. New test `presetstack.test.ts` applies several partial presets in a row and checks the untouched fields.

**RawBoy web, Pro: Looks, a look selector prototype (2026-11-08)**

- New **Looks** button in Pro's top bar. Click it, then click the photo: the area there is shown through every look at once as vertical stripes of one continuous picture, each labelled: No LUT, the bundled and Your LUTs, then the film stocks (marked FILM). Click a stripe to use it: a LUT turns Film off and sets the LUT, a stock turns Film on (full strength if it was off), either as one undo step. Drag the window (its bar or the stripes) and the stripes follow the area under it, developed at 35% size while it moves and in full once it rests. Stripes are at least 88 px wide; looks that don't fit go on pages (‹ ›, arrow keys); Esc or ✕ closes. Code: `ui/pro/LookSelector.tsx`; each stripe is the shared off-screen developer's `renderPreviewRegion` (one preview upload per redraw) with the LUT or stock swapped, so it is the fit view's own shader and parameters. It samples the downscaled preview, not the 100% tile. Checked in headless Chrome (software GL, a stand-in decoder, desktop and 390 px phone).

**RawBoy Camera (Android): flat video is exposed 1 EV higher (2026-11-08)**

- Flat video now raises the camera's exposure by +1 EV (AE compensation, real light) so the shadows keep detail, and the file keeps the lift: the picture is 1 EV brighter than the look would be. The offset is the constant `VideoRecorder.FLAT_RAISE_EV` and is in the file name, `VID_<date>_<time>-flat+1.0ev.mp4`; a converter takes it out with exposure of -1 EV before grading. Older `-flat` clips are 0 EV. Highlights clip 1 EV sooner in the viewfinder's source picture.

**RawBoy Camera (Android): lock chips no longer cover the histogram (2026-11-08)**

- AF LOCK / TRACKING and (in video mode) AE LOCK are stacked at the top left of the viewfinder, clear of the histogram at the top right. "Without look" moved to the bottom left for the same reason.

**RawBoy Camera (Android): saves back off when memory is low (2026-11-08)**

- On a phone with little free memory a save could take over a minute (once 62-70 s in the GPU develop instead of ~1 s, with ~2 GB of 16 GB free and swap nearly full). The camera now develops one shot at a time, instead of decoding the next while the last develops, when free memory is under 2.5 GB, the system reports low memory, or it asked apps to trim memory in the last minute; it also frees the GPU context when asked to trim while idle. The log (tag `RawBoyCamera`) now shows free memory before each decode, when a shot waits for memory, on trim requests, and after any develop slower than 8 s. Not compiled or run in the session (no Android SDK): on the phone, shoot a burst of shots while other apps fill memory and compare the `saved … in … ms` lines with and without.

**RawBoy Camera (Android): flat video for grading later (2026-11-08)**

- New Settings › Flat video for grading (under Experimental features, off by default). In video mode the recording skips the look: the file holds the viewfinder's linear picture, exposed as the auto develop meters it, encoded with Apple's log curve in Rec.2020 colours, tagged BT.709 so browsers leave the codes alone (the input RawBoy's film LUTs expect), with no grain, bloom or grading, HEVC at 28 Mbit/s. The viewfinder still shows the look. Files are named `VID_<date>_<time>-flat.mp4` and look washed out in any player until a look is applied. The Pixel's own HDRnet tone mapping is still in the picture (it can't be switched off), but its scene tone mapping isn't.

**RawBoy Camera (Android): Samsung photos match the viewfinder better (2026-11-08)**

- On a Galaxy S25 the viewfinder looked punchy but the saved photo was flat. Samsung's preview is its own rendering (an S-curve and more colour) and ignores the plain sRGB curve the app asks for, so the viewfinder can't undo it as it does on a Pixel, while the raw has neither. Measured on one S25 pair (Film look, same scene): shadows x0.55-0.65, highlights x1.2, midtone colour +30%. Saved photos from Samsung DNGs now get Contrast +25 and Saturation +25 on top of the look (`CameraSettings.withPhoneIspLook`; B&W keeps its grey). First estimate from a single pair: send more Samsung viewfinder/JPEG pairs to tune it. Not compiled or run in the session (no Android SDK).

**RawBoy Camera (Android): optical-only video stabilization and an exposure lock (2026-11-08)**

- Settings › Optical video stabilization (Experimental features) now uses only the lens's own stabilizer (OIS): the electronic and preview stabilization are gone, so video is no longer cropped or delayed. Plain video stabilization stays off.
- Video mode has an **AE LOCK** button (top right of the viewfinder) that holds the exposure; it is separate from the focus lock (tap the picture, **AF LOCK**), so either can be on alone. It switches off when leaving video mode.

**RawBoy Camera (Android): burst merge written into the photo's description (2026-11-07)**

- For debugging Merge 8 frames: every shot's JPEG and DNG now carry an ImageDescription such as `RawBoy merge=on frames=8/8 effective=6.43 mode=auto lowLight=1` (merged) or `RawBoy merge=off frames=1 mode=auto lowLight=0 reason=not-low-light` (single frame; reasons: mode-off, not-low-light, max-res, flash, screen-flash). Read it with `exiftool -ImageDescription`. `frames=` is how many of the requested frames arrived and were merged.

**RawBoy Camera (Android): optional video stabilization (2026-11-07)**

- New Settings › Video stabilization (shown with Experimental features, off by default). In video mode it turns on the camera's preview stabilization (Android 13+; the plain video stabilization on older phones) and the lens stabilizer, so the recorded picture is steadier; the frame is cropped a little and the viewfinder trails the camera by a few frames. Photos stay unstabilized. Tap-to-focus regions don't account for the stabilization crop (a few % off while it is on). Untested on the phone when added: check that the picture is steadier and the crop is acceptable.

**RawBoy Camera (Android): video sound no longer has holes, so Photos plays it (2026-11-07)**

- Videos stalled at once in Google Photos on the Pixel, then played choppy and sped up, while VLC and a PC played them fine (H.264 and HEVC alike, so not the codec). The cause was the sound: the audio loop took one finished AAC frame per microphone read, but a read holds several frames, so the encoder's input filled and most of the sound was dropped. A 7 s clip held 1.7 s of audio in four pieces with 1.3-1.5 s holes between them; Photos follows the audio clock and chased it with the picture. The loop now takes every finished frame each time. Checked on the clip's audio packets (1024-sample frames, timestamps jumping 1.3-1.5 s); untested on the phone when added: send the next clip if Photos still stalls.

**RawBoy: a small light next to a bright area flares again (2026-11-07)**

- The anamorphic flare's size gate reached too far: a small light by a lit ceiling or window (a lamp held next to a face, in a stairwell) was counted as part of the big bright area and got no flare. The gate now looks about 40% as far (Gaussian 2.5% of the long edge, was 4%, and the dilation 0.3 of that, was 0.8). Big lit windows and signs are still left alone. Checked on the web render path on a stairwell portrait, the night street shots and the test chart; Android and iOS carry the same constants, not built here.

**RawBoy Camera (Android): video recorded as HEVC (2026-11-07)**

- Google Photos on the Pixel 9 Pro froze for seconds while playing the app's videos (in the owner's screen recording the timer sat at 0:15 while "playing"), while the camera's own clips and the same files on a PC played fine. The frame times are clean (30 fps, no gaps) and a copy re-muxed with exact 30 fps times froze too, so the encoded H.264 High stream is the suspect. Video now records HEVC (Main, 16 Mbit/s, still 1080p30); a phone without an HEVC encoder falls back to H.264. Untested on the phone when added: if it still stalls, send the clip and the screen recording.

**RawBoy Camera (Android): video fixes from the first test clips (2026-11-07)**

- A clip on a non-Film look ran at a steady 12 fps (the film and B&W clips ran at 30): the viewfinder kept those looks' colour-denoise floor (70), whose coarse stages are many taps per pixel, drawn twice per frame (screen and encoder). Video mode now draws the viewfinder without colour denoise. This is inferred from the clips and the shader, not measured on the phone: if a look still stutters, send the `RawBoyViewfinder` logcat lines (fps, GL ms per frame) while recording.
- A phone held sideways with auto-rotate off recorded a portrait file with the picture on its side. The file's orientation now follows the phone's own rotation, as photos do.
- The sound ran 0.7-1.6 s past the last picture; it now stops with the picture.

**RawBoy: DNGs decoded by the DNG SDK open at the same brightness as LibRaw's (2026-11-07)**

- A Packer Small raw (lossy JPEG XL, decoded by the DNG SDK) opened a stop or more brighter in RawBoy and RawBoy Auto than the same photo's original or Lossless DNG (LibRaw): LibRaw normalises its white balance multipliers to the largest, the SDK path left green at 1 (a Pixel 9 Pro's blue multiplier is 2). Auto's exposure, histogram stats and highlight clip level now match. Host test `tools/dng_decode_test/run.sh`.

**RawBoy Camera (Android): optional HDR gain map in the JPEG (2026-11-07)**

- New Settings switch **HDR gain map**, off by default. On, each JPEG is an Ultra HDR JPEG: the SDR picture exactly as before, plus a gain map (MPF second image, XMP `hdrgm`, ISO 21496-1) that lets HDR screens show highlights up to 2 stops brighter. Viewers without gain map support show the plain picture; Film, B&W and LUT looks are unchanged because the SDR picture is untouched.
- The gain map comes from the finished SDR picture, not from the scene: one channel (Rec.709 luma of the display-encoded pixels), zero below 0.75, easing up to the full 2 stops at white, averaged over 4 x 4 pixels and saved as a grayscale jpegli JPEG (about 1/4 size per side). It expands the tone mapper's highlight shoulder; it does not recover detail the SDR picture lost. A picture with nothing bright enough (peak gain below 3/255) stays a plain JPEG. If building the container fails, the plain JPEG is written.
- `engine/src/main/cpp/ultrahdr.h` (container, metadata and gain map; header-only), `JpegNative.beginGainMap`, `ExportSettings.hdrGainMap`. Host test of the container: `tools/ultrahdr/run.sh` (reads it back the way `decoder_display.cpp` does: MPF offsets, XMP, ISO 21496-1 fields).
- Not yet checked on a device or in a viewer: the Android build was not run for this change (no SDK in the sandbox), only the container on the host and `jpeg_jpegli.cpp` against a stub header. Knee 0.75 and 2 stops are first guesses (`kKnee`, `kHeadroomEv`). The setting is Android only; iOS and the other apps are unchanged.

**RawBoy Camera (Android): video mode prototype (2026-11-07)**

- Hidden behind Settings › Experimental features (off by default). New VIDEO button in the top bar. In video mode the shutter (and the volume buttons) start and stop a recording: 1080p, 30 fps, H.264, stereo AAC, saved to `Movies/RawBoy Camera/VID_<date>_<time>-camera.mp4`. Pixel 9 Pro only for now; Android only.
- The file is what the viewfinder shows: the develop pass (look, Film or B&W stock, Strength, Brightness, Warmth) is drawn a second time into the encoder's input surface, cropped to 16:9 (the viewfinder is 4:3; the cut-off parts are darkened in video mode). A phone held sideways records a landscape file.
- Film grain is seeded by position only for photos, which in a video would be a frozen pattern: `uGrainFrame` (video only, 0 for photos) folds a frame counter into the grain seeds in `develop.glsl` and `film_form.glsl`.
- The live exposure eases at most 0.05 EV per update in video mode (0.3 for photos) so the recording doesn't pump. Skin retouch, the ISO-based wavelet denoise and sharpening are photo-only. The camera session is the photo one (no video stabilisation, lens or camera can't change while recording).
- Untested on a device when added; thermal and 30 fps headroom with Film on still to be measured (logcat tag `RawBoyViewfinder`, `RawBoyVideo`).

**RawBoy Camera: punchier Natural and plain LUT looks, stronger colour denoise (2026-11-07)**

- Natural and the plain LUT looks (not Film, B&W or the Experimental looks) now start with Contrast +6 and Saturation +8 on top of the auto develop. Camera only: Auto and Pro's Auto button keep their base.
- The colour-denoise floor for those looks goes from 35 to 70, which reaches the shader's coarse chroma stage: chroma mottle in a Natural shadow patch (Pixel stage DNG, σ10 chroma std) 3.95 → 2.55. 100 gave 1.34 but faded colour at edges. Experimental looks keep luma 22 / colour 70.
- Redscale's blocky shadow noise stays as it is (owner's call): it is mostly luma noise amplified by the LUT's red ramp (gain ~2.5-3.5 between input 32 and 100), so colour denoise barely helps (chroma std 5.06 → 4.33 at 100); luma floors of 40/70 cut about 20%, a gentler red ramp about 25% but darker. Android and iOS, tuned through the web develop on Pixel DNGs; not yet checked on device.

**RawBoy Camera: cleaner shadows in non-Film looks (2026-11-07)**

- Colour looks outside Film mode (LUT looks, Natural, Redscale and the other Experimental looks) had noisy shadows, Redscale with ugly blocky colour blotches: they have no film grain or scatter to hide it, and the LUT steepens the shadows (Redscale about 4x). Camera now floors the shot's denoise for them: luma 12 and colour 35, and for Experimental looks luma 22 and colour 70 (reaching the shader's coarse colour stage). Film and B&W are unchanged. Android and iOS. Values are first guesses, not yet checked on device.

**RawBoy Packer: Small raw back to Maximum compatibility no longer washed out (2026-11-07)**

- A lossy JPEG XL DNG (Small raw) packed again as Lossless came out washed out and magenta in Apple Photos and other software that ignores OpcodeList2 in a DNG 1.4 file: the lossy mosaic's non-linear encoding was kept, with the MapPolynomial that undoes it. The Packer now applies the list to the pixels, so the file holds ordinary linear raw data. Checked on the Pixel and GFX 50R Small raws; host test `tools/dng_pack_test/run.sh`.

# Changelog

**RawBoy Camera (Android): Zoom buttons can be hidden (2026-11-07)**

- New Settings switch "Zoom buttons" (on by default) hides the + / zoom / − column over the viewfinder. Pinch zoom keeps working either way. Not compiled or run (no SDK in the session).

**RawBoy Camera (Android): compact zoom control (2026-11-07)**

- The zoom control is now one narrow column in the viewfinder's bottom right corner, beside the lens buttons: + on top, the zoom in the middle (a tap jumps 1x → 2x → 5x → 10x → 1x), − below, 48 dp buttons. The separate presets row is gone. Not compiled or run (no SDK in the session).

**RawBoy Camera (Android): digital zoom up to 10x for seeing far away (2026-11-07)**

- A zoom control above the lens buttons: a large readout (tap it for 1x), 56 dp − and + buttons (a tap steps 1.25x, holding zooms smoothly) and 1x / 2x / 5x / 10x presets; pinching the viewfinder zooms too. It is a GPU crop of the centre of the camera frame in the viewfinder's first pass (`ViewfinderRenderer.zoom`), so it is smooth, works on every lens, and the live develop, histogram and QR reader see the zoomed picture. Focus taps are mapped back to the unzoomed frame, and a zoom change releases an AF lock.
- View only: photos and DNGs are still the whole frame, and the zoom is not saved between launches. Made for people with poor eyesight, so the viewfinder comes first; cropping the saved photo to match, hardware zoom for the first steps, and iOS are not done. Android code is not compiled or run (no SDK in the session): check on a Pixel 9 Pro.

**RawBoy: more cinematic anamorphic flare, Magenta coating and optional Ghosts (2026-11-07)**

- The anamorphic flare now follows the real thing more closely: each colour channel's streak reaches a different distance (white core, cyan, then blue tips), a soft bar of coating colour runs along it, and only small, very bright lights flare. Big lit windows and signs are left alone (a size gate on the blown-out area of each neighbourhood), as are bright reflections that do not clip. Streak strength falls off with the light's size.
- New **Magenta** coating beside Neutral, Blue and Golden, and an optional **Ghosts** switch (faint tall ovals mirrored through the frame centre; off by default, kept in the Detail preset group and edits).
- Builds on a flare source made once per photo from the 1536 px highlight-boosted copy (`FlareSource`, a new texture unit). Old edits and presets still load; the look of an existing flare changes (strength curve unchanged). Android, iOS and web; developed and checked on the web render path (the real shader through WebGL), **not yet built or run on Android or iOS**.

**RawBoy Auto and Pro: 25% less Film grain by default (2026-11-07)**

- Film mode's default grain is 25% lower: Auto's film looks start at 60% of the stock's grain (was 80%) and Pro's Film grain slider defaults to 75 (was 100). Android, iOS and web. Slider ranges and photos' saved edits are unchanged. RawBoy Camera keeps its film grain at 80 (its film looks no longer follow Auto's value). Not yet checked on a device.

**RawBoy Camera: Grid and Level options, off by default (2026-11-07)**

- Two new Settings switches: Grid (a 3 x 3 grid over the viewfinder) and Level (a line that turns against the phone's tilt and goes yellow within 1 degree of straight; nothing is drawn with the phone flat). Both are off by default and nothing changes for current users. Android and iOS. Not yet checked on a device.

**RawBoy Camera (Android): selfie flash with a lit frame (2026-11-07)**

- The selfie camera gets the flash button: on the shutter the screen goes to full brightness with a wide warm-white frame around the viewfinder, and the shot is taken after a short settle (450 ms) so AE sees the light. Single frame, no burst merging, no preview calibration from it.
- Android code is not compiled or run (no SDK in the session); the frame width (20% of the short side) and the settle time are first guesses to check on a Pixel 9 Pro.

**RawBoy Camera: flash exposure at zoom (2026-11-07)**

- Flash shots on the zoom (telephoto) lenses and farther subjects came out too dark while the main lens at arm's length was right. Two causes, both addressed: a lens that hasn't learned its own flash guide now starts from the default scaled by its aperture (f-number² against the main lens's f/1.7: a f/2.8 tele gets ~2.7x the gain), and beyond 1 m the exposure grows slightly faster than distance² (extra exponent 0.3: +0.3 EV at 2 m, +0.6 EV at 4 m) because the guide is learned on near subjects. Learned per-lens guides keep working (calibration divides by the same falloff). Android only; the iPhone's flash is metered by iOS. Values are first estimates, not yet checked on device; the log line `flash exposure:` shows the result.

**RawBoy Pro and Auto: Film scan 1.5× export (2026-11-07)**

- Export option **Film scan 1.5×** (Android and web; iOS not ported yet), shown only for Film mode (Pro's Film tone mapper, Auto's Film looks). Renders the photo 1.5× larger: iterative back-projection upscale plus a light luma sharpen before the grain, then the film grain at the finer pitch (print-size grain matched, `SCAN_GRAIN`). The Size setting is ignored for a scan. New pre-pass shader `shaders/scan.frag`.
- Android code is not compiled or run yet; the web build is tested in headless Chromium.

**RawBoy: bundled Film Flash look across Camera, Auto, and Pro (2026-11-06)**

- Added the "Film Flash" look across RawBoy Camera, RawBoy Auto, and RawBoy Pro, bundled as `luts/Film Flash.cube`.
- Modeled on 35mm color negative film scanned on a Noritsu HS-1800 minilab scanner under flash: pure cadmium red dye saturation (suppressing green/blue sensor leakage), warm glowing peach skin tones, and Noritsu contrast curve with smooth highlight rolloff at standard exposure.
- RawBoy Camera: available in the look dropdown under the viewfinder.
- RawBoy Auto & Pro: available in Auto's look picker and Pro's LUT selector under the Color section.
- Added reproducible generator script in `tools/film_flash_luts/generate.py`.

**RawBoy Packer: help menu and version display (2026-11-06)**

- Added the "(?)" help button to RawBoy Packer's header (and shortcut `Ctrl+/` / `⌘/`), opening the help sheet like in the other RawBoy apps.
- The help sheet covers Packer basics, formats and compatibility round-trip, queue and folder management, photo preview shortcuts, and advanced settings.
- Displays the app version (release, commit, and build time via `versionLabel()`), engine status (`LibRaw + Adobe DNG SDK`), and links to Open-source Licences, About, and Privacy.

**RawBoy Pro: fake anamorphic lens flares (2026-11-06)**

- Detail tab: added fake anamorphic lens flare slider (0–100, off by default) with Neutral, Blue, and Golden coating tint options across Android, iOS, and Web.
- Optical model scatters horizontal streaks from highlight-boosted light sources across the framed photo (remaining horizontal under rotation and straightening, and unchanged by crop).
- Continuous bilinear taps along and across the streak with per-texel knee evaluation keep the flare smooth and free of beading on specular highlights.
- The flare shines brilliantly over light sources with an intense white core instead of dimming over highlights.
- Flare threshold doubled (one EV above bloom's knee) so dimmer zones flare less; smoother needle and wing cross-profiles.
- Presets and sidecars: saved under the Detail preset group and carries over between photos.

**RawBoy Pro: horizontal lens distortion and adjustable crop (2026-11-06)**

- Lens tab (Android, iOS, web): added **Horizontal distortion** (−100–100, cylindrical horizontal distortion that bows vertical edges like an anamorphic lens while keeping horizontals straighter) and **Crop** (−100–100: 0 auto-crops empty edges as before, negative zooms out with anti-aliased black borders to keep wide field of view, positive crops tighter). Both are included in the Lens preset group, lens presets (including RawBoy Auto), and edit carry-over.
- Crop & rotate (Android, iOS, web): added **2:1** and **2.39:1** cinema aspect ratios (and **1:2** / **1:2.39** in Portrait).

**RawBoy Pro: Scale slider in crop mode that preserves resolution (2026-11-06)**

- Crop & rotate (Android, iOS, web): added a **Scale** slider (100%–200%, default 100%) that zooms the image within the full frame, allowing re-framing while preserving the full pixel dimensions of the exported image.

**RawBoy Pro: batch-select presets to delete or export (2026-11-06)**

- Presets panel (Android, iOS, web): added **Select** (and long-press on Android/iOS) to enter multi-select mode, select or deselect all presets, and batch-delete or export the selected presets at once.

**RawBoy Pro (web): Auto WB with draggable rectangle and reset WB button (2026-11-06)**

- Color tab: added the "Auto WB" button next to "Pick white balance" on the web, displaying a draggable, extendable rectangle over the preview to solve white balance from the selected area.
- Added the "Reset WB" button on the web to revert temperature and tint back to as-shot defaults.

**RawBoy Auto (web): filter grid by ISO range (2026-11-06)**

- Filter bar now features "Min ISO" and "Max ISO" dropdowns instead of a single ISO selector, allowing filtering by any range of ISOs (e.g. ISO 400 to 1600), lower bounds (ISO ≥ min), or upper bounds (ISO ≤ max).
- Selecting a minimum ISO higher than the current maximum ISO (or vice versa) automatically resets the opposing bound.

**RawBoy Auto: white balance picker on the Adjust tab (2026-11-06)**

- "Pick white balance" button on the Adjust tab (Android, iOS and web), like RawBoy Pro's eyedropper.
- Tapping or clicking a neutral grey spot in the photo sets Warmth and Tint so that spot renders grey, with messages when the sampled spot is clipped or not neutral.

**RawBoy Packer: sort by shoot date or name (2026-11-06)**

- Files in the queue are now sorted by shoot date by default (from EXIF DateTimeOriginal / DateTimeDigitized, falling back to file modification date), with an option to sort by file name (like in RawBoy Auto).
- The sort preference is remembered in the browser (localStorage) and controls the queue list order, preview navigation, and the order files are packed.

**RawBoy Packer: collapse and expand folders in the queue (2026-11-06)**

- Folders in the queue can now be collapsed and expanded individually by clicking their header.
- When collapsed, the folder header displays live packing progress (packing, done, failed) alongside the file count.
- An "Expand all" / "Collapse all" action in the files bar expands or collapses all folder groups together.

**RawBoy Pro: Auto WB with draggable rectangle and reset WB button (2026-11-06)**

- Color tab: added an "Auto WB" button next to "Pick white balance" that displays a draggable, extendable rectangle over the preview and calculates white balance from the selected area.
- Added a "Reset WB" button to quickly revert temperature and tint back to as-shot defaults.

**RawBoy Auto (web): filter grid by camera, lens, ISO and shoot date (2026-11-06)**

- Added a metadata filter bar above the Auto grid with dropdowns for Camera, Lens, ISO, and Shoot date, each displaying the count of matching photos in the batch.
- Filters work individually or combined; the grid, detail view photo navigation (arrow keys, Space, Backspace, and ‹ › buttons), and batch export show and export only the filtered photos.
- Added a "Clear filter" button to reset filters back to the full batch, and an empty state when no photos match the active filters.

**RawBoy Browser (web): force real previews instead of embedded (2026-11-05)**

- Added a "Real preview" button in the photo viewer (and an "R" keyboard shortcut) to force developing the raw photo as shot using RawBoy's engine instead of showing the camera's embedded JPEG preview.
- Added a "Real previews" toggle in the grid filter bar, remembered across sessions in browser storage.

**RawBoy: scroll film stocks with mouse wheel (2026-11-05)**

- Hovering over the Film button or the stock picker in RawBoy Pro (web) now scrolls through film stocks with the mouse wheel without clicking. A wheel already scrolling the controls panel leaves it alone.

**RawBoy Auto: apply presets in photo view (2026-11-05)**

- In the photo view, presets can now be applied directly to the opened photo alone via "Apply RawBoy preset…" in the ⋮/…/⋯ menu (or the Preset button in the top bar on desktop).
- When a preset is already active on the photo, a "Change" button allows choosing a different preset directly from the Look panel.

**RawBoy Auto: clear Saved badges on export, lower contrast while waiting (2026-11-03)**

- Starting a new export clears previous "Saved" badges on the photos being exported (or all photos for "Export all"), so progress can be followed cleanly.
- Photos waiting to be saved now have reduced contrast (0.75) in addition to desaturation and brightness dimming (Android, iOS, web), making the transition to full render visible on black-and-white photos as well.

**RawBoy Packer: folder grouping in the queue (2026-11-02)**

- Files in the queue are now grouped by folder with folder name headers, item counts, and a folder remove button.
- Folders can be added using the new "Add folder" button or by dragging and dropping folders directly onto the page.
- Packing proceeds in folder group order (by order of first appearance). Non-raw files (such as JPG, XMP, TXT and Thumbs.db) are skipped when dropping files or picking folders, with a note showing how many were skipped.

**RawBoy Packer: jump to top and persistent clear finished (2026-11-02)**

- Added a floating "Jump to top" button that appears when scrolled down, smoothly returning to the top of the page.
- The "Clear finished" button is now always visible in the actions bar, disabled when there are no finished or failed
  files to clear or while a packing run is active.

**RawBoy Packer: raw details in the file list (2026-11-02)**

- Each file in the list now shows how its raw data is stored, under the camera and lens: bit depth, compression
  (lossless or lossy compressed, uncompressed; for DNGs lossless/lossy JPEG or JPEG XL), colour filter (Bayer, X-Trans,
  linear) and megapixels, e.g. "14-bit · lossless compressed · X-Trans · 40.1 MP". DNGs show their version (DNG 1.4,
  DNG 1.7). The pixel size is in the tooltip.

**RawBoy Packer: JPEG XL DNGs back to maximum compatibility (2026-11-02)**

- Packing a JPEG XL DNG (Small raw, Lossless JPEG XL, Micro) as *Lossless* now really turns it into a classic lossless
  JPEG DNG that older software opens. Before, the Packer copied the JPEG XL data over unchanged, so the "Lossless" file
  was still JPEG XL (DNG 1.7). The pixels are bit-identical to the JPEG XL file; lossy compression stays lost and the
  file is larger (see the Packer page).

**RawBoy Packer: progress bar pinned to the bottom (2026-11-02)**

- While packing, a progress bar stays at the bottom of the screen, on desktop and phone, however far the page is
  scrolled: files packed of the run, failures, an estimate of the time left (by file size), and a Stop button. The
  page leaves room under it, so the last files and the footer still scroll clear, and it keeps clear of a phone's
  gesture bar. "Stop after these" now shows that it is stopping.

**RawBoy Packer: Fujifilm X-T5, X-Trans framing (2026-11-02)**

- Fujifilm X-T5 raws now pack: Adobe's colour matrix (the raw library is older than the camera), Lightroom's default
  sharpening and exposure as in Adobe's DNGs, and the camera's lens corrections.
- 40 MP X-Trans raws (X-T5, X-E5) are framed as the camera and Adobe frame them: the raw library placed the picture 60
  pixels to the right, so a strip on the left was lost and a black strip came in on the right. X-Trans raws (these and
  the X-T1) now keep the camera's own crop exactly (the X-T1's lost 2 rows). Checked pixel for pixel against Adobe's
  DNGs of an X-T5, X-E5 and X-T1 raw.

**RawBoy Auto (web): next and previous photo while zoomed (2026-11-02)**

- In the photo view, the ‹ › buttons now stay on screen while the photo is zoomed in, and ← / →, Space and Backspace
  change the photo while zoomed too. The next photo opens whole (fitted); double-click or pinch to zoom it again.
  Swiping stays off while zoomed, since one finger pans then.

**RawBoy Packer: pack without waiting for files to be read (2026-11-02)**

- *Pack* works as soon as files are added: it no longer waits until every file shows its camera and format. A file not
  read yet is packed when its turn comes, and its details appear once it is done. Files left over after *Stop* are read
  as usual.

**RawBoy Packer: pop-up when packing is done (2026-11-02)**

- New *When done* setting (off by default, remembered): *Pop-up* shows a message with the number of files packed, the
  sizes before and after, and any that failed or were stopped. When the tab is in the background and the browser allows
  it, a system notification says the same; the browser asks for permission when the option is turned on.

**Camera viewfinder exposure on Samsung tablets (2026-11-01)**

- RawBoy Camera's viewfinder is no longer blown out before the first photo on a lens. Some cameras (Galaxy Tab S11
  Ultra) brighten their preview about 4.4 stops more than the raw they record, without saying so, and the viewfinder
  only learned that from the first shot. Now, when a lens has no calibration yet, the app meters one raw frame
  silently right after the camera opens (about 1.5 s of bright viewfinder the very first time) and calibrates the viewfinder from it. A shot can also correct the
  calibration by up to 6 stops at once (was 4), so one photo is enough. Android.

**Small raw colour fix (2026-11-01)**

- JPEG XL DNGs (RawBoy Packer's Small raw, Adobe's JPEG XL DNGs) no longer open much paler than the same photo as an
  ordinary raw or lossless DNG. These files are read by the Adobe DNG SDK, which converted colour with the profile's
  ForwardMatrix; Adobe makes that matrix together with the profile's hue/saturation tables, which RawBoy doesn't apply,
  so on its own it is about half as saturated (Sony A7 III, Adobe Standard). The SDK path now uses the ColorMatrix,
  as LibRaw does for every other raw. Phone DNGs (RawBoy Camera's own) are unchanged: their ForwardMatrix is plain.
  All apps, on Android, iPhone and the web. RawBoy Web's Auto analyses such photos again instead of showing the
  pale previews it had saved before the fix.

**Experimental: Lagoon, Violet Dust, Unseen (2026-11-01)**

- Three new colour-swap looks in the **Experimental** section, after Redscale: **Lagoon** (skin and warm tones go
  turquoise, blue sky goes amber, highlights cream), **Violet Dust** (greens go violet, blue sky mint, reds stay) and
  **Unseen** (false-colour infrared: foliage and yellows go crimson with magenta mids). All three are low-contrast
  (lifted blacks, soft whites) and deliberately uneven, with grain 20 and vignette -10 on top. In RawBoy Auto's look
  strip, RawBoy Camera's Look menu (Film off) and RawBoy's LUTs tab, on Android, iPhone and the web. The 33-point
  LUTs are generated procedurally by `tools/swap_luts/generate.py`.

**Experimental looks (2026-11-01)**

- Looks pickers have a third section, **Experimental**, between Color and Black & white, for unusual colour looks.
  Movie Green and Redscale move there. It shows in RawBoy Auto's look strip, the colour Look menu of RawBoy Camera
  (Film off) and the LUTs tab of RawBoy, on Android, iPhone and the web. Experimental looks are never suggested.

**Movie Green look (2026-11-01)**

- New colour look **Movie Green**: a strong green-teal grade with lifted, slightly cyan blacks, made by the owner in
  Affinity Photo. It sits after Green Vivid Slide 50 in Auto's looks, Camera's Look menu and Pro's LUTs tab (Color),
  on Android, iPhone and the web, with grain 20 and vignette -10 on top. The LUT was exported at 8 points per axis
  and is resampled to 33 like the other bundled LUTs (monotone cubic between the original points, which stay exact),
  so smooth gradients show softer transitions between the LUT's cells.

**RawBoy Camera: B&W filter as a menu (2026-11-01)**

- Upright in B&W mode, Filter is a menu like the Look menu above it ("● Yellow ▾"), in place of a row of chips that
  ran off the screen's edge on phones. All five filters are one tap away at any width. Sideways, the filter column is
  unchanged (Android and iPhone).

**RawBoy Camera: neutral greys, filter row hint (2026-11-01)**

- Slider tracks, the selected filter, the look menu and the Settings sheet are neutral grey instead of Material's
  faint purple, so only the amber marks a choice next to the viewfinder (Android).
- Upright in B&W mode, the filter row's edges fade while more filters lie past them: Red and Green were cut off
  or out of sight on phones with nothing to say the row scrolls (Android and iPhone).

**RawBoy Camera: TalkBack and VoiceOver in the controls (2026-11-01)**

- Android: the shutter, the sideways S, B and W (F) buttons and the tall slider now work with TalkBack. They read
  their full names and values ("Brightness, 0"), the slider moves in steps of 5 with swipes, and a Reset action does
  what the double tap does. Film and B&W read as on/off switches, and the selected lens is announced.
- Android, all three apps: the one-row sliders (Strength, Brightness, Warmth here; Pro's and Auto's too) read their
  name, and tapping a value says it resets.
- iPhone: the sideways S, B and W (F) buttons and the tall slider read their full names, with the same Reset action.

**RawBoy (web): selected option filled amber (2026-11-01)**

- The chosen tone mapper, crop ratio and curve channel now fill amber, like the options in RawBoy Auto and Packer.
  They were outlined before, which was easy to miss on a phone.

**RawBoy (web): one-line top bar on phones held sideways (2026-11-01)**

- "Send to Auto" no longer wraps onto two lines next to Export in phone landscape; it shows "To Auto" there, as on
  upright phones.

**RawBoy Browser (web): undo icon, filter bar on phones (2026-11-01)**

- Undo uses the same drawn icon as Auto and RawBoy (it was a "↶" character) and has a name for screen readers.
- On phones the filter bar's right edge fades, so it's clear the bar scrolls sideways to stars, sort and the switches.

**RawBoy Auto (web): a ⋯ menu on phones (2026-11-01)**

- In the photo view on phones (below 560 px), Apply to all, Edit in RawBoy and Remove from batch moved into a ⋯ menu
  next to Export. The top bar is one line again instead of two, the photo gets about 100 px more, and more of the file
  name shows.
- The "Double-tap for 100%" hint no longer covers the ISO badge on phones, and the empty photo view's text wraps
  without a single word on its last line.

**RawBoy Packer: phone layout and polish (2026-11-01)**

- On phones and narrow windows the files list and the Pack button now come straight after the settings; the summary
  moved below them.
- Choice buttons keep their natural width instead of a wrapped one filling a whole row.
- Hint text is easier to read (full-strength grey instead of faded), the empty file list lost its inner dashed box,
  keyboard focus shows an amber ring, and screen readers name each setting's buttons by their row ("Lens corrections").

**RawBoy Packer: Standard and Advanced settings (2026-11-01)**

- The settings open in a plain view with three choices (Smallest files, Maximum compatibility, Tiny copies for sharing);
  file type, quality, compression effort, preview and files at once moved under *Advanced settings*, where changing
  one row no longer changes the others. Files at once is chosen automatically from the cores and memory (Auto).
  Clearer names and hints, and a line saying the original files are never changed.

**RawBoy Packer: settings in the file name (2026-11-01)**

- An option (off by default) adds the format and quality to each output name, e.g. `DSC001-small-high.dng`.

**RawBoy Packer: Fujifilm X-T1 / X-E5, X-Trans, more cameras (2026-11-01)**

- Fujifilm X-T1 and X-E5 raws now work: their lens correction tables (different layouts from the GFX's) are read
  correctly, and an X-E5 (newer than the raw library's colour table) packs with Adobe's colour matrix. X-Trans raws
  now pack as Small raw and Micro (they ran out of memory) and honour the quality setting; at High an X-T1 raw is
  about 15% of its size. Unknown cameras now say why they fail instead of "DNG SDK error".
- Lightroom's default sharpening and exposure now match Adobe's DNGs for the A7C II, EOS RP, EOS 6D, X-T1 and X-E5 too.

**RawBoy Packer: raws to smaller DNGs in the browser (2026-11-01)**

- A new web page, deployed on its own: drop camera raws or DNGs and get DNGs back. Small raw (the default) keeps the
  raw data with JPEG XL compression at about a quarter to a half of the camera raw's size; Lossless keeps it bit-exact
  in classic DNG compression that every raw developer reads; Micro stores a resized, demosaiced copy. A summary under
  the settings updates with every change and says what you keep, what you lose, the expected size and which apps
  (RawBoy, Lightroom, Apple Photos, Capture One, darktable) will open the result.
- Sony and Fujifilm lens corrections stored in the raw are written into the DNG, as Adobe's converter does. Lightroom
  opens the DNGs of the GFX 50R, A7 III, NEX-3 and E-PL9 with the same default sharpening and exposure as Adobe's own.
- Files at once (1-4), location removal, preview size; originals are never changed. See docs/packer.md.

**Web: no more freezes while panning a zoomed photo (2026-11-01)**

- Profiled on a Galaxy Tab S11 Ultra: panning itself ran at 120 fps, but each time the view reached a new area of the
  full-resolution photo, uploading that area (~6 MP, 37 MB) held the GPU for 200-320 ms: 2-3 frozen frames every 1-4 s
  of dragging or pinching. New areas now upload in slices over a few frames while the last one stays on screen (the
  preview stands in where it doesn't cover the view), so the photo keeps moving.
- The "double-click for 100%" hint no longer writes to browser storage on every pan step, only once per zoom-in.

**Camera: Brightness holds in low light (2026-11-01)**

- Android: in a dim room, raising Brightness lit the viewfinder up and then let it sink back to where it was within a
  second or two. The phone was already at its longest preview exposure, so the extra exposure compensation only went
  into the camera's digital gain, which the raw never gets, yet the develop took the whole compensation back out. It
  now takes out only the part that really reached the raw, so the brightness you set stays, in the viewfinder and in
  the photo. In good light nothing changes (the compensation still lengthens the exposure for cleaner shadows).

**Web: panning a zoomed photo keeps up on large tablets (2026-11-01)**

- Dragging the photo around at 100% (or any zoom) uses the same live drawing as the sliders: if the GPU can't redraw the
  whole screen at full resolution every frame, the view is drawn lighter while it moves and sharp again as soon as it
  stops. Pinch zoom too. GPUs that keep up draw exactly as before.

**Web: sliders keep up on large tablets (2026-11-01)**

- On a big high-resolution screen (reported on a Galaxy Tab S11 Ultra) every slider step re-developed the whole photo
  at full screen resolution, several times a phone's pixels, and the frames queued up behind the GPU, so the photo
  trailed the finger further and further. The preview now waits for the GPU to finish a frame before starting the next
  (it always draws the newest slider value, never a backlog), and while a slider is moving it draws the photo at a
  lower resolution if, and only as far as, the GPU can't keep up; the full-resolution frame follows as soon as the
  slider rests (~0.16 s). Phones and desktops that keep up draw exactly as before. RawBoy and Auto tabs.

**RawBoy: the curves box has a visible frame again on phones (2026-11-01)**

- Android: the curve area's frame and grid were drawn in the theme's outline colour on its surface-variant fill, which
  are the same grey in the dark scheme, so the curve looked like it floated in a flat box. The box now uses the web's
  colours: the app's surface with a 1 dp border, and the frame and grid in the same line colour.
- iPhone: the box gets the same border, and the grid uses the matching system grey.

**RawBoy: chromatic aberration sliders, applied by RawBoy Auto too (2026-11-01)**

- Lens tab → **Chromatic aberration**: **Red/Cyan** and **Blue/Yellow** scale the red and blue planes around the image
  centre (±100 = ±0.2%, about ±6 px in the corners of a 24 MP photo) to line up colour fringes on edges. Until now the
  only CA removal was a DNG's per-plane WarpRectilinear, which most raws lack (Fuji RAF, Pixel DNGs). The sliders add to
  that profile correction and leave the auto scale alone.
- They belong to the Lens preset group, so lens presets and RawBoy edits sent to Auto carry them: RawBoy Auto applies
  them in its thumbnails, preview and export, all from the same shader. Android, iPhone and the web.

**RawBoy Camera (Android): photos taken back to back save sooner (2026-11-01)**

- Shots no longer wait in line for the whole save of the one before: the next photo's RAW is decoded and analysed
  while the previous one is developed and written as JPEG, so a run of shots should drain about a third faster
  (at most two photos are open at once; not while a burst merges or the phone is low on memory). Each photo looks
  exactly as before.
- With Keep raw and Lossy JPEG XL DNG on, the DNG is re-saved in the background and no longer holds up the next JPEG.
- JPEGs (all apps, jpegli) get their EXIF as they are written instead of a second rewrite of the finished file, and
  the camera's last-photo thumbnail no longer looks the new JPEG up by name.

**Web: the "?" sheet shows the release version, commit and build time (2026-10-31)**

- The web app always said "Version 0.1.0" (package.json's version, never bumped) in small grey text, so it didn't tell
  which release was running. It now shows e.g. "Version 1.7.0 (8f37634), built 31 Oct 2026, 21:40" on its own line
  above the decoder: the release tag (the release workflow passes it, as the APKs' versionName), the commit and the
  build time, so an installed app shows whether a new deploy has reached it. The "New version available" banner names
  the new version too. Docker builds take `--build-arg RAWBOY_VERSION=... RAWBOY_COMMIT=...`.

**RawBoy Camera: landscape layout (2026-10-31)**

- Held sideways, RawBoy Camera turns its controls to the right edge, under the right thumb: the shutter in the middle
  of the edge (front/back switch above, last photo below), one tall slider beside it, and round **S**, **B** and **W**
  buttons (Strength, Brightness, Warmth; **F**, the filter, in B&W mode, which then lists the filters beside the
  shutter) to pick what the slider changes, with the lens buttons (UW · W · T…) in a column beside them. Brightness is
  picked first. Double-tap a letter or the slider to reset it.
  The Look menu sits above them, with the Film and B&W buttons under it; RAW, Burst, Flash, ? and Settings move to a column at the left.
- The viewfinder picture, the focus ring and taps stay upright, the selfie view stays upright, and photos keep
  their orientation as before. Portrait is unchanged. Android and iPhone.

**RawBoy Film merged into RawBoy Camera (2026-10-31)**

- RawBoy Film is now RawBoy Camera's Film mode, and its separate build is gone: no `film` flavour on Android, no
  `RawBoyFilm` target on iOS, no RawBoy Film APK in releases and no RawBoy Film choice in the Google Play workflow.
  Camera builds are `:app-camera:assembleDebug` / `assembleRelease` / `bundleRelease` again.
- The Play listing `app.rawboy.camera.film` is no longer updated; installed copies keep working.

**RawBoy Camera: Film and B&W buttons side by side, RawBoy Film's icon (2026-10-31)**

- The **Film** and **B&W** buttons sit side by side left of the Look menu and each switches by itself: B&W lists only
  the black and white looks, Film on or not, and switching B&W off comes back to Film.
- **Film + B&W** is punchier than B&W alone: Contrast +20 and 1.5 times B&W's grain, on the same black and white looks.
- RawBoy Camera's app icon is now RawBoy Film's.

**RawBoy (Android, iPhone): Curves end points easier to reach (2026-10-31)**

- As on the web, the Curves box has a 14 dp/pt margin inside it, with the curve area outlined, so the end points sit
  away from the panel's edges where a finger can grab them (Android had them on the box's edge, iPhone 8 pt in).

**RawBoy Camera: black and white mode (2026-10-31)**

- RawBoy Camera gets RawBoy Film's **B&W** button left of the shutter: black and white live in the viewfinder, the
  black and white looks (Yellow Mono Soft, 400, Push, Hard, Yellow Cine Mono and Cine Mono Soft) in the Look menu,
  **Filter** in Warmth's place, three times the grain, and the DNG stays in colour.
- The colour Look menu no longer lists the black and white looks. A black and white look remembered from before
  opens in B&W mode on that look.

**RawBoy Film: grainier black and white (2026-10-31)**

- B&W mode has three times the grain it had, in the viewfinder and in the photos. Colour looks are unchanged.

**RawBoy Film: black and white mode (2026-10-31)**

- A **B&W** button left of the shutter switches RawBoy Film to black and white, live in the viewfinder. The Look menu
  then lists the black and white films from RawBoy Auto (Yellow Mono Soft, 400, Push, Hard, Yellow Cine Mono and Cine
  Mono Soft), and **Filter** takes Warmth's place: None, Yellow (the default), Orange, Red or Green, like a coloured
  filter on the lens (Red: dark skies, smooth skin; Green: darker skin, lighter leaves). Middle grey keeps its
  brightness with every filter. Each mode remembers its own look, so switching back finds the colour look again.
- The JPEG is black and white; the DNG stays in colour. Press and hold still shows the colour picture without the look.
- Engine (all ports): `DevelopParams.bwFilter`, channel gains after white balance (`BwFilter.kt/.ts/.swift`); identity by
  default, so nothing else changes.

**RawBoy Camera and Film (Android): no noisy border on merged night shots (2026-10-31)**

- Night shots merged from a burst could show a strip along the edges, about 20 pixels wide, with clearly more grain
  and colour noise than the rest of the photo, most visible with the exposure raised. The hand moves between the
  burst's frames, so some frames don't cover the edges; the merge filled those parts with the first frame's own
  noisy pixels. It now averages the frames it does have there, and the parts that still got fewer frames (the
  outermost pixels, and moving things the merge keeps from one frame) get extra noise reduction to match the rest.

**RawBoy Camera and Film: Brightness changes the exposure (2026-10-31)**

- Brightness used to brighten or darken only the develop. It now also sets the camera's exposure compensation, so a
  brighter setting takes the photo with a longer shutter or more gain (cleaner shadows) and a darker one keeps more
  highlights. The developed picture looks as bright as before at each setting. Flash shots on Android keep their
  own manual exposure.

**RawBoy Auto (Android): no blank flash when swiping between photos (2026-10-31)**

- Swiping to the next photo showed its thumbnail, then an empty dark frame for up to a second, then the photo. Each
  photo swiped to gets a new GL view, which is empty until it has built the develop shader and drawn once. The
  thumbnail now stays over the view until its first frame is on screen.

**RawBoy Camera and Film: less colour speckle in night shadows and corners (2026-10-31)**

- Low-ISO night shots (merged bursts at ISO 20-150) got no colour denoise from the ISO table, and their lifted shadows
  showed red and blue speckle, worst in the corners. Each shot now measures its own colour noise (as RawBoy Auto does,
  ~30 ms) and sets colour denoise from it; it never goes below what it was. Luma denoise is unchanged.
- Colour denoise now grows towards the corners on phone RAWs: the phone's lens shading correction brightens the corners
  up to 3.4x (and their noise with them), so the colour denoise follows that gain there. Applies to every app when
  colour denoise is on, including RawBoy's own slider on phone DNGs. Colour detail in the centre keeps the old strength.

**RawBoy Auto (web): lens blur shows in the photo view (2026-10-31)**

- Photos sent from RawBoy with a mask's *Lens blur* showed the blur in the grid and in exported files, but Auto's
  photo view dropped it once the RAW finished decoding. The photo view now redraws when the blur's source copy is
  ready, so it shows the same develop as the export.

**RawBoy Film: back in RawBoy, on Auto's film formation (2026-10-31)**

- RawBoy Film is built from this repository again (Android `app-camera` flavour `film`, iOS target `RawBoyFilm`),
  so it gets every RawBoy Camera fix at once, including the lock screen camera fix further down.
- Its looks now render exactly as RawBoy Auto's Film mode does: the same 12 stocks on spektrafilm's film and print
  LUTs, with RawBoy's own grain, halation and scatter (`shaders/film_form.glsl`). The grain and halation ported from
  spektrafilm's code are gone, so the film render can look slightly different from earlier Film versions.
- RawBoy Film now uses the same engine as the other apps: it opens JPEG XL DNGs and can save lossy JPEG XL DNGs, like
  RawBoy Camera.
- Licence: RawBoy Film is now under RawBoy's PolyForm Shield licence like the other apps, and its Settings show the
  same open-source licences (with the DNG notice). spektrafilm's LUTs stay CC BY-SA 4.0 and are credited in Settings.
  Earlier Film releases were GPLv3; their source stays in the `RawBoyFilm` repository.
- Releases attach `RawBoy-Film-<tag>.apk` with the other APKs; the "Sync RawBoy Film" workflow is gone.

**RawBoy Web and iPhone: RAW files open 2 to 3 times faster (2026-10-31)**

- Opening a photo full size (RawBoy, Auto's photo view, export) decodes the RAW on all cores: the demosaic, the
  Fujifilm compressed RAF and Canon CR3 unpacking and white balance used one core. A GFX 50R file now opens in about
  3.1 s instead of 9.2 s (4-core test machine; Sony and Pixel files about twice as fast). The developed result is
  identical, pixel for pixel.
- RawBoy Auto (web): each photo's analysis is 2.5 times faster for GFX files too, so the grid develops sooner.
- Less memory per open photo (one 300 MB copy of a 50 MP image fewer), and the hot pixel and column defect checks
  are quicker. Android already used all cores for the demosaic and unpacking; it gains the white balance and memory
  changes.

**RawBoy Camera and RawBoy Film: lock screen camera listed once (2026-10-31)**

- Choosing the *Lock screen camera* in Settings listed RawBoy Camera and RawBoy Film twice each, because an alias
  kept from an older build also answered the lock screen camera request. Each camera is now listed once, as for the
  *Unlocked camera*. If the lock screen choice was set to the old entry, Android asks once more: pick the camera and
  **Always** again.

**RawBoy and RawBoy Auto: controls beside the photo in landscape (2026-10-31)**

- Turn the phone sideways (or use a wide window or tablet) and the controls move to a panel on the right of the
  photo; upright, they sit under the photo as before. Android, iPhone and the web: RawBoy's editor (sliders, crop,
  masks, light leaks, presets) and Auto's photo view (looks and sliders). Beside the photo the panel uses the whole
  height, so more sliders show at once.
- iPhone: RawBoy and RawBoy Auto now turn with the phone (they were portrait only). RawBoy Camera stays portrait.
- Web: the layout follows the window's shape instead of its width: a phone turned sideways gets the side panel (it
  had the controls squeezed under a thin strip of photo), and a portrait tablet or tall window gets them under the
  photo. RawBoy's tool bar no longer pushes Export and ? off the edge between 560 and 900 px wide, the Masks panel's
  add buttons no longer run under Done in a narrow side panel, and Auto's Apply to all moves into the Look tab on a
  phone turned sideways, as it does upright.

**RawBoy Web: Curves end points easier to reach on phones (2026-10-31)**

- On phones (upright or sideways) and touch screens the Curves box has a margin inside its frame, so the curve's
  end points sit away from the panel's edges where a finger can grab them, rather than half outside the box. Desktop is
  unchanged.

**RawBoy Web: New version available (2026-10-31)**

- An installed web app (home-screen icon) is resumed rather than reloaded, so it could run an old build for days. It
  now checks `version.json` when it comes back to the foreground and every 30 minutes, and offers **Reload** when a
  newer build is deployed. It never reloads by itself, because that closes the open photos; **Later** hides it.

**RawBoy Web: Done always in view (2026-10-31)**

- In Crop & rotate, Masks, Light leaks and Presets the heading with **Done** (and Reset crop, the add buttons) stays
  pinned at the top of the panel while it scrolls, on phones and on desktop. Masks' Mask / Adjust tabs stick just
  under it, and the light leak add buttons keep to one row so the pinned heading stays short.

**RawBoy Camera: track the subject after a tap (2026-10-31)**

- New **Track subject after tap** setting (Android and iPhone, off by default): after a tap the focus ring follows what
  was tapped as it moves, focus and metering go with it (continuous autofocus on the moving focus square), and the
  badge reads **TRACKING ✕**. A subject hidden for a moment is held; one gone for about half a second ends the lock and
  the camera returns to autofocus. A spot too plain to follow stays an ordinary focus lock.
- Tracking follows a subject that grows or shrinks as you walk up to it or away, doesn't jump to the next thing in
  view when the subject leaves, and doesn't hop between the stripes of a repeating pattern.
- The viewfinder's brightness eases into a new metering spot instead of jumping (on tap, release and a lost subject),
  and releasing focus no longer flashes the viewfinder bright for a frame.
- Engine: `PatternTracker` (Kotlin and Swift, with unit tests) follows a patch in small greyscale frames by normalised
  cross-correlation, about 0.2 ms a frame.

**RawBoy Camera (Android): the camera no longer shows over the lock screen after locking (2026-10-31)**

- A camera opened on the unlocked phone no longer comes back over the lock screen when the phone is locked and woken
  (it showed without the passcode, with the last photo's thumbnail). Only the power button's double press on a locked
  phone opens it there.
- With the screensaver set to start while charging, locking the phone right after the lock screen camera now closes
  it, as when the screen turns off.

**RawBoy Camera (Android): small fixes (2026-10-31)**

- The frame merging button turns gray while the flash is on, since flash shots are single frames.
- RawBoy Film no longer shows the *Lossy JPEG XL DNG* switch: its build has no DNG SDK, so the switch did nothing.

**Film looks: Yellow Mono Soft (2026-10-30)**

- New black-and-white look **Yellow Mono Soft** (Auto, Camera; Android, iOS, web): the Yellow Mono negative printed on a
  soft paper grade, for gentle highlights and open shadows. It comes first among the Yellow Mono looks.

**RawBoy Camera (Android): lossy JPEG XL DNG (2026-10-30)**

- New **Lossy JPEG XL DNG** switch in Settings (under Keep raw): the kept DNG is re-saved as a DNG 1.7.1 with lossy
  JPEG XL compression (libjxl distance 0.2, visually lossless) through the Adobe DNG SDK, about a quarter of the size
  of the uncompressed DNG (25 MB to 6 MB on a 12 MP shot). The JPEG is developed from the uncompressed raw first; if the
  compression fails the uncompressed DNG stays. Orientation, shooting data and GPS are kept (host test:
  `tools/dng_jxl/run.sh`). No embedded previews: the SDK build has no libjpeg.

**RawBoy Camera (Android): fix launch from lock screen (2026-10-30)**

- Double-pressing the power button to launch the camera from the lock screen now opens reliably: re-unified the secure
  and unlocked camera intent filters on CameraActivity, removed the screen-off receiver race condition on launch, and
  ensured lock-screen display flags remain active.

**RawBoy Camera (Android): full-resolution option (2026-10-30)**

- New switch in Settings (labelled with the megapixels, e.g. **50 MP** on a Pixel 9 Pro): shoots the raw (and DNG) in
  the sensor's maximum-resolution mode on lenses that have one. Shown only on phones that offer it. One raw per shot (no
  frame merging); the viewfinder pauses while it shoots.

**Crop & rotate: smooth straighten slider (2026-10-30)**

- Crop & rotate (Android, iOS, web): the Straighten slider now rotates smoothly instead of snapping in 0.1° steps,
  giving fine sub-pixel control when aligning horizons and architectural verticals against the grid.

**RawBoy Camera: AF LOCK disable button is larger and easier to tap (2026-10-30)**

- The yellow **AF LOCK ✕** badge above the viewfinder has a larger, clearer label (14sp/subheadline semibold, more
  padding) and an expanded touch target (at least 44-48 pt/dp high), so releasing focus lock is effortless and misses
  no longer fall through to set a new focus point on the viewfinder.

**RawBoy Camera (Android): frame merging is Auto by default (2026-10-30)**

- The burst button now cycles **On → Auto → Off** (also a choice in Settings) and starts on **Auto**: 8 frames are
  merged only in low light (preview ISO × exposure time × boost ≥ 6, back to one frame below 4; `LowLight`, documented
  in `docs/camera.md` for tuning). The icon is gray when the next shot won't merge, coloured when it will, and carries a
  small "A" in Auto. The old on/off setting is not carried over.

**RawBoy Camera (Android): photos save when locking right after shooting (2026-10-30)**

- Launching the camera from the lock screen, taking one or more photos (single RAW, flash, or 8-frame burst), and
  pressing the power button right away to lock the phone back no longer loses the shot: Camera2 finishes reading the
  raw before the lock screen camera closes, and the JPEG develop runs to completion in a short foreground service
  with a wake lock.

**RawBoy Camera (Android): lock screen camera always opens ready to shoot (2026-10-30)**

- A double press on a locked phone after opening a photo from the lock screen camera (unlock, view, lock again) no
  longer hangs on a black screen: the lock screen camera now has its own task, closes when the screen turns off
  (also from the background and after unlocking), and the photo viewer, links and Wi-Fi settings open in their own
  tasks. After updating, tap **Choose** next to *Lock screen camera* in Settings once more.

**RawBoy Web: sliders work with a stylus on tablets (2026-10-30)**

- RawBoy and Auto (web): sliders now respond to a stylus (such as the S Pen on a Samsung Galaxy Tab): horizontal drags
  move the value and a double-tap resets it, while vertical swipes still scroll the panel.

**RawBoy Camera (Android): Unlocked camera row in Settings (2026-10-26)**

- Settings has an **Unlocked camera** row next to *Lock screen camera*: both show whether the power button's double
  press opens RawBoy Camera and offer **Choose** when it doesn't. Turning Pixel Camera back on clears both choices;
  the rows make them quick to set again.

**RawBoy Camera: reads QR codes (2026-10-26)**

- RawBoy Camera (Android, iOS): a QR code in the viewfinder shows a bar above the lens buttons with what it holds and
  what a tap does, as the phone's own camera: open a link (the site's name shown first), join a Wi-Fi network
  (Android 11+; the iPhone copies the password), email, call (the dialler only), message, map, or copy the text. ✕
  hides it until the code leaves the view; a locked phone asks to unlock before anything opens. Android reads a
  1280 px greyscale copy of the viewfinder about three times a second with ZXing (Apache 2.0, new dependency) on a
  background thread; iOS uses AVFoundation's QR detector. On by default; Settings → QR codes turns it off.

**RawBoy Camera (Android): lock screen camera without the passcode (2026-10-26)**

- Settings has a **Lock screen camera** row: Android keeps the locked phone's camera as a separate choice, and until
  RawBoy Camera is picked there (Choose, then Always) the power button's double press asked for the passcode first.
- Unlocking while the camera is open over the lock screen no longer closes it (it left a black screen after the
  passcode); it stays open as the ordinary camera. The screen turning off still closes it.

**RawBoy Camera (Android): opens with the power button's double press (2026-10-26)**

- RawBoy Camera can be chosen as the phone's default camera (the still-camera and secure still-camera intents), so
  the power button's double press opens it. On a locked phone it opens over the lock screen; photos from before the
  lock aren't shown, opening a new one asks to unlock, and the camera closes when it goes to the background.

**RawBoy Auto (web): several photos analysed at once, and a reopened batch develops at once (2026-10-26)**

- RawBoy Auto (web): on computers with enough cores, photos are analysed on up to 3 decoder workers at once (one per
  three cores; phones and devices reporting under 8 GB keep one). A batch of 12 photos took 28 s instead of 45 s on a
  4-core test machine with two at once; a Mac with 9 or more cores uses three.
- Each photo's analysis (its small copies, noise level and skin mask, about 3 MB) is kept in the browser across visits,
  up to about 1 GB, by file name, size and date: the same folder opened again showed all 12 developed thumbnails in
  9 s instead of 28 s, with no decoding. The photo view still decodes the RAW when you open a photo.

**RawBoy Auto (web): the grid develops about twice as fast (2026-10-26)**

- RawBoy Auto (web): each photo's analysis decodes the RAW at half size without demosaicing (a draft, enough for the
  grid's thumbnails, the look suggestions and the auto develop), and skin detection runs in its own worker while the
  next photo decodes. A batch of 12 photos (GFX 50R, Sony NEX-3, Pixel 9 Pro) went from 85 s to 40 s on a 4-core test
  machine, and the first developed thumbnail from 22 s to 11 s; a 51 MP GFX RAF decodes in 5 s instead of 15 s. The
  photo view, 100% zoom and export still decode at full resolution. The photo view's preview shown while the full
  decode runs comes from the draft, so it is a little softer for that moment.
- Auto denoise reads the same from the draft as from the full decode (within 3% on the test files): the noise
  measurement is scaled for drafts.
- RawBoy and Auto (web): skin detection no longer blocks the page while it runs.

**RawBoy Camera: more precise tap to focus (2026-10-26)**

- RawBoy Camera (Android, iOS): a tap focuses on a small square (5% of the frame's short side) inside the ring, while
  exposure is still metered on the ring's area, so a thin or small subject in front of a busy background gets the
  focus. Android: when the square finds nothing to focus on, the camera tries once more with the ring's area before
  the ring turns red. iPhone: the square needs iOS 26 (the focus rectangle of interest); face detection no longer pulls
  focus away from a tapped point while it is locked.
- Drag the focus ring to move the point: a 3× loupe above your finger shows what's under it, and the camera focuses
  there when you let go. A tap on the ring focuses at the tap, as anywhere else.

**RawBoy Web: Google Drive (2026-10-25)**

- RawBoy and RawBoy Auto (web only): **Open › From Google Drive** and **Add › From Google Drive** open photos (RAW,
  JPEG, HEIC, PNG, TIFF) from Google Drive, and the export options have **Save to: Google Drive**, which saves into a
  Drive folder you pick. RawBoy only gets access to the files you pick and the ones it saves (`drive.file`). It needs a
  Google Cloud client ID and API key built into the site; see [Google Drive](docs/google-drive.md).
- RawBoy Web: a privacy policy page (`/privacy`) and an About page (`/about`: what the app is for, how it uses Google
  Drive, no generative AI), linked from the help sheet and the start page.

**RawBoy opens JPEG, HEIC, PNG and TIFF (2026-10-25)**

- RawBoy (Android, iOS, web): Open takes JPEG, HEIC, PNG and TIFF as well as RAW, as Auto does, with the same
  lower-quality-than-RAW decoding. Android: RawBoy also shows up under "Open with" and Share for them. iPhone: picking
  a photo without a RAW version in Photos now opens its HEIC or JPEG instead of saying it has no RAW version.

**RawBoy and Auto on iPhone: pinch to zoom (2026-10-25)**

- RawBoy and RawBoy Auto (iOS): pinch the photo with two fingers to zoom from the whole photo up to 400% (it stops
  once at 100%), as on Android and the web; drag to pan, zoom out past the whole photo to go back. Between the whole
  photo and 100% the preview shows at once while the full-resolution part loads. Mask and leak handles follow the
  zoom, and two fingers on them pinch too. The frame around the photo now stays in the zoomed view.

**RawBoy on iPhone: Stripe masks (2026-10-25)**

- RawBoy (iOS): the **Stripe** mask layer from Android and the web, under Masks › + Add: a soft band shaped like the
  light leaks' Streak, for a horizon, a road, a river or a beam of light. Drag its centre to move it, the dots to set
  its length and width, the knob to turn it and the square to bend it; Feather, Bend and Taper sliders. Stripes in
  presets made on Android or the web now open on iOS too (they were skipped).

**RawBoy on iPhone: light leaks (2026-10-25)**

- RawBoy (iOS): the **Light leaks** tool from Android and the web, in the top bar (Reset all moved down next to Undo
  and Redo to make room). Up to 4 streaks, glows or triangles, made like a Photoshop light leak (a white shape with an
  orange and a red glow, in Screen mode, grain on top), dragged anywhere inside to move, resized with the dots, turned
  with the knob and bent with the square; Intensity, Width and Length or Size and Stretch, Rotation, Bend, Taper,
  Warp, Softness, Glow and Colour. They export with the photo, reset for the next one and aren't kept in presets.

**iOS catches up: colour and black & white sections, Auto denoise all, Remove from batch (2026-10-25)**

- RawBoy, Auto and Camera (iOS): look and preset pickers list black and white ones apart from the colour ones, as on
  Android and the web: RawBoy's included LUTs and Presets panel, Auto's look strip (Color and Black & white headings
  with a divider), Camera's Look menu. Auto's preset dialog lists colour presets first, then black and white ones
  marked B&W.
- RawBoy Auto (iOS): **Auto denoise all** in the grid's top row, and **Auto denoise** (dots) in the selection bar,
  give photos their own measured denoise in place of the Denoise slider, as on Android and the web.
- RawBoy Auto (iOS): **Remove from batch** in a new … menu in the photo view's top bar (with Apply to all) takes the
  open photo out of the batch and goes on to the next.
- RawBoy Auto (iOS): the frame around a photo that is still rendering stays, instead of blinking out.
- RawBoy (iOS): the file name and shot info line scrolls sideways instead of shortening the name.

**Camera on iPhone: as bright as the phone's camera, optional shutter sound (2026-10-25)**

- RawBoy Camera (iOS): the exposure fixes Android got today. The viewfinder and the photos keep the iPhone's own auto
  exposure instead of metering the raw again to Auto's darker target, and lift the frame back to a normal brightness
  (up to +2 EV) when the AE took it down to protect something bright, such as a window or a white bird. Faces still
  steer it. Flash shots keep the iPhone's flash exposure too.
- RawBoy Camera (iOS): Settings has a **Shutter sound** switch, off by default, as on Android. Where the iPhone can't
  silence it (the law in Japan and Korea, or iOS before 18) it shows on and greyed out.

**Camera: no more dark frames when something bright is in the middle (2026-10-25)**

- RawBoy Camera and RawBoy Film (Android): the Pixel's own auto exposure protects highlights, so a white pigeon or a
  window in the middle of the frame took the whole picture 1-2 EV down. The viewfinder and the photo now lift the
  frame back to a normal brightness when that happens (up to +2 EV; AgX and Highlights roll the bright part off).
  Scenes the phone already exposes normally are unchanged.

**Camera: photos and viewfinder as bright as the phone's own camera (2026-10-25)**

- RawBoy Camera and RawBoy Film (Android): ordinary scenes came out 1-2 EV darker than the Pixel's camera app, in the
  viewfinder and in the saved photos (a white wardrobe turned grey, a room with a window went nearly black). The
  phone's auto exposure had already exposed the raw, but the auto develop metered it again to the target Auto uses
  for camera raws, which sits well below a phone's, and bright windows in the metered box pulled it down further.
  Camera now keeps the phone's exposure, as Auto already does for Pixel DNGs; faces still steer it. Flash shots
  (exposed manually) are metered as before.

**Browser: choose the look when sending to Auto (2026-10-25)**

- RawBoy Browser (web): **Send to Auto** now asks what the photos get: **Looks** (a suggested colour look), **Film**
  (a suggested film stock) or **As is** (no automatic edits, no look), the same choice as Auto's Import as. The
  selection bar's Send to Auto opens the dialog too, so a hand-picked set gets the choice as well. It used to follow
  whatever Auto's Import as was set to.

**RawBoy: Stripe masks (2026-10-25)**

- RawBoy (Android, web): a new **Stripe** mask layer beside Linear, Radial and Brush: a soft band, shaped like the
  light leaks' Streak, for a horizon, a road, a river or a beam of light. Drag its centre to move it, the dots to set
  its length and width, the knob to turn it and the square to bend it; Feather, Bend and Taper sliders as the light
  leaks have. Like the gradients it can be painted on or erased from, inverted and kept in presets. Not on iOS yet
  (a stripe in edits or a preset opened there is skipped).

**RawBoy remembers its open tab (2026-10-25)**

- RawBoy (Android, web): the editor's tab (Light, Color, Detail, LUTs, Lens) stays where you left it after going to
  Auto and back, opening a photo with Edit in RawBoy, opening Presets, Masks or Crop, or restarting the app. It used
  to jump back to Light.

**Smooth halation (2026-10-25)**

- RawBoy (Film tone mapper) and Auto's Film mode (Android, iOS, web): at high Halation the glow around small lights
  showed as a checkered square, from the coarse copy of the photo it is made from. The glow is now round and smooth
  at any zoom, with the same overall strength.

**RGB primaries: wider hue and purity (2026-10-25)**

- RawBoy (Android, iOS, web): the RGB primaries hue sliders reach ±45° (were ±30°) and the purity sliders ×0.5–×2
  (were ×0.71–×1.41, now -200..200 on the same scale, so earlier edits and presets look the same). Hue stops at 45°
  because past it two primaries can be turned onto almost the same hue and the matrix blows up (entries up to ~29 at
  ±60° against ~2.3 at ±45°).

**RawBoy: select or deselect all groups when saving a preset (2026-10-25)**

- RawBoy (Android, iOS, web): the **Save preset** dialog has a **Select all** / **Deselect all** button beside
  Include, so a preset with every group, or with just one or two, takes one tap instead of ticking each box.

**Auto: half the measured luma denoise (2026-10-25)**

- RawBoy Auto and RawBoy's Auto button (Android, iOS, web): the luma Denoise Auto measures is halved again, about one
  part luma to two parts colour (a noisy Canon G9 shot: 34 → 17, colour 93). Colour denoise and sharpening are
  unchanged, and the Denoise slider keeps its range on top.

**RawBoy: light leaks rebuilt like a Photoshop light leak (2026-10-25)**

- RawBoy (Android, web): light leaks are now made the way a Photoshop or Affinity light leak is: a white shape,
  blurred, with an orange glow and a wider red glow around it, all in Screen mode. The photo shows through the glow,
  the white middle still hides what is under it at full intensity, and the grain now lies on top of the leak instead
  of stopping at it. New **Triangle** shape beside Streak and Glow, and every shape can be **bent** (a square handle on
  the photo or the Bend slider), **tapered** and **warped**. A new **Glow** slider sets how far the coloured light
  reaches. Edits saved with the earlier leaks open as plain round glows.

**Auto: gentler measured luma denoise (2026-10-25)**

- RawBoy Auto and RawBoy's Auto button (Android, iOS, web): the luma Denoise Auto measures is 10 lower (down to 0),
  so Auto's Denoise at 0 now looks like -5 did before; clean photos get no luma denoise. Colour denoise and sharpening
  are unchanged, and the Denoise slider keeps its range on top.

**Pinch to zoom on phones (2026-10-25)**

- RawBoy and Auto (Android, and the web on phones and tablets): two fingers zoom the photo smoothly around their
  middle, from the whole photo up to 400% (it stops once at 100% on the way), and pan with it; the finger left after a
  pinch keeps panning, and one finger pans as before while zoomed. Pinching out past the whole photo goes back to it.
  Close to the whole photo the view comes from the preview, further in from full-resolution tiles. The frame stays
  around the photo, mask and light-leak handles follow the zoom, and a pinch never starts press-and-hold compare. A
  second finger that lands on a mask or leak handle puts it back and pinches instead; a brush stroke just begun is
  dropped (Android already did this). Auto's swipe to the next photo ignores two-finger touches. Double-tap still
  toggles 100%. Not on iOS yet.

**Auto: Auto denoise works on "As is" photos (2026-10-25)**

- RawBoy Auto (web): photos added **As is** have no auto develop, so Auto denoise found nothing to change and their
  denoise stayed at 0 under a preset. Now it gives them the denoise, colour denoise and sharpening of the ISO table
  (they skip the noise measurement), kept with the photo (sidecar too) and undoable.

**Web: fits regular iPhones (2026-10-25)**

- RawBoy Web on phones with up to 720 px of page height (iPhone SE to 16 Pro in Safari; Plus and Max are unchanged):
  the panel under the photo had room for one slider in RawBoy and none in Auto, whose photo page ran off the bottom.
  The tool bars are slimmer (a shorter app switcher, 40 px tools), the histogram is shorter, and the photo keeps 45%
  of the height while the panel takes the rest. In Auto's photo view the Look / Adjust tabs move to the top of the
  panel, the look strip scrolls inside the Look tab (so Adjust gets the whole panel) and Apply to all moves next to
  Copy previous, so the top bar is one line.

**RawBoy Web: findable in search engines (2026-10-25)**

- RawBoy Web now has a proper title and description, a link preview card (the app icons) when the address is shared
  in chats and social media, a description of the app that search engines read, `robots.txt` and `sitemap.xml`.
  Its main address is `https://app.rawboy.link`. [Cloudflare and search engines](docs/cloudflare.md) covers the
  domain, caching and Google / Bing setup.

**New app icons (2026-10-25)**

- RawBoy, Auto, Camera and RawBoy Film (Android, iOS) and RawBoy Web: new logo, a photographer with a camera, one
  colour per app (RawBoy coral red, Auto teal, Camera yellow, Film orange). Android icons are adaptive, fit round and
  squircle masks, and follow Android 13+ themed icons. RawBoy Web gets a favicon, a home-screen icon and a web app
  manifest, so it can be installed from the browser.

**Auto: Auto denoise all (2026-10-25)**

- RawBoy Auto (Android, web): **Auto denoise all** in the grid's top row gives every photo of the batch its own
  measured denoise, colour denoise and sharpening, for when a series is finished with its presets and lens
  corrections. The Denoise slider goes back to 0 and RawBoy edits take the measured values; on the web presets also
  lose their Denoise & sharpening group (photos added "As is" use the ISO table). Looks, presets, lens corrections and the
  other settings stay; Undo in a photo takes it back. With photos selected, the selection bar's Auto denoise (dots
  icon) does it for those photos only. Not on iOS yet.

**Halation: stronger top of the slider, follows Exposure (2026-10-25)**

- RawBoy (Film tone mapper, Android, iOS, web): Halation 100 is still the stock's own glow, which is faint (as on
  real film, only light sources and blown highlights halate). Above 100 the slider now doubles the glow every 25, up
  to 16x at 200 (it was 2x), so strong red halos around lights are possible. Halation also follows Exposure
  like Bloom: only the highlights at the current exposure send light back, so a dark raw brightened with Exposure
  halates like one shot brighter, and midtones are no longer touched. Auto's film looks (Halation 100) are unchanged.

**The frame around the photo stays (2026-10-24)**

- RawBoy Auto (Android, web): switching to a photo that is still rendering kept its thumbnail but dropped the grey /
  white / black frame around it, so the frame blinked out and back. The frame now stays around the thumbnail too.
- RawBoy and Auto (Android, web): the 100% view (and the web's wheel zoom) keeps the frame along the edges, with the
  photo inside it; panning still reaches the photo's edges and corners.

**Color and black & white sections in look and preset lists (2026-10-24)**

- RawBoy, Auto and Camera (Android, web): look and preset pickers list black and white ones apart from the colour ones,
  under **Color** and **Black & white** headings: Auto's look strip (a divider between the two in the phone's row),
  Camera's Look menu, RawBoy's included LUTs, the Presets panel and Auto's preset picker. A preset counts as black and
  white with Saturation -100 or a black and white LUT at full strength. Not on iOS yet.

**Auto: Denoise favours colour noise (2026-10-24)**

- RawBoy Auto (Android, iOS, web): the Denoise adjustment used to add the same amount to luma and colour denoise.
  Raising it now clears colour noise (blotches) first and fast, and smooths luma later and gently: at +25 colour
  denoise rises by 44 and luma by 4, at +50 by 75 and 15, at +100 by 100 and 60. Lowering it takes luma denoise away
  first, colour later; -100 still turns both off. Photos with Denoise at 0 look as before.

**Camera: geotagging (2026-10-24)**

- RawBoy Camera (Android, iOS): a **Geotag** switch in Settings, off by default. On, each JPEG and DNG records where
  it was taken (GPS latitude, longitude, altitude and the fix's UTC date and time). Location access is asked for only
  when you turn it on, and the location service runs only while the camera is open.
- RawBoy, Auto and Camera (Android, iOS, web): exports keep the GPS time and date stamps too, next to the position
  and altitude they already kept.

**Auto batch-exports photos with their full RawBoy edits (2026-10-24)**

- RawBoy → Auto (Android): **Export › Send to Auto** in RawBoy hands the open photo to RawBoy Auto with every edit:
  crop, rotation and flips, mask layers with their brush strokes and Lens blur, light leaks, curves, film or LUT,
  denoise. Auto shows it as *RawBoy edits* in place of the look (with what it carries), its sliders adjust on top,
  **Use a look** drops the edits, and Export all renders them. Until now Android could only send presets, which never
  hold a photo's crop, strokes or leaks. The edits travel as the same JSON as the web's sidecar edits.
- Auto (Android, web): batch export and the grid thumbnails now render RawBoy edits' painted (brush) masks and Lens
  blur. Before, only the photo view and its single Export did: Export all dropped brush masks and lens blur (web), so
  a photo sent back from the RawBoy tab came out differently. Photos added As is (web) get the skin mask RawBoy edits'
  skin retouch and blemish removal need.

**Bloom glows from highlights only (2026-10-24)**

- RawBoy, Auto and Camera (Android, iOS, web): Bloom used to mix the whole picture with its blur, so at higher values
  midtones lost detail and shadows were veiled. Now only the highlights and the tones just below them scatter light
  (a smooth knee from 1 to 3 EV above middle grey, measured after Exposure, so it follows exposure edits); everything
  else stays as sharp as at Bloom 0 and only picks up the glow of nearby lights. Light sources glow as before.

**Masks: Lens blur (2026-10-24)**

- RawBoy (Android, web): each mask layer has a Lens blur slider, a round lens-like defocus inside the mask (radius up
  to 3% of the photo's long side). Small bright lights and highlights become clean, bright bokeh discs instead of a
  grey smear, and the sharp part beside the mask stays clean (no halo of blurred background over it). Preview, 100%
  view and export match. Not on iOS yet.

**Web: mouse wheel zooms the photo (2026-10-24)**

- RawBoy and Auto (web, desktop): the mouse wheel over the photo zooms in and out around the pointer, from the whole
  photo up to 400%, stopping once at 100% on the way; zooming out past the whole photo returns to it. Drag pans at
  any zoom, the label in the corner shows the scale, and a trackpad pinch zooms too. Double-click and Z still toggle
  100%. The wheel over sliders still moves them, and a wheel that is scrolling a panel keeps scrolling it. Touch
  screens are unchanged.

**RawBoy: light leaks (2026-10-24)**

- RawBoy (Android, web): a new **Light leaks** tool in the top bar adds film-style light (orange by default,
  magenta-red to amber) that you drag around the photo: **streaks**, straight beams across the frame with a
  white-hot middle and coloured edges, or round **glows**. Intensity, Width and Length (streak) or Size and Stretch
  (glow), Rotation, Softness and Colour. At full intensity a leak's middle hides what is under it, so it can tastefully cover part of a nude; lower,
  it is a glow laid over the picture like light on film. Up to 4 per photo; they follow crop and rotation, reset for
  the next photo and aren't saved in presets. On Android, Reset all moved next to Undo and Redo to make room.

**Web: pinching the photo no longer leaves it on the original (2026-10-24)**

- RawBoy and Auto (web, touch screens): a two-finger pinch on the photo could switch it to the as-shot render
  (Original, or Auto without its look) and leave it there until the next press and hold. A second finger now ends
  press-and-hold compare and dragging, and nothing starts again until every finger is lifted.

**Pro on phones: the shot info line scrolls sideways (2026-10-24)**

- RawBoy (Android, web on phones): the file name and shot info under the tools used to end in an ellipsis when they
  didn't fit. The line now scrolls sideways with a finger, so the whole of it can be read. Android also shows the
  full file name instead of shortening it in the middle.

**Camera: smaller photos get a light sharpening (2026-10-24)**

- RawBoy Camera (Android, iOS): with Smaller photos on (the default, 3000 px), the JPEG gets a light sharpening after
  the downscale, so it looks a little crisper. It works on brightness only (no coloured edges), and strong edges such
  as lights and window frames are capped so they don't get halos. Full-size photos are unchanged.

**Camera: only Focus-flash (2026-10-24)**

- RawBoy Camera (Android): the plain Flash mode is gone. The bolt button now turns Focus-flash on or off (the light
  comes on, the camera focuses with it, then the flash fires). If Flash was the remembered choice, it becomes
  Focus-flash.

**Camera: optional shutter sound (2026-10-24)**

- RawBoy Camera (Android): Settings has a **Shutter sound** switch, off by default, that plays the system's camera
  click on each shot. Where the law requires the sound (Japan, Korea…), Android says so
  (`MediaActionSound.mustPlayShutterSound`, or a camera that can't disable it before Android 13): the click always
  plays there and the switch shows on and greyed out.

**Auto: Export all shows its progress in the grid (2026-10-24)**

- RawBoy Auto (Android, iOS, web): while Export all runs, the photos still to be saved show in grey, and each fades
  to full colour once it's saved. The grid is no longer dimmed as a whole during an export on the web.

**Web on iPhone and iPad: exports go to Photos (2026-10-24)**

- RawBoy and Auto (web, Safari and the home-screen app on iOS/iPadOS): exports used to land in Files as downloads
  (a ZIP for Export all). When an export finishes, a sheet now offers Save to Photos, which opens the share sheet
  with every exported photo; its Save Image (Save N Images) puts them in the gallery. Safari opens the share sheet
  only from a tap, so this one extra tap is needed; Download instead keeps the old behaviour. Other browsers and
  platforms are unchanged.
**Auto: remove the open photo from the batch (2026-10-24)**

- RawBoy Auto (Android, web): the photo view can take the open photo out of the batch (the file stays) and goes on to
  the next photo, or the one before it at the batch's end; back to the grid after the last one. Web: a bin in the top
  bar, or the Delete key. Android: Remove from batch in a new ⋮ menu in the top bar, which also holds Apply to all,
  to give the file name room on phones.

**Curves take less room on phones (2026-10-24)**

- RawBoy (Android, iOS, web on phones): the Curves box is now twice as wide as tall (at most 400 dp/pt/px wide)
  instead of square, so it no longer fills the panel under the photo. On Android its 320 dp width cap never applied
  (the full width overrode it), so on a Pixel 9 Pro the box was about 410 dp tall; it is now about 190. Points still
  grab within the same finger distance in both directions. The web's side panel on wider screens keeps its square box.

**Android: dragging the crop no longer swipes back (2026-10-24)**

- RawBoy (Android): on a landscape photo the crop frame's left and right handles sit at the screen's edges, so
  dragging them fired the system back gesture. Crop & rotate now keeps the area around those handles out of the back
  gesture (the whole edge when it is short enough, else its corners and middle handle, within Android's 200 dp per
  edge limit). Swiping back elsewhere on the screen works as before.

**Blown highlights stay white when white balance changes; infrared highlights no longer go yellow (2026-10-24)**

- All apps (Android, iOS, web): blown highlights (a bulb's filament, the sun) were made neutral at the photo's as-shot
  white balance, so moving Temperature/Tint tinted them with the opposite of the change: neutralising an infrared
  photo turned them yellow-green. They now stay white under any white balance (also in mask layers), as when white
  balance is set before clipping. Unclipped pixels are unchanged.
- Highlights are blended to neutral only where the sensor actually clipped. Before, bright light was blended (LibRaw)
  or cut (JPEG XL / DNG 1.7 files through the DNG SDK) wherever one white balanced channel passed the lowest clip,
  which with infrared multipliers (blue x3.7) took the colour out of light far below clipping: a green blotch beside
  the bulb, and in compressed DNGs flat yellow highlights. Compressed and uncompressed DNGs of a shot now match.

**Web: mouse wheel moves sliders (2026-10-24)**

- RawBoy and Auto (web): as in darktable, turning the mouse wheel over a slider moves it, no click needed: 1/200 of
  its range per notch (1 on a −100…100 slider, 0.05 EV on Exposure), Shift for 10× bigger steps, Ctrl/⌘ for 10×
  finer ones. A wheel that is scrolling the panel keeps scrolling it when a slider passes under the pointer; the
  wheel takes the slider once the panel has been still for a moment. A run of wheel steps is one undo step.

**Web: shortcuts work in Ukrainian and other non-Latin layouts (2026-10-24)**

- RawBoy Web (Pro, Auto, Browser): letter shortcuts (Z zoom, Ctrl/⌘+Z undo, P / X / U flags, B / E / V mask tools,
  [ ] brush size, \\ compare, Ctrl/⌘+A select all, …) did nothing while a Ukrainian, Russian or other non-Latin
  keyboard layout was active, because the key then types a Cyrillic letter. They now go by the physical key, as in
  Lightroom. Latin layouts (AZERTY, Dvorak) keep following the letter printed on the key.

**Auto: finer film grain in Film mode (2026-10-24)**

- RawBoy Auto (Android, iOS, web): the film stocks in Film mode start with 20% less grain than before. The Grain
  slider still scales it from none (−50) to double (+50). RawBoy's own Film grain slider is unchanged.

**Auto web: C for Copy previous (2026-10-24)**

- RawBoy Auto (web): in the photo view, **C** does Copy previous (shown in the button's tooltip and the **?** help).
  It goes by key position, so it works with any keyboard layout (e.g. Ukrainian).

**Camera and Auto: JPEGs keep shutter speed, aperture, ISO and focal length (2026-10-24)**

- RawBoy Camera's JPEGs, and JPEG or TIFF exports from Auto and RawBoy (Android) of RawBoy Camera's DNGs, came out
  with only the camera make and model: no shutter speed, aperture, ISO, focal length or capture date. Android's DNG
  writer keeps these in the DNG's main tag list rather than in the EXIF section, where the metadata copy looked for
  them. Exports now read them from there too. The DNGs themselves always had them.

**Auto and Browser: photos in shoot-date order (2026-10-24)**

- RawBoy Auto (Android, iOS, web) and RawBoy Browser (web) now show photos in the order they were shot, from each
  file's EXIF capture date (DateTimeOriginal; CR3 included), read from the metadata without decoding the raw. A photo
  without one goes by its file's modified date. **Sort: Shoot date / File name** next to Auto's *Import as* (the
  Browser: a menu next to the filters) switches to file-name order (IMG_9 before IMG_10); the choice is remembered.
  Auto's photo view, Copy previous and Export all follow the grid's order.

**Denoise: no more blotchy texture on flat surfaces (2026-10-24)**

- All apps (Android, iOS, web): Luma denoise is now multi-scale. Camera noise isn't only fine grain: demosaicing
  spreads it into blobs several pixels across, and the old filter removed the fine grain but kept 83–88% of those, so
  flat walls, skies and skin turned into blotchy, mottled texture once the exposure went up (visible from about
  ISO 1000). The new denoise takes noise out at every scale up to about 60 px and leaves an even fine grain of the
  photo's own noise, so it looks like a cleaner sensor rather than plastic. Dark shadows no longer turn into dark
  dots, and colour blotches 8 px and larger go too.
- Color denoise measures colour relative to brightness: texture under strongly coloured light (stage lights) stays
  detail instead of being smoothed as colour, so a mono LUT on such a photo no longer shows the face as blotches.
- The Luma / Color denoise sliders keep their meaning; Auto's measured denoise sets them as before. Edges that
  denoised photos need from around a tile grew by 64 px, so exports read a little more of the image per tile.
- The Camera viewfinder keeps the single-pass filter (the multi-scale one would cost too much per frame); shots get
  the new denoise.

**Browser: rate a selection (2026-10-21)**

- RawBoy Browser (web): select photos in the grid (long-press or Ctrl/⌘-click, Shift-click, Ctrl/⌘+A) and rate
  them together: a stars and Pick / Reject bar shows under the grid while photos are selected, and **1–5**, **0**,
  **P**, **X** and **U** apply to the whole selection. Pressing what every selected photo already has clears it, as on
  one photo. Each photo's XMP sidecar is written as usual (or goes into Save ratings' ZIP), and one Undo takes the
  whole change back.

**Camera: RAW off by default (2026-10-20)**

- RawBoy Camera (Android, iOS): new installs save only the JPEG; tap **RAW** in the top bar (or Settings › Keep raw)
  to keep the DNG as well. A choice you already made is kept.

**iOS: Brightness and Warmth sliders move again (2026-10-20)**

- iOS apps: sliders centred on 0 (Camera's Brightness and Warmth, Auto's adjustments) didn't respond to touch on
  iOS 26. They now handle the drag themselves: drag anywhere on the row to move the value, double-tap or tap the
  number to reset. VoiceOver can still adjust them (swipe up/down).

**Bloom: round, soft and wider (2026-10-19)**

- All apps: Bloom no longer draws square halos or blocky bands around bright windows. The halo uses a round kernel
  whose weights fade to zero at the rim (square tap grids with heavy corner weights showed as squares, most visibly at
  Bloom 100). The wide tail is now scattered once on a 64 px copy when the photo opens (the Camera viewfinder does it
  on the GPU every frame) and sampled as a smooth B-spline, so its coarse texels no longer show; the develop shader
  also does fewer texture reads than before. The tail reaches about 10% of the long edge (was ~3%). The glow is dense
  next to the light and fades into a wide haze, like a mist filter, and it thickens as the slider rises: Bloom 100
  scatters 75% of the light (was 35%), about a 1/2 black mist. Low values, as the Auto looks use, change little
  (20 scatters 9%, was 7%).

**Colour denoise keeps eye colour (2026-10-19)**

- All apps: at high colour denoise (above 65) the coarse colour stages now leave small features with their own colour
  alone: they only move a pixel's colour while the change is small, as the leftover blotches in even areas are. Before,
  they averaged an iris with the skin around it, so blue-grey eyes came out brown. On DSCF1837.RAF (GFX 50R, colour
  denoise 99.6) the iris colour error drops from 33 to 7 (sqrt-domain chroma, ×1000) while the blurred legs measure as
  before.

**Auto: stop a batch export (2026-10-19)**

- RawBoy Auto (Android, iOS, web): **Export all** and Export on a selection show a **Stop** button next to the
  progress bar. It ends the export after the photo being saved; photos already saved stay where they are (on the web
  without a folder, the ZIP is still downloaded with the photos finished so far), and the rest stay in the batch to
  export later. The message then starts with *Stopped*.

**Web: Denoise & sharpening is its own preset group (2026-10-19)**

- RawBoy (web): **Save preset** has a new **Denoise & sharpening** group (Luma denoise, Color denoise, Sharpening),
  off by default; Detail keeps local contrast, high-pass, bloom and grain. RawBoy Auto (web) keeps its measured
  denoise and sharpening unless a preset holds that group, whatever else the preset holds; before, presets with Light
  never set them, even when saved with Detail. Presets saved before: Detail-only ones (e.g. a denoise preset) keep
  their denoise in the new group; ones with Light leave denoise to Auto as before (re-save them with the group ticked
  to apply theirs).

**Web Browser: Reopen in Arc (2026-10-19)**

- RawBoy Browser (web): Arc never shows its access prompt for a remembered folder, so **Reopen** waited forever and
  opening that folder again from the picker hung. In Arc, RawBoy no longer remembers the folder (no Reopen button), so
  **Open a folder** asks for access normally. In any browser, a Reopen whose access prompt isn't answered within 3
  seconds gives up with a message and forgets the folder. After this update, open your folder once with **Open a
  folder** to get the Reopen button back (Chrome, Edge).

**Web Auto: presets apply only the sections they hold (2026-10-19)**

- RawBoy Auto (web): a preset without the Light group, for example one holding only Detail, now changes just those
  settings and leaves the rest of each photo alone: its look (and Strength), its RawBoy preset (labelled e.g.
  *Scene A + Grain*) or its RawBoy edits. Before, any preset replaced the photo's look and edits, and its denoise and
  sharpening were ignored. Presets with the Light group still develop the photo in place of its look. With **Edits in
  sidecars** on, the result is saved in the photo's XMP sidecar.

**Colour denoise without the 6 px grid (2026-10-19)**

- All apps (Android, iOS, web; the shared develop shader): at high ISO the colour noise left after denoising no
  longer forms a blocky grid. The sparse denoise stages (colour 7×7 at stride 3 and 6, luma coarse 5×5 at stride 3)
  read the image on a fixed lattice of single pixels, so pixels 6 px apart averaged almost the same samples and the
  leftover colour noise repeated every 6 px (a GFX 50R export at ISO 6400 pushed in Auto: colour autocorrelation 0.54
  at 6 source px, where noise should have none). Each tap now sits at a random point of its own cell, seeded by the
  full-resolution pixel (so preview, 100% view and export tiles match), read with bilinear filtering; the centre tap
  stays on the pixel and the outermost taps stay within the old radius, so margins and strength are unchanged.
  Measured on synthetic Bayer noise through the real shader (WebGL2): at Auto's high-ISO setting the grid
  correlation at 6 px drops from 0.91 to 0.03, colour noise left 1.19 → 0.96 (0.90 → 0.54 after a 2× downscale),
  luma unchanged within 5%.
- At high colour denoise (above 65) a last, coarsest colour stage reads the 512 px base copy (7×7 texels, range
  weighted with tight luma and colour guards), for colour blotches 20–100 px across that the 18 px stage can't reach and that
  turn into blocky patches when the exposure is raised. On DSCF1837.RAF (GFX 50R, the blurred legs): colour noise at
  8–16 px 5.7 → 2.8, at 4–8 px 3.5 → 1.1. Luma is left alone (flattening it at that scale would make skin plastic).

**Auto: open a waiting photo ahead of the queue (2026-10-19)**

- RawBoy Auto (Android, iOS, web): tapping or clicking a photo that's still waiting for its analysis moves it to the
  front of the queue (its badge reads **Next**) and opens it as soon as it's analysed, unless another photo was opened
  meanwhile. Before, waiting photos did nothing when tapped. The photo being analysed finishes first (a decode can't be
  interrupted), and the opened photo's full decode goes ahead of the next analysis.

**Web Browser: Reopen checks the folder first (2026-10-19)**

- RawBoy Browser (web): **Reopen <folder>** checks the remembered folder before opening it. When the browser no longer
  grants read-write access it asks again; when access is refused, or the folder was moved, renamed or deleted, the
  folder picker opens instead (in the old folder when it still exists), or a message says to choose it with **Open a
  folder**. A folder that is gone is forgotten, so its Reopen button goes away.

**Camera: burst button in the top bar (2026-10-19)**

- RawBoy Camera (Android): a burst button (stacked frames) next to RAW turns **Merge 8 frames** on (lit) or off
  (dimmed), the same setting as the Settings switch.

**Auto: gentler automatic luma denoise (2026-10-18)**

- RawBoy Auto (Android, iOS, web) and RawBoy's Auto button pick a 20% lower **Denoise** (luma) from the measured
  noise than before (`AutoTone.LUMA_DENOISE_SCALE` 0.8; e.g. the Canon G9 at ISO 400 lifted 2 EV: 55 → 44, a clean
  Pixel shot 6 → 5, at most 80 instead of 100). Colour denoise and sharpening are unchanged, as are Camera's denoise
  and the ISO table for photos whose noise isn't measured. The Denoise adjustment still adds on top.

**Camera: merge a burst of raws (2026-10-18)**

- RawBoy Camera (Android): **Merge 8 frames** in Settings (off by default). Each shot without flash captures 8 raw
  frames (`CameraCaptureSession.captureBurst`), copies each into native memory as it arrives, then aligns and merges
  them into one Bayer frame written as the DNG (`burst_merge.cpp`, `BurstNative`, `DngCreator.writeByteBuffer`). The
  method is a simplified reimplementation of Google's HDR+ paper (Hasinoff et al. 2016): coarse-to-fine tile
  alignment on a 2×2-averaged grey copy (even raw shifts, so the Bayer pattern is kept), then a spatial merge of
  overlapping 32 px tiles weighted by how far each aligned tile differs from the first frame beyond noise, with a
  per-pixel check against ghosts. The phone's own computational photography (Night Sight, HDR+) isn't available to
  apps as raw: Camera2 extensions only return processed JPEG/YUV. Host test (`tools/burst_merge/run.sh`, synthetic
  bursts with sub-pixel shake): noise 2.5× lower in flat areas, a moving square not ghosted, clipped light kept;
  8 frames of 12 MP merge in ~1.7 s on 4 x86 cores. On the Pixel 9 Pro (two selfies, ISO 1212, 1/30 s): raw noise in
  flat green areas 4.9–22 DN → 1.5–6.9 DN (~3.2× lower at every level), the develop's denoise 51 → 16, skin, glasses
  and knit detail kept at 100% with no blotchy colour noise; all 8 frames merged (weights ~1.0); shutter to DNG
  0.3 s → 2.1 s (2–3.5 s over several shots), shutter to JPEG 3.1 s → 2.7 s. The first burst made Android close ~20
  background apps for memory, so the merge now streams: a worker thread merges each frame into running sums as soon
  as its capture result is in, then frees it, and the result is written over the reference's samples. Host benchmark
  (12 MP, a frame every 66 ms): peak memory 368 → 210 MB, wait after the last frame 2.0 → 0.4 s; same noise and
  ghosting results. On the phone (4 merged shots, all 8 of 8): no background apps closed, noise still ~3.3× lower,
  shutter to DNG 2.1–3.9 s. The frames come every 33 ms and a merge step takes 0.3–0.4 s, so 6–7 frames still wait
  at once; the native peak (~590 MB, vs ~445 MB for a single shot's develop) came from back-to-back bursts
  overlapping a develop. The shutter now waits for a burst's DNG before the next shot. Phone, with the block (6 merged
  shots, all 8 of 8, 2.1–3.1 s to DNG, no apps closed): a merged shot alone peaks at ~320 MB native, single shots
  (develop only) 455 MB, merged shots back to back 511 MB (a burst merging while the previous JPEG develops), down
  from ~590 MB; shots without merge aren't blocked.

**Grain size, roughness and colour in RawBoy (2026-10-18)**

- RawBoy (Android, iOS, web): tapping Grain's name opens Size, Roughness and Color under it (`DevelopParams.grainSize`,
  `grainRoughness`, `grainColor`; shader `uGrainRoughness`, `uGrainColor`, size through `uGrainSize`). The defaults
  render exactly as before; Amount keeps its strength across Roughness and Color (variance-normalised). In the Detail
  preset group. Auto and Camera keep the defaults.

**Auto: 5600 px export size (2026-10-18)**

- Auto (Android, iOS, web): the export size choices gain a long side of 5600 px, between the original size and 4096.

**Faster Fujifilm RAF decodes on the web and iOS (2026-10-18)**

- RawBoy Web and iOS: X-Trans raws (most Fujifilm RAFs) are demosaiced on all cores instead of one. LibRaw's X-Trans
  demosaic is ~6× slower than AHD on a Bayer raw of the same size and only runs in parallel with OpenMP, which Android
  has and the web and iOS builds don't. A 26 MP frame: 15.0 s → 4.4 s on 4 cores (x86 host build); Android unchanged.

**Web: Auto imports "As is" (2026-10-18)**

- RawBoy Web: Auto's *Import as* gains **As is**: no auto develop, no look, no noise/skin measurement
  (`analyzeFile(…, plain)`, `AutoPhoto.plain`, autoBase = the as-shot defaults), so finished files such as TIFFs import
  quickly and get only the preset applied (e.g. grain). Grid cells show the file's own preview while waiting
  (`quickImageOf`, all import modes). The TIFF reader already covers 8/16-bit RGB/grey, strips or tiles, LZW, Deflate,
  PackBits, ICC and orientation; float, planar, CMYK and JPEG-compressed TIFFs still aren't read.

**Web: Auto shows each photo's ISO (2026-10-18)**

- RawBoy Web: Auto's grid shows each photo's ISO (from its EXIF) at the end of the name line, and the photo view shows
  it in the view's bottom-left corner (also at 100%), so noise can be judged without the 100% view. Hidden when the file has none.

**Several lens presets from one photo (2026-10-18)**

- RawBoy (Android, iOS, web): a lens preset saved under another name no longer replaces the one saved for the same lens
  (`Presets.putLensPreset` matches lens and name), so one photo can save a preset per manual lens.

**Named lens presets for manual lenses (2026-10-18)**

- RawBoy (Android, iOS, web): the Lens tab's lens preset has a name field (the lens by default). Photos from manual
  lenses record no lens name; their presets are kept by name, so each manual lens can have its own
  (`Presets.putLensPreset`).
- RawBoy Auto (Android, iOS, web): pick a lens preset for every photo and those added later, or for a selection:
  By lens (as before), None, or a named one (`Presets.chosenLensPreset`, `AutoPhoto.lensChoice`). Presets without a
  lens no longer apply to every photo. Lens presets can be removed on the web too (**Manage…**).
- RawBoy Web: Auto's photo view shows and changes the photo's lens preset; a picked lens preset (or None) is kept in
  the photo's sidecar with its other Auto settings (Edits in sidecars), and comes back into the lens presets if this
  browser no longer has it.

**Web: RawBoy Browser shows JPEG XL DNG previews at full size (2026-10-18)**

- DNGs from Adobe DNG Converter with JPEG XL compression (lossy DNGs) showed blurry thumbnails and a tiny photo in
  the viewer: their only JPEG preview is a 256 px thumbnail; the real previews (1024 px and full size) are JPEG XL. The
  Browser now decodes those (libjxl, already in the DNG SDK build): the 1024 px one for the grid (~30 ms), the
  full-size one at 2560 px for the viewer (~0.3 s for 24 MP).

**Back to Auto (web, 2026-10-18)**

- RawBoy Web: **Back to Auto** / **Send to Auto** in the RawBoy tab hands the photo and its edits to the Auto tab
  (`AutoStore.receiveEdits`, `AutoPhoto.edits`, `LookApplier.applyEditsDevelop`), so a photo can go Auto → RawBoy →
  Auto and back again without losing its adjustments.

**Lens presets for RawBoy Auto (2026-10-18)**

- RawBoy (Android, iOS, web): **Save lens preset** in the Lens tab saves the lens settings as a preset for the photo's
  lens (`Presets.captureLens`; preset files now record the lens they were saved on, `"lens"`). Android and iOS also
  have **Send to Auto** there.
- RawBoy Auto (Android, iOS, web): lens-only presets are kept per lens (`LensPresetStore`; web: the RawBoy tab's
  presets) and applied by lens name on top of each photo's look or RawBoy preset, changing only the lens settings
  (`LookApplier.develop`). A **lens presets** button in the grid lists them (remove on Android and iOS).

## 0.1.0 — in development (2026-10-10)

**Web: Auto's edits survive closing the browser (2026-10-18)**

- With **Edits in sidecars** on in RawBoy Browser, every photo sent from the Browser to Auto keeps its Auto settings
  in its XMP sidecar as you work: look, strength, brightness and the other adjustments, a preset applied to it (per
  scene or to all) and RawBoy edits brought back with Back to Auto. Close the browser, come back, press **Reopen
  <folder>** in the Browser, and those photos are back in Auto with their edits. Before, Auto's batch and edits were
  gone once the page closed.

**Web: keep RawBoy edits in XMP sidecars (2026-10-18)**

- RawBoy Browser has a new **Edits in sidecars** switch, off by default. With it on, a photo opened in RawBoy from a
  Browser folder saves its edits into the photo's XMP sidecar as you work, next to the rating and any darktable or
  Lightroom data, and opening it again from the Browser brings the edits back (crop, masks and brush strokes too).
  Before, RawBoy forgot a photo's edits once you opened another one. Needs Chrome or Edge on a computer; photos
  opened in RawBoy directly, or sent to Auto, don't use it yet.

**Auto: photos open at once in the photo view (2026-10-18)**

- Swiping or arrow-keying to the next photo (Android, iOS, web) now shows it developed straight away, with its look
  and sliders working, instead of the blurry grid thumbnail and a spinner while the raw decodes. Auto keeps a
  screen-sized copy of each photo from its analysis (about 17 MB each on disk, up to about 90 photos; older ones fall
  back to the thumbnail). The full decode still runs behind it, shown by a small spinner in the corner: 100% zoom and
  Export become available when it finishes.
- Photos you swipe or arrow-key past are no longer decoded one after another before the one you stop on.

**Web: Auto keeps its open photo when you switch apps (2026-10-18)**

- Auto's photo view has the RawBoy · Auto · Browser switcher in its bar, so you can leave the photo for another app and
  come back to it. After **Edit in RawBoy**, going back to Auto reopens the same photo (decoded again: its full-size
  image is freed while RawBoy has the photo). Before, you had to go back to the grid to switch apps, and Edit in RawBoy
  closed the photo, so Auto came back on the grid.

**Web: RawBoy Browser handles darktable duplicates (2026-10-18)**

- darktable's duplicate sidecars (`IMG_0001_01.CR2.xmp`, `_02`…) now belong to their photo: rating a photo writes
  the rating into every version's sidecar, and moving it to the bin (or restoring it) takes them along, renamed to
  match. Before, they weren't linked to the photo, so they kept their old rating and stayed in the folder.

**Film looks get RawBoy's own names (2026-10-18)**

- Looks and film stocks no longer carry film makers' brand or product names: the warm family is **Yellow** (Yellow
  Portrait 400/800, Yellow Vivid 100, Yellow Warm 200, Yellow Cine 250D/500T, Yellow Slide 100, Yellow Classic 64,
  Yellow Mono 400/Push/Hard, Yellow Cine Mono/Soft), the cool one **Green** (Green Pastel 400, Green Everyday 400,
  Green Vivid Slide 50/100, Green Slide 100). The renders are unchanged.
- The bundled LUT files are renamed to match. Presets, saved picks and Camera's look that name the old looks or LUT
  files still open the same look.

**RawBoy Film moves to its own repository (2026-10-18)**

- RawBoy Film (GPLv3, spektrafilm) is now developed in a separate repository, which carries its complete source. This
  repository and its releases hold only the GPL-free apps: RawBoy, RawBoy Auto, RawBoy Camera, RawBoy Web and iOS.
- Release builds no longer include the RawBoy Film APK.

**Flip in RawBoy (2026-10-18)**

- RawBoy (Android, iOS, web): **⇆ Flip** and **⇅ Flip** in Crop & rotate mirror the picture as shown, left-right or
  top-bottom, after any 90° turn. The crop, the straighten angle and the masks mirror with it, so the result is an
  exact mirror of what was on screen. Flips are part of the edit: undo takes them back, export and compare keep
  them, presets leave them alone, and they reset for each new photo like the rotation. Stored as
  `flipHorizontal`/`flipVertical` on the unturned photo (a mirror in `LensTransform.outToImage`).

**Auto: Copy previous (2026-10-18)**

- RawBoy Auto (Android, iOS, web): **Copy previous** at the end of the photo view's Look / Adjust tabs gives the open
  photo what Apply to all copies (look or preset, Looks/Film mode, strength, warmth, tint, contrast, saturation and
  grain) plus Brightness from the photo before it in the batch. Denoise and rotation stay the photo's own; Undo takes
  it back. Off on the first photo.

**Web: Space / Backspace change the photo in Auto (2026-10-18)**

- RawBoy web, Auto's photo view: **Space** goes to the next photo and **Backspace** to the previous one (darktable's
  keys), also while a slider or button has focus. After dragging a slider, **←** / **→** change the photo instead of
  nudging that slider; a slider reached with Tab still moves with the arrows. Help (**?**) and the hint under the
  sliders say so.

**Web: send photos from Browser to Auto by stars, picks or selection (2026-10-18)**

- RawBoy Browser's **Picks to Auto** is now **Send to Auto**: choose the picks, photos with at least or exactly N
  stars, or what the grid shows, and see how many each takes. Long-press (or Ctrl/⌘-click) photos to select them
  and send just those. Auto says how many were added and skips photos it already has.

**Web: Masks panel fits on phones (2026-10-17)**

- RawBoy web on a phone: the Masks panel under the photo scrolls, and the selected layer has **Mask** and **Adjust**
  tabs (as in the apps), so its adjustments are one tap away; the add buttons share the panel's top row. The Crop and
  Presets panels scroll too when they don't fit.
- Mask lines and ellipses stop at the photo's edges; their handles still show beyond it, so they stay reachable.

**Auto: one preset per scene, noise settings from Auto (2026-10-17)**

- Auto (Android, iOS, web): a selection's **Preset** button (bookmarks icon) develops just the selected photos with a
  RawBoy preset, so one batch can hold a preset per scene (develop one shot per scene in RawBoy, save a preset each,
  then give each scene's photos theirs). The batch preset still goes to photos added later; removing it leaves photos
  with another preset alone.
- A preset in Auto no longer brings the Denoise, Color denoise and sharpening of the photo it was made on: each photo
  keeps its own measured values (by its noise and ISO), and the Denoise adjustment still works on top.

**Auto: a grid at the photos' own shape, full look names (2026-10-17)**

- RawBoy Auto's grid (Android, iOS, web) lays photos out in justified rows, each at its own aspect, so portrait and
  landscape shots fill their cells instead of sitting letterboxed in squares. Rows are about 120 px high on phones and
  180 px on wider screens, and the file name and look sit over the bottom of each photo.
- Look and film-stock names under the thumbnails in the photo view take two lines, so long names such as
  "Double-X 5222" aren't cut off.

**Web: one top bar, compare button, tidier masks (2026-10-17)**

- RawBoy Web has one bar above the photo instead of two: the tab's name (**RawBoy ▾**, **Auto ▾**, **Browser ▾**) at
  its left switches between the three, and **?** sits at its right. The decoder name and **Licences** moved to the end
  of the help. About 45 px more photo.
- RawBoy: a **Compare** button on the photo (or the `\` key) shows the as-shot render until pressed again; press and
  hold still works.
- Masks on phones: the photo keeps a 16 px margin instead of 72 px, so it stays nearly full width. The layer's name
  field is its heading, styled like the other controls, and renames in place.

**Histogram with clipping warnings (2026-10-17)**

- RawBoy (Android, iOS, web) shows a small RGB histogram above the slider tabs, with the share of crushed shadows and
  clipped highlights in its corners. Tap it to mark those pixels blue and red on the photo, so blown skies and crushed
  blacks are easy to spot under AgX's soft roll-off. The warning is only on screen, never in exports.
- RawBoy Camera (Android, iOS): **Histogram** in Settings (off by default) adds a live histogram in a corner of the
  viewfinder.

**Web: messages no longer cover the sliders (2026-10-17)**

- With a photo open, RawBoy Web's short messages (such as "… applied to all photos" after applying a preset in Auto)
  show at the top of the photo instead of the window's foot, where on phones they covered the sliders under the photo.

**Export the selected photos in Auto (2026-10-17)**

- Auto (Android, iOS, web): while photos are selected in the grid, **Export** saves only those, asking for format and
  size as Export all does. Photos still being analysed are left out. Remove is now a bin icon so the bar still
  fits a phone.

**RawBoy Auto: frame around the photo (2026-10-17)**

- RawBoy Auto's photo view has RawBoy's thin frame around the photo, neutral grey by default; tap (click on the web)
  outside the photo to cycle it through grey, white and black. Remembered, on Android, iOS and web.

**RawBoy: labelled tools (2026-10-17)**

- RawBoy's top-bar tools have a word under each icon (Open, Crop, Masks, Presets, Reset, Auto, Export) on Android and
  iOS, and on phones in RawBoy Web; long-press one on Android or iOS for its full name. Reset all has a restore icon
  instead of one that read as reload, and Auto is a wand icon on Android and iOS so the row still fits a 360 dp phone.

**Web: RawBoy Browser, for culling (2026-10-17)**

- RawBoy Web has a third tab, **Browser**: open a folder of raws, rate (1–5), pick and reject with the keyboard, and
  move the rejects into a `_bin` subfolder (undoable). Thumbnails and the photo view use the cameras' embedded JPEG
  previews, so nothing is decoded to browse. Ratings are saved in XMP sidecars that Lightroom, Capture One and
  darktable read. Folders need Chrome or Edge; Safari and Firefox rate picked files and download the sidecars.
  On phones the app name in the top bar makes way for the three tabs.

**Auto denoise from the photo's own noise (2026-10-17)**

- RawBoy's **Auto** button and RawBoy Auto (Android, iOS, web) now measure the noise in each raw and set **Luma
  denoise** and **Color denoise** separately from it, instead of from ISO: the quietest 16 px blocks at each
  brightness, in the denoise filter's own sqrt domain, scaled by how much the exposure lifts the shadows. Fitted by eye
  on 100% crops of 26 raws from 9 cameras: clean daylight shots get about 5, a GFX at ISO 6400 lifted 2 EV about 30/40,
  a Pixel night selfie 95/100. RawBoy Camera DNGs, which carry no ISO and so got no denoise before, are covered too.
  Sharpening eases off as denoise grows (15 → 5). Auto's Denoise adjustment moves both. RawBoy Camera keeps its
  ISO-based denoise.

**RawBoy Web on phones (2026-10-17)**

- The RawBoy tab's tool bar fits phone screens: on narrow screens the file name and shot info move to their own line
  under the tools, with Export at its end, and Open becomes a folder icon. Before, the bar was wider than a 390 px
  screen, the page scrolled sideways and Export was cut off. Tool bar buttons are at least 44 px tall on touch
  screens (42 px wide for icons).

**Sliders fill from 0 (2026-10-17)**

- Sliders with a signed range (Exposure, Contrast, Highlights, Shadows, Tint, Brightness, Warmth, mask adjustments
  and the rest) fill from 0 to the value, with a small mark at 0, in every app on Android, iOS and the web. Before,
  they filled from the left end, so each one at 0 looked half applied and edited sliders didn't stand out. Sliders
  that start at 0 (Sharpening, Grain, Strength…) still fill from the left; colour-track sliders are unchanged.

**Camera: selfie switch icon (2026-10-17)**

- RawBoy Camera and RawBoy Film on Android show the camera-switch icon (a camera between two turning arrows, as in
  Google Camera) on the button right of the shutter, instead of the plain circular arrows that RawBoy uses for Reset.

**Auto: more room for the grid (2026-10-17)**

- Auto's grid header is one line (two on narrow phones): **Import as** Looks | Film and the batch's RawBoy preset
  (**Apply RawBoy preset…**, or a "Preset: name ✕" chip that removes it). The format, quality and size moved from the
  header into a dialog that **Export all** and the photo view's **Export** open first, remembered as before. The header
  took about 220 px on desktop and a third of a phone screen; now about 50 px (web, Android, iOS).

**Undo and Redo (2026-10-17)**

- RawBoy (Android, iOS, web): **Undo** and **Redo** arrows in the top bar (on phones at the end of the file name's
  line), Ctrl/⌘ Z and Shift Ctrl/⌘ Z (or Ctrl Y) on the web. Every edit can be taken back: a slider drag, crop drag or
  brush stroke is one step, and so is each button (Auto, Reset all, a preset, a LUT, a turn). Reset all and Auto used
  to wipe the edits with no way back; Ctrl/⌘ Z used to undo only brush strokes. Opening another photo starts afresh.
- RawBoy Auto (Android, iOS, web): the photo view has the same arrows (and keys on the web), per photo: looks,
  sliders, presets, turns and Apply to all can all be taken back.

**Android, iOS: Curves scroll on touch away from the curve (2026-10-17)**

- RawBoy (Android, iOS): as on the web, touching the Curves box away from the curve scrolls the panel; touching the
  curve adds a point on it and drags it, and touching a point drags it.

**Web: Curves scroll on touch away from the curve (2026-10-17)**

- RawBoy web: with a finger, touching the Curves box away from the curve now scrolls the panel; touching the curve
  adds a point on it and drags it, and touching a point drags it. The mouse works as before.

**Web: Curves no longer jumps while you drag (2026-10-17)**

- RawBoy web: the Curves channel buttons (RGB, Red, Green, Blue, Reset) now stay on one row at every width, so
  editing a curve no longer wraps Reset onto a second line and pushes the curve box down mid-drag (seen on tablets in
  portrait). A drag also keeps mapping against where the box was when it started.

**Auto: paired sliders on the Adjust tab (2026-10-17)**

- Auto (Android, iOS, web): on the **Adjust** tab Brightness and Contrast share one row, Warmth and Tint the next,
  each with its label and value above a half-width slider; Saturation, Grain and Denoise stay one per row. The Look
  tab is unchanged.

**Defective sensor columns (2026-10-17)**

- Lines from defective sensor columns are removed automatically in all apps, on the raw data before demosaicing. A
  column segment where one colour sits at a constant offset from its same-colour neighbours, over hundreds of rows,
  while the column's other colour is normal (real detail moves both), has that offset subtracted. The Pentax 645D
  has two such red columns from part-way down the frame (+18 DN), which showed as two thin lines in underexposed
  photos. Positions differ per camera body and the DNG lists none, so they are found in each photo. Other cameras'
  decodes are unchanged (checked on the Fuji, Canon, Olympus and iPhone test files).

**Fewer, more distinct looks (2026-10-17)**

- Removed looks that rendered nearly the same as another one (measured on the same colours, median ΔE2000): film
  stocks UltraMax 400 (0.4 from Portra 800), Fuji C200 (1.3 from X-Tra 400) and Portra 160 (1.3 from Portra 400); LUT
  looks UltraMax 400 (1.4 from Portra 800) and Portra 160. Presets, Camera's saved look and Pro's film stock that named
  one of them now get the closest kept one (Portra 800, X-Tra 400, Portra 400). Auto no longer suggests Portra 160
  for bright, low-ISO portraits; they get Portra 400.

**Auto: Apply to all reaches every photo (2026-10-17)**

- Auto (Android, iOS, web): **Apply to all** used to skip photos that were still being analysed, and those then got
  their suggested look. Now every photo in the batch gets the look and its settings; a photo analysed afterwards keeps
  it (`AutoPhoto.looksApplied`) and only records its suggestion.

**Help sheet in every app (2026-10-17)**

- Every app (Android, iOS, web): a **?** button in the top bar opens a short sheet with the app's basics and its
  gestures (Pro, Auto's grid and photo view, Camera and RawBoy Film). On the web it lists the keyboard shortcuts too
  and opens with **Ctrl+/** (**⌘/** on a Mac), like Google's apps; Esc closes it. In Pro and Auto on Android and iOS
  the **?** takes the place of the "⋮" menu: **Open-source licences** is at the end of the sheet. The camera's volume
  keys don't shoot while it is open. Content: `ui/Help.kt` per app (`view/Help.kt` in the engine), `ui/Help.swift`,
  `ui/pro/help.ts` and `ui/auto/help.ts`.

**Curves in RawBoy (2026-10-17)**

- Pro (Android, iOS, web): **Curves** in the Light tab, point curves for RGB and for Red, Green and Blue on the final
  sRGB image, after the LUT. Tap to add a point, drag to move, double-tap to remove; monotone cubic between points
  (`ToneCurves`, `ToneCurve.kt/.ts/.swift`). The shader reads a 33-entry table per channel (`uCurve`, RGB curve
  already applied; off at the identity). Curves carry over and are a new **Curves** preset group (each channel a list
  of `[x, y]` pairs in `.rawboy.json`), which Auto's **Apply RawBoy preset** renders as well.

**Range and select-all in Auto's grid, web (2026-10-17)**

- Auto (web): Shift-click a photo to select it and every photo between it and the last one picked; Ctrl/Cmd+A
  selects all photos (left alone in text fields).

**Separate luma and colour denoise in RawBoy (2026-10-17)**

- RawBoy (Android, iOS, web): Denoise is now two sliders in Detail, **Luma denoise** and **Color denoise**, each with
  its own coarse stage above 65. Older presets and edits keep their look: their one Denoise value sets both. Presets
  store both in the Detail group. Auto, Camera and the Auto button develop as before (colour follows the ISO-based
  denoise).

**Local contrast in RawBoy (2026-10-17)**

- Pro (Android, iOS, web): **Local contrast** slider in the Detail tab (−100–100), for mid-frequency texture between
  Sharpening and High-pass contrast. Log-luminance against an edge-aware blur in the develop shader
  (`localContrastGain`), so strong edges keep no halo; in the Detail preset group and carried over like other edits.

**Auto grid keeps its place, web (2026-10-17)**

- Auto (web): closing a photo (Esc, Back, or removing it) brings the grid back where it was scrolled instead of at
  the top, scrolled just enough to show the last photo viewed when ← / → or swipes moved on past the visible rows.

**White balance picker and infrared range in RawBoy (2026-10-17)**

- Pro (Android, iOS, web): **Pick white balance** in the Color tab; tap something neutral grey and the temperature and
  tint are solved so it renders grey (`WhitePicker`, `WhiteBalance.neutralTempTint`).
- Pro: Temperature goes down to 1000 K and Tint to ±250, so infrared photos can be neutralised. Nothing changes above
  1667 K; as-shot whites below it (very warm or IR files) are no longer clamped to 1667 K.

**RawBoy presets in Auto, Android and iOS (2026-10-17)**

- Auto (Android, iOS): **Apply RawBoy preset…** in the grid applies a `.rawboy.json` preset to every photo in the
  batch, with all its groups including lens corrections, in place of the look (`LookApplier.applyPreset`). RawBoy
  (Android, iOS) has **Send to Auto** in each preset's menu: on Android a share intent to `app.rawboy.auto` through a
  FileProvider, on iOS a `rawboy-auto://preset?json=…` link; Auto also opens preset files from file managers / Files.
  Batch export now heals blemishes when the develop asks for Blemish removal.

**RawBoy presets in Auto, web (2026-10-17)**

- Auto (web): **Apply RawBoy preset…** in the grid applies a RawBoy preset (from the RawBoy tab or a `.rawboy.json`
  file) to every photo in the batch, with all its groups including lens corrections, in place of the look
  (`applyPresetDevelop`). Batch export now heals blemishes when the develop asks for Blemish removal.

**Tap to meter in RawBoy Camera and RawBoy Film (2026-10-17)**

- Camera and Film (Android, iOS): a tap now sets exposure as well as focus. The live develop and the shot meter a
  square of 16% of the frame's short side around the tap (moved inside the frame near an edge) instead of the centre
  box, and Camera2's AE region on Android is the same box. **AF LOCK ✕** goes back to centre metering.

**Batch rotate in RawBoy Auto (2026-10-17)**

- Auto (Android, iOS, web): select photos in the grid (long-press, then tap or **All**) and turn them all 90° left or
  right with **↺** / **↻**. The rotation is kept per photo (`Adjustments.rotation`, on top of the photo's own
  orientation) and applies to thumbnails, the photo view and exports.

**All sliders on Auto's Adjust tab (2026-10-17)**

- Auto (Android, iOS, web): the **Adjust** tab now has every adjustment, Brightness and Warmth (also on the Look tab)
  followed by Contrast, Saturation, Tint, Grain and Denoise. It still scrolls; the photo keeps the rest of the screen.

**TIFF and export sizes in RawBoy Auto; LZW TIFFs (2026-10-17)**

- Auto (Android, iOS, web): an **Export as** row under *Import as* in the grid picks JPEG (quality 1–100, default 92)
  or TIFF (8/16-bit, default 16) and the size: original, or a long side of 4096, 2048 or 1080 px (area downscaling, as
  Pro's smaller exports). Remembered per app (web: per browser, apart from RawBoy's own export settings). Applies to
  Export all and the photo view's Export.
- TIFF exports keep the photo's EXIF (all apps): the same tags as JPEGs (make, model, lens, exposure, date, GPS…,
  Orientation 1, Software RawBoy, ColorSpace sRGB) in IFD0 and its Exif and GPS IFDs. ExifInterface can't write TIFFs,
  so Android reads the source's tags into `ExifMetadata` and `ExifWriter.kt` (a port of `ExifWriter.ts`) lays out the
  header; web and iOS take the decoder's metadata as their JPEGs do. Checked with Pillow's EXIF reader.
- TIFF exports (all apps, all platforms) are LZW-compressed with the horizontal differencing predictor (TIFF
  Predictor 2), lossless and readable by libtiff, Photoshop, Lightroom and the platforms' image viewers. The header
  is written last (in front of the strips) because the strip sizes are only known after compressing. The Kotlin and
  TS writers produce byte-identical files (checked on the JVM and in Node, decoded with libtiff and tifffile); the
  Swift writer follows them line for line but hasn't been run yet.
  Tests: `TiffWriterTest.kt`, `web/src/engine/__tests__/tiff.test.ts`.

**JPEG, Ultra HDR, HEIC, PNG and TIFF in RawBoy Auto (2026-10-14, 2026-10-17)**

- Auto (all platforms): opens JPEG, HEIC, PNG and TIFF besides raws (pickers, share/open-with on Android, Photos
  picker on iOS takes the HEIC/JPEG/PNG/TIFF when a photo has no raw); the empty grid and an import message say these
  give lower quality than RAW. New `decoder_display.cpp` (jpegli decode via `rb_jpeg_decode` in the
  JPEG library, ICC, EXIF, MPF + Ultra HDR gain map) and `display_inverse.cpp` (inverse of the default develop);
  shader uniform `uDisplaySource` renders these files with AgX per channel and without soft gamut compression.
  HEIC and PNG: platform decoders hand pixels to `decodeDisplayPixels`; EXIF from the HEIF Exif item / PNG eXIf
  chunk. TIFF: `decodeTiff`, the last fallback of `decodeAny`.
- Ultra HDR boost per channel near scene white (first version: by the brightest channel from 90% up, which brightened
  skies by 13-24 levels on outdoor Pixel shots).
- Verified (web, `tools/display_roundtrip/check.mjs`, 25 files in `.raw/display/`): no-edit exports match the
  originals, 12 JPEGs (sRGB, Display P3, Ultra HDR) median dE76 0.45-0.62, p99 ≤ 1.7; 13 HEICs in WebKit median
  0.15-0.28, max < 1. Auto's web UI in WebKit: raw, HEIC, JPEG, PNG and TIFF import, analyse and show their looks.
  Earlier: iOS Metal renders of two HEICs and two JPEGs match ImageIO's decode (`DisplaySourceTests`); the inverse
  alone is exact over the whole sRGB cube (max 0.35 levels).

**RGB primaries: coloured sliders, wider hue (2026-10-14)**

- RawBoy (all): each RGB primaries slider's track shows the colour a sample patch takes at every position, computed
  with the develop's own primaries matrix and the other primaries sliders' current values (`color/PrimariesTrack`;
  the Tint hue track is drawn at full Tint purity). Hue range doubled to ±30°.

**UX pass: more room for the photo (2026-10-14)**

- Auto (Android, iOS): the detail view's controls take a fixed height of three one-row sliders (the Look tab fits;
  Adjust scrolls), smaller look thumbnails and tabs, so the photo gets most of the screen. Web was already laid out so.
- Auto (all): **New photos** is now **Import as**, with a line saying what Looks and Film do and that it applies to
  photos added next. Web: it and the detail view's Looks / Film are segmented switches, no longer styled like tabs.
- RawBoy (all): the LUTs tab hides while the Film tone mapper is on; the chosen LUT is kept but not rendered or
  exported, and comes back with another tone mapper. The stock picker is a shared dropdown (`view/LookDropdown.kt`).
- Camera (Android, iOS, both editions): the strip of look chips is now a **Look** menu, and the sliders are one thin
  row each (`view/CompactSlider.kt`, shared with Auto and RawBoy's `ParamSlider`), about 50 dp less under the viewfinder.

**RawBoy: Film tone mapper (2026-10-14)**

- RawBoy (Android, iOS, web): **Film** is a fourth tone mapper on the Light tab, with a stock picker and Film
  strength, Film grain and Halation. Photos handed over from Auto's Film mode (web: Edit in RawBoy) open in it; the
  Light preset group saves it (older presets leave it as it is). Android and iOS RawBoy now render film at all.

**RawBoy Auto: Film mode (2026-10-13)**

- Auto (Android, iOS, web) has a **Looks / Film** switch, per photo in the detail view and as **New photos** above the
  grid, chosen before importing and remembered (only photos added afterwards follow it). Film develops the photo as negative + print with the 15
  spektrafilm stocks of RawBoy Film (see [RawBoy Auto](docs/auto.md)), in place of AgX + LUT; a stock is suggested
  per photo. The Adjust tab's Grain scales the film grain.
- Grain, halation and scatter are RawBoy's own (`shaders/film_form.glsl`, parameters in
  `luts/spektrafilm/formation.json`), not ported from spektrafilm, so Auto stays GPL-free and keeps the Adobe DNG SDK.
  Fitted to RawBoy Film's renders by output statistics (`tools/film_eval`): the formation itself matches exactly
  (dE2000 median 0), grain std within about 10%.
- Every app now bundles the spektrafilm LUTs (CC BY-SA 4.0, credited in the licences screen); RawBoy Film is unchanged.

**RawBoy Film: RawBoy Camera on spektrafilm (2026-10-13, prototype)**

- New app **RawBoy Film** (`app.rawboy.camera.film`, the `film` flavour of `app-camera`): RawBoy Camera with
  spektrafilm film stocks as its looks (see [Film looks](docs/camera.md#film-looks-spektrafilm)): negative, print and scan replace
  AgX, with spektrafilm's grain in film density and its halation and scatter, live in the viewfinder and in the
  photo. 15 stocks; Strength blends with the AgX render. Installs next to RawBoy Camera, saving to `Pictures/RawBoy Film`.
- RawBoy Film is GPLv3 ([Licence](Readme.md#licence)): LibRaw under the LGPL 2.1, no Adobe DNG SDK, spektrafilm's GPLv3 and
  CC BY-SA notices in its licences screen, credit in its Settings. RawBoy Camera and the other apps are unchanged.
- The engine has two editions (`standard`, `film`); release builds publish `RawBoy-Film-<tag>.apk` too.
- iOS: **RawBoy Film** too (target `RawBoyFilm`, `app.rawboy.camera.film`), on its own engine framework
  (`RawBoyFilmEngine`) and native library without the DNG SDK (`RawBoyNativeFilm`); saves to the "RawBoy Film" albums.
  The standard iOS apps no longer bundle the spektrafilm LUTs.

**Flash and Pro Auto (2026-10-13)**

- RawBoy Camera: **Flash** (fires with the shot) and **Focus-flash** (light on, focus, then flash, as Google Camera
  does), from a top-bar button on lenses with a flash. Exposed from the focus distance and a per-lens flash strength
  learned from each flash shot, so the raw keeps its highlights.
- RawBoy and RawBoy Web: **Auto** button in the top bar: RawBoy Auto's develop (exposure, tone, white balance,
  saturation, denoise, sharpening, AgX) on the current photo, keeping the LUT and the rest of the edit.
- RawBoy Camera: **RAW** toggle in the top bar (keep the DNG or not).
- `tools/auto-eval/DATASET.md`: what a dataset for tuning Auto needs (minimum, normal, best).
- RawBoy Web on phones: a vertical swipe that starts on a slider scrolls the panel instead of moving the slider.
  Touch drags must be mostly horizontal and move the value from where it was (no jump to the finger).
- RawBoy Web: each slider tab (Light, Color, … and Auto's Look, Adjust) keeps its own scroll position.

**Tone mappers (2026-10-12)**

- RawBoy and RawBoy Web: **Tone mapper** choice at the top of the Light tab: AgX (default), Filmic or Sigmoid.
  Same middle grey, white point and slope at grey as AgX, so Exposure, Contrast, Whites/Blacks and Grain behave
  alike. Saved in presets (Light group). RawBoy Auto and Camera stay on AgX.

**Masks (2026-10-12)**

- RawBoy (Android): **Masks** like RawBoy Web: linear (with curvature), radial and brush layers, Brush / Erase on any
  layer, Auto mask, Show mask, presets keep gradients only. One finger paints, two fingers pan the 100% view; the
  panel's 100% button zooms while painting. Layer chips (tap the selected one to rename, hide or delete), then the
  layer's Mask and Adjust tabs.
- RawBoy (Android): more room for the photo. The top bar is a row of icons (Export is the download icon) over one
  line with the file name and the shot info (camera, ISO, shutter, aperture, focal length; also on the web). Sliders
  take one row each (label, slider, value) and the panel is shorter, so all six Light sliders show at once.

- RawBoy Web: **Z** toggles the 100% view in the editor, Presets and Masks (not while typing, not in Crop & rotate).

- RawBoy Web: **Brush** for mask layers. Paint or erase on any layer (erasing also carves a gradient), or start from
  an empty Brush layer. Size, Hardness, Flow and **Auto mask**, which only paints on colours like the one under the
  brush (a gate on luminance and chroma of the preview copy). Works in the fit and the 100% view. Strokes are kept as
  vectors and painted into a whole-image mask at preview size (2048 px), so preview, 100% and export match. Presets
  keep gradients only, and the save dialog says so when the photo has strokes.

- RawBoy Web: **Masks**, a top-bar mode after Capture One's layers: up to 4 linear or radial gradient layers, each
  with Opacity, Invert, a red mask view, Curvature for linear gradients (lines bent into arcs) and its own Exposure, Contrast, Highlights, Shadows, Temperature, Tint,
  Saturation and Clarity. The gradients are computed in the develop shader (no mask textures), so the preview, the
  100% view and export match. Presets have a new Masks group (off by default). Android follows; the shared shader
  already has it and renders unchanged without masks.

**No colour clipping on saturated colours (2026-10-12)**

- All apps (Android and Web): Saturation is limited by purity, after Saulala's *Sat vs Sat*. Each pixel gets at most
  the boost it can take before a channel would reach zero (soft knee at 80% of that), so very pure colours (flowers,
  tomatoes, neon, sunsets) keep their shading instead of turning into flat patches. Neutrals are untouched.
- All apps: colours beyond Rec.709 are compressed softly into it (the ACES reference gamut compression's method) instead
  of being clipped per channel, which shifted hues and flattened gradients, even at Saturation 0. Colours inside the
  gamut change only near its edge (on the owner's Pixel test set: under 1/255 for 20 of 25 photos at the auto
  develop; at Saturation +100, pixels with a channel stuck at 0 went from up to 35% to none).
- RawBoy Auto (Android and Web): Saturation −100 is black and white. Below 0 the slider now scales the saturation
  the auto develop and the look arrive at towards −100 (before, it was an offset and left ~30% of the colour).
- All apps: near Saturation −100 (the last quarter of the scale) the film LUT's colour cast fades out too, so −100
  with a colour film look is neutral grey rather than toned.

**Auto controls and defaults (2026-10-12)**

- RawBoy Auto (Android and Web): the controls are split into two tabs. **Look** has Strength, Brightness and Warmth;
  **Adjust** has the new Contrast, Saturation, Tint, Grain and Denoise, offsets from the auto develop. Apply to all
  copies tint, contrast, saturation and grain too.
- RawBoy Auto and RawBoy Camera: white balance is exactly as shot (the 6% warming is gone), Saturation +30 (was +40),
  base grain 5 (was 10).

**Auto saturation (2026-10-12)**

- RawBoy Auto and RawBoy Camera: the auto develop starts at Saturation +40 (was 0), under every look.

**Auto white balance (2026-10-12)**

- RawBoy Auto (Android and Web): the default white balance is 6% warmer than as shot instead of 25%. Measured against
  87 of the owner's darktable edits (their JPEGs vs Auto's renders with the suggested look), Auto was warmer than
  nearly all of them (snow came out brownish pink): typically 27 Warmth units off before, 16 now, and the excess
  magenta halved. Sunsets and warm interiors now come out a little cooler than the owner's edits; Warmth fixes those.
- Gold 200 is only suggested for photos shot in warm light (as shot below 5500 K): in daylight, a few warm things
  in the frame made it the pick for snow and a cityscape, which then came out yellow.

**Auto exposure (2026-10-12)**

- RawBoy Auto (Android and Web): phone DNGs (Google, Apple, Samsung) keep the phone's own exposure, which it stores in
  the DNG's BaselineExposure, instead of being re-metered. Measured against 74 Pixel DNGs the owner developed in
  darktable: 1.73 EV RMS off before, 0.92 now (snow was pulled 1–2 EV too dark, sunsets and bright windows 2 EV).
  Other cameras are metered as before. RawBoy Camera keeps its own live metering.
- Face size was wrong for every photo: the skin model's faint face confidence was summed over the whole frame, so each
  photo had a "face" of about 2% (sunsets included) and real small faces couldn't be told apart. Only confident face
  pixels count now. Exposure follows faces gradually (from 0.3% of the frame, full weight at 2%) instead of only above
  3%; looks add their portrait skin retouch only when there is a face; portrait looks are suggested from 1.5%.

**iPhone ProRAW (2026-10-12)**

- RawBoy Web: iPhone ProRAW DNGs (and other big-endian DNGs with a LinearizationTable) decoded as a blown-out,
  posterised image. The WebAssembly C library's `swab` corrupted LibRaw's in-place byte swap; LibRaw now uses its own.
- iPhone ProRAW DNGs read their as-shot white correctly. Apple stores the white balance in the DNG's AnalogBalance
  (AsShotNeutral is 1 1 1), which was ignored, so every iPhone shot's as-shot white read as a strong magenta and
  white balance changes, Auto's white balance and the temperature/tint readout started from it.

**Adobe DNG SDK everywhere, licences (2026-10-12)**

- RawBoy Web's public build (Cloudflare Pages, Docker) now includes the Adobe DNG SDK, so JPEG XL DNGs open there too.
  `build:public` and Android release builds fail without the SDK; the Docker build downloads it from Adobe.
- Open-source licences: RawBoy and RawBoy Auto (top-bar overflow menu), RawBoy Camera (Settings) and RawBoy Web
  (**Licences** in the top bar) list every third-party licence, with the Adobe DNG notice
  ([licenses/THIRD_PARTY_NOTICES.txt](licenses/THIRD_PARTY_NOTICES.txt)).

**Zoom hint (2026-10-12)**

- RawBoy, RawBoy Auto and RawBoy Web: a short-lived "Double-tap (double-click) for 100% · drag to pan" hint over
  the photo for a few seconds when it opens, until the 100% view has been used once (not while cropping).

**Auto → RawBoy (2026-10-11)**

- RawBoy Web: **Edit in RawBoy** in the Auto tab's photo view moves the photo to the RawBoy tab in one click, with
  Auto's exposure, white balance, look and Strength/Brightness/Warmth as the starting sliders.

**Crop and presets (2026-10-11)**

- RawBoy and RawBoy Web: the Rotate & straighten tool is now **Crop & rotate**. While it's open the preview shows the
  whole straightened picture with a crop frame (dimmed outside, grid inside): drag corners, edges or the inside.
  Aspect ratios Free, Original, 1:1, 4:5, 4:3, 3:2, 16:9, each portrait or landscape; a 90° turn turns the crop with
  the picture. The crop only picks a window of the finished frame: lens corrections (profile, distortion, vignetting)
  and the straighten auto crop are still computed on the full frame, so a cropped pixel is identical to the same pixel
  uncropped. Export, the 100% view and the export size follow the crop. It resets for each new photo.
- RawBoy and RawBoy Web: **Presets**, a top-bar button that opens the presets in place of the slider tabs (the
  five slider tabs stay as they were). Save the current edits with the groups you choose, apply with one tap
  (only the saved groups change; a missing LUT shows a message and the rest still applies), update, rename, delete,
  and import/export preset files (`.rawboy.json`, shared format: a preset exported in the browser imports on the
  phone and back). Stored in app storage on Android, in the browser's local storage on the web.

**Hot pixels (2026-10-11)**

- Hot and warm pixels are removed automatically in all apps (RawBoy, Auto, Camera, Web), on the raw data before
  demosaicing. A photosite is replaced when it stands well above its same-colour neighbours (5 sigma of the photo's
  own noise) and its adjacent photosites aren't lit too, so small highlights, catchlights and fine hair are kept;
  defects often come in pairs, so a hot pixel's neighbours get a second, more sensitive look. On a GFX 50R frame at
  ISO 6400 (a dark shot pushed ~7 stops) it removes ~5,300 hot and warm pixels and the bright specks on the model;
  ~100 ms for 50 MP on a Mac. Linear raws (already demosaiced DNGs) are left alone.

**Film looks (2026-10-11)**

- New bundled LUTs, generated from film datasheets with spectral_film_lut (`tools/film_luts/generate.py`): Portra
  160/400/800, Ektar 100, Gold 200, UltraMax 400, Superia X-Tra 400, Pro 400H, Vision3 500T, Velvia 50, and in
  black and white Tri-X 400 (normal, Push, Hard) and Double-X 5222 (normal, Soft). The third-party HaldCLUTs and
  Infrared are removed; Redscale stays. Auto and Camera's default look is now Portra 400 (was Fuji 160C); the looks'
  contrast/blacks/whites adjustments are gone, as the LUTs carry the film's own curve.
- Film LUTs regenerated with more contrast and colour, matched to the earlier looks in Auto (Portra 400/800, Gold 200,
  UltraMax, Superia and Vision3 contrast up; Portra, 400H and Vision3 saturation up); black levels unchanged.
- Fixed: black dots with Skin retouch on saturated colours (e.g. yellow flowers taken for skin, so Auto's Portra and
  400H looks showed them): the smoothing's weights could all underflow to zero (0 / 0).

**RawBoy Web (new)**

- New **RawBoy Web** (`web/`): RawBoy and RawBoy Auto as two tabs in the browser. LibRaw, the DNG opcode parser,
  blemish healing, the export downscaler and jpegli run as WebAssembly in a worker; the develop shader runs
  unchanged in WebGL2; the Kotlin engine (white balance, primaries, lens geometry, LUTs, skin segmentation, auto
  develop, looks) is ported to TypeScript. Local builds include the Adobe DNG SDK (JPEG XL DNGs); the public build
  doesn't.
- RawBoy Web: exported JPEGs keep the main EXIF fields (camera, lens, exposure, ISO, focal length, date, GPS),
  read by the decoders (also for CR3, which Android's EXIF copy can't read).
- RawBoy Web: the Rotate & straighten button uses the crop-rotate icon, as on Android (its arrow looked like Reset
  all next to it).
- Engine (all apps, no change in behaviour): the decoder order, preview downsampling, tile copy, band downscaler,
  jpegli settings and DNG SDK CMake setup moved into shared files (`decode.cpp`, `image_ops.cpp`, `band_ops.h`,
  `jpegli_settings.h`, `dng_sdk.cmake`) so the Android and web builds use the same code.

**RawBoy Camera (new app)**

- New app **RawBoy Camera** (`app.rawboy.camera`): live film-look viewfinder (looks, Strength, Brightness, Warmth),
  UW / W / T lens selector, raw capture to `Pictures/RawBoy Camera/RAW/*.dng`, background develop to
  `Pictures/RawBoy Camera/*-camera.jpg`, stronger denoise for phone-sensor noise.
- Faster (Camera): smoother viewfinder (its analysis copy is read back without stalling the GPU; shots develop
  at lower CPU and GPU priority than the viewfinder); quicker saves (raw decode uses all cores via OpenMP, the
  skin models stay loaded, the export GPU context is reused between shots). Engine: RawBoy and Auto get the
  faster decode and skin detection too.
- Fixed (Camera): bright lights no longer leave a delayed glowing trail in the viewfinder. Bloom and high-pass
  contrast now come from the current frame (made on the GPU each frame), not from a copy a few hundred ms old.
- Fixed (Camera): the viewfinder showed a tighter frame (~20% crop) than the saved photo: the camera's video
  stabilization was on for the preview. It's off now, so the viewfinder frames exactly what the photo gets.
- Fixed (Camera): viewfinder colours were too saturated (reds most) and differed from the photo. It now decodes the
  camera's frames itself (the phone's GPU used the wrong YUV matrix) and swaps the camera's own colour rendering for
  the one the raw gets, so viewfinder and photo match.
- Fixed (Camera): the photo's darkest shadows were slightly lifted and bluish compared with the viewfinder; the
  photo now uses the phone's own (slightly deeper) black.
- Fixed (all apps): the as-shot white balance of phone DNGs (and other cameras LibRaw doesn't list) was read as
  daylight (~6500 K) whatever the light, so auto white balance and the Temperature/Tint defaults were off under
  indoor light. It now comes from the DNG's own colour matrix.
- Camera: tap-to-focus lock with focus ring and AF LOCK badge; volume buttons take photos; shutter blink + haptic;
  selfie camera (when it has RAW), saved mirrored; smaller photos (3000 px) by default; "Remember camera &
  settings" option (off by default).
- Engine: export can be saved smaller (`ExportSettings.maxLongSide`, streamed area downscale, grain sized to the output).
- Camera: viewfinder exposure now matches the photo from the second shot on each lens (the preview gets an
  explicit sRGB curve, calibration per lens); viewfinder 30 fps in low light (photos keep their longer exposure);
  photos save in ~3 s instead of ~4.5 s (native downscale and repack, faster raw conversion, 16-bit GPU readback,
  skin detection only when the camera sees a face).
- Camera: exposure is metered on the centre (middle half of width and height), for both the camera's raw exposure
  and the auto develop; stronger denoise at high ISO (from ISO 1600 on the back cameras, 800 on the selfie camera,
  up to 100 at ISO 6400 / 3200).
- Denoise above 65 adds a coarse stage for high-ISO noise (RawBoy's slider gets stronger at the top; Auto never goes
  above 65, so it's unchanged).
- Camera: grain twice as fine as in RawBoy and Auto, equally strong (at 3000 px it's raised ×1.34 to make up for
  the downscale averaging the finer grain).
- Fixed (Camera): the selfie camera wasn't offered on the Pixel 9 Pro (its raw is 1.40:1 and no preview size
  matches; the viewfinder now shows the closest, 4:3, which is slightly tighter than the saved photo).
- Fixed (Camera): the viewfinder was sideways and stretched on the Pixel (the camera's preview transform already rotates).
- Engine: JPEG export with jpegli (16-bit input, 4:4:4), streamed band by band; RawBoy and Auto still use Android's encoder.
- Engine: RawBoy Auto's analysis and looks moved into the engine so Auto and Camera share them (Auto unchanged).
- Auto: swipe left/right on the photo in the detail view to move between the batch's photos (shows "3 / 12" under the name).

**RawBoy Auto (new app) and shared engine**

- New app **RawBoy Auto** (`app.rawboy.auto`): automatic develop + film looks, batch export to
  `Pictures/RawBoy Auto/<name>-auto.jpg`.
- Repository split into `engine` (shared library), `app-pro` (RawBoy, unchanged behaviour: exports are
  byte-identical to before the split) and `app-auto`.
- Develop shader moved to `shaders/*.glsl`, compiled into the engine at build time.
- Engine reads the ISO speed from raws (LibRaw and DNG SDK paths).
- Fixed: RawBoy Auto could run out of memory (and crash) when sliders were dragged while a batch was
  still being analysed: every slider step reloaded the look's LUT. LUTs now load once (shared cache, one
  parse at a time) and full-resolution decodes run one at a time.
- Auto exposure recalibrated on test raws (it was 0.5–2 EV too bright): darker target, small faces
  (under 3% of the frame, often misdetections such as a cat) no longer steer exposure, and a contrast
  base of +15; Brightness range ±3 EV.
- RawBoy Auto: remove photos from the batch (long-press to select, then Remove).
- RawBoy Auto: fine grain on every photo by default.
- Fixed: exports of photos rotated by 90° had high-pass contrast, bloom and skin retouch misplaced
  (the shader got the rotated size as the image size).
- Changed: the Tint slider now works like Lightroom's (+ = more magenta); it was reversed. As-shot
  tint values change sign accordingly; renders at default settings are unchanged.
- RawBoy Auto: warmer default white balance (+25% Kelvin) and a Warmth slider that moves temperature and
  tint together.

## 0.1.0 — first version (2026-10-09)

First version, built up feature by feature and tested on the Android emulator with
sample files (Pixel 8 Pro DNG, Fujifilm GFX 50R RAF, Olympus JPEG XL DNG, CC0 portraits).

**Added**

- Raw development app: LibRaw decoding, GLES 3.0 develop shader with AgX tone mapping,
  live preview, tiled full-resolution export to JPEG (quality 1–100) or TIFF (8/16-bit)
  in `Pictures/RawBoy/` as `<name>-rawboy.jpg`, then `-001`, `-002`, … on conflict; EXIF copied to JPEG.
- Light and Color sliders: Exposure, Contrast, Highlights, Shadows, Whites, Blacks,
  Temperature/Tint (as-shot defaults), Saturation.
- Detail tab: Denoise, Grain (spektrafilm-inspired, film-scaled), Sharpening,
  High-pass contrast, Bloom (spektrafilm diffusion-filter PSF), Skin retouch,
  Blemish removal.
- 100% view: double-tap to zoom at a point, drag to pan; full-resolution tiles stream in.
- LUTs tab: bundled HaldCLUT/.cube LUTs from `luts/`, user LUTs from `Documents/luts`, Strength slider.
- Lens tab: embedded DNG lens profile (gain maps, WarpRectilinear, FixVignetteRadial) read
  by RawBoy itself, plus manual Distortion (auto crop/scale), Vignetting and Vignette radius.
- Rotate & straighten: 90° turns and a ±45° Straighten slider with grid and auto crop; resets per photo.
- RGB primaries (Color tab): per-primary hue/purity and white-point tint, after darktable.
- Skin retouch and Blemish removal using on-device MediaPipe models (skin segmentation,
  Face Landmarker), with eyes, brows, lips and nostrils protected.
- Adobe DNG SDK 1.7.1 integration (with its libjxl) as fallback decoder: DNG 1.7 / JPEG XL DNGs open.
- Exposure frame around the photo (neutral grey / white / black, tap outside the photo to cycle).
- Edits carry over to the next photo (white balance only if changed; rotation never).
- Slider resets: double-tap a slider or tap its value. Press and hold the photo to compare with the as-shot render.
- Release build setup: signing via `keystore.properties`, R8 + resource shrinking, keep rules for MediaPipe.

**Changed**

- Grain made film-scaled and 50% finer than first version; strength and colour share reduced.
- Sharpening strengthened and widened (σ 0.7 px vs 2 px) after testing on phone raws.
- RGB primaries ranges narrowed (hue ±15°, purity ×0.71–×1.41, tint ≤10%) to avoid strong side effects.
- Decoder order: LibRaw first, Adobe DNG SDK only for DNGs LibRaw can't read.
- Blemish removal slider remapped so low values already remove the most obvious spots.
- Each tab (Light, Color, Detail, LUTs, Lens) keeps its own scroll position.

**Fixed**

- Gradle failed to run on Android Studio's bundled Java 25: daemon pinned to JDK 21.
- CMake 3.22 rejected `DOWNLOAD_EXTRACT_TIMESTAMP`; LibRaw build excluded its placeholder `*_ph.cpp` files.
- Grain darkened the image on some GPUs (16-bit integer precision): shader now requests `highp int`.
- Auto orientation lost since the lens-correction change (LibRaw overwrote the flip): orientation now read before processing.
- Camera-native raws (CR3, NEF, ARW, RAF…) and DNGs without BaselineExposure decoded black (LibRaw's −999 placeholder).
- Pixel DNG vignetting and colour shading were uncorrected (LibRaw ignores DNG gain maps).
- 256³ HaldCLUTs ran out of memory: resampled from native memory instead.
- Slider double-tap could be overridden by the slider's own tap; now detected from the slider's callbacks.
- Release build crashed when using Skin retouch (R8 broke MediaPipe/Flogger); detection errors no longer crash the app.
- Blemish removal healed nostrils and inner eye corners: facial features are now excluded via face landmarks, and very dark spots are skipped.
- Native library not 16 KB page-aligned (Google Play requirement).
