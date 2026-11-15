# RawBoy Desktop (macOS, in development)

RawBoy's editor as a native Mac app (SwiftUI + Metal, the iOS engine). Phase 1 is "RawBoy at iOS level + edits in sidecars + keyboard and mouse". Needs Apple Silicon (the Swift engine uses `Float16`) and macOS 15.

## Photos and sidecars
- Open with ⌘O, drop a file on the window, or Finder's Open With. RAW, HEIC, JPEG, PNG and TIFF open in place (never copied).
- Edits are written to the photo's XMP sidecar as you work: `rawboy:Develop`, the same JSON as RawBoy on the web. The file is NAME.xmp next to the photo, else darktable's NAME.EXT.xmp, else a new NAME.xmp. Only that field changes; everything else in an existing sidecar is kept. Writes happen 800 ms after the last change, when another photo opens, when the app goes to the background and on quit.
- A photo with a sidecar reopens with its edits. One without takes the previous photo's edits (as on the phone). RawBoy Viewer's rotation (`tiff:Orientation`) and crop are read; RawBoy's own turn wins.
- Healing brush strokes are saved in the sidecar too; web-only values (portrait retouch and others the Mac app doesn't know) are kept untouched.

## Export
⌘E: JPEG or TIFF, into the photo's folder or a folder you choose, named NAME-rawboy.jpg / .tif (an existing file of that name is replaced).

## Keys and mouse
Z 100% at the pointer, D frame colour, C Crop & rotate, \ Compare, B healing brush (inside Masks: brush), E / V masks, [ ] brush size, Delete removes the selected healing stroke, Esc or Return closes the tool, Space pans, ⌘Z / ⇧⌘Z, ⌘O, ⌘E, ⌘/ help. Keys are matched by physical position. The wheel zooms around the pointer; over a slider it moves it (Shift big, ⌘ fine); double-click resets a slider.

## Masks: Lens blur
The Masks panel's **Lens blur** slider (Adjust tab, 0..100): a round, lens-like defocus inside the layer's mask, up to 3% of the long side, where small bright lights become clean bokeh discs and the sharp part next to the mask is never smeared. The same two Metal passes as the web's two GL passes (mask radius, then disc gather) on a highlight-boosted 1536 px copy; preview, 100% and export agree. See [rawboy.md](rawboy.md), Masks.

## Skin: Skin retouch, Blemish removal, Portrait retouch
MediaPipe has no macOS build, so the Mac finds faces and skin with Apple's Vision framework (nothing bundled, no third-party code). Each face's skin is the polygon of Vision's face contour plus a forehead cap above the eyebrows, minus eyes, eyebrows, lips and nostrils (from Vision's 76 landmarks), cut back by a skin-colour model sampled from the face itself; neck, arms and hands are found by that colour model inside Vision's person mask (weight 0.85). How it differs from MediaPipe's (iOS, Android, web): there is no trained skin class, so a garment or hair close to the skin's tone can be taken for skin and skin in very different light to the face's is missed; the forehead's top edge is an estimate (Vision has no hairline); Vision finds fewer small or side-on faces (the mask is made on a 1280 px copy), and a dark scene is tried at several exposures until a face is found. **Skin retouch**, **Blemish removal** and **Portrait retouch** (Detail tab; per mask layer too, in the Masks panel) run on that mask. Portrait retouch is the web's algorithm and numbers (`PortraitRetouch.swift`; face landmarks reach it through `FaceShape`): spots, under-eyes, lines and evening, as a gains map the develop shader applies, so preview, 100% and export match. iOS: the engine is shared, but MediaPipe's landmarks aren't handed over yet, so the Portrait retouch sliders are Mac-only for now.

## Masks: Lens blur
Heal in the top bar, or B: click a dust spot, blemish or small object to heal it away, drag to paint a stroke. Healed in the full-resolution image by seamless cloning (the same native `healStroke` as the web): the tone comes from around it, the detail from a clean area the engine picks (**Auto source**) or one you place (**Choose source**: drag the dashed copy; new strokes keep that offset). Size and Feather apply to the next strokes; pick a stroke in the list to change its source or delete it; up to 64 strokes per photo, reset for each new photo and kept out of presets. Strokes are undone one at a time with ⌘Z. The iPhone build has the engine but no button yet (its top bar is full).

## Lens corrections
Lens tab › **Use Lensfun profile**: distortion, chromatic aberration and vignetting from the Lensfun database for raws with no embedded profile, as on the web (Auto match from EXIF, Pick lens, Generic). See [rawboy.md](rawboy.md), Lens corrections. The database is inside the app; nothing is downloaded.

## Not in yet
Send to Auto, Photos export, a folder browser, Intel Macs, sandboxing and notarisation (the app writes next to your photos, so it is not sandboxed).

## The DMG
Publishing a release builds `RawBoy-Desktop-<tag>.dmg` (the `desktop` job of `.github/workflows/release.yml`, on a macOS runner: macOS native slice with `ios/native/build.sh macos`, xcodegen, `xcodebuild` Release, ad-hoc signed, app + an Applications link packed with `hdiutil`) and attaches it to the release. It is not notarised: open the app the first time with right-click > Open (or System Settings > Privacy & Security > Open Anyway). To rebuild only the DMG for an existing release, run the workflow by hand with that tag and tick **Skip building the APKs**; **Skip building RawBoy Desktop's DMG** leaves it out. The job uses the newest non-beta Xcode on the `macos-26` runner.
