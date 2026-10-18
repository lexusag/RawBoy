# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.3.3"]
# ///
"""
How far RawBoy Auto's exposure is from the owner's own edits in darktable.

darktable's scene-referred exposure module works in the same units as RawBoy (linear, 1.0 = sensor clip, DNG
BaselineExposure applied) and starts from the same +0.7 EV, so the photo's darktable exposure minus 0.7 (minus the
camera's exposure bias when "compensate camera exposure" is on) is the RawBoy exposure slider the owner chose.
Untouched photos keep darktable's default, which for phone DNGs is the phone's own metering.

    uv run compare.py <raw-folder>:<harness-out-dir>... [-v]

Needs exiftool. Each raw folder holds the raws with darktable's .xmp sidecars.
"""
import base64
import glob
import json
import os
import re
import struct
import subprocess
import sys
import zlib

import numpy as np


def darktable_exposure(xmp: str):
    """(exposure EV, compensate camera bias) of the last enabled exposure module in the active history."""
    t = open(xmp).read()
    end = int(re.search(r'history_end="(\d+)"', t).group(1))
    found = None
    for item in re.findall(r"<rdf:li\s+([^>]*?)/>", t, re.S)[:end]:
        a = dict(re.findall(r'darktable:(\w+)="([^"]*)"', item))
        if a.get("operation") == "exposure" and a.get("enabled") == "1":
            p = a["params"]
            p = zlib.decompress(base64.b64decode(p[4:])) if p.startswith("gz") else bytes.fromhex(p)
            _mode, _black, exposure, _pct, _target, compensate = struct.unpack("<ifffii", p[:24])
            found = (exposure, compensate)
    return found


def main():
    verbose = "-v" in sys.argv
    rows = []
    for arg in [a for a in sys.argv[1:] if a != "-v"]:
        raws, out = arg.rsplit(":", 1)
        exif = {}
        cmd = ["exiftool", "-q", "-T", "-n", "-FileName", "-Make", "-ExposureCompensation", raws]
        for line in subprocess.run(cmd, capture_output=True, text=True).stdout.splitlines():
            name, make, bias = line.split("\t")
            exif[name] = (make, float(bias) if bias != "-" else 0.0)
        for j in sorted(glob.glob(os.path.join(out, "*.json"))):
            name = os.path.basename(j)[:-5]
            xmp = os.path.join(raws, name + ".xmp")
            if not os.path.exists(xmp) or name not in exif:
                continue
            dt = darktable_exposure(xmp)
            if dt is None:
                continue
            make, bias = exif[name]
            target = dt[0] - (bias if dt[1] else 0.0) - 0.7
            rows.append((name, make, json.load(open(j))["auto"]["exposure"], target))
    for make in sorted({r[1] for r in rows}):
        r = [x for x in rows if x[1] == make]
        e = np.array([x[2] - x[3] for x in r])
        print(f"{make:12} n={len(r):3}  auto vs edit: rms {np.sqrt(np.mean(e ** 2)):.2f} EV, mean {e.mean():+.2f} EV")
    if verbose:
        for name, make, auto, target in rows:
            print(f"  {name[:32]:32} auto {auto:+.2f}  edit {target:+.2f}  off {auto - target:+.2f}")


if __name__ == "__main__":
    main()
