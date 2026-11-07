#!/bin/sh
# Builds the DNG SDK decoder test (needs cmake and the DNG SDK in third_party/dng_sdk) and runs it on a DNG:
#   tools/dng_decode_test/run.sh in.dng
# in.dng is a Bayer DNG that LibRaw reads; its Small raw (lossy JPEG XL, decoded by the SDK) is made first. Set
# FETCHCONTENT_SOURCE_DIR_LIBRAW to an unpacked LibRaw 0.21.3 to build offline.
set -e
here=$(cd "$(dirname "$0")" && pwd)
build="${TMPDIR:-/tmp}/dng_decode_test_build"
cmake -S "$here" -B "$build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    ${FETCHCONTENT_SOURCE_DIR_LIBRAW:+-DFETCHCONTENT_SOURCE_DIR_LIBRAW="$FETCHCONTENT_SOURCE_DIR_LIBRAW"} >/dev/null
cmake --build "$build" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" --target dng_decode_test
"$build/dng_decode_test" "$@"
