# RawBoy Auto

Pick or share RAW files (one or many); each is developed automatically and gets a film look. JPEG, HEIC, PNG and
TIFF work too, at lower quality (see *JPEG, HEIC, PNG and TIFF* below).

1. **Analysis** (from a 512 px copy, a fraction of a second per photo after decoding): centre-weighted
   key, luminance percentiles, clipping, colour mix, and faces via the same MediaPipe models as Pro.
2. **Auto develop**, using Pro's own sliders. Exposure follows the camera, about 0.6 EV darker (cameras
   meter a scene's key to ~0.06 of sensor clip; the target is 0.043), but never brighter than needed to
   bring the brightest 2% to about 1.3 EV under clip, so dark interiors stay dark while underexposed
   frames are lifted. Phone DNGs (Google, Apple, Samsung) keep the phone's own exposure instead: HDR+ and Smart HDR
   store their scene-aware metering in the DNG's BaselineExposure, and it beats ours (snow, sunsets, bright
   windows). Faces are metered on the skin, gradually from 0.3% of the frame to full weight at 2%. Highlights recover
   what still lands near white; Shadows lift very deep shadows; Contrast starts at +15 (more for flat
   scenes, less for very wide ones, 0..30); Saturation +30; a fine grain (5) on every photo;
   Denoise, Color denoise and Sharpening come from the noise **measured in the photo** (full resolution, ~30 ms; not
   from ISO, which says little across cameras and phones), scaled by how much the exposure lifts it; JPEG/HEIC get
   none. White balance stays as shot.
3. **Look**, suggested per photo and changeable:

| Look | Character | Suggested for |
|---|---|---|
| Natural | none | — (the auto develop alone) |
| Yellow Portrait 400 | soft colour negative, kind to skin | portraits and everyday scenes; the default |
| Yellow Portrait 800 | the same at a higher speed | low light / ISO ≥ 3200 (more grain, some bloom) |
| Yellow Vivid 100 | saturated, fine-grained negative | colourful green/blue scenes |
| Yellow Warm 200 | warm consumer negative | warm scenes |
| Green Everyday 400, Green Pastel 400 | cooler consumer negative; soft pastel negative | — |
| Yellow Cine 500T | tungsten-balanced cinema negative | — (grain and bloom) |
| Green Vivid Slide 50 | slide film, vivid | — |
| Redscale | Redscale | — (red/orange redscale film) |
| Yellow Mono 400, Yellow Mono Push, Yellow Mono Hard | black-and-white negative on paper: normal; developed longer; developed longer on a hard grade | — (monochrome, rising contrast) |
| Yellow Cine Mono, Yellow Cine Mono Soft | black-and-white cinema negative on print film; developed short on a soft paper grade | — (monochrome) |

Look names are RawBoy's own: "Yellow" and "Green" are two families of film character, not products.

The film LUTs are generated with [spectral_film_lut](https://github.com/JanLohse/spectral_film_lut) from
each stock's datasheet (`tools/film_luts/generate.py`). Each LUT first undoes RawBoy's AgX curve, exposes the
film on the scene light, then scans and inverts the negative (colour), prints it on paper (B&W) or shows the
slide. Black, white and middle grey stay where AgX put them; the tone curve and colour become the film's.
Each stock's contrast and saturation are tuned so its look in Auto is at least as punchy as the earlier look it
replaced (measured on test photos: global contrast and mean colourfulness).

**Film** (Android, iOS and web): choose **Import as: Looks | Film** above the grid before importing (remembered;
a line under it says what each does; photos already in the batch keep their mode), or switch a photo in its detail view (the switch above the looks).
Instead of a LUT on top of AgX, the photo is developed as
film. The scene light exposes the negative, which is printed and the print scanned (slides: scanned), with the same
12 stocks as RawBoy Film (Yellow Portrait 400/800, Yellow Vivid 100, Yellow Warm 200, Green Pastel 400, Green
Everyday 400, Yellow Cine 250D/500T, Green Vivid Slide 100, Green Slide 100, Yellow Slide 100, Yellow Classic 64) and spektrafilm's film and print LUTs. The
grain (in film density, sized on a 36 mm frame), halation (the reddish glow around bright light) and scatter are
RawBoy's own (`shaders/film_form.glsl`), fitted to RawBoy Film's renders. A stock is suggested per photo (tungsten
light: Yellow Cine 500T); Strength blends the film with the AgX develop; Grain (±50) scales the stock's grain from none to
double. Each photo keeps one pick per mode, and the Pro tab (web) shows a photo handed over in Film mode with its
stock. Whites reach the print's paper white (about 0.85), not 1.0.

Each look is a LUT plus small adjustments (grain, bloom, vignette, warmth, and skin retouch when there's a
face). **Strength** (default 100) scales all of it; 0 shows the auto develop
alone. **Brightness** shifts exposure ±3 EV. **Warmth** (±100) multiplies the temperature by up to 2 or
divides it by up to 2 (2000–25000 K), on top of the as-shot white balance; tint follows automatically (about 0.25 tint units of magenta per mired
of warming, green when cooling), so warming doesn't leave the green/teal cast of temperature alone. These three are on
the **Look** tab. The **Adjust** tab has every adjustment, Brightness next to Contrast and Warmth next to Tint, then
the other auto develop sliders (0 = as Auto set them): **Contrast** (±50),
**Saturation** (±100; −100 is black and white, the film look keeps its tone curve but loses its colour cast), **Tint** (±50, + = magenta, on top of what Warmth adds), **Grain** (±50, on top of the base
grain and the look's) and **Denoise** (±100, on top of the measured luma and colour denoise; below 0 it takes the auto denoise away,
down to none, e.g. to keep fine detail at high ISO). Press and hold the photo to see it without the look. As in RawBoy, a thin frame around the photo (neutral
grey by default) helps judge exposure; tap (click) outside the photo to cycle it through grey, white and black.
**Swipe left or right** on the photo to move to the previous or next photo in the batch (each keeps its own
settings; swiping is off while zoomed to 100% or exporting).
**Undo** and **Redo** (arrows in the photo view's top bar; Ctrl/⌘ Z and Shift Ctrl/⌘ Z on the web) take back the
photo's edits one step at a time: a look, a slider drag, a preset, a turn, Apply to all.
**Apply to all** copies the look (and the Looks/Film mode), strength, warmth, tint, contrast, saturation and grain to
every photo, including photos still being analysed, which keep it instead of their suggested look (brightness and
denoise stay per photo). **Copy previous** (at the end of the Look / Adjust tabs) copies the same settings, plus
brightness, from the photo before this one in the batch to this photo only (denoise stays), as one undo step, like darktable's or Lightroom's "copy previous":
develop one shot of a scene, swipe to the next and tap it. **Export all** saves every photo
to `Pictures/RawBoy Auto/<name>-auto.jpg` (or `.tif`), one photo at a time, keeping the screen on.
**Export all** and the photo view's **Export** ask for the format and size first (remembered for the next export),
as RawBoy's export dialog does: JPEG with a quality slider (default 92) or TIFF (8 or 16-bit, LZW,
default 16), at the original size or a long side of 5600, 4096, 2048 or 1080 px. Both keep the photo's EXIF.
**RawBoy presets:** **Apply RawBoy preset…** next to *Import as* (Android, iOS) opens a `.rawboy.json` file, as RawBoy
exports it on any platform; RawBoy's **Send to Auto**, or opening a preset file with RawBoy Auto, does the same. The
preset develops every photo, and photos added later, in place of its look: everything it holds, lens corrections,
LUT, film, detail, retouch and gradient masks included, on top of each photo's auto develop (groups it leaves out keep
the auto values). Denoise, Color denoise and sharpening always come from each photo's own auto develop (its measured
noise, so its ISO), never from the photo the preset was made on. Brightness, Warmth and the Adjust sliders still work
on top; there is no Strength. **Remove** goes back to the looks (photos given another preset on a selection keep
theirs); **Use a look** in the photo view does it for one photo.
**Lens presets:** a preset holding only the Lens group (RawBoy's Lens tab → **Save lens preset** / **Send to Auto**) is
not applied in place of the look: Auto keeps it for photos taken with its lens (the lens name in the raw, ignoring
case) and gives them its lens corrections (embedded profile on/off, Distortion, Vignetting, Vignette radius) on top of
their look or RawBoy preset, in this batch and later ones. Nothing else changes; a look's own vignette stays on top,
and a RawBoy preset's Lens group gives way to the lens preset. Sending a new one for the same lens replaces it. The
**lens presets** button in the grid (web: the **Lens** menu, and **Manage…** to remove) picks one for every photo and
those added later: **By lens** (the default), **None**, or a named preset. Manual lenses record no lens name, so their
presets (and lens-only presets saved before RawBoy recorded the lens) never match by lens: pick them by name, for the
whole batch or for a selection (**Lens** in the selection bar). **Remove** forgets a preset. **One preset per scene:** select a scene's photos and
tap **Preset** (the bookmarks icon) in the selection bar to develop just those with a preset; the rest keep theirs.
**Rotating, removing and exporting photos:** long-press a photo in the grid to start selecting, tap others to add them
(or **All**), then **↺** / **↻** to turn them all 90° left or right (thumbnails, photo view and exports follow; Apply to
all leaves each photo's rotation alone), **Remove** (a bin icon), or **Export** to save only the
selected photos, with the same format and size choices as Export all. Removing only takes them out of the batch; the
raw files stay where they are. On the web, Ctrl/Cmd-click also starts a selection, Shift-click selects every photo between the last
one picked and the clicked one, and Ctrl/Cmd+A selects all.

## JPEG, HEIC, PNG and TIFF

These files are already developed (8 bits per channel mostly, highlights clipped, noise reduction and sharpening baked
in), so results are lower quality than from RAW: the empty grid says so, and so does a message when an import includes
them. Auto takes them back to the light RawBoy's develop would have rendered them from (the exact inverse of the
default develop: AgX, applied per channel for these files, so even saturated sRGB colours come back) and leaves them as
they are: with no look, a photo exports as itself (median dE 0.5 for JPEG, 0.25 for HEIC). The auto develop then only
adds the base grain (the camera already chose exposure, tone, noise reduction and sharpening); looks, Film mode,
Strength and the sliders work as on raws. White balance starts at the file's (shown as D65) and moves relative to it.

- JPEG is decoded by jpegli at more than 8-bit precision (the inverse stretches shadows), on every platform, with its
  ICC profile (sRGB, Display P3, Adobe RGB and other matrix profiles) and EXIF (orientation, camera, exposure, GPS).
- Ultra HDR JPEGs (Pixel, recent Android: gain map in XMP `hdrgm` or ISO 21496-1) get their highlight headroom back,
  per channel, only where a channel is within half a stop of white: it renders the same at defaults, and Highlights
  or lower Exposure bring back what the SDR picture clipped.
- HEIC and PNG go through the platform's decoder (Android's ImageDecoder, iOS ImageIO, the browser; Chrome can't
  decode HEIC, Safari can), SDR only, with EXIF read from the file.
- TIFF: RawBoy's own reader (8/16-bit RGB or gray, strips or tiles, uncompressed, LZW, Deflate or PackBits, ICC,
  orientation, EXIF), used when no raw decoder takes the file (most raws are TIFF files too). Float TIFFs aren't
  read. PNG and TIFF are untested beyond a smoke test on the web.
