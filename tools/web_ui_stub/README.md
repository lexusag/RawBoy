# Web UI stub decoder

Runs RawBoy Web's UI without the WASM build (no Emscripten), for layout work and screenshots. Every file opens as
the same synthetic linear image; exports come out empty.

```
python3 tools/web_ui_stub/gen_image.py web/public/wasm/stub.f16   # needs numpy
cp tools/web_ui_stub/rawboy.mjs web/public/wasm/                   # web/public/wasm is git-ignored
cd web && npm ci && node_modules/.bin/vite
```

Open any file (a few MB of random bytes named `*.RAF` will do). Delete `web/public/wasm/` before `npm run wasm`.
