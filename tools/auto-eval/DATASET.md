# A dataset for tuning RawBoy Auto

This is what to collect so that Auto's defaults can be measured and fitted instead of judged by eye. The first
target is exposure and white balance, then contrast, highlights/shadows, saturation and denoise. Ground truth is
your own edit of each raw. `harness.mjs` runs the real Auto on the same raws, and `compare.py` (exposure today)
measures the gap.

## What each photo needs

| File | Why |
|---|---|
| The original raw, untouched (DNG, ARW, RAF, CR3…) | Auto's input |
| darktable `.xmp` sidecar | the slider values you chose: exposure today (`compare.py`), later WB, denoise, sharpen |
| Exported **neutral** JPEG: sRGB, long side ≥ 2048 px, same base name | the rendered result, to compare brightness, WB, contrast and saturation without mapping every darktable module onto RawBoy sliders |
| A row in `labels.csv` (below) | lets results be split by scene, camera and outing |

**Neutral edit** means "how this photo should look before a film look": no LUT, no creative colour grade, no
vignette, no local edits. If a photo only works with a creative grade, leave it out or mark it `edit_quality` 1.
Crop is fine if darktable records it, but avoid heavy crops: they change what Auto should have metered.

### `labels.csv`

```
file,outing,camera,tags,wb_intent,edit_quality,notes
PXL_20260124_101530.dng,2026-01-24 Kyiv sea,Pixel 9 Pro,snow;daylight,neutral,3,
DSC01234.ARW,2026-01-24 Kyiv sea,Sony A7 III,snow;backlit,keep-mood,2,sun in frame
```

- `outing`: one shoot, meaning the same place, day and light. **This is the most important column** (see below).
- `tags` (any number, `;`-separated): `daylight`, `overcast`, `backlit`, `indoor-tungsten`, `indoor-mixed`,
  `night`, `snow-beach`, `sunset`, `faces`, `flash`, `high-iso`.
- `wb_intent`: `neutral` (whites should be white) or `keep-mood` (keep the warm sunset or the cold blue hour).
- `edit_quality`: 3 = confident, 2 = fine, 1 = unsure. Low-confidence edits get a lower weight.

## Editing rules (so edits are comparable)

1. Use one darktable version and one workflow for the whole set (scene-referred, with the same tone mapper,
   sigmoid or filmic, on every photo). Write the version down.
2. Change only global modules: exposure, white balance or color calibration, the tone mapper, color balance rgb
   (contrast and saturation), denoise (profiled) and sharpen. Add a `notes` entry if you used anything else.
3. White balance: start from the camera's as-shot WB and change it only when it is actually wrong. That
   change is the signal, so record `wb_intent`.
4. Exposure: judge on a calibrated or at least consistent screen, in the same room light.
5. Don't skip photos where the camera was already right. "No change needed" is ground truth too.

## Why outings matter more than photo count

On 2026-10-12, scene-tag exposure offsets fitted on two outings (Pixel March, Kyiv sea January) didn't carry over
from one to the other. Photos from one outing share light, place and your mood that day, so 40 shots of one snowy
afternoon are worth about one data point for "snow". So:

- Count **independent outings per tag**, not photos.
- Always split train and test **by outing**, never by file.

## Tiers

| | Minimum | Normal | Best |
|---|---|---|---|
| Raws | 80–120 | 300–500 | 1000+ |
| Cameras | 3, including the Pixel and one dedicated camera | 5+, including one older, noisy body | 8–10+, several phones |
| Photos per tag | ≥ 8 | ≥ 25 | ≥ 60 |
| **Outings per tag** | ≥ 2 | ≥ 5 | ≥ 10 |
| WB reference | — | a grey card or ColorChecker in one frame per lighting session (~30 sessions) | every session |
| Repeat edits | — | 10% re-edited ≥ 2 weeks later without looking at the first edit | 20% re-edited |
| Noise | an ISO spread, with ≥ 10 high-ISO shots | denoise value recorded on every photo | per camera, the same tripod scene at 3–4 ISOs |
| Flash (RawBoy Camera) | — | ≥ 30, both modes | ≥ 100, both modes, near and far subjects |
| Preference ratings | — | — | pairwise A/B choices between Auto variants on ~200 photos |

### What each tier can tune

- **Minimum:** exposure, checked for over- and under-shoot per camera. Highlights and shadows get a sanity check
  (are bright skies clipped, are shadows crushed).
- **Normal:** everything above, plus:
  - WB, as conditional corrections only, applied when the as-shot WB is measurably off for a tag such as tungsten
    or flash. Never as a global shift.
  - contrast and saturation (or vibrance)
  - denoise strength

  The repeat edits show how precise your own edits are (for example, ±0.3 EV). Auto can't be held to a tighter
  standard than that.
- **Best:** everything above, plus:
  - scene-conditional tuning (night, snow, backlit), with enough outings to show it generalises
  - image-based noise estimation, replacing the ISO table for denoise
  - preference ratings to settle questions where edits disagree ("darker and punchier, or brighter")

## New Auto parameters this data could support

- **Vibrance from scene chroma**: less saturation on already-colourful scenes, more on flat ones. Needs Normal.
- **Local contrast or clarity**: some scenes (fog, overcast) get it in edits, others don't. Needs Normal.
- **Image-measured denoise**: from flat patches of the raw instead of ISO, because ISO doesn't predict noise
  across cameras. Needs the Best noise set.
- **Conditional WB for tungsten and flash**: needs grey-card frames (Normal).
- **Black point**: if edits consistently deepen or lift blacks per scene. Needs Normal.

## Tooling still to build (not done yet)

- A JPEG comparison in `compare.py`: render Auto, which has no look, against your export and measure
  - key (log-mean luminance) and p98
  - neutral-patch or grey-world WB error in Δuv
  - mean chroma
  - local contrast

  This covers every parameter above without decoding darktable module parameters.
- A `labels.csv` reader for per-tag, per-camera and per-outing breakdowns, plus a leave-one-outing-out split.
- Grey-card patch picking: a crop box in `labels.csv` notes, or automatic detection of the ColorChecker.

## Optional outside data

**MIT-Adobe FiveK** has 5,000 raws, each retouched by five experts. Its licence covers research only, so use it to
analyse (for example, how much experts disagree on exposure) and never ship parameters fitted on it alone. Your own
edits stay the ground truth, because Auto should match your taste.
