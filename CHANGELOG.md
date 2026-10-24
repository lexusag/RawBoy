# Changelog

**Auto: Export all shows its progress in the grid (2026-10-24)**

- RawBoy Auto (Android, iOS, web): while Export all runs, the photos still to be saved show in grey, and each fades
  to full colour once it's saved. The grid is no longer dimmed as a whole during an export on the web.

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
