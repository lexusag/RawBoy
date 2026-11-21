#!/bin/sh
# Where RawBoy Viewer's libraries (RawBoyBrowseKit, ViewerFiles, ViewerImaging, ViewerUI) come from: project.yml's
# `packages:` block between the viewer-package markers.
#
#   ios/viewer-source.sh local [path]   a sibling checkout (default ../../RawBoyImageViewer/Packages): development
#   ios/viewer-source.sh git            the tag pinned below, from github.com/lexusag/RawBoyImageViewer: CI and releases
#
# Then run `xcodegen`. A change of source is a change of project.yml: commit it only when the *default* should change.
# Overrides for trying something before it is tagged (not committed): VIEWER_URL (e.g. file:///path/to/checkout) and
# VIEWER_BRANCH (instead of `from: VIEWER_FROM`).
set -e
cd "$(dirname "$0")"
VIEWER_FROM="${VIEWER_FROM:-0.2.11}"
VIEWER_URL="${VIEWER_URL:-https://github.com/lexusag/RawBoyImageViewer}"
case "$1" in
local) block="  RawBoyViewerPackages:
    path: ${2:-../../RawBoyImageViewer/Packages}" ;;
git)
    if [ -n "$VIEWER_BRANCH" ]; then pin="branch: $VIEWER_BRANCH"; else pin="from: $VIEWER_FROM"; fi
    block="  RawBoyViewerPackages:
    url: $VIEWER_URL
    $pin" ;;
*) echo "usage: $0 local [path] | git" >&2; exit 2 ;;
esac
python3 - "$block" <<'PY'
import re, sys
text = open("project.yml").read()
pattern = re.compile(r"(  # viewer-package:begin[^\n]*\n)(.*?)(  # viewer-package:end\n)", re.S)
if not pattern.search(text):
    sys.exit("project.yml has no viewer-package markers")
open("project.yml", "w").write(pattern.sub(lambda m: m.group(1) + sys.argv[1] + "\n" + m.group(3), text))
PY
echo "project.yml now takes the Viewer's libraries from: $1"
