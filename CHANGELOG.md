**RawBoy Pro (web): lens corrections from the Lensfun database (2026-11-11)**

- The Lens tab has a **Use Lensfun profile** switch: distortion, chromatic aberration and vignetting from the community Lensfun lens database, for raws with no embedded profile (Fuji, Sony, Canon, Nikon...). **Auto** matches the camera and lens from the photo's EXIF; **Pick lens** has searchable camera and lens lists (all mounts for adapted lenses); **Generic** takes a crop factor (or sensor size), focal length, aperture and lens type for a lens that is not in the database, including fisheye types (equidistant, equisolid, stereographic, orthographic) with a **Straighten fisheye** button that sets the existing Fisheye slider, and optional known distortion/vignetting terms. The profile replaces the file's embedded warp and vignette and works with the existing sliders (Distortion, Fisheye, Crop, Vignetting, Red/Cyan, Blue/Yellow add on top). No shader change: Lensfun's ptlens/poly3/poly5 distortion, TCA and "pa" vignetting models are re-implemented (`engine/lens/Lensfun.ts`, no Lensfun code) and fitted into the per-plane warp and radial vignette the DNG opcodes already use (within about a pixel at the corner of a 24 MP frame). **Licence/size:** Lensfun's database is CC BY-SA 3.0 (its code is LGPL and not used), so the data is a separate compact JSON conversion in `web/public/lensfun/` (made by `tools/lensfun/convert.mjs`, with its licence and attribution, also in the notices); the app bundle is unchanged: a 27 kB gzipped index is fetched when the switch is first turned on, then one calibration file for the lens (the whole converted database is 1.8 MB). Not in presets or sidecars. Checked by unit tests (matching, the models against Lensfun's formulas, the transform, the store) and screenshots of the panel; not run on a real photo in a browser here (no WebAssembly build in the session). Android and iOS do not have it yet.

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
