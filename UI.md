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

## RawBoy Camera

### C3. Fold the sliders into one row (Medium, M) — Android, iOS
Look, Strength, Brightness and Warmth are four permanent rows between viewfinder and shutter.
**Change:** one row with the look name and an "adjust" button that slides the three sliders up over the bottom of
the viewfinder; a dot on the button when values differ from default.

### C4. Grid and level (Medium, S) — Android, iOS
No composition aids.
**Change:** a Settings switch for a thirds grid, and a level line that turns accent-coloured when the phone is
straight (the orientation listener already exists for EXIF).

## Web UI screenshots

Without Emscripten the web UI can still be run with a stand-in decoder that opens every file as one synthetic
linear image: `tools/web_ui_stub/` (a `rawboy.mjs` for the git-ignored `web/public/wasm/`, exporting the embind API that
`src/worker/decoder.worker.ts` calls (`open`, `width`, `height`, `downsample`, `copyTile`, `lensInfo` …) and
returning RGB half floats). Exports come out empty; everything else works, so Playwright can screenshot each panel at
desktop and phone widths.
