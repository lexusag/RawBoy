# Extend canvas (crop past the edges)

Request (2026-11-23): in all products, extend the crop beyond the photo with a simple fill, like the healing brush.

## Decision

The fill is done **in the develop shader**, not with the healing code. `healStroke` (blemish.cpp, `HealSpots`) works on
the full-resolution CPU image and takes a donor area of the same size; canvas outside the picture has no donor, and a
CPU pass would need a bigger image, memory and a second path for the live preview. The shader already has what is
needed: pixels outside the picture are found per output pixel (`frameMask`), and the whole-image 512 px copy (`uBase`)
is the same in preview, 100% view and export tiles. So the fill is mirrored-and-blurred edge, read from that copy:

- `fillColour(srcG)` (shaders/develop.glsl): the source position is the picture's edge mirrored but *stretched*: d' = L(1 − e^(−d/L)) with L = 10% of the long side, per axis, so only the first L of the picture is read and it is smeared further the farther out (no repeated copies of the subject). Next to the edge
  (within `FILL_RAMP` = 8% of the long side) the mirrored **full-resolution** picture continues it, with its detail and
  grain; with distance it fades (smoothstep) to a blur of 12 taps in a disc on the 512 px copy, radius 1.5 copy texels
  + 0.15 × distance, rotated per pixel. A hard seam between sharp photo and blurred fill was the first version's flaw.
  Tiles read `FILL_RAMP` more source around the picture (`sourceBounds`) so the sharp part is there.
- main_body.glsl replaces `x` with it where `frameMask` says outside, right after denoise, so tone, grain, LUT and film
  apply over it like any pixel. The black clip (`uClipFrame`) is off while the fill is on.
- Pixels the photo really has (outside the straightened, auto-cropped frame but inside the image) are untouched, so
  extending after a Straighten reveals real corners first.

Limits: the smear continues whatever touches the edge as streaks (a limb at the edge becomes a long smudge); fine for backgrounds, walls, sky, bokeh. Large
extensions over detailed subjects look wrong (a generative fill would be a separate, heavier feature). `MAX_EXTEND`
is 0.3 of each side (a 3:2 photo reaches 4:5 or 1:1 and a little more); raise it in `CropMath` if wanted, the tool's
canvas gets smaller on screen as it grows.

## Pieces per platform

| Piece | Web | Android | iOS / Desktop | Viewer |
|---|---|---|---|---|
| Shader (`develop.glsl`, `main_body.glsl`) | shared | shared (Shaders.kt assembles it) | shared (gen.sh → Metal) | n/a |
| `uFillOutside` binding | `GlCommon.ts` | `GlCommon.kt` | `MetalCommon.swift` | n/a |
| `LensTransform.fillOutside` + crop pixels allowed past the frame | `LensTransform.ts` | `LensTransform.kt` | `LensTransform.swift` | n/a |
| `CropMath` (`MAX_EXTEND`, `dragCrop(extend)`, view mapping) | `CropMath.ts` | `CropMath.kt` | `CropMath.swift` | `CropMath.swift` (own port) |
| Tool: extended canvas + Extend toggle | `CropOverlay` + panels | `CropOverlay.kt`, Pro/Auto | `CropOverlay.swift`, Pro/Auto | `CropTool.swift` |
| Sidecar / edits parse of crops outside 0..1 | `AutoSidecar.ts` (Edits is generic) | `Edits.kt` | `Edits.swift`, `AutoSidecar.swift` | `DevelopEdits` |

Web, Android, iOS and Desktop are all done (Android and Swift only compiled by CI). RawBoy Viewer is not.

Cost: the shader part is ~30 lines and shared; each port is the same small crop-math change plus the tool UI, about a
day per platform and not compilable here (CI only). The Viewer is different: it crops by `contentsRect` on the decoded
image and exports with Core Graphics, so it would need its own fill (a Core Image mirror + blur) or be left out; it is
not in this change.

Check when porting: LensTransform tile bounds (`sourceBounds`) stay clamped to the image, so tiles that are all canvas
read a 1 px region and the fill comes entirely from the 512 px copy; Auto's batch export and thumbnails go through the
same transform.
