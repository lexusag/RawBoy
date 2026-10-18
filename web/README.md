# RawBoy Web

RawBoy in the browser: the **RawBoy** tab (every control) and the **Auto** tab (automatic develop + film looks,
batches), on the same engine as the Android apps.

- Decoding: the engine's C++ (LibRaw 0.21.3, the Adobe DNG SDK for JPEG XL DNGs, DNG opcodes, blemish healing, band
  downscaler, jpegli) compiled to WebAssembly (`native/`), running in a Web Worker.
- Develop: the same GLSL as Android (`../shaders`, unchanged) in WebGL2, for the preview and tiled export.
- The Kotlin engine is ported file for file to TypeScript in `src/engine/` (same names; Kotlin stays the reference).
- Skin retouch / blemish removal / face metering: the same MediaPipe models, through `@mediapipe/tasks-vision`.
- Export: JPEG with jpegli (16-bit in, 4:4:4) or TIFF 8/16-bit, as a download. Auto's **Export all** writes into a
  folder you pick (Chrome/Edge) or downloads one ZIP.

## Run locally

Needs Node 20+, Emscripten and CMake (`brew install emscripten cmake`).

```
cd web
npm install
npm run wasm     # first time: builds public/wasm/ (downloads LibRaw and jpegli)
npm run dev      # http://localhost:5173
npm run build:public   # deployable dist/ (rebuilds the WASM; needs the DNG SDK, see below)
```

With the Adobe DNG SDK in `third_party/dng_sdk` (see `../third_party/README.md`), `npm run wasm` also builds
`rawboy-full.wasm` (LibRaw + DNG SDK), which the app loads first; it opens DNG 1.7 / JPEG XL DNGs. Without the SDK
only `rawboy.wasm` (LibRaw) is built and used. The header shows which decoder is loaded.

## Public build

```
npm run build:public   # dist/ with rawboy-full.wasm; fails without third_party/dng_sdk
```

**Licences** in the top bar shows `../licenses/THIRD_PARTY_NOTICES.txt` (copied to `public/third_party_notices.txt`
by `vite.config.ts`), including the notice the DNG patent license requires. Keep it up to date when dependencies change.

`dist/` is static and can go on any host. The decoder uses threads, which need a cross-origin isolated page:
`coi-serviceworker` adds the headers on hosts that can't send them (GitHub Pages); where you can, send
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` yourself.
Check the bundled LUTs' licences before publishing (see [Third-party components](../docs/third-party.md)).

### Cloudflare Pages

`public/_headers` (copied into `dist/`) sends the isolation headers on Cloudflare Pages and Netlify; nginx ignores it.

```
npm run build:public
npx wrangler pages deploy dist --project-name rawboy   # first run asks to log in
```

Publishing a GitHub release does the same in CI (`web` job in `.github/workflows/release.yml`), using the
`CLOUDFLARE_API_TOKEN` (Account → Cloudflare Pages → Edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

Production is `rawboy.pages.dev` (a custom domain's CNAME points there); each deploy also gets its own
`<hash>.rawboy.pages.dev` URL. Some networks' DNS filters block `*.pages.dev`.

## Docker

The public build served by nginx with the isolation headers (`Dockerfile`, `nginx.conf`). Build from the repo root,
since the web build uses `../shaders`, `../luts` and `../engine`:

```
docker build -f web/Dockerfile -t rawboy-web .
docker run --rm -p 8080:80 rawboy-web   # http://localhost:8080
```

The wasm stage downloads the Adobe DNG SDK from Adobe (the URL in `../third_party/README.md`) and builds both
variants; the first build also downloads LibRaw and jpegli.

## Tests

- `npm test`: unit tests of the TypeScript engine (identity at defaults, white balance, lens geometry, LUTs, looks,
  naming, EXIF written and read back).
- `node scripts/decode-check.mjs [--full] file...`: decodes raws with the WASM build in Node and prints size,
  orientation, as-shot white, lens data and the 512 px copy's mean.

## Differences from Android

- Files come from the picker or drag and drop; exports are downloads (or a picked folder), not `Pictures/`.
- Auto's photo view has **Edit in RawBoy**: the photo opens in the RawBoy tab with Auto's settings (both apps share
  one page; on Android they're separate apps).
- Double-click = double tap; drag pans the 100% view; press and hold compares; ←/→ move through Auto's batch.
- EXIF in JPEGs is written from what the decoder read (`PhotoMetadata` in `rawboy.h`, `ExifWriter.ts`): the fields
  Android copies, plus Orientation 1 / Software / sRGB. LibRaw doesn't keep exposure compensation, the time zone or
  the original make/model strings, so LibRaw files lack the first two and get LibRaw's normalised names; DNG SDK files
  have everything. TIFF has no EXIF (as on Android).
- The WASM heap is limited to 4 GB: very large raws (≥100 MP) may not open.
- Tested in Chrome on macOS; other browsers need WebGL2 with `RGBA16UI` render targets.
