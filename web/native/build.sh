#!/bin/sh
# Builds the engine's native code to WebAssembly into web/public/wasm/:
#   rawboy-full.mjs/.wasm  LibRaw + Adobe DNG SDK (DNG 1.7 / JPEG XL); what the app loads
#   rawboy.mjs/.wasm       LibRaw only; the fallback when the full variant is missing
# Needs Emscripten and CMake (brew install emscripten cmake). The first run downloads LibRaw and jpegli.
# Usage: native/build.sh [public]   (without the SDK in third_party/dng_sdk only rawboy.wasm is built;
# "public", for deployable builds, fails instead)
set -e
cd "$(dirname "$0")"
OUT=../public/wasm
mkdir -p "$OUT"

build() {  # build <dir> <cmake options...>
    dir=$1; shift
    emcmake cmake -S . -B "$dir" -DCMAKE_BUILD_TYPE=Release "$@" > /dev/null
    cmake --build "$dir" -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
}

build build/lite
cp build/lite/rawboy.mjs build/lite/rawboy.wasm "$OUT/"

if [ -f ../../third_party/dng_sdk/dng_sdk/source/dng_host.cpp ]; then
    # libjxl's bundled dependencies declare CMake < 3.5 policies, which CMake 4 refuses by default.
    build build/full -DRAWBOY_WEB_DNG_SDK=ON -DCMAKE_POLICY_VERSION_MINIMUM=3.5
    cp build/full/rawboy-full.mjs build/full/rawboy-full.wasm "$OUT/"
elif [ "$1" = "public" ]; then
    echo "Public builds need the Adobe DNG SDK in third_party/dng_sdk; see third_party/README.md" >&2
    exit 1
fi
ls -la "$OUT"
