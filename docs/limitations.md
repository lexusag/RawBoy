# Known limitations / next steps

- Grain and the fine colour denoise are sized in full-resolution pixels, so the fit-to-screen preview shows them weaker than the exported file (the multi-scale luma denoise follows the preview's scale). Judge them in the 100% view.
- Shadows/Highlights are per-pixel tone curves. A local (guided-filter) version would keep more micro-contrast.
- Press-and-hold compare shows healed blemishes as healed (healing changes the image data itself).
- Very large files (≥100 MP) export JPEG through a full-size Bitmap and may run out of memory (RawBoy and Auto;
  Camera's jpegli path streams and has no such limit).
- RawBoy Camera: single raw frames unless **Merge 8 frames** is on, which needs ~200 MB at its peak (on phones with
  little RAM Android may kill the app) and holds the DNG until the burst is merged; no manual exposure
  or digital zoom yet. Lenses other than the main one are streamed as physical cameras of the phone's logical back
  camera; if a phone refuses that, RawBoy Camera tries opening the lens on its own, and logs what it found
  (`adb logcat -s RawBoyCamera`). The Android emulator's back camera can't write DNGs (its metadata lacks the post-raw boost
  DngCreator needs), so camera captures are tested on the phone.
- TIFF has no embedded ICC profile (pixels are sRGB).
- JPEG/HEIC/PNG/TIFF input: output stays sRGB (wide-gamut colours are clipped as before); HEIC gain maps are ignored
  (iOS 18's HDR decode drew black on the Simulator); Apple's own JPEG gain map isn't read; 8-bit files can band in
  deep shadows pushed far up; the browser reads 16-bit PNGs as 8-bit. Ultra HDR recovery is modest on Pixel JPEGs:
  their SDR picture rarely clips (≤ 0.3% of pixels in the test set).
- RawBoy Web: JPEG EXIF comes from the decoder, not copied from the file: for LibRaw files (all but JPEG XL DNGs)
  exposure compensation and the time zone are missing and make/model are LibRaw's normalised names; raws of 100 MP
  and more may not fit the 4 GB WASM heap; tested in Chrome on macOS only.
