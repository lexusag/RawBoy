# RawBoy Camera

A camera for the back lenses (made for the Pixel 9 Pro and measured on the OnePlus 11; any phone whose camera offers RAW works, see Phones below). The
viewfinder shows the photo developed live: RawBoy Auto's automatic develop plus the **look** chosen from the
**Look** menu under the viewfinder, with **Brightness** and **Warmth** as in Auto (one thin row each; **Strength** is in Settings › Look strength, so the viewfinder keeps the room). **Brightness** also changes the exposure the camera shoots with (exposure compensation, up to the camera's limit, usually ±2 to ±4 EV): a brighter setting gathers more light, so its shadows are cleaner, and a darker one keeps more highlights; the picture's brightness is the same as before. The slider runs from −3 EV to +3 EV around the camera's normal exposure (0); auto exposure keeps working at any setting, so the viewfinder still follows the scene, and a slider move goes straight to its new brightness. In the dark the camera may already be at its longest exposure and highest gain (the OnePlus 11 at about 1/15 s and ISO 6400): a brighter setting then gathers nothing more, and the picture is brightened in the develop alone. The camera's auto exposure doesn't always give what is asked even in ordinary light (the Pixel 9 Pro often gives only a fraction of a brighter setting at first, and sometimes the rest over several seconds), so RawBoy measures what each frame got and develops the rest: the picture stays at the slider's brightness while the exposure underneath catches up. Flash shots keep their own exposure (where the camera's own flash metering exposes them, on OnePlus phones, Brightness moves it too). **Tap** to lock focus and exposure at that point: a ring
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
**Held sideways** the controls move to the right edge, under your right thumb: the shutter in the middle of the
edge (the selfie switch above it, the last photo below), one tall slider beside it, and round **B** and **W**
buttons (Brightness, Warmth) to pick what the slider changes, with the lens buttons in a column beside them
(the longest lens at the top); each shows its value, Brightness is picked
first, and a double tap on a letter or the slider resets it. In B&W mode **W** becomes **F** (the filter), which lists
the filters beside the shutter. The Look menu is above them, with the Film and B&W buttons under it; RAW, Frames, Burst, Flash, ? and
Settings move to a column at the left. The viewfinder stays upright and photos come out the right way round, as in
portrait. With auto-rotate off the screen stays portrait.
**UW · W · T** at the bottom of the viewfinder switches between the ultrawide, wide and telephoto lenses, as in
Google Camera (each lens that can deliver RAW is offered; W is the lens a logical back camera starts on, else the only
camera, else the one nearest 26 mm). The button right of the shutter switches to the
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
- **Selfie flash (Android):** the selfie camera has no flash unit, so the bolt button there turns on a **screen flash**: on the
  shutter the screen goes to full brightness with a wide warm-white frame around the picture, and the shot is taken
  about half a second later, exposed by the camera's AE under that light (single frame, no burst merging). On phones
  whose camera starts the exposure late (the OnePlus 11: about 0.36 s after the shutter request), the frame stays lit
  until the exposure is over.
- **Flash:** the bolt button in the top bar (shown when the lens has a flash) turns
  **Focus-flash** (bolt with "AF") on or off. It works like Google Camera's: the light comes on, the camera focuses with it (unless focus is locked), then the flash fires.
  Exposure works like a flash guide number: the photo is exposed for the distance the lens is focused at (the flash's
  light falls off with its square), never brighter than without flash, and each lens learns its flash strength from
  its flash shots (the camera's own flash metering left the raw several stops overexposed on the Pixel). On phones
  where that manual way gets none of the flash's light (OnePlus), the camera's own flash metering exposes the shot
  instead: a pre-flash, then the photo, 1 EV darker in the raw than the camera picks (the OnePlus 11's ultrawide
  clipped white paper otherwise), which the develop brightens back. Flash shots don't recalibrate the viewfinder's
  exposure. The choice is remembered.
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
- **HDR gain map** (Android, **Settings → HDR gain map**, off by default): saves the JPEG as an **Ultra HDR JPEG**. The picture itself is unchanged; a small second image (the gain map) tells HDR screens to show highlights brighter, up to 2 stops, easing in from the upper highlights (about 72% of the look's white) and reaching the full boost near its brightest white (scaled by the active film stock or LUT's white level so dimmed film whites still lift without blowing out midtones). Apps that don't know gain maps show the normal photo. The gain map is worked out from the finished picture, so it makes the highlights brighter on an HDR screen but doesn't bring back detail the picture already lost; a photo with nothing bright stays an ordinary JPEG. (`kKnee`, `kWhite`, `kHeadroomEv` in `ultrahdr.h`).
- In **B&W** mode (also with Film on) the random light leak goes grey with the picture.
- **Random light leak** (Android and iOS, **Settings → Random light leak**, off by default): adds one random procedural film leak to saved JPEGs: an edge burn, blob, sprocket holes, rebate glow, flare or start of roll, with random colours and placement. **Frequency** (1/5, 2/5, 3/5, 4/5 or 5/5, default 5/5) picks how many shots in each 5-photo sequence get a leak at randomly shuffled positions, so lower frequencies stay unpredictable. **Short-side sprockets** (off by default) also allows sprocket holes on the short edges. The DNG is untouched and the viewfinder doesn't show it. iOS draws the same leaks (`FilmLeaks.randomForCamera`) and the same shuffled 5-photo sequence (`LightLeakSequence`).
- **RAW:** the **RAW** button in the top bar saves RAW DNG only by default (lit, with an embedded processed JPEG
  preview), or JPEG only (struck through); the same setting as in Settings (where **Also save JPEG** and **Embedded
  preview** / **Pure RAW** live).
- **Language** (Android, **Settings → Language → Interface language**): *Phone* (default) follows the phone's language, *English* and *Українська* (Ukrainian) override it, and the screen changes at once. The viewfinder, Settings, the help sheet, accessibility labels and messages are translated; look and film stock names, QR code contents and the device report stay as they are. Code: the text in the source stays English and goes through `tr("…")` (`i18n/Strings.kt`); `i18n/StringsUk.kt` maps each English string to Ukrainian, `%s` marking values; a string with no entry shows in English, so a new feature needs its Ukrainian line added there. Not on iOS yet.
- **Settings:** JPEG quality; **Look strength** (0-100, how much of the look the photo gets; it used to be a slider under the look menu); **Keep raw (DNG)** (off by default: only the JPEG is saved; when on, saves **RAW only** into `Pictures/<Folder>/RAW` on Android / `Photos › RawBoy Camera RAW` on iOS, with **Also save JPEG** off by default to save a standalone JPEG alongside each DNG, and **Embedded preview** writing a developed JPEG preview into the DNG via the Adobe DNG SDK — **3000 px** at quality 85 by default, optional **12 MP** (4000 px cap) at quality 85, or **Pure RAW** with no embedded preview, bypassing decode and GPU develop when JPEG is off); **Lossy JPEG XL DNG** (Android, shown while the DNG
  is kept; off by default: re-saves the DNG as a DNG 1.7.1 with lossy JPEG XL in the same pass as the embedded preview, preserving any `RBDP` depth trailer);
  lossy JPEG XL compression, visually lossless and about a quarter of the size; it stays uncompressed if that fails); **Smaller photos**
  (on by default: 3000 px on the long side, area-downscaled from the full-resolution develop, with the grain sized to
  the smaller photo and a light sharpening after the downscale; off saves full resolution, unsharpened); **50 MP / 48 MP**
  (shown when a lens offers a maximum-resolution raw stream of the same field of view, such as 50 MP `RAW10` on the Pixel 9 Pro's main `W` lens: writes a 16-bit Bayer DNG via `MaxResDngWriter` — remosaicing 4×4 Quad-Bayer streams into standard 2×2 Bayer — and develops the JPEG from it, while keeping normal resolution on virtual crop lenses; frame merging is off on full-resolution lenses); **Merge 8 frames** (see above); **Shutter sound** (off by default: a click on each
  shot; where the law requires it, such as Japan and Korea, Android or iOS reports so and it is always on and greyed out,
  as it is on iPhones before iOS 18);
  **Geotag** (off by default; see below); **Frames** (off by default, also toggled on/off from the top-bar Frames button which restores the last enabled frame or **Pentax 645** by default: a submenu offering either **Date stamp** — imprints today's date in the bottom-right corner of the JPEG in `DD MM 'YY` by default, or `'YY MM DD` / `MM DD 'YY`, drawn like a quartz film data back with chamfered 7-segment LED light — or **Pentax 645** — frames the photo with a dark film-base rebate that covers its edges (the picture keeps its size, 4:3 stays 4:3; nothing is added around it, and the photo isn't scaled) with convexly rounded black stripe ends and 5×7 dot-matrix LED shoot info always along the shorter side of the photo: today's 1-based frame number (`#1`), mode `FILM` / `LOOK` / `BW`, shutter speed, aperture, exposure compensation EV, metering icon — larger multi-pattern frame when auto-metered, smaller spot icon when tap-metered — lens focal length (`24mm`), ISO (`ISO400`), and separate **Date** (`DD MM 'YY`, `'YY MM DD`, `MM DD 'YY`, or `jan 26`) and **Time** (`24h` or `12h (am/pm)`), with an option to **Flip info upside down** 180° and drag-and-drop reordering of items under **Shoot info**; in B&W mode both Date stamp and Pentax 645 render in neutral black and white); **Grain** (on by default; off removes the look's grain, Film's included, from the viewfinder and photos); **QR codes** (on by default; see above); **Track subject after tap** (off by
  default; see above);
  **Remember camera & settings** (off by default: each start uses the
  back W lens, Yellow Portrait 400 and default sliders; on keeps lens, side, look and sliders); **Reset settings to defaults** (returns photo, capture, video, viewfinder, experimental, look and camera choices to their defaults after confirmation, keeping learned camera calibration). Below it, before the credits, the **phone profile** (see below).
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
  ISO 1600 gets 45, ISO 6400 and up 65. Looks outside Film mode (LUT looks, Natural) have no film grain to hide shadow noise, so they get at least Denoise 12 and Color denoise 70, which reaches the coarse colour stage (Experimental looks such as Redscale: 22 and 70).
- **Phone profile** (Android): some of the camera's numbers and workarounds belong to one chip or phone maker
  (the preview's colour path and the raw's extra black were measured on a Pixel 9 Pro's Tensor chip; Samsung phones add
  a punchier look to saved photos). At start the camera reads the phone's chip maker (`Build.SOC_MANUFACTURER`, on
  Android 10-11 `Build.HARDWARE`), manufacturer and model and builds its profile from layers: neutral, then the chip
  maker's, the phone maker's and the model's, where they exist. The end of Settings shows the result, e.g. *Phone
  profile: Google Tensor* or *Phone profile: neutral (this phone hasn't been tested)*, with the chip and model it
  detected; logcat has the same and every value under the tag `RawBoyPlatform`. Today there are layers for Google
  Tensor, Qualcomm Snapdragon, Samsung and OnePlus; other phones get the neutral profile, which takes the preview as
  plain sRGB and adds no extra black. Snapdragon phones (older Pixels included) develop photos at normal GPU priority:
  on a phone hot from long shooting, the low priority the Pixel uses let the viewfinder starve the develop (a photo
  without Film took minutes instead of ~3 s on the OnePlus 11); Samsung phones keep the low priority. OnePlus phones ask for the preview's sRGB curve at evenly spaced
  points (the OnePlus 11 reads the points that way, whatever their spacing: with the points packed near black, as other
  phones get them, its viewfinder came out about twice as contrasty and saturated as the photo), and list their
  stand-alone cameras rather than the logical camera that also covers them (RAW through the logical camera froze the
  preview). On OnePlus phones the viewfinder also takes the preview as being as bright as the photo's raw, with the
  camera's white balance in it, so its learned brightness stays near 1 in any light and needs no raw metering before
  the first photo; it shows the shadow lift backlit photos get (their preview has no local lift of its own), and it
  reads the curve's darkest step as the straight line the camera draws there. OnePlus photos are decoded with the
  DNG's exact black level (the decoder used to drop its fraction, up to 0.8 of a raw level at high ISO) and keep the
  noise below black instead of clipping it, so the deepest shadows of night shots stay neutral instead of turning
  magenta. The OnePlus 11's model layer brings the ultrawide's paler preview up to its photos' saturation, corrects its
  main and ultrawide cameras' black at high ISO (measured on the sensors) and denoises its selfie camera as the noisier
  sensor it is (*Phone profile: Qualcomm + OnePlus + OnePlus 11*). Debug builds can take the phone for another chip (*Take the phone
  for*, from the next start); calibration learned under such a profile is kept apart from the phone's own.
  How profiles are built, what each value does and how to add a phone: [Camera phone profiles](camera-platforms.md).
- **Phones:** tuned on the **Pixel 9 Pro** (Google Tensor; other Tensor Pixels get the same values) and measured on
  the **OnePlus 11** (all its features checked, with the limits below). **Samsung** phones keep exactly what they did
  before phones were told apart (the Pixel's preview colour path and extra black plus the +25 look), unchecked since.
  Every other phone, Pixels before the Pixel 6 included, gets the neutral profile (Snapdragon phones also the normal
  develop priority): photos, video and the viewfinder work wherever the camera offers RAW, but the viewfinder may differ
  from the photo until each lens has learned its calibration over a few shots, and nobody has checked those phones.
- **Known limits on the OnePlus 11:** no telephoto (it is a system-only camera) and no full-resolution RAW (binned only,
  so the 50 MP switch doesn't show); flash on a near, light subject comes out brighter than the scene without flash
  (+2.4 to +2.8 EV at about 1 m, no clipped highlights); Brightness in the dark is accurate to about ±0.4 EV; the
  viewfinder is 10-15% less saturated than the photo at ISO 6400; single ultrawide frames at ISO 6400 have slightly
  red deep shadows (merged shots don't); videos don't get the backlight shadow lift photos and the viewfinder get.
- **Share device report** (Android; Settings, under the phone profile): gathers what a profile for a new phone is made
  from into a plain text file and opens the system share sheet; nothing is sent unless you send it. It lists the phone
  as detected and the profile's layers and values; every camera and physical lens (support level, capabilities, RAW
  and preview sizes, tone map modes and curve points, ISO, exposure, frame rate and boost ranges, exposure
  compensation step, flash, OIS, stabilization, lens shading map, focus calibration, session keys); which lenses the
  camera lists as UW / W / T and why it passes over the others; the GPU (`GL_RENDERER`, the extensions the camera uses,
  the EGL window configs and how many are recordable); the H.264 and HEVC encoders with their input colour formats; the
  video probe's result (the way video is recorded on this phone, see Video); and the calibration learned per lens. One `key: value` per line in a fixed order, numbers written the same in every
  language, so two phones' reports compare line by line. It holds no serial numbers, accounts, locations, file names or
  photos.
- **Collect tuning data** (Android; Settings, under Share device report): for the next 10 shots, keeps a 512 px copy of
  what the viewfinder showed at the shutter and of the photo's raw (linear, no metadata), with the numbers behind each
  (lens, exposure, the preview's colour and white balance) and the camera's own log lines. Take photos as usual: indoors
  and outdoors, every lens and the selfie camera. **Share tuning data** zips them with the device report and opens the
  share sheet (email, Drive, a GitHub issue); **Delete** removes them, **Stop collecting** stops early. Nothing leaves
  the phone until you share it, and the camera has no network access. The file holds no full-size photos, locations or
  sound; the log may show the photos' file names. This is how a phone is tuned without having it in hand
  ([phone profiles](camera-platforms.md#adding-a-phone)).

## Black and white

The **B&W** button (left of the Look menu, next to the film strip) switches RawBoy Camera to black and white, and back. In B&W the **Look** menu
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
  from before opens in B&W mode. With Film off, it lists the colour looks under **Color** and **Experimental** (Movie
  Green, Movie Green V2, Redscale, Redscale V2, Lagoon, Violet Dust, Unseen).

## Film mode

RawBoy Camera has a **Film** toggle, a film strip left of the Look menu: on (the default), the **Look** menu
lists the film stocks below; off, the looks on RawBoy's film LUTs. Each keeps its own pick, and Strength, Brightness
and Warmth are shared. The **B&W** button sits next to it, and each switches by itself: in B&W the menu lists only the black and white looks
below, Film on or not, and switching B&W off comes back to Film if it is on. With both on, B&W is punchier: Contrast
+20 on top of the look's and 1.5 times B&W's grain (4.5 times the look's own). Photos save to `Pictures/RawBoy Camera` (`…-camera.jpg`, DNGs in `RAW/`) in both modes. The film and
LUT looks share ids (`portra400` is both), so Film mode's pick is kept separately (`CameraSettings.film`/`filmLookId`,
prefs `film`/`filmLook`).

The film stocks are the same 12 as RawBoy Auto's Film mode, rendered the same way: Yellow Portrait 400/800, Yellow
Vivid 100, Yellow Warm 200, Green Pastel 400, Green Everyday 400, Yellow Cine 250D and 500T (printed on cinema print
film), and the slide films Green Vivid Slide 100, Green Slide 100, Yellow Slide 100 and Yellow Classic 64 (scanned, not
printed). Colour negatives are printed on colour paper. **Natural** is the AgX develop alone.

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

## Video (Android and iOS)

*iOS (2026-11-22):* the same switch, record button, AE LOCK, 9:16 mask and **Settings › Video quality** (Low 8, Optimal 16, High 24 Mbit/s HEVC, H.264 where HEVC isn't offered) with the file saved to **Photos › RawBoy Camera** as `VID_<date>_<time>-camera.mp4`; the volume buttons and Camera Control record too. **Settings › Video stabilization** (on by default) is the camera's own (standard mode, a small crop and a little delay, video mode only). Video mode runs the camera on its 1080p video format (the photo format has no stabilization): the viewfinder turns 16:9 portrait with no darkened bands, and the camera restarts when you switch PHOTO / VIDEO. No Flat video, no motion data, no stabilized copies. Sound is the microphone's (stereo where the iPhone offers it; asked the first time video mode is switched on). The file is always 1080 x 1920 and a phone held sideways is stored with a rotation, so players show it landscape. Not compiled or tried on a phone yet. The notes below are Android's.

Video is always available: the **PHOTO / VIDEO** pill under the viewfinder, above the shutter (or a swipe left or right on the shutter area; in landscape the pill stands in the shutter column), switches to video mode (the RAW, Frames, Burst and Flash buttons hide). The shutter becomes a red record button, the volume buttons start and stop too, and the timer shows beside the status. The recording is the viewfinder as it looks, with the chosen look or film stock baked in: 1080p, 30 fps, HEVC (H.264 on a phone without an HEVC encoder; bitrate by **Settings › Video quality**: Low 8, Optimal 16 (the default) or High 24 Mbit/s, fixed while recording and clamped to what the encoder accepts) and stereo AAC from the microphone (asked for the first time video mode is switched on; refusing gives silent videos), saved to `Movies/RawBoy Camera/VID_<date>_<time>-camera.mp4`. **Settings › Optical stabilization** (off by default) turns the lens stabilizer (OIS) on in video mode; off really turns it off. The phone's own electronic stabilization is never used (it crops and delays the picture). Photos are never stabilized.

In video mode, **AE LOCK** (top right of the viewfinder) holds the exposure and tapping the picture locks focus (**AF LOCK**); the two are independent. **Settings › Optical video stabilization** uses the lens stabilizer only (no crop, no delay).

**Settings › Flat video for grading** records without the look: an Apple Log picture in Rec.2020 colours (no grain, bloom or grading; 14, 28 or 38 Mbit/s HEVC by Video quality), named `...-flat+1.0ev.mp4` (exposed 1 EV higher for the shadows; undo it with -1 EV when grading). It plays washed out; grade it later on the web video page (Apple Log input): pick a look or film stock.

- The viewfinder is 4:3, a video is 16:9: the parts the file will not have are darkened. A phone held sideways records a landscape file.
- Film grain moves with the frames in video mode. The live exposure eases much slower than for photos, so brightness does not pump.
- Skin retouch, the ISO-based denoise and sharpening, bursts, flash and raw are photo-only. The lens and the camera (selfie) can't be changed while recording, and leaving the app stops the recording.
- No 4K, no 10-bit, no log beyond Flat video; the lens/stream setup is the photo one. How it works: `ViewfinderRenderer.videoSink` draws the same develop pass into the `MediaCodec` input surface through an EGL window surface (`gl/VideoOutput.kt`: in the viewfinder's own context, or in one of its own on phones that need it, see below); `capture/VideoRecorder.kt` runs the encoders and the MP4 muxer. The original exploration and staged plan: `docs/video.md`.
- **Finding the way to record on a new phone.** Phones differ in what their GPU driver and video encoder accept, so the first recording tries, in order: the standard path (an EGL surface in the viewfinder's context: the Pixel 9 Pro's, the only one it ever uses); the encoder's surface in a GL context of its own (the OnePlus 11's Snapdragon encoder refused the standard path's buffers); the viewfinder itself on a recordable config; the phone's software H.264 encoder (slower, lower frame rate). A way counts as working when the encoder hands out its first frame, usually 0.2-0.3 s after the start; a failed try is taken down and the next one starts at once, so the recording just begins a fraction of a second later. The working way is remembered until the next system or app update. The way a phone records with gives way only after failing in two recordings in a row (the first time, another way is used for that recording only), and another way than the standard one is remembered only after the standard one failed outright (a refused surface or an encoder error), never after a slow start. If the next way needs the viewfinder made again, the viewfinder restarts once with *Video is set up for this phone: the viewfinder restarts once. Press record again*. When nothing works, the message says so at once (instead of a timer running and *Nothing was recorded* at the end); an encoder (or its surface) that fails during a recording stops it at once, keeps what was recorded and says so. The device report's *Video probe* section shows the way in use and the last probe's tries; logcat has them under `RawBoyVideo` and `RawBoyCamera`.

## Depth map in the DNG (Android, experimental)

**Settings › Experimental › Save depth map in DNG** saves a small 8-bit depth map with each photo, appended to the DNG (`RBDP` trailer after the file's last byte; DNG readers ignore it, the lossy JPEG XL re-save keeps it, other tools that rewrite the DNG drop it), turned upright like the photo. **Depth from** picks where it comes from; only the sources the active lens has are listed:

- **Depth sensor**: the camera's own depth output (`DEPTH16`), where a lens has one (none of the Pixel 9 Pro's do). A stream beside the raw; each still keeps the depth frame with its sensor timestamp.
- **Dual pixel**: the sensor's phase-detect autofocus data, which the Pixel 9 Pro streams beside the raw on its back lenses (`RAW_DEPTH10`, 4080×768 on the main lens; the selfie camera refuses it next to the raw and doesn't list it). Every column is half a pixel, even = the left of the lens's pupil, odd = the right; out of focus the two halves see the scene shifted sideways, one way behind the focus plane and the other in front. RawBoy matches them (`DualPixelDepth`), so the map is a *defocus* map: mid-grey is the focus plane. Measured, not guessed, but coarse: blurred, textureless areas and horizontal edges carry little signal and are filled in from around them. About 1 s a shot on the Pixel 9 Pro. For a burst, the first frame's.
  - **Distances in millimetres** (after **Calibrate dual-pixel distances**, under *Depth from* while Dual pixel is chosen): a one-off screen measures the main lens's dual-pixel shift per dioptre of defocus against ARCore's depth (Google Play Services for AR; it shares the camera with RawBoy's dual-pixel stream; move the phone slowly over near and far things for ~30 s; saved per phone, kept through *Reset settings*). After that each Dual pixel shot on that lens also runs the AI estimate: the map is the AI's shape, focused on what the camera focused on (the sharpest dual-pixel cells), and its distances are anchored at the lens's focus distance there, with the dual pixel setting only the scale (shifts no distance could make, such as the matching artifacts of blurred backgrounds, are ignored). When the frame supports it, the DNG's map carries a distance per pixel in millimetres (trailer version 2) and RawBoy Pro on the web tells the distance where you pick the focus; when it doesn't, the map is saved without distances rather than with wrong ones. Per pixel the dual pixel alone is too weak for distances (its shift is ~0.1 half-pixel per dioptre on the Pixel 9 Pro's main lens); the combination came out at ~8% median error against ARCore on held-out frames (p90 ~30%). ARCore offers depth only on the main back camera, so only W is calibrated; ~5 s a shot.
- **AI estimate** (any lens): Depth Anything V2 Small estimates depth from the photo (on the phone, about 2-3 s a shot; the model loads once, 19 MB). Inside a person (MediaPipe's segmentation) nothing reads farther than a little behind them, so glasses don't let the background through; with a person in the frame the focus is on them.

If the chosen stream brings no frame (the phone refused it, a long exposure), the AI estimate stands in. A tap to focus sets the focus depth; otherwise it is the middle (sensor), the focus plane (dual pixel) or the person (AI). **Generate portrait in camera** (under it; also the **Portrait** button in the top bar, which toggles both switches on and off together) blurs the saved JPEG's background from the map with the same lens blur as Pro's masks. RawBoy Pro on the web shows the map under **Detail › Portrait blur**. iOS not ported.

## Motion data with videos (Android, experimental)

Under **Settings › Experimental**, **Save motion data with videos** (off by default) prepares videos for stabilizing afterwards, the first step of the software stabilization plan:

- The video records the **whole 4:3 viewfinder** (1920 × 1440, or 1440 × 1920 upright) instead of the 16:9 slice, so a later stabilizer has room to crop into; the viewfinder then shows no darkened bands.
- Beside it, a `.motion` file of the same name goes to `Android/data/app.rawboy.camera/files/motion/` (reach it with `adb pull` or over USB): the gyroscope (uncalibrated, at its highest rate, 400 Hz on the Pixel 9 Pro) and accelerometer, every camera frame's timestamp, exposure, rolling shutter skew, focus, active lens and crop, the lens stabilizer's shift samples where the lens reports them (Pixel 9 Pro: the telephoto only), and which frame went into the file at which time. Its header holds the lens's calibration (intrinsics, distortion, pose) and the sensors' details. Format: `capture/MotionFormat.kt`; `python3 tools/motion/dump.py <file>` summarises one.
- The gyroscope runs while video mode with motion data is on (not only while recording), so the file starts half a second before the video's first frame.
- **Stabilize after recording** (on by default, under the motion data switch): when a recording stops, a steadied copy is rendered from the motion data in the background and saved beside the video as `VID_…-stab.mp4` (dated like the original, so galleries show it next to it), same size, a 70% crop of the frame scaled up, with the original sound. The camera's rotation from the gyro is smoothed (half-second Gaussian, longer for the telephotos, up to a second at 10x and beyond, since they magnify the hand's slow sway); each output row is taken from the source row exposed at its time (rolling shutter), and the lens stabilizer's measured shift is added where the lens reports it. Where the crop would show the frame's edge, the steadied view follows the camera, easing in over about 0.4 s instead of jumping. A frame the recorder lost repeats the one before. Selfie videos aren't stabilized, nor videos from lenses whose optical stabilization can't report its movement (Pixel 9 Pro T2 and T3, with the Optical stabilization switch on): their optical stabilization is smoother than the software one, which can't know what the lens already took out. Switch Optical stabilization off to have them stabilized in software. Message *Stabilized copy saved* when done; logcat `RawBoyStab`.

## Viewfinder from RAW (Android)

Under **Settings › Viewfinder**, **Viewfinder from RAW** (off by default; shown only on phones whose profile allows
it, the Pixels with a Tensor chip for now) builds the viewfinder from the camera's raw sensor data instead of the
phone's processed preview. The camera then sends every preview frame twice: as before to the ISP's preview, and as a
RAW_SENSOR frame. The viewfinder decodes the raw frame on the GPU as the photo's decoder does (black and white
levels, lens shading map, white balance, the DNG's colour matrix), at half the sensor's resolution (one pixel per 2×2
block, about the screen's), and develops it with the same look. The aim: the viewfinder shows the photo's own data
and colours, with no per-lens calibration against the ISP's preview.

- Turning it on or off restarts the camera. Maximum-resolution lenses keep the ISP's preview (their raw can't share
  a request with the preview). Long exposures freeze it on the last raw frame while they run.
- Where the phone's profile allows (the Tensor Pixels), the camera then streams only the raw frames: the ISP's own
  preview stops, which saves its work and the viewfinder's extra redraws (30 frames a second, the raw's own rate).
- Logcat `RawBoyViewfinder` prints the fps every 5 s, and in this mode the raw upload time and frames copied/dropped.
- Not yet: full demosaic, the decoder's exact highlight blend (a simple blend to neutral stands in), hot pixels, the
  DNG warp's lens correction in the viewfinder (the develop applies it as before), iOS (AVFoundation streams no raw).

## Easy mode (Android prototype)

**Settings › Easy mode** (off by default, the first switch under Language) turns RawBoy Camera into a plain point-and-shoot,
for handing the phone to someone who just wants photos.

- **Shown:** the viewfinder (tap to focus, pinch to zoom, AF LOCK ✕ to let go), the lens buttons, RAW and Frames, the flash button
  (photo mode, phones with a flash or the selfie screen flash), Photo / Video, **Colour / B&W**, a bigger shutter (96 dp),
  the last photo and the selfie switch, and the Settings gear. Landscape: the lenses and Colour / B&W in a narrow column
  beside the shutter.
- **Colour** is Film mode on the default film stock (Yellow Portrait 400); **B&W** is Film + B&W on the default
  black and white stock (Yellow Mono 400) with the Yellow filter, both at the default Strength. The full camera's own look picks stay as
  they were.
- **Hidden:** the look menu, Film and B&W buttons, Brightness and Warmth, the Burst and help buttons,
  the timer and long exposure, the zoom buttons, grid, level and histogram, the focus ring's drag and loupe, and press
  and hold to see the photo without the look.
- **Forced while it is on** (the stored settings keep their values, so switching it off brings everything back as it was):
  no border, no random light leak, Brightness and Warmth 0, frame merging on Auto, no
  timer or long exposure, no subject tracking, no flat video or motion data. RAW (and its lossy JPEG XL choice), the frame and its options, size, JPEG quality, HDR gain map and grain
  stay as set outside Easy mode.
- **Settings** then shows only Language, Easy mode, Shutter sound, Geotag and QR codes (and the licences).
- Lighter as well: no histogram or level work, no tracking copies.

## Street mode and fast start (Android)

Double-pressing the power button (with RawBoy Camera set as the default camera) opens straight into **Street mode** — a pocket-ready single-frame camera built to launch momentarily and shoot without focus or burst-merge lag. It can also be opened from a pinned **Street** app shortcut, the **RawBoy Street** Quick Settings tile, or **Settings › Street mode** (and power-button activation can be switched off under **Settings › Power double-press opens Street**).

- **Instant start (all modes):**
  - **Cached lens fast-open** (`FastLensCache`): persists the target lens descriptor keyed by `Build.FINGERPRINT` so startup opens the camera in 1–2 IPCs instead of waiting ~1.7 s for full multi-camera discovery; remaining lenses, selfie camera, max-res MP and depth capabilities populate asynchronously after the camera is `READY`.
  - **Early camera open & LUT preload:** `CameraActivity.onCreate` calls `CameraController.preopen` and preloads the active film stock / LUT into RAM in parallel with Compose layout and EGL setup.
  - **Binary GL shader cache & instant frame-0 preview:** `GlProgramCache` persists linked GLES 3.0 binaries (`glProgramBinary`) across launches and lazily compiles optional shaders (`RawLinearize`, `Luma`, `Turn`, `Flat`, `Develop`). A tiny `FastPreviewProgram` draws the live camera frame on frame 0 (colour or monochrome) while the full look warms up, removing the black spinner.
  - **Queued early shutter:** pressing the shutter or a volume key while the camera is still opening queues one shot and fires automatically as soon as the first frame arrives.
  - **Off-lock DNG write & ART Baseline Profile:** single-frame 16-bit RAW captures copy the sensor plane and release `captureLock` before writing the ~24 MB DNG to disk; `baseline-prof.txt` pre-compiles the launch path.
  - **Startup telemetry:** logcat tag `RawBoyStartup` logs monotonic `+ms` milestones from `onCreate` through `firstVisibleFrame`, `firstLookFrame` and shutter capture.
- **Street mode controls:**
  - Uses Easy mode's **Colour / B&W** look (default colour film stock, or Film + B&W on the default mono stock), a 96 dp shutter, live shutter/ISO readout, and disables Photo/Video swipes, flash, burst merging, QR scanning, histogram, depth/portrait, HDR gain map and max-res without changing the stored full-camera settings. Tapping the amber **STREET** badge in the top bar switches straight to the full camera.
  - **Snap focus (zone focus):** `AF`, `1.5m`, `2.5m`, `5m`, `∞` (using `LENS_INFO_HYPERFOCAL_DISTANCE` where reported; `Near / Mid / Far / ∞` on uncalibrated lenses) sets `CONTROL_AF_MODE_OFF` + `LENS_FOCUS_DISTANCE` for 0 ms focus lag. Tapping the viewfinder still focuses temporarily (`AF LOCK ✕` returns to Snap focus).
  - **Min shutter speed:** `Auto` (30 fps preview floor instead of dropping to 1/15 s), `1/125`, `1/250`, or `1/500`, raising ISO to freeze motion and relaxing exposure cleanly if ISO hits sensor ceiling.
  - **Instant capture (ZSL):** lightweight 3-frame continuous RAW ring buffer (~65 MB RAM) on phones that support RAW streaming (`PreviewProfile.rawViewfinder`), with `CONTROL_ENABLE_ZSL = true` on other phones, plus shoot-priority `ShotSaver` pacing so rapid bursts don't contend with LibRaw decode (flushed immediately on pause/lock).
  - **Tap viewfinder to shoot** (optional): tap anywhere on the frame to take a photo immediately.

## Self-timer and long exposure (Android prototype)

Both are behind **Settings › Experimental features** (off by default); with it on, two buttons join the Photo / Video switch under the viewfinder (Timer left of it, Long exposure right; they hide in video mode). They are meant for a tripod.

- **Timer** cycles Off, 2, 5 and 10 s. The shutter (or a volume key) then counts down over the viewfinder before taking the shot, so the phone can settle; pressing the shutter again cancels. It also applies to burst-merged and long-exposure shots, and is off in video mode.
- **Long exposure** cycles Off, 5, 10, 30 and 60 s. The camera keeps the preview's exposure and white balance locked and shoots frames back to back for that long, folding each into one raw as it arrives (`long_exposure.h`; memory stays at one accumulator, about 48 MB at 12 MP, however long it runs). **Settings › Average** gives the mean of the frames (smooth water and clouds, less noise, like an ND filter); **Lighten** keeps the brightest value of every frame (light and star trails; the button shows an "L"). The shutter stops it early and keeps the frames taken so far. Each frame is exposed by hand, not by AE (which stops at 1/30 s): up to 0.5 s a frame, with the ISO lowered to match, and a dark scene lifted by up to 4 EV towards a normal brightness; the Brightness slider raises or lowers it. The result is an ordinary raw, so it is developed with the chosen look and saved as DNG and JPEG like any shot. Frames are not aligned, so use a tripod. Not used with flash or at full sensor resolution (those shoot a single frame).
