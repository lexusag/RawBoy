#!/usr/bin/env python3
"""Summarises a RawBoy Camera `.motion` file (app-camera capture/MotionFormat.kt): header, gyro rate and gaps,
frame timing, rolling shutter skew, OIS samples, encoded frames, and whether the gyro covers every frame.

    python3 tools/motion/dump.py VID_20261121_101500-camera.motion [--csv out_prefix]

--csv writes <prefix>-gyro.csv, -accel.csv, -frames.csv, -encoded.csv for plotting. Standard library only.
"""
import json
import struct
import sys

GYRO, ACCEL, FRAME, ENCODED, END = 1, 2, 3, 4, 255


def read(path):
    data = open(path, 'rb').read()
    if data[:8] != b'RBMOTION':
        sys.exit('not a .motion file')
    version, hlen = struct.unpack_from('<HI', data, 8)
    if version != 1:
        sys.exit(f'unknown version {version}')
    p = 14
    header = json.loads(data[p:p + hlen].decode('utf-8'))
    p += hlen
    gyro, accel, frames, encoded, end = [], [], [], [], None
    try:
        while p < len(data):
            tag = data[p]
            p += 1
            if tag == GYRO:
                gyro.append(struct.unpack_from('<q6f', data, p)); p += 32
            elif tag == ACCEL:
                accel.append(struct.unpack_from('<q3f', data, p)); p += 20
            elif tag == FRAME:
                t, e, d, s, focus, focal, ois = struct.unpack_from('<4q2fb', data, p); p += 41
                (n,) = struct.unpack_from('<h', data, p); p += 2
                pid = data[p:p + n].decode('utf-8'); p += n
                crop = struct.unpack_from('<4i', data, p); p += 16
                k = struct.unpack_from('<b', data, p)[0]; p += 1
                intr = struct.unpack_from(f'<{k}f', data, p); p += 4 * k
                (m,) = struct.unpack_from('<H', data, p); p += 2
                samples = [struct.unpack_from('<q2f', data, p + 16 * i) for i in range(m)]; p += 16 * m
                frames.append(dict(t=t, exposure=e, duration=d, skew=s, focus=focus, focal=focal, ois=ois,
                                   physical=pid, crop=crop, intrinsics=intr, ois_samples=samples))
            elif tag == ENCODED:
                encoded.append(struct.unpack_from('<2q', data, p)); p += 16
            elif tag == END:
                end = struct.unpack_from('<3q', data, p); p += 24
            else:
                print(f'unknown record {tag} at {p - 1}, stopping')
                break
    except struct.error:
        print('file cut short (last record incomplete)')
    return header, gyro, accel, frames, encoded, end


def stats(xs):
    xs = sorted(xs)
    if not xs:
        return 'none'
    return f'min {xs[0]:.3f}  median {xs[len(xs) // 2]:.3f}  max {xs[-1]:.3f}'


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    header, gyro, accel, frames, encoded, end = read(sys.argv[1])
    print(json.dumps(header, indent=1))
    if gyro:
        span = (gyro[-1][0] - gyro[0][0]) / 1e9
        gaps = [(b[0] - a[0]) / 1e6 for a, b in zip(gyro, gyro[1:])]
        print(f'gyro: {len(gyro)} samples over {span:.2f} s = {(len(gyro) - 1) / span:.1f} Hz; gap ms {stats(gaps)}')
    if accel:
        span = (accel[-1][0] - accel[0][0]) / 1e9
        print(f'accel: {len(accel)} samples = {(len(accel) - 1) / max(span, 1e-9):.1f} Hz')
    if frames:
        dt = [(b['t'] - a['t']) / 1e6 for a, b in zip(frames, frames[1:])]
        print(f'frames: {len(frames)}; interval ms {stats(dt)}')
        print(f'  exposure ms {stats([f["exposure"] / 1e6 for f in frames if f["exposure"] >= 0])}')
        print(f'  rolling shutter skew ms {stats([f["skew"] / 1e6 for f in frames if f["skew"] >= 0])}')
        print(f'  OIS mode {sorted({f["ois"] for f in frames})}, samples per frame {stats([len(f["ois_samples"]) for f in frames])}')
        print(f'  physical ids {sorted({f["physical"] for f in frames})}; crop {frames[0]["crop"]}; intrinsics {frames[0]["intrinsics"]}')
        if gyro:
            covered = sum(1 for f in frames if gyro[0][0] <= f['t'] and f['t'] + max(f['skew'], 0) + max(f['exposure'], 0) <= gyro[-1][0])
            print(f'  frames inside the gyro span: {covered}/{len(frames)}')
    if encoded:
        print(f'encoded: {len(encoded)} frames, pts 0..{encoded[-1][1] / 1e9:.2f} s')
    print(f'end: {end}' if end else 'no END record (recording not finished normally)')
    if '--csv' in sys.argv:
        prefix = sys.argv[sys.argv.index('--csv') + 1]
        with open(prefix + '-gyro.csv', 'w') as f:
            f.write('t,x,y,z,dx,dy,dz\n')
            f.writelines(','.join(map(str, g)) + '\n' for g in gyro)
        with open(prefix + '-accel.csv', 'w') as f:
            f.write('t,x,y,z\n')
            f.writelines(','.join(map(str, a)) + '\n' for a in accel)
        with open(prefix + '-frames.csv', 'w') as f:
            f.write('t,exposure,duration,skew,focus,focal,ois,physical,ois_samples\n')
            f.writelines(f'{x["t"]},{x["exposure"]},{x["duration"]},{x["skew"]},{x["focus"]},{x["focal"]},{x["ois"]},{x["physical"]},{len(x["ois_samples"])}\n' for x in frames)
        with open(prefix + '-encoded.csv', 'w') as f:
            f.write('sensor_t,pts\n')
            f.writelines(f'{s},{p}\n' for s, p in encoded)


if __name__ == '__main__':
    main()
