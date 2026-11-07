#!/bin/sh
# Host test of the Ultra HDR container writer (engine/src/main/cpp/ultrahdr.h): builds the C++ harness with the system
# compiler and checks its output with check.py (needs python3 + Pillow). Usage: tools/ultrahdr/run.sh
set -e
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
${CXX:-c++} -std=c++17 -O1 -Wall -Wextra -fsanitize=address,undefined -o "$work/test" "$here/test.cpp"
python3 -I "$here/check.py" "$work/test" "$work"
