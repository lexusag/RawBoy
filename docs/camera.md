# RawBoy Camera

A camera for the back lenses (made for the Pixel 9 Pro; any phone whose camera offers RAW works). The
viewfinder shows the photo developed live: RawBoy Auto's automatic develop plus the **look** chosen from the
**Look** menu under the viewfinder, with **Strength**, **Brightness** and **Warmth** as in Auto (one thin row each). **Brightness** also changes the exposure the camera shoots with (exposure compensation, up to the camera's limit, usually ±2 to ±4 EV): a brighter setting gathers more light, so its shadows are cleaner, and a darker one keeps more highlights; the picture's brightness is the same as before. Flash shots keep their own exposure. **Tap** to lock focus and exposure at that point: a ring
shows it (pulsing while focusing, white when locked, red when focus wasn't found) and stays locked, also for the
shot, until you tap **AF LOCK ✕** or tap somewhere else. Exposure is metered on a box about the ring's size; focus
uses the small square inside it (5% of the frame's short side), so a thin subject in front of a busy background
gets the focus. If the square finds nothing to focus on (a plain wall), the Android app tries again with the ring's
area before turning red; on the iPhone the square needs iOS 26 (before that the iPhone picks its own area around the
point, shown as a dot), and faces in the frame no longer pull focus away from the point. **Drag the ring** to move the
point precisely: a 3× loupe shows what's under it, clear of your finger, and it focuses there when you let go. With
**Settings → Track subject after tap** on, the ring then follows what you tapped as it (or the phone) moves, the badge
reads **TRACKING ✕**, and focus keeps adjusting on it (continuous autofocus on the moving square, metering moving
with it); a subject covered for a moment is held, and once it has been out of sight for about half a second the lock
ends by itself and the camera goes back to autofocus ("Subject lost"). A spot with too little detail to follow (a
plain wall) stays a plain lock. Press and hold to see the photo without the look. The
**volume buttons** take a photo too; the viewfinder blinks and the phone ticks on each shot.
**Power button double press** (Android): RawBoy Camera can be the phone's default camera, so pressing the power
button twice opens it, also on a locked phone. Turn on *Settings → System → Gestures → Quickly open camera*. Android
keeps two separate choices, both in RawBoy Camera's Settings: tap **Choose** next to *Unlocked camera* and next to
*Lock screen camera*, and pick RawBoy Camera and **Always** each time (a row without Choose is already set). Until the
lock screen one is set, a double press on a locked phone asks for the passcode first and then shows a black screen.
Turning on or installing another camera app (Pixel Camera, say) clears both choices: set them again, or keep Pixel
Camera disabled. If another camera was set to always open, clear it first (*Settings → Apps → that camera → Open by
default*). On a locked phone it opens over the lock screen without the photos taken before: the thumbnail shows
only the new shots and asks to unlock before opening one, and the camera closes when the screen turns off (also if
it was unlocked since, so the next double press on a locked phone always starts a fresh camera; any shot just taken
still finishes saving in the background). Unlocked
while it is open, it carries on as the ordinary camera.
**UW · W · T** at the bottom of the viewfinder switches between the ultrawide, wide and telephoto lenses, as in
Google Camera (each lens that can deliver RAW is offered). The button right of the shutter switches to the
**selfie camera**, shown only when the front camera delivers RAW; selfies are saved mirrored, as the viewfinder
shows them.

- **QR codes:** point the camera at a QR code and a bar above the lens buttons shows what it holds and what a tap
  does, as the phone's own camera does: **Open** a link (the site's name is shown, so you see where it goes before
  tapping), **Join** a Wi-Fi network (Android 11+: the system's "save this network?" sheet; on iPhones, and for WEP
  networks or older Android, the password is copied instead), **Email**, **Call** (the dialler opens with the number,
  nothing is dialled), **Message** or **Map**, or **Copy** the text. **✕** hides the bar until the code leaves the
  view. Nothing happens on its own: only a tap acts. On a locked phone, anything that leaves the camera asks to
  unlock first. Shooting isn't affected: Android reads a 1280 px greyscale copy of the viewfinder about three times
  a second with ZXing on a background thread (skipped while a burst merges); the iPhone uses AVFoundation's own QR
  detector next to its face detection. On by default; **Settings → QR codes** turns it off.
- **Subject tracking** (Track subject after tap, off by default): a 320 px greyscale copy of each viewfinder frame
  (Android: drawn on the GPU and read back asynchronously; iPhone: made from the video frame on the CPU, about 15 a
  second) is searched for the tapped patch by normalised cross-correlation (`PatternTracker`, shared engine code:
  half resolution near where it should be, then refined; the template slowly learns the patch's new look). The camera's
  focus region moves with it at most ten times a second.
- **Flash:** the bolt button in the top bar (shown when the lens has a flash; usually not the selfie camera) turns
  **Focus-flash** (bolt with "AF") on or off. It works like Google Camera's: the light comes on, the camera focuses with it (unless focus is locked), then the flash fires.
  Exposure works like a flash guide number: the photo is exposed for the distance the lens is focused at (the flash's
  light falls off with its square), never brighter than without flash, and each lens learns its flash strength from
  its flash shots (the camera's own flash metering left the raw several stops overexposed). Flash shots don't
  recalibrate the viewfinder's exposure. The choice is remembered.
- **Shooting:** each shot is one raw frame from the selected lens (Camera2 `RAW_SENSOR`, 12 MP on the Pixel's main lens), saved as DNG to
  `Pictures/RawBoy Camera/RAW/IMG_<date>_<time>.dng`. It is then developed in the background exactly as RawBoy Auto
  develops a raw (tone and noise from the raw itself, then the look with the controls as they were at the shutter)
  and saved as `Pictures/RawBoy Camera/IMG_<date>_<time>-camera.jpg`. The exposure is the phone's own auto exposure,
  lifted when it darkened the frame to protect something bright (a white bird, a window); flash shots, exposed
  manually on the Pixel, are metered by RawBoy (the iPhone's flash is exposed by its own AE, so it is kept too). You can keep shooting meanwhile;
  "Saving N…" shows the queue. The thumbnail opens the last photo. Exposure is metered on the middle half of the
  frame (width and height); a focus lock meters at its point instead.
- **Merge 8 frames** (the burst button in the top bar, or Settings; **Auto** by default): each shot without flash takes 8 raw frames in a quick burst and
  merges them into one DNG before developing, as the phone's HDR+ does for its own JPEGs: each frame is aligned to the
  first (tile by tile, so hand shake is followed) and averaged in where it matches; where something moved, the first
  frame is kept, so moving things don't ghost. Noise drops by about 3× where nothing moves, so the develop picks
  less denoise and keeps more detail. Along the edges, which hand shake takes out of view in some frames, and where something
  moved, fewer frames go in; those parts get extra noise reduction so they don't stand out as a noisier border. Hold still while the burst runs. The frames are merged while the burst is
  still coming in, so the DNG follows soon after the last frame; the JPEG comes out about as fast as from one frame
  (less denoise work). It needs ~200 MB of memory at its peak, so Android may close other apps to make room. The
  shutter greys out ("Merging frames…") until the merged DNG is written, so bursts never overlap.
  The button cycles **On → Auto → Off**. **Auto** (small "A") merges only in low light; the icon is coloured when the
  next shot will merge and gray when it won't (On is always coloured, Off always gray).
  - *Low-light criteria (Auto), for tuning* (`LowLight` in `CameraSettings.kt`): the measure is the preview's
    `ISO × exposure time (s) × post-raw boost`, the light the camera's auto exposure needs (higher = darker). Rough scale:
    sunny day ≈ 0.1, bright indoors ≈ 3, dim indoors ≈ 15–30, night street 60+. Low light **starts at ≥ 6**
    (`ENTER_PRODUCT`, e.g. ISO 400 at 1/60 s) and **ends below 4** (`EXIT_PRODUCT`), so it doesn't flicker at the
    edge. The decision is read when the shutter is pressed. Values are first guesses: compare with the `shutter …`
    logcat line (preview ISO, exposure, boost) in real scenes and adjust.
- **JPEG:** encoded with Google's **jpegli** from 16-bit pixels, full-resolution colour (4:4:4), quality 95 by
  default (Settings: 70–100). jpegli's adaptive quantisation gives fewer artefacts per byte than libjpeg.
- **RAW:** the **RAW** button in the top bar keeps the DNG next to the JPEG (lit) or not (struck through); the same
  setting as in Settings.
- **Settings:** JPEG quality; whether to keep the DNG (off by default: only the JPEG is saved); **Lossy JPEG XL DNG** (Android, shown while the DNG
  is kept; off by default: once the JPEG is saved from the uncompressed raw, the DNG is re-saved as a DNG 1.7.1 with
  lossy JPEG XL compression, visually lossless and about a quarter of the size; it stays uncompressed if that fails); **Smaller photos**
  (on by default: 3000 px on the long side, area-downscaled from the full-resolution develop, with the grain sized to
  the smaller photo and a light sharpening after the downscale; off saves full resolution, unsharpened); **50 MP / 48 MP**
  (shown when a lens offers a maximum-resolution raw stream of the same field of view, such as 50 MP `RAW10` on the Pixel 9 Pro's main `W` lens: writes a 16-bit Bayer DNG via `MaxResDngWriter` — remosaicing 4×4 Quad-Bayer streams into standard 2×2 Bayer — and develops the JPEG from it, while keeping normal resolution on virtual crop lenses; frame merging is off on full-resolution lenses); **Merge 8 frames** (see above); **Shutter sound** (off by default: a click on each
  shot; where the law requires it, such as Japan and Korea, Android or iOS reports so and it is always on and greyed out,
  as it is on iPhones before iOS 18);
  **Geotag** (off by default; see below); **QR codes** (on by default; see above); **Track subject after tap** (off by
  default; see above);
  **Remember camera & settings** (off by default: each start uses the
  back W lens, Yellow Portrait 400 and default sliders; on keeps lens, side, look and sliders).
- **Geotag:** with it on, each JPEG and DNG gets the GPS tags of where it was taken: latitude, longitude, altitude
  above sea level and the fix's UTC date and time. Location access is asked for only when you turn it on (approximate
  location is enough on Android too, just less exact); without it the switch stays off. The position comes from the
  phone's location service while the camera is open (Android: the fused provider, else GPS and network, no Google
  Play services; iOS: Core Location) and is stopped as soon as the camera leaves the screen. A shot gets the latest
  fix up to 10 minutes old, so a photo taken before the first fix (or with location off in the system) has no GPS.
  Android's DngCreator writes no altitude, so the camera appends a complete GPS IFD to the DNG and points IFD0 at it
  (`DngGps`); Android 14+ converts the fix's height above the ellipsoid to height above sea level. The GPS tags
  carry on through RawBoy and Auto exports of the DNG (JPEG and TIFF, all platforms).
- **How the viewfinder matches the final:** the camera's preview stream is asked for the plain sRGB tone curve, so
  the viewfinder can turn it back into linear light and run the same develop shader on it. The auto develop is
  worked out from a 512 px copy of the live frame about three times a second (faces from the camera's face detection
  steer exposure as skin does in Auto). After every shot the viewfinder's exposure is calibrated against the raw,
  so it converges on the final over a few shots (separately per lens). Skin retouch and the ISO-based
  denoise/sharpening appear only in the final.
- **Noise:** a phone sensor is noisier than the camera raws Auto's noise settings were tuned on, so Camera picks
  denoise and sharpening as for 4× the shot's ISO (2 stops): base ISO stays clean, ISO 400 gets Denoise 20,
  ISO 1600 gets 45, ISO 6400 and up 65.

## Black and white

The **B&W** button (left of the Look menu, next to the film strip) switches RawBoy Camera and RawBoy Film to black and white, and back. In B&W the **Look** menu
lists the black and white films RawBoy Auto has: Yellow Mono Soft, Yellow Mono 400 (the default), Yellow Mono Push,
Yellow Mono Hard, Yellow Cine Mono and Yellow Cine Mono Soft (AgX plus each film's LUT, with RawBoy's grain). The
viewfinder shows black and white live. Each mode keeps its own pick, so switching back finds the colour look again.

- **Filter** takes Warmth's place: **None**, **Yellow** (the default), **Orange**, **Red** and **Green**, like a
  coloured filter on the lens. It lightens things of its own colour and darkens the others before the picture turns
  grey: Yellow and Orange darken a blue sky a little and a lot, Red makes it nearly black and smooths skin, Green
  darkens skin and lips and lightens leaves. Middle grey keeps its brightness with every filter, as a photographer
  opens up by the filter factor. Blown highlights stay white. Technically: channel gains on linear Rec.2020 after white
  balance (`DevelopParams.bwFilter`, `BwFilter.kt`), then the scene is made grey (Saturation -100) before the film's LUT.
- **Strength** blends the film's tones with plain grey AgX: the picture stays black and white at any Strength.
- The grain is three times the black and white look's own (as in RawBoy Auto), for a grainier, more filmic picture.
- The JPEG is black and white; the **DNG stays in colour**, so the shot can still be developed in colour later.
- Press and hold still shows the photo in colour, without the look.
- In RawBoy Camera the colour **Look** menu no longer lists the black and white looks; a black and white look remembered
  from before opens in B&W mode.

## Film mode and RawBoy Film

RawBoy Camera has a **Film** toggle, a film strip left of the Look menu: on (the default), the **Look** menu
lists the film stocks below; off, the looks on RawBoy's film LUTs. Each keeps its own pick, and Strength, Brightness
and Warmth are shared. The **B&W** button sits next to it; leaving B&W comes back to the mode it left, and turning
Film on in B&W leaves B&W. Photos save to `Pictures/RawBoy Camera` (`…-camera.jpg`, DNGs in `RAW/`) in both modes. The film and
LUT looks share ids (`portra400` is both), so Film mode's pick is kept separately (`CameraSettings.film`/`filmLookId`,
prefs `film`/`filmLook`).

**RawBoy Film** is RawBoy Camera with only the film stocks as its looks and no toggle (everything else above applies;
it is due to be retired in favour of RawBoy Camera's Film mode): the same 12 stocks
as RawBoy Auto's Film mode, rendered the same way. Yellow Portrait 400/800, Yellow Vivid 100, Yellow Warm 200, Green
Pastel 400, Green Everyday 400, Yellow Cine 250D and 500T (printed on cinema print film), and the slide films Green
Vivid Slide 100, Green Slide 100, Yellow Slide 100 and Yellow Classic 64 (scanned, not printed). Colour negatives are
printed on colour paper. **Natural** is the AgX develop alone. It saves to `Pictures/RawBoy Film` (`…-film.jpg`, DNGs
in `RAW/`), so its photos stay apart from RawBoy Camera's. It is built from this repository (`app-camera` flavour
`film`, iOS target `RawBoyFilm`) with the same engine as the other apps, so it opens JPEG XL DNGs and can save lossy
JPEG XL DNGs like RawBoy Camera.

- The film replaces AgX: after white balance, exposure and Shadows/Highlights, the scene light exposes the negative,
  which is printed and the print scanned. The negative and the print are spektrafilm's 2-LUT bake of each stock
  (film LUT: light → film density; print LUT: density → sRGB; [spektrafilm](https://github.com/andreavolpato/spektrafilm)
  by Andrea Volpato, CC BY-SA 4.0, in `luts/spektrafilm/`).
- **Grain**, **halation** (light reflected back from the film base, the red glow around highlights) and in-emulsion
  **scatter** are RawBoy's own (`shaders/film_form.glsl`): grain in film density from each stock's RMS
  granularity, halation and scatter sized in micrometres on a 36 mm frame, so viewfinder and photo match and a
  downscaled photo shows the grain as a smaller scan would.
- **Strength** blends the film render with the AgX one (grain and halation fade with it). Middle grey stays where
  AgX puts it, so exposure and Brightness behave as before. Whites reach the paper's white (about 0.85), not 1.0.
