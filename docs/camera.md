# RawBoy Camera

A camera for the back lenses (made for the Pixel 9 Pro; any phone whose camera offers RAW works). The
viewfinder shows the photo developed live: RawBoy Auto's automatic develop plus the **look** chosen from the
**Look** menu under the viewfinder, with **Strength**, **Brightness** and **Warmth** as in Auto (one thin row each). **Tap** to lock focus and exposure at that point (metered on a box about the ring's size around it): a ring
shows it (pulsing while focusing, white when locked, red when focus wasn't found) and stays locked, also for the
shot, until you tap **AF LOCK ✕** or tap somewhere else. Press and hold to see the photo without the look. The
**volume buttons** take a photo too; the viewfinder blinks and the phone ticks on each shot.
**UW · W · T** at the bottom of the viewfinder switches between the ultrawide, wide and telephoto lenses, as in
Google Camera (each lens that can deliver RAW is offered). The button right of the shutter switches to the
**selfie camera**, shown only when the front camera delivers RAW; selfies are saved mirrored, as the viewfinder
shows them.

- **Flash:** the bolt button in the top bar (shown when the lens has a flash; usually not the selfie camera) cycles
  **Off**, **Flash** and **Focus-flash** (bolt with "AF"). Flash fires at once with the shot. Focus-flash works like
  Google Camera's: the light comes on, the camera focuses with it (unless focus is locked), then the flash fires.
  Exposure works like a flash guide number: the photo is exposed for the distance the lens is focused at (the flash's
  light falls off with its square), never brighter than without flash, and each lens learns its flash strength from
  its flash shots (the camera's own flash metering left the raw several stops overexposed). Flash shots don't
  recalibrate the viewfinder's exposure. The choice is remembered.
- **Shooting:** each shot is one raw frame from the selected lens (Camera2 `RAW_SENSOR`, 12 MP on the Pixel's main lens), saved as DNG to
  `Pictures/RawBoy Camera/RAW/IMG_<date>_<time>.dng`. It is then developed in the background exactly as RawBoy Auto
  develops a raw (auto exposure, tone and noise from the raw itself, then the look with the controls as they were at
  the shutter) and saved as `Pictures/RawBoy Camera/IMG_<date>_<time>-camera.jpg`. You can keep shooting meanwhile;
  "Saving N…" shows the queue. The thumbnail opens the last photo. Exposure is metered on the middle half of the
  frame (width and height); a focus lock meters at its point instead.
- **Merge 8 frames** (the burst button in the top bar, or Settings; off by default): each shot without flash takes 8 raw frames in a quick burst and
  merges them into one DNG before developing, as the phone's HDR+ does for its own JPEGs: each frame is aligned to the
  first (tile by tile, so hand shake is followed) and averaged in where it matches; where something moved, the first
  frame is kept, so moving things don't ghost. Noise drops by about 3× where nothing moves, so the develop picks
  less denoise and keeps more detail. Hold still while the burst runs. The frames are merged while the burst is
  still coming in, so the DNG follows soon after the last frame; the JPEG comes out about as fast as from one frame
  (less denoise work). It needs ~200 MB of memory at its peak, so Android may close other apps to make room. The
  shutter greys out ("Merging frames…") until the merged DNG is written, so bursts never overlap.
- **JPEG:** encoded with Google's **jpegli** from 16-bit pixels, full-resolution colour (4:4:4), quality 95 by
  default (Settings: 70–100). jpegli's adaptive quantisation gives fewer artefacts per byte than libjpeg.
- **RAW:** the **RAW** button in the top bar keeps the DNG next to the JPEG (lit) or not (struck through); the same
  setting as in Settings.
- **Settings:** JPEG quality; whether to keep the DNG (off by default: only the JPEG is saved); **Smaller photos**
  (on by default: 3000 px on the long side, area-downscaled from the full-resolution develop, with the grain sized to
  the smaller photo; off saves full resolution); **Merge 8 frames** (see above); **Remember camera & settings** (off by default: each start uses the
  back W lens, Yellow Portrait 400 and default sliders; on keeps lens, side, look and sliders).
- **How the viewfinder matches the final:** the camera's preview stream is asked for the plain sRGB tone curve, so
  the viewfinder can turn it back into linear light and run the same develop shader on it. The auto develop is
  worked out from a 512 px copy of the live frame about three times a second (faces from the camera's face detection
  steer exposure as skin does in Auto). After every shot the viewfinder's exposure is calibrated against the raw,
  so it converges on the final over a few shots (separately per lens). Skin retouch and the ISO-based
  denoise/sharpening appear only in the final.
- **Noise:** a phone sensor is noisier than the camera raws Auto's noise settings were tuned on, so Camera picks
  denoise and sharpening as for 4× the shot's ISO (2 stops): base ISO stays clean, ISO 400 gets Denoise 20,
  ISO 1600 gets 45, ISO 6400 and up 65.

## Film looks (spektrafilm)

**RawBoy Film** (its own repository, see [Licence](../Readme.md#licence)) is RawBoy Camera with film stocks as its looks (everything else above applies), simulated by
[spektrafilm](https://github.com/andreavolpato/spektrafilm) (Andrea Volpato): Yellow Portrait 400/800, Yellow Vivid 100, Yellow Warm 200,
Green Pastel 400, Green Everyday 400, Yellow Cine 250D and 500T (printed on cinema print film), and the slide
films Green Vivid Slide 100, Green Slide 100, Yellow Slide 100 and Yellow Classic 64 (scanned, not printed). Colour
negatives are printed on colour paper. **Natural** is the AgX develop alone. It saves to `Pictures/RawBoy Film` (`…-film.jpg`,
DNGs in `RAW/`), so its photos stay apart from RawBoy Camera's.

- The film replaces AgX: after white balance, exposure and Shadows/Highlights, the scene light exposes the negative,
  which is printed and the print scanned. spektrafilm computes that spectrally from the stocks' datasheets; RawBoy
  uses spektrafilm's own 2-LUT bake (film LUT: light → film density; print LUT: density → sRGB), generated by
  `tools/spektrafilm_luts/generate.py`.
- **Grain** is added between the two LUTs, in film density, with spektrafilm's particle statistics (more
  particles per pixel = finer grain; the amount follows density). It is sized on a 36 mm frame, so a downscaled
  photo shows it as a smaller scan would.
- **Halation** (light reflected back from the film base, the red glow around highlights) and in-emulsion
  **scatter** are spektrafilm's, sized in micrometres on the same 36 mm frame, so viewfinder and photo match.
- **Strength** blends the film render with the AgX one (grain and halation fade with it). Middle grey stays where
  AgX puts it, so exposure and Brightness behave as before. Whites reach the paper's white (about 0.85), not 1.0.
