# Film scan: web reference for the Swift engine

Runs `shaders/scan.frag` (the film scan upscale pre-pass) exactly as `web/src/engine/gl/ScanUpscaler.ts` does, in headless
Chrome (WebGL2, float render targets), on `in.f16` (a 96 x 64 half-float RGBA image) and writes the 144 x 96 result to
`web.json`. `ios/EngineTests/ScanTests.swift` compares the Metal pre-pass with it:

    python3 gen_input.py            # writes in.f16 (needs numpy)
    node serve.mjs                  # writes web.json (needs Google Chrome)
    TEST_RUNNER_RAWBOY_SCAN_IN=$PWD/in.f16 TEST_RUNNER_RAWBOY_SCAN_WEB=$PWD/web.json \
      xcodebuild test -scheme RawBoyEngineTestsMac -destination 'platform=macOS' -only-testing:RawBoyEngineTestsMac/ScanTests
