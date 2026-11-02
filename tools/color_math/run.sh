#!/bin/sh
# Builds and runs the color_math host test (any C++17 compiler).
set -e
here=$(cd "$(dirname "$0")" && pwd)
cpp="$here/../../engine/src/main/cpp"
out="${TMPDIR:-/tmp}/color_math_test"
${CXX:-c++} -std=c++17 -O2 -I"$cpp" "$here/test.cpp" -o "$out"
"$out"
