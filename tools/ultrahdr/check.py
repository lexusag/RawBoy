"""Builds the inputs, runs the C++ harness and checks the container the way decoder_display.cpp reads it."""
import io, re, struct, subprocess, sys
from PIL import Image

exe, work = sys.argv[1], sys.argv[2]
W, H = 641, 479  # not multiples of the gain map's scale

# primary: a ramp picture with EXIF, as the encoder would produce (SOI, JFIF, EXIF APP1, ...)
img = Image.new("RGB", (W, H))
img.putdata([(int(255 * (i % W) / (W - 1)),) * 3 for i in range(W * H)])
exif = Image.Exif(); exif[0x010F] = "RawBoyTest"
img.save(f"{work}/primary.jpg", quality=92, exif=exif.tobytes())

subprocess.check_call([exe, "map", str(W), str(H), f"{work}/map.pgm"])
g = Image.open(f"{work}/map.pgm")
gw, gh = g.size
assert (gw, gh) == ((W + 3) // 4, (H + 3) // 4), (gw, gh)
row = list(g.tobytes()[:gw])
assert row[0] == 0 and row[gw // 2] == 0 and row[int(gw * 0.7)] == 0, row[:5]  # knee: nothing at or below luma 0.72
assert row[-1] >= 250, row[-1]                                               # full headroom at white
assert all(row[i] <= row[i + 1] + 1 for i in range(gw - 1)), "monotonic"

# film stock with dimmed paper white (0.857): normalized ramp should match the 1.0 ramp
subprocess.check_call([exe, "map", str(W), str(H), f"{work}/map_film.pgm", "0.857"])
gf = Image.open(f"{work}/map_film.pgm")
frow = list(gf.tobytes()[:gw])
assert frow[int(gw * 0.7)] == 0 and frow[-1] >= 250, (frow[int(gw * 0.7)], frow[-1])
assert max(abs(a - b) for a, b in zip(row, frow)) <= 1, "film white normalization"

g.convert("L").save(f"{work}/gain.jpg", quality=85)

subprocess.check_call([exe, "assemble", f"{work}/primary.jpg", f"{work}/gain.jpg", f"{work}/out.jpg"])
d = open(f"{work}/out.jpg", "rb").read()

# --- segments of the primary
def segments(d, start=0):
    p, out = start + 2, []
    while d[p] == 0xFF and 0xE0 <= d[p + 1] <= 0xEF:
        n = struct.unpack(">H", d[p + 2:p + 4])[0]
        out.append((d[p + 1], d[p + 4:p + 2 + n], p)); p += 2 + n
    return out

segs = segments(d)
kinds = [(m, s[:12]) for m, s, _ in segs]
assert segs[0][0] == 0xE0 and segs[1][1].startswith(b"Exif"), kinds
xmp = next(s for m, s, _ in segs if s.startswith(b"http://ns.adobe.com/xap/1.0/")).decode()
iso = next(s for m, s, _ in segs if s.startswith(b"urn:iso:std:iso:ts:21496:-1"))
assert iso == b"urn:iso:std:iso:ts:21496:-1\0\0\0\0\0", iso
mpf_seg = next((s, p) for m, s, p in segs if s.startswith(b"MPF\0"))
mpf, mpf_at = mpf_seg
tiff_at = mpf_at + 4 + 4  # marker+length, "MPF\0"
t = mpf[4:]
assert t[:4] == b"MM\x00*"
ifd = struct.unpack(">I", t[4:8])[0]; count = struct.unpack(">H", t[ifd:ifd + 2])[0]; assert count == 3
entry = next(t[ifd + 2 + i * 12: ifd + 14 + i * 12] for i in range(count) if struct.unpack(">H", t[ifd + 2 + i * 12:ifd + 4 + i * 12])[0] == 0xB002)
nent = struct.unpack(">I", entry[4:8])[0] // 16; lst = struct.unpack(">I", entry[8:12])[0]; assert nent == 2
size0, off0 = struct.unpack(">II", t[lst + 4:lst + 12]); size1, off1 = struct.unpack(">II", t[lst + 20:lst + 28])
assert off0 == 0 and size0 + size1 == len(d), (size0, size1, len(d))
second = tiff_at + off1
assert d[second:second + 2] == b"\xff\xd8" and second == size0, (second, size0)
assert d[size0 - 2:size0] == b"\xff\xd9" and d[-2:] == b"\xff\xd9"
m = re.search(r'Item:Semantic="GainMap"[^>]*Item:Length="(\d+)"', xmp); assert int(m.group(1)) == size1
assert 'hdrgm:Version="1.0"' in xmp

# --- the gain map file
gsegs = segments(d, second)
gxmp = next(s for m, s, _ in gsegs if s.startswith(b"http://ns.adobe.com/xap/1.0/")).decode()
for k, v in [("GainMapMin", "0"), ("GainMapMax", "2"), ("Gamma", "1"), ("OffsetSDR", "0.015625"), ("OffsetHDR", "0.015625"),
             ("HDRCapacityMax", "2"), ("BaseRenditionIsHDR", "False")]:
    assert f'hdrgm:{k}="{v}"' in gxmp, k
giso = next(s for m, s, _ in gsegs if s.startswith(b"urn:iso:std:iso:ts:21496:-1"))[28:]
# the ISO reader of decoder_display.cpp (fromIso), step for step
p = 0
def u(n):
    global p; v = int.from_bytes(giso[p:p + n], "big"); p += n; return v
def s32():
    v = u(4); return v - (1 << 32) if v >= 1 << 31 else v
assert u(2) == 0; u(2)
flags = u(1); assert flags == 0x08 and not flags & 0x80 and not flags & 0x04
den = u(4); base, alt = u(4), u(4)
mn, mx, gamma, osdr, ohdr = s32() / den, s32() / den, u(4) / den, s32() / den, s32() / den
assert (mn, mx, gamma, osdr, ohdr) == (0, 2, 1, 1 / 64, 1 / 64) and alt / den == 2 and p == len(giso), (mn, mx, gamma, osdr, ohdr, p, len(giso))

# --- viewers that read MPF
mpo = Image.open(io.BytesIO(d)); assert mpo.size == (W, H)
print("ok:", len(d), "bytes, gain map", gw, "x", gh, ", PIL format", mpo.format, getattr(mpo, "n_frames", 1), "frame(s)")
