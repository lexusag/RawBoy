# RawBoy Desktop (macOS, in development)

RawBoy's editor as a native Mac app (SwiftUI + Metal, the iOS engine). Phase 1 is "RawBoy at iOS level + edits in sidecars + keyboard and mouse". Needs Apple Silicon (the Swift engine uses `Float16`) and macOS 15.

## Photos and sidecars
- Open with ⌘O, drop a file on the window, or Finder's Open With. RAW, HEIC, JPEG, PNG and TIFF open in place (never copied).
- Edits are written to the photo's XMP sidecar as you work: `rawboy:Develop`, the same JSON as RawBoy on the web. The file is NAME.xmp next to the photo, else darktable's NAME.EXT.xmp, else a new NAME.xmp. Only that field changes; everything else in an existing sidecar is kept. Writes happen 800 ms after the last change, when another photo opens, when the app goes to the background and on quit.
- A photo with a sidecar reopens with its edits. One without takes the previous photo's edits (as on the phone). RawBoy Viewer's rotation (`tiff:Orientation`) and crop are read; RawBoy's own turn wins.
- Web-only values in a sidecar (heal spots, portrait retouch) are kept untouched.

## Export
⌘E: JPEG or TIFF, into the photo's folder or a folder you choose, named NAME-rawboy.jpg / .tif (an existing file of that name is replaced).

## Keys and mouse
Z 100% at the pointer, D frame colour, C Crop & rotate, \ Compare, B / E / V masks, [ ] brush size, Esc or Return closes the tool, Space pans, ⌘Z / ⇧⌘Z, ⌘O, ⌘E, ⌘/ help. Keys are matched by physical position. The wheel zooms around the pointer; over a slider it moves it (Shift big, ⌘ fine); double-click resets a slider.

## Not in yet
Skin retouch and blemish removal (MediaPipe has no macOS build), Send to Auto, Photos export, a folder browser, Intel Macs, sandboxing and notarisation (the app writes next to your photos, so it is not sandboxed).

## The DMG
Publishing a release builds `RawBoy-Desktop-<tag>.dmg` (the `desktop` job of `.github/workflows/release.yml`, on a macOS runner: macOS native slice with `ios/native/build.sh macos`, xcodegen, `xcodebuild` Release, ad-hoc signed, app + an Applications link packed with `hdiutil`) and attaches it to the release. It is not notarised: open the app the first time with right-click > Open (or System Settings > Privacy & Security > Open Anyway).
