# RawBoy Web

The browser version: a **RawBoy** tab with every control above and an **Auto** tab with RawBoy Auto's batch,
looks and export. Same pipeline: the engine's C++ (LibRaw, lens opcodes, blemish healing, jpegli) compiled to
WebAssembly, the same develop shader in WebGL2, and the Kotlin engine ported to TypeScript. Skin retouch and
blemish removal use the same MediaPipe models in the browser.

- Open: **Open** / **Add** or drag and drop (RAW files; `.cube` / HaldCLUT `.png` files go to *Your LUTs*).
- Double-click the photo or press **Z** for 100% (Z zooms at the pointer, or the middle when the pointer is off the photo; works in every mode except Crop & rotate), drag to pan, press and hold to compare (or the **Compare** button and `\` to keep the as-shot render on), click outside the photo to change the frame.
  A hint at the bottom of the photo says so for a few seconds after each photo opens, until you have zoomed once.
- Export: JPEG (jpegli, quality 1–100, 4:4:4) or TIFF 8/16-bit (LZW), full size or a smaller long side, saved as a
  download. Auto's **Export all** writes `<name>-auto.jpg` (or `.tif`, see Auto's export options) into a folder you pick
  (Chrome/Edge), else one ZIP.
- RawBoy → Auto: **Apply RawBoy preset…** next to *Import as* in Auto's grid develops every photo with a RawBoy preset
  (one saved in the RawBoy tab, or a `.rawboy.json` file exported from RawBoy on the web or Android) in place of its
  look: everything the preset holds, lens corrections, LUT, film, detail, retouch and gradient masks included, on top
  of each photo's auto develop (groups the preset leaves out keep the auto values). Photos added later get it too.
  Denoise, Color denoise and sharpening come from each photo's auto develop (its own noise), not the preset. A
  selection's **Preset** button (bookmarks icon) gives just those photos a preset, so each scene can have its own.
  Brightness, Warmth and the Adjust sliders still work on top; there is no Strength. **Remove** goes back to the looks;
  **Use a look** in the photo view does it for one photo.
- Auto's **Import as: As is** (web only): photos are added with no automatic edits and no look, for files finished
  elsewhere (TIFFs from another editor, scans) that only want a preset, e.g. just grain. The analysis skips the auto
  develop and the noise and skin measurements behind it, so imports are faster, and each photo starts as the file
  itself (labelled *As is*); **Apply RawBoy preset…**, a look, Film or the sliders add what you choose. Denoise and
  sharpening stay at the file's (none added). No "lower quality than RAW" note for these imports. While photos wait,
  the grid shows each file's own preview as the Browser does (a JPEG/PNG as it is, a raw's or TIFF's embedded JPEG; a
  TIFF without one appears once analysed). Kept in sidecars with the other Auto settings.
- Lens presets: **Save lens preset** in the RawBoy tab's Lens tab, and the Auto tab gives every photo taken with that
  lens its lens corrections on top of its look or preset (only the lens settings change); a lens-only preset file
  opened with **Apply RawBoy preset…** joins the RawBoy tab's presets. Manual lenses' presets (named in the Lens tab)
  are picked by name in the Auto tab's **Lens** menu, for every photo or a selection; the photo view has the same menu
  for one photo and shows which preset By lens found. Remove one with **Manage…** next to the menu, or in the RawBoy
  tab's Presets.
- Auto → RawBoy: **Edit in RawBoy** in Auto's photo view opens that photo in the RawBoy tab, starting from Auto's
  develop and look (Reset still goes back to as-shot). And back: **Back to Auto** in the RawBoy tab's top bar returns it
  to the same photo in Auto, developed with the RawBoy edits ("RawBoy edits" in place of the look; Auto's sliders adjust
  on top, **Use a look** drops them, Undo too). A photo opened in RawBoy directly gets **Send to Auto**, which adds it to
  Auto's batch with its edits. Edits come back exactly as made, crop and masks included; Apply to all and Copy previous
  copy looks and presets, not RawBoy edits.
- **Browser** tab (RawBoy Browser): culling. **Open** a folder (or drop one) and its photos show from the JPEG previews
  cameras embed in their raws (CR2, CR3, NEF, ARW, RAF, RW2, ORF, PEF, DNG…), read without decoding the raw, so a
  card's worth opens in seconds; a raw without one is developed as shot. DNG 1.7 files with JPEG XL previews (Adobe
  DNG Converter's lossy/JPEG XL DNGs, which keep only a 256 px JPEG thumbnail) show their JPEG XL previews instead:
  the small one for the grid, the full-size one at 2560 px in the viewer (needs the build with the Adobe DNG SDK). A
  RAW + JPEG pair is one photo.
  Keys: **1–5** stars, **P** pick, **X** reject, **U** unflag, **Mod+Z** undo, arrows to move, Enter to open, Esc back,
  **Z** or double-click for 1:1 of the preview, **E** to edit in RawBoy; **Auto-advance** goes on to the next photo
  after rating. Filters: All / Picks / Unflagged / Rejects and minimum stars. Ratings are written as you go into XMP
  sidecars next to the raws (`NAME.xmp`; darktable's `NAME.CR2.xmp` and its duplicates' `NAME_01.CR2.xmp` are updated when present), which Lightroom,
  Capture One and darktable read: `xmp:Rating` 0–5, −1 for rejects; picks go in RawBoy's own `rawboy:Pick` (XMP has
  no standard pick). Existing sidecars keep everything else byte for byte. **Move rejects to bin** moves the rejects,
  their sidecars and same-name JPEGs into a `_bin` subfolder (browsers can't use the system trash); **Undo** or
  **Bin (n)** moves them back, and nothing is ever deleted. **Send to Auto** adds photos to Auto's batch: the
  picks, those with at least or exactly N stars (rejects left out), or what the grid shows now; photos already in Auto
  are skipped. To send a hand-picked set, long-press a photo (or Ctrl/⌘-click) to select, click more, Shift-click for
  a range, Ctrl/⌘+A for all shown, then **Send to Auto** in the selection bar.
  Writing to a folder needs Chrome or Edge (File System Access API); Safari (all iPad browsers) and Firefox pick
  files instead, rate in memory, and **Save ratings** downloads the sidecars as a ZIP; nothing is moved there.
  **Edits in sidecars** (folders only, off by default, remembered in the browser): photos opened in RawBoy from the
  Browser keep their edits in their sidecar (`rawboy:Develop`, JSON of the fields changed from as shot, crop, masks
  and brush strokes included; `NAME.xmp`, else darktable's `NAME.CR2.xmp`, else a new `NAME.xmp`) and reopen with
  them instead of the previous photo's carried-over edits. Reset removes them again. Photos sent to Auto keep their
  Auto settings there too (`rawboy:Auto`: look or film look, strength, adjustments, the preset itself, a picked lens
  preset or None, and RawBoy edits from Back to Auto). Opening the folder again (**Reopen <folder>** remembers the last one) puts the photos with Auto
  settings back into Auto as they were left. Other apps' data in the sidecar stays as it was; they don't read
  RawBoy's edits.
- Auto's photo view: **Space** / **Backspace** go to the next / previous photo, as in darktable, even while a slider
  has focus; **→** / **←** do too, also right after dragging a slider. A slider reached with **Tab** keeps the arrow
  keys for itself.
- **?** in the top bar, or **Ctrl+/** (**⌘/** on a Mac), shows the open tab's basics and keyboard shortcuts; Esc closes it.
- Opens JPEG XL DNGs with the Adobe DNG SDK, like the apps. **Licences** at the end of the help (**?**) lists the
  third-party licences. Setup and builds: [web/README.md](../web/README.md).
