# UI backlog

Proposals from the UI review of 2026-10-17 (all apps, Android, iOS and web) that aren't done yet. The five picked
first (web phone toolbar, centre-filled sliders, undo/redo, Auto's batch settings, Camera's selfie icon) went into
their own PRs. Priority is High / Medium / Low; effort S is one screen per platform, M a few files per platform.
Most items touch three ports (Kotlin, Swift, TypeScript): keep them in step, as CLAUDE.md asks.

Web screenshots for the review were taken with a stub decoder (no Emscripten needed): see "Web UI screenshots" at the
end.

## RawBoy (Pro)

### P4. Tell "Film" and "Filmic" apart (Low, S) — Android, iOS, web
The tone mapper row reads AgX, Filmic, Sigmoid, Film: a curve and a whole stock simulation, two letters apart.
**Change:** rename the chip "Film stock", or show the stock name on it once picked ("Yellow Portrait 400").

## RawBoy Auto

### A3. One list of adjustments in the photo view (Medium, S) — Android, iOS, web
Brightness and Warmth appear in both the Look and the Adjust tab; it reads like two settings and costs a tab switch
for Contrast or Grain.
**Change:** drop the tabs: Strength, Brightness, Warmth, then a collapsible "More" with Contrast, Saturation, Tint,
Grain and Denoise.

### A4. Room for the file name on phones (Medium, S) — web, Android, iOS
In the photo view the name shrinks to "DSCF000…" behind Apply to all, Edit and Export.
**Change:** on narrow screens put Apply to all and Edit in RawBoy in a ⋯ menu; keep Export visible.

## RawBoy Camera

### C2. Swipe the viewfinder to change look (High, M) — Android, iOS
The look is a text dropdown under the viewfinder: two taps while framing, the menu covers the frame, and a look
can't be previewed before choosing it.
**Change:** swipe left/right on the viewfinder to step through looks, with the name shown briefly over the frame
(like film-simulation dials). The dropdown stays for jumping straight to one.

### C3. Fold the sliders into one row (Medium, M) — Android, iOS
Look, Strength, Brightness and Warmth are four permanent rows between viewfinder and shutter.
**Change:** one row with the look name and an "adjust" button that slides the three sliders up over the bottom of
the viewfinder; a dot on the button when values differ from default.

### C4. Grid and level (Medium, S) — Android, iOS
No composition aids.
**Change:** a Settings switch for a thirds grid, and a level line that turns accent-coloured when the phone is
straight (the orientation listener already exists for EXIF).

### F1. Group the film stocks and show which one is loaded (Medium, S) — RawBoy Camera's Film mode, Android, iOS
Twelve stocks plus Natural in one flat list; nothing says which are colour negative, cinema or slide, and the stock
name is only in the small row under the viewfinder.
**Change:** group the menu (Colour negative, Cinema on 2383, Slide, Natural) with a short note per stock, and show
the stock name in a corner of the viewfinder.

## Web UI screenshots

Without Emscripten the web UI can still be run with a stand-in decoder that opens every file as one synthetic
linear image: `tools/web_ui_stub/` (a `rawboy.mjs` for the git-ignored `web/public/wasm/`, exporting the embind API that
`src/worker/decoder.worker.ts` calls (`open`, `width`, `height`, `downsample`, `copyTile`, `lensInfo` …) and
returning RGB half floats). Exports come out empty; everything else works, so Playwright can screenshot each panel at
desktop and phone widths.
