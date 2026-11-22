#!/usr/bin/env python3
# RawBoy Camera bring-up: fits the viewfinder's 512 px linear copy against the shot's raw copy (debug builds' DebugProbe
# dumps, files/debug/<id>-vf.f16 and <id>-raw.f16, half-float RGB with a .txt beside each). Prints the alignment, the
# viewfinder/raw ratio per 1 EV band of the raw, per channel, the log-log slope (1.0 = same tone) and the log-chroma
# spread (saturation). See docs/camera-platforms.md, "Adding a phone". Needs numpy.
#
# Pull a shot's files (P = the debug package, e.g. app.rawboy.camera.dev):
#   id=$(adb shell run-as $P ls -t files/debug | head -1 | cut -d- -f1)
#   for f in $id-vf.f16 $id-vf.txt $id-raw.f16 $id-raw.txt; do adb exec-out run-as $P cat files/debug/$f > <dir>/$f; done
#   python3 tools/camera_fit/fit.py <dir> $id
#   adb shell run-as $P rm -r files/debug        # afterwards
# The id is the shot's number since the process started: a restart begins at 1 again and overwrites older files.
# Usage: fit.py <dir or tuning zip> [id]: the viewfinder's 512 px copy vs the shot's (both linear Rec.2020, upright, half floats).
# Without an id, every shot in the folder or zip. A tuning zip comes from Settings › Collect tuning data (release builds
# too, report/TuningData.kt): its copies are numbered 1, 2, ... and log.txt and device-report.txt sit beside them.
import sys, re, os, glob, tempfile, zipfile, numpy as np

def fit(d, i):
    Y = np.array([0.2627, 0.6780, 0.0593])
    def load(n):
        t = open(f'{d}/{i}-{n}.txt').read(); w, h = map(int, t.split()[:2])
        return np.frombuffer(open(f'{d}/{i}-{n}.f16', 'rb').read(), np.float16).astype(float).reshape(h, w, 3), t
    vf, note = load('vf'); raw, _ = load('raw')
    scale = float(re.search(r'scale ([\d.]+)', note).group(1))
    m = re.search(r'colour ([-\d.E ]+?) ccm', note)
    C = np.array(list(map(float, m.group(1).split()))).reshape(3, 3).T if m and 'null' not in m.group(1) else None  # GL column-major -> rows
    def zoom(a, z, dx, dy):  # centre crop 1/z of a, shifted, bilinear back to full size
        h, w = a.shape[:2]; cw, ch = w / z, h / z; x0, y0 = (w - cw) / 2 + dx, (h - ch) / 2 + dy
        yy, xx = np.mgrid[0:h, 0:w]
        sx = np.clip(x0 + (xx + .5) * cw / w - .5, 0, w - 1.001); sy = np.clip(y0 + (yy + .5) * ch / h - .5, 0, h - 1.001)
        xi, yi = sx.astype(int), sy.astype(int); fx, fy = (sx - xi)[..., None], (sy - yi)[..., None]
        return a[yi, xi] * (1 - fx) * (1 - fy) + a[yi, xi + 1] * fx * (1 - fy) + a[yi + 1, xi] * (1 - fx) * fy + a[yi + 1, xi + 1] * fx * fy
    grey = lambda a: np.log2(np.maximum(a @ Y, 1e-5))[40:-40, 40:-40]
    def corr(a, b): a, b = a - a.mean(), b - b.mean(); return (a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum())
    best = max((corr(grey(vf), grey(zoom(raw, z, dx, dy))), z, dx, dy)
               for z in np.arange(1, 1.31, .02) for dx in range(-8, 9, 2) for dy in range(-8, 9, 2))
    print('alignment: corr %.3f zoom %.2f dx %d dy %d' % best)
    box = lambda a: a[:a.shape[0] // 8 * 8, :a.shape[1] // 8 * 8].reshape(a.shape[0] // 8, 8, a.shape[1] // 8, 8, 3).mean((1, 3)).reshape(-1, 3)
    V, R = box(vf), box(zoom(raw, *best[1:]))
    ok = (R.min(1) > 1e-4) & (V.min(1) > 1e-4) & (R.max(1) < .9 * R.max()); V, R = V[ok], R[ok]
    yv, yr = V @ Y, R @ Y; k = np.median(yv / yr)
    bins = np.floor(np.log2(yr / np.median(yr)))
    for b in sorted(set(bins)):
        s = bins == b
        if s.sum() >= 10: print(f'raw {b:+.0f} EV: n {s.sum():4d} vf/raw {np.median(yv[s] / yr[s]) / k:.3f}')
    print('vf/raw per channel', np.round(np.median((V / k) / R, 0), 3))
    print('log-log slope vf vs raw %.2f' % np.polyfit(np.log2(yr), np.log2(yv), 1)[0])
    sat = lambda A: np.median(np.std(np.log(A), 1))  # log-chroma spread
    if C is not None:
        P = (np.linalg.inv(C) @ (V / scale).T).T     # the preview before the app's colour matrix
        print(f'log-chroma spread: raw {sat(R):.3f} viewfinder {sat(V):.3f} preview without C {sat(P):.3f}')


src = sys.argv[1]
if zipfile.is_zipfile(src):
    tmp = tempfile.mkdtemp(prefix='rawboy-tuning-')
    zipfile.ZipFile(src).extractall(tmp)
    src = tmp
ids = sys.argv[2:] or sorted({os.path.basename(f)[:-8] for f in glob.glob(f'{src}/*-raw.f16')
                              if os.path.exists(f[:-7] + 'vf.f16')}, key=lambda s: (len(s), s))
for i in ids:
    if len(ids) > 1: print(f'--- shot {i}: ' + open(f'{src}/{i}-vf.txt').read().split('\n')[1].split(' scale')[0])
    fit(src, i)
