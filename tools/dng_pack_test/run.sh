#!/bin/sh
# Builds the Packer's DNG round-trip test (needs cmake and the DNG SDK in third_party/dng_sdk) and runs it on a DNG:
#   tools/dng_pack_test/run.sh in.dng
# in.dng is a Bayer DNG; it is made a Small raw (lossy JPEG XL) first unless it already is one. Set
# FETCHCONTENT_SOURCE_DIR_LIBRAW to an unpacked LibRaw 0.21.3 to build offline.
set -e
here=$(cd "$(dirname "$0")" && pwd)
build="${TMPDIR:-/tmp}/dng_pack_test_build"
cmake -S "$here" -B "$build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    ${FETCHCONTENT_SOURCE_DIR_LIBRAW:+-DFETCHCONTENT_SOURCE_DIR_LIBRAW="$FETCHCONTENT_SOURCE_DIR_LIBRAW"} >/dev/null
cmake --build "$build" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" --target dng_pack_test
"$build/dng_pack_test" "$@"
