# Feature matrix: RawBoy Pro, Auto, Browse and Packer by platform

What each platform has, which release first shipped it, and **where Desktop (macOS) is behind the web**. The Camera
apps are in [features-camera.md](features-camera.md).

Written 2026-11-17 against `main` at 45bb627 (after v1.18.3; "unreleased" below means after that tag). Sources: every
entry of `CHANGELOG.md` (379), matched to the first tag that contains it with `git blame` + `git tag --contains` (163
tags, v1.0.0 to v1.18.3), the docs in `docs/`, `desktop-app/features.md` (the Phase 0 plan, 2026-11-15) and a read of the
web, Swift and Kotlin sources. No Mac, Android SDK or browser was available, so nothing was *run*: a cell says what
the code and changelog say.

## How to read it

| Mark | Meaning |
|---|---|
| ✓ | has it |
| ✓ 1.17.2 | has it, from that release (shown when later than the first release) |
| ◐ | partly: the Notes column says what is missing |
| — | missing, although the platform could have it |
| n/a | not meant to exist there (a deliberate choice, or the platform can't) |
| ? | not checked in the code; inferred from the changelog |

- **Since** = the first release of the feature on any platform. `≤1.1.1` = before the 2026-10-18 baseline: the history
  before v1.1.1 was squashed into one commit, so those features can only be dated to "October 2026, before v1.1.1".
- **Platforms.** *Web* = app.rawboy.link (Pro, Auto, Browser, Packer and Video tabs). *Desktop* = RawBoy Desktop for the
  Mac (v1.17.0 on), with three modes: Pro, Auto, Browse (⌘1 / ⌘2 / ⌘3). *iOS* = the iPhone/iPad apps. *Android* = the
  Android apps. Desktop and iOS share the Swift engine and most of `ios/Pro` and `ios/Auto`, so a Swift port
  usually lands on both ("Desktop and iOS" in the changelog); the Mac-only parts (inspector, keyboard, filmstrip,
  sidecars, Packer, Vision skin) are called out.
- Each table has the columns that make sense for its area (Pro, Auto and Browse each have their own Desktop column).
- Release dates: v1.0.0 2026-10-18, v1.5.0 10-25, v1.10.0 11-07, v1.14.0 11-11, v1.17.0 (Desktop's first) 11-15,
  v1.18.3 11-17.

## The gaps in one list

The full prioritised list is at the end ([Web features missing on Desktop](#web-features-missing-on-desktop-prioritised)).
Biggest first:

1. ~~**Auto's export file names**~~ (web 1.14.3): on Desktop too (unreleased).
2. ~~**Auto's Retouch slider**~~ (web 1.12.0): on Desktop too (unreleased).
3. ~~**Your own LUTs**~~: done 2026-11-17 (folder shown, Add files, Show in Finder, Choose folder, drop).
4. ~~**Auto's keys**~~ (web 1.1.1 to 1.15.10): Space / ⌫, ⌦ and C on Desktop too (unreleased).
5. ~~**ISO on every Auto photo**~~ (web ≤1.1.1) and ~~**time left on Export all**~~ (web 1.15.1): on Desktop too (unreleased).
6. ~~**Preset group Denoise & sharpening** (web 1.1.3)~~: done on Desktop, iOS and Android (unreleased).
7. **No update path**: the web has a "New version available" banner; Desktop is a hand-downloaded DMG.
8. **Browse** misses: photos with `rawboy:Auto` settings don't go back into Auto when a folder is reopened, "Send to
   Auto" has no picks / minimum-stars shortcut, darktable `_01` duplicates are unchecked.
9. **Packer**: "jump to top" and the done notification are web only (sort, collapse and remove folders came to Desktop, unreleased).
10. ~~**Auto's paging speed**~~: Desktop decodes the next photo ahead and reads its neighbours' previews too (unreleased).

## RawBoy Pro: develop controls

Web, Desktop and iOS take every field of `DevelopParams` except where noted (checked field by field: Swift lacks
none of the web's 74; Kotlin lacks `healSpots`, `lumaContrast`, `portraitRetouch`). So gaps here are *UI*, not engine.

| Feature | Since | Web | Desktop | iOS | Android | Notes |
|---|---|---|---|---|---|---|
| Tone mapper AgX / Filmic / Sigmoid | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Film tone mapper (stocks, grain, halation) | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Mouse wheel steps stocks: web 1.9.0, Desktop 1.18.3 |
| Exposure, Contrast, Highlights, Shadows, Whites, Blacks | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Luma contrast | 1.12.5 | ✓ | ✓ 1.18.3 | ✓ 1.18.3 | — | Android has no slider |
| Curves (RGB + channels) | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Mouse version of the touch panel |
| Temperature / Tint, Pick white balance | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Auto WB rectangle, Reset WB | 1.9.0 | ✓ | ✓ 1.17.2 | ✓ 1.17.2 | ✓ | |
| Saturation, RGB primaries | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Luma / Colour denoise (wavelet), Sharpening | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Local contrast, High-pass contrast | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Skin retouch, Blemish removal | ≤1.1.1 | ✓ MediaPipe | ✓ 1.17.2 Vision | ✓ MediaPipe | ✓ MediaPipe | Desktop's mask is Apple Vision (differences in `desktop.md`) |
| Portrait retouch (Reblum-like) | 1.12.0 | ✓ | ✓ 1.17.2 | ◐ | — | iOS has the engine but its sliders are Mac-only (no landmarks yet); also per mask layer: web 1.13.4, Desktop 1.17.2 |
| Bloom | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Anamorphic flare (colours, Ghosts) | 1.9.2 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Magenta coating and Ghosts: 1.10.1 |
| Grain (size, roughness, colour) | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Crisper grain 1.14.0 |
| LUTs: bundled | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| LUTs: your own | ≤1.1.1 | ✓ choose folder, or drop `.cube`/`.png` on the page | ✓ (after 1.18.3): Add files, Show in Finder, Choose folder (remembered), drop on the panel or window; the folder's path under the list | ✓ Files › RawBoy › LUTs | ✓ choose folder | Desktop copies added files into its folder (`~/Library/Application Support/RawBoy Desktop/LUTs` unless you choose one); a `.png` dropped on the window counts as a LUT only when HaldCLUT-shaped (square, side a whole cube), else it opens as a photo |
| Lens: embedded DNG profile, Distortion, Crop, Vignetting, CA | ≤1.1.1; CA 1.7.2 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Lens: Horizontal distortion | 1.9.4 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Lens: Fisheye, Straighten fisheye, circle finder | 1.13.0 | ✓ | ✓ 1.17.0 | ✓ 1.13.1 | ✓ 1.13.1 | |
| Lens: **Lensfun database** | 1.14.0 | ✓ | ✓ 1.17.2 | ✓ 1.17.2 | — | |
| Lens presets (by lens; named for manual lenses) | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Crop & rotate, Straighten, Flip | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Drag outside the crop frame to rotate: web, Desktop and iOS unreleased (Android has only the Straighten slider) |
| Perspective (Vertical, Horizontal), Scale | 1.9.2 / 1.14.0 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Masks: brush, linear, radial | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Masks: stripe | 1.4.3 | ✓ | ✓ 1.17.0 | ✓ 1.4.7 | ✓ | |
| Masks: Lens blur | 1.3.0 | ✓ | ✓ 1.17.2 | ✓ 1.17.2 | ✓ | |
| Masks: Portrait retouch inside a layer | 1.13.4 | ✓ | ✓ 1.17.2 | — | — | |
| Light leaks | 1.3.0 | ✓ | ✓ 1.17.0 | ✓ 1.4.7 | ✓ | Outline dots: web 1.11.0, Desktop and iOS 1.17.4, Android — |
| Light effects (lightning, sparks, trails, swirl) | 1.11.0 | ✓ | ✓ 1.17.0 | ✓ 1.13.0 | ✓ 1.13.0 | |
| **Healing brush** | 1.15.1 | ✓ | ✓ 1.17.2 | ◐ | — | iOS has the engine (`rb_heal`) but no button (its bar is full) |
| Auto Dev button | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Histogram + clipping marks | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Undo / Redo | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Presets: groups, import / export `.rawboy.json` | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Presets: batch select to delete / export | 1.9.2 | ✓ | ✓ 1.17.0 | ✓ | ? | |
| Presets: **Denoise & sharpening group** | 1.1.3 | ✓ | ✓ unreleased | ✓ unreleased | ✓ unreleased | `PresetGroup.denoise` / `DENOISE`, off by default in Save preset; old Detail-only presets keep their denoise, ones with Light leave it to Auto (as `Presets.ts`). Auto: a preset sets denoise and sharpening only with this group; Auto denoise all drops it |
| Presets: Masks, Retouch groups | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Presets with no photo open | 1.17.8 | ✓ | ✓ 1.17.8 | ? | ? | |
| Look selector (stripes of every LUT / stock over the photo) | 1.10.11 | ✓ | ✓ 1.17.8 | ✓ (shared code) | — | Resizable window: web 1.14.2, Desktop 1.17.8 |
| Carry edits over to the next photo (Pro) | ≤1.1.1 | ✓ automatic | on demand (by design) | ✓ automatic | ✓ automatic | **Not a gap.** Web, iOS and Android open one photo at a time, so edits carry over by themselves. Desktop Pro has a filmstrip and ← / →, so it starts every photo from its own sidecar or as shot (unreleased, #399); the bar's Copy or ⇧C takes the previous photo's settings. Web also has the Copy button and ⇧C since 1.17.10. Auto never carried edits; it has Copy previous (⇧C) on every platform |
| Edits saved next to the photo (`rawboy:Develop`) | ≤1.1.1 | ◐ opt-in, Chrome/Edge folders | ✓ 1.17.0 always on | — | — | |
| Compare: hold, `\` toggle | ≤1.1.1 | ✓ | ✓ 1.17.0 | ◐ hold | ◐ hold | |
| Before/After slider (Y) | 1.18.3 | — | ✓ | — | — | Desktop only |

## RawBoy Pro: view, files, export

| Feature | Since | Web | Desktop | iOS | Android | Notes |
|---|---|---|---|---|---|---|
| Open RAW, DNG 1.7 JPEG XL | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | Desktop has no 4 GB WASM limit |
| Open JPEG / HEIC / PNG / TIFF, Ultra HDR input | 1.4.7 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Drag and drop, file associations | ≤1.1.1 | ✓ drop | ✓ drop, Open With (opens Browse) | ✓ | ✓ Open with | |
| Wheel zoom (also past the whole photo), `Z`, pinch | 1.3.0; 1.13.4 | ✓ | ✓ 1.17.0 | ✓ pinch 1.4.7 | ✓ pinch | |
| Wheel over a slider (Shift, ⌘ fine) | 1.2.0 | ✓ | ✓ 1.17.0 | n/a | n/a | |
| Middle button pans, Space pans | 1.15.3 | ✓ | ✓ 1.17.0 | n/a | n/a | |
| Keyboard shortcuts + non-Latin layouts | 1.2.0 | ✓ | ✓ 1.17.0 (physical key codes) | n/a | n/a | |
| `D` frame colour | 1.14.0 | ✓ | ✓ 1.17.0 | — | — | tap outside the photo on the phones |
| `C` Crop & rotate, `⇧C` Copy previous, Enter finishes heal | 1.15.10 | ✓ | ✓ | n/a | n/a | |
| Help sheet, version, licences, Ko-fi link | ≤1.1.1; 1.12.2 | ✓ | ✓ 1.17.0; version 1.17.6 | ✓ | ✓ | |
| Zoom hint at the foot of the photo | ≤1.1.1 | ✓ | ? | ? | ✓ | |
| Export JPEG (jpegli 4:4:4), TIFF 8/16, sizes, EXIF | ≤1.1.1 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Export Frame (date stamp, Pentax / Contax 645) | 1.16.12 | ✓ | ✓ 1.17.0 | ✓ | ✓ | |
| Film scan 1.5× | 1.10.0 | ✓ | ✓ 1.17.4 | ✓ 1.17.4 | ✓ | |
| Send to Auto (one photo) / back | ≤1.1.1 | ✓ | ✓ 1.17.8 (To Auto) | — | ✓ | iOS has no edits file |
| Google Drive open / save | 1.5.0 | ✓ | n/a | n/a | n/a | Drive's desktop folder covers it |
| "New version available" banner | 1.6.0 | ✓ | — | n/a | n/a (Play) | **Gap.** Desktop has no updater; releases are DMGs on GitHub |
| Warning before closing mid-work | 1.14.0 | ✓ | ✓ 1.18.3 (quit) | n/a | n/a | |
| **Next / previous photo in Pro** (filmstrip of the folder, ← / →) | 1.17.7 | — | ✓ | — | — | Desktop only. Web, iOS and Android Pro open a single file; to change photo you open another (web: back to the Browser tab). This is why carry-over is automatic there and on demand on Desktop |
| Multi-display, VoiceOver, Reduce Motion | 1.17.4 | n/a | ✓ | ✓ (iOS system) | ✓ TalkBack (Camera) | |

## RawBoy Auto

| Feature | Since | Web | Desktop | iOS | Android | Notes |
|---|---|---|---|---|---|---|
| Analysis, auto develop, suggested look | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | Desktop analyses up to 3 at once, with a 1 GB analysis cache (1.17.4) |
| Looks (Color / Experimental / B&W), Strength | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Film mode (Import as Looks / Film) | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Import as **As is** | ≤1.1.1 | ✓ | ✓ 1.17.8 | — | — | |
| Brightness, Warmth, Contrast, Saturation, Tint, Grain, Denoise | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | Luma contrast: web 1.12.5, Desktop and iOS 1.18.3 |
| White balance picker | 1.9.0 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| **Retouch** (portrait retouch adjustment) | 1.12.0 | ✓ | ✓ unreleased | — | — | Desktop: its own Retouch section in the panel. `Adjustments.retouch` is in the Swift engine too (sidecar, Apply to all, Copy previous); iOS has no slider (its MediaPipe skin mask has no face landmarks yet) |
| Crop & rotate in the photo view | 1.15.3 | ✓ | ✓ 1.17.2 | ✓ 1.15.3 | ✓ 1.15.3 | Drag outside the frame to rotate: web 1.15.5, Desktop and iOS unreleased (open hand cursor on the Mac); Android — |
| RawBoy preset for the batch / a selection | ≤1.1.1 | ✓ | ✓ 1.17.8 (list of Pro's presets) | ✓ | ✓ | |
| Partial presets (only the groups they hold) | 1.1.2 | ✓ | ✓ 1.17.2 | ✓ | ? | Denoise & sharpening group: unreleased on Desktop, iOS and Android |
| Lens presets (by lens, per batch / selection) | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Edit in RawBoy / Back to Auto (RawBoy edits per photo) | ≤1.1.1 | ✓ | ✓ 1.17.8 | — | ✓ | |
| Apply to all, Copy previous (⇧C) | ≤1.1.1 | ✓ | ✓ 1.17.2; ⇧C 1.17.8 | ✓ | ✓ | |
| Auto denoise all / selection | 1.4.0 | ✓ | ✓ 1.17.2 | ✓ 1.4.7 | ✓ | |
| Remove from batch, Clear batch | 1.2.1 | ✓ | ✓ 1.17.2 | ✓ 1.4.7 | ✓ | |
| Batch rotate ↺ ↻ | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Reset all photos | 1.17.5 | ? | ✓ | — | — | |
| Sort by shoot date / file name | 1.2.0 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Filter: camera, lens, ISO, date | 1.9.0 | ✓ | ✓ 1.17.8 | — | — | |
| Filter: focal length, Unedited | 1.12.6; 1.17.10 | ✓ | ✓ 1.17.8 / 1.17.10 | — | — | |
| **ISO beside each photo** (grid and photo view) | ≤1.1.1 | ✓ | ✓ unreleased | ✓ unreleased | — | Shared SwiftUI cells and photo view |
| Select: ⌘-click, ⇧-click range, ⌘A, Esc | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ long-press | ✓ | |
| Export all / selected, JPEG / TIFF, sizes, Frame, Film scan | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | 5600 px size ≤1.1.1 |
| **Export file name template** (`{name}`, `{date}`, `{look}`, `#`…) | 1.14.3 | ✓ | ✓ unreleased | — | — | `NameTemplate.swift`, a port of `NameTemplate.ts` with its tests. Desktop never overwrites now (`-001`, `-002`), as the web; it used to replace `NAME-auto.jpg`. iOS keeps `<name>-auto` (no field in its sheet) |
| **Export progress: elapsed and time left** | 1.15.1 | ✓ | ✓ unreleased | ✓ unreleased | — | `BatchTime.swift`, the web's estimate |
| Stop a batch export | 1.1.4 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| Export to a folder / Google Drive / ZIP / Photos | ≤1.1.1; 1.5.0 | ✓ | ✓ folder only | ✓ Photos | ✓ | Drive and ZIP n/a on Desktop |
| Click a waiting photo to analyse it next | 1.1.2 | ✓ | ✓ 1.17.2 | ✓ | ? | |
| Cached preview while a photo decodes | ≤1.1.1 | ✓ | ✓ 1.17.2 | ✓ | ✓ | |
| **Neighbour photos decoded ahead** | 1.15.9 | ✓ | ✓ unreleased | — | — | Next photo decoded at full resolution, cached previews of the next 3 / previous 2 read ahead (`PhotoSession.prepare` / `adopt`), when Auto analyses in more than one lane (Macs; the web's rule too). iOS decodes only the shown photo |
| Settings kept next to each photo (`rawboy:Auto`) | ≤1.1.1 | ◐ opt-in | ✓ 1.17.2 | — | — | |
| Keys: arrows, Return, Esc | ≤1.1.1 | ✓ | ✓ 1.17.2 | n/a | n/a | |
| **Keys: Space / Backspace** (next / previous), **Delete** (remove), **C** (Crop) | ≤1.1.1; 1.15.10 | ✓ | ✓ unreleased | n/a | n/a | On the Mac: Space / ⌫ (the Delete key), ⌦ (fn-Delete, the web's Delete) and C; C, Return or Esc put Crop down |
| Wheel zoom and wheel over sliders in the photo view | 1.3.0 | ✓ | ✓ 1.17.8 | n/a | n/a | |
| Photo view Frame colour | ≤1.1.1 | ✓ | ? | ✓ | ✓ | |

## RawBoy Browser / Browse

Web "Browser" tab = culling; Desktop's counterpart is Browse mode, which hosts RawBoy Viewer (its own repository,
`lexusag/RawBoyImageViewer`, tags v0.1.0 to v0.2.3, pinned by Desktop at 0.2.3). iOS and Android have no browser.

| Feature | Since | Web | Desktop | Notes |
|---|---|---|---|---|
| Grid from the cameras' embedded previews, RAW + JPEG as one | ≤1.1.1 | ✓ | ✓ 1.18.0 | |
| Ratings (1–5, 0), Pick, Reject, Unflag, selection rating, Undo | ≤1.1.1; 1.1.7 | ✓ | ✓ 1.18.0 | XMP sidecars, `rawboy:Pick` |
| Filters (Picks / Unflagged / Rejects, stars), sort date / name | ≤1.1.1; 1.2.0 | ✓ | ✓ 1.18.0 | |
| `_bin` (Bin, restore), Trash | ≤1.1.1 | ✓ `_bin` | ✓ 1.18.0 `_bin` and Trash | |
| Auto-advance after rating | ≤1.1.1 | ✓ | ✓ 1.18.0 | |
| 1:1 zoom, compare, slideshow, crop, rename, copy / move, export | — | ◐ 1:1 only | ✓ 1.18.0 | Desktop is richer here (Viewer features) |
| Real preview (`R`, develop with RawBoy) | 1.9.0 | ✓ opt-in | ✓ 1.18.0 (the engine's develop) | |
| JPEG XL DNG previews (the 6000 px one) | ≤1.1.1 | ✓ | ◐ | Viewer asks ImageIO to decode those DNGs (not ported), Adobe's lossy DNGs fall back |
| **Send to Auto: picks, ≥ N stars, = N stars, "what the grid shows"** | ≤1.1.1 | ✓ | ◐ 1.18.0 | **Gap.** Only the selection (and the right-click menu); Develop as Looks / Film / As is ✓ (web 1.4.4; Desktop 1.17.8) |
| Edit in RawBoy (`E`) | ≤1.1.1 | ✓ | ✓ 1.18.0 in-process | |
| Edits in sidecars (`rawboy:Develop`, `rawboy:Auto`) | ≤1.1.1 | ◐ opt-in | ✓ always | |
| **Reopen a folder: photos with Auto settings go back into Auto** | ≤1.1.1 | ✓ | — | **Gap.** Browse reads sidecars for ratings only; Auto restores a photo's settings only when that photo is added to Auto again |
| Reopen last folder | 1.1.2 | ✓ | ✓ unreleased (#400, at launch; before, only through Viewer settings) | |
| darktable duplicates (`NAME_01.CR2.xmp`) | ≤1.1.1 | ✓ | ? | The Viewer's sidecar code names `NAME.xmp` and `NAME.EXT.xmp`; no `_01` handling found |
| Safari / Firefox: pick files, download sidecars as ZIP | ≤1.1.1 | ✓ | n/a | |
| Full-screen viewer, edge panels, Compare 2–4 | — | — | ✓ 1.18.0 | Viewer only |

## RawBoy Packer (raws and DNGs to smaller DNGs)

| Feature | Since | Web | Desktop | iOS | Android | Notes |
|---|---|---|---|---|---|---|
| Small raw / Lossless / Micro, lens corrections kept, previews | 1.8.0 | ✓ | ✓ 1.17.4 | n/a | n/a | Same C++; sizes within 4% of the web's |
| Presets, summary, "Opens in" table, Advanced settings | 1.8.3 | ✓ | ✓ 1.17.4 | n/a | n/a | |
| Group by folder, shoot order | 1.8.17 | ✓ | ✓ 1.17.4 | n/a | n/a | |
| Sort by shoot date / name, collapse a folder, remove a folder | 1.9.0 | ✓ | ✓ unreleased | n/a | n/a | Collapse state lasts while the window is open, as on the web |
| **Jump to top, persistent Clear finished, done pop-up** | 1.8.12 / 1.8.16 | ✓ | ◐ | n/a | n/a | Desktop has Clear and a result line, no jump to top |
| Raw details in the list | 1.8.15 | ✓ | ✓ 1.17.4 | n/a | n/a | |

## RawBoy Video (web only)

Grade clips with RawBoy's looks (`web/src/video/`; 1.13.0 added export quality and format). Not planned for Desktop,
iOS or Android (Camera records video on Android: see [features-camera.md](features-camera.md)).

## Desktop-only (no web equivalent)

One-row bar and sectioned inspector (1.17.7); Photo-only mode (Tab / F); Before/After slider (Y, 1.18.3); filmstrip
under the photo (1.17.7); Auto grid with sidebar (1.17.7); Browse and the Viewer's libraries (1.18.0); sidecars always on;
Apple Vision for skin (1.17.2); Reset all photos (1.17.5); quit guard (1.18.3); displays and accessibility (1.17.4);
analysis cache (1.17.4).

## Web features missing on Desktop, prioritised

Ordered by how often a web user would hit them and how cheap the port looks (the engine already has the pieces in
most cases). "Check" = confirm in the app before building, because I could only read the code.

| # | Feature | Web since | Why it matters | Cost |
|---|---|---|---|---|
| 1 | ~~**Auto: export file name template**~~ (done, unreleased) | 1.14.3 | Auto is the batch tool; fixed `NAME-auto.jpg` collides across folders and can't carry date or look | Small: `NameTemplate.ts` is pure logic (+ its test); Auto's ExportSheet takes a text field |
| 2 | ~~**Auto: Retouch slider**~~ (done, unreleased) | 1.12.0 | Desktop already has the engine (`PortraitRetouch.swift`) and Pro's slider; Auto's `Adjustments` lacks `retouch` (also in `AutoSidecar`) | Small to medium: a field in `Adjustments`, `LookApplier`, the sidecar, the batch export's `retouchMapFor`, a slider; bump `AnalysisCache` only if it touches the analysis |
| 3 | ~~Your own LUTs: a reachable folder~~ | ≤1.1.1 | Done 2026-11-17: path shown, Add files, Show in Finder, Choose folder, drop | — |
| 4 | ~~**Auto keys: Space / Backspace, Delete, C**~~ (done, unreleased) | ≤1.1.1; 1.15.10 | Muscle memory from the web; culling a batch is keyboard work | Small: `KeyboardShortcuts.handleAuto` + menu items |
| 5 | ~~**Auto: ISO on each photo; time left on Export all**~~ (done, unreleased) | ≤1.1.1; 1.15.1 | Judging noise without zooming; knowing if a 300-photo export is 4 or 40 minutes | Small |
| 6 | ~~**Preset group Denoise & sharpening**~~ (done, unreleased) | 1.1.3 | Without it a Pro preset applied in Auto either leaves noise to Auto (Detail unticked) or overrides the measured values | Small: `PresetGroup.denoise` (Swift and Kotlin), the "Detail-only presets keep theirs" migration (see `Presets.ts`) |
| 7 | **Browse: send "picks / ≥ N stars" to Auto; reopen a folder and bring Auto-edited photos back** | ≤1.1.1 | The web's Browser → Auto loop; needs a Viewer release (host hook) | Medium, in `RawBoyImageViewer` |
| 8 | **Updater** | 1.6.0 | New DMGs are easy to miss; Sparkle is already in the Viewer app | Medium (signing, appcast; notarisation is "not in yet") |
| 9 | ~~**Auto: decode neighbours ahead**~~ (done, unreleased) | 1.15.9 | Paging through a batch waits on each decode | Medium: a one-ahead prefetch in `AutoViewModel` / `PhotoSession`; web's `NeighbourPreload.ts` is the pattern |
| 10 | **Packer: jump to top** | 1.8.12 | Long lists | Small (sort, collapse and remove folders done, unreleased) |
| 11 | ~~Auto crop drag-to-rotate (1.15.5)~~ (done, unreleased: Pro's crop too, web and Desktop). Check: **next / previous photo while zoomed (1.8.13), Pro zoom hint, healing stroke shown red while painting (1.15.11)** | | Listed as ? above | Check |
| 12 | Check: **darktable `_01` duplicates in Browse** | ≤1.1.1 | Web handles `NAME_01.CR2.xmp` | Check in the Viewer |
| 13 | Carry-over to the next photo (Pro) | ≤1.1.1 | Not a gap: automatic on web, iOS and Android (they open one photo at a time), on demand on Desktop (it has a filmstrip and ← / →). Listed so the difference isn't mistaken for a bug | none |

Left out on purpose: Google Drive, Video, ZIP export, the web caches and lanes, Safari/Firefox rating download.

### And on the phones (not Desktop, for completeness)

- **Android** has none of: Lensfun, healing brush, Portrait retouch, Luma contrast, Look selector, Auto filter,
  Auto As is, Auto edits in sidecars, Packer, keyboard and sidecars (no Mac-style editing).
- **iOS** has none of: healing brush UI, Portrait retouch sliders, Send to Auto / RawBoy edits in Auto, Auto filter,
  Auto As is, sidecars, Packer.

## Keeping this file honest

When a feature lands, change its cell here in the same PR as the `CHANGELOG.md` entry (CHANGELOG is the source for
"Since"). To re-derive the release of an entry: `git blame -L<line>,<line> CHANGELOG.md` for the commit, then
`git tag --contains <commit> --sort=creatordate | head -1`. Lines whose commit is v1.1.1 are the squashed baseline.
A cheap check for Swift parity with the web: compare `DevelopParams` fields, `PresetGroup`s and `handleAuto` /
`handleEditor` keys with their web counterparts (`web/src/engine/develop/`, `ProApp.tsx`, `AutoApp.tsx`).
