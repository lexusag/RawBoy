#!/bin/sh
# Builds the lossy JPEG XL DNG host test (needs cmake and the DNG SDK in third_party/dng_sdk) and runs it on a DNG:
#   tools/dng_jxl/run.sh in.dng out.dng [distance]
set -e
here=$(cd "$(dirname "$0")" && pwd)
build="${TMPDIR:-/tmp}/dng_jxl_build"
cmake -S "$here" -B "$build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
cmake --build "$build" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" --target dng_jxl_test
"$build/dng_jxl_test" "$@"
