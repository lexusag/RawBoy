import { describe, expect, it } from 'vitest';
import { LzwEncoder, TiffWriter } from '../export/TiffWriter';
import type { PhotoMetadata } from '../../worker/protocol';

/** TIFF LZW decoder with libtiff's code-width rule (early change), for the round trips. */
function lzwDecode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => { table = []; for (let i = 0; i < 256; i++) table.push([i]); table.push([], []); };
  reset();
  let width = 9;
  let pos = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const bit = (data[pos >> 3] >> (7 - (pos & 7))) & 1;
      v = (v << 1) | bit;
      pos++;
    }
    return v;
  };
  let old: number[] | null = null;
  for (;;) {
    if (pos + width > data.length * 8) throw new Error('ran out of data before EOI');
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; old = null; continue; }
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && old) entry = [...old, old[0]];
    else throw new Error(`bad code ${code} (table ${table.length})`);
    out.push(...entry);
    if (old) table.push([...old, entry[0]]);
    old = entry;
    if (table.length >= (1 << width) - 1 && width < 12) width++;
  }
  return Uint8Array.from(out);
}

describe('LzwEncoder', () => {
  const roundTrip = (src: Uint8Array) => expect(lzwDecode(new LzwEncoder().encode(src, src.length))).toEqual(src);

  it('round-trips random, repetitive and empty data, across table resets', () => {
    let seed = 1;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
    roundTrip(new Uint8Array(0));
    roundTrip(Uint8Array.of(7));
    roundTrip(Uint8Array.from({ length: 200_000 }, rnd));
    roundTrip(new Uint8Array(300_000).fill(3));
    roundTrip(Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 13 + (rnd() & 1)));
    for (let n = 1; n < 600; n += 37) roundTrip(Uint8Array.from({ length: n * 17 }, (_, i) => (i % n) & 0xff));
  });

  it('compresses smooth data', () => {
    const src = Uint8Array.from({ length: 100_000 }, (_, i) => (i >> 9) & 0xff);
    expect(new LzwEncoder().encode(src, src.length).length).toBeLessThan(src.length / 10);
  });
});

describe('TiffWriter', () => {
  const meta: PhotoMetadata = {
    make: 'FUJIFILM', model: 'GFX 50R', lensMake: '', lensModel: 'GF110mmF2 R LM WR', artist: '', copyright: '',
    dateTimeOriginal: '2026:04:27 14:03:09', subSecTimeOriginal: '', offsetTimeOriginal: '',
    exposureTime: 1 / 250, fNumber: 2.8, exposureBias: 0, focalLength: 110, focalLength35mm: 87, iso: 1000,
    gps: { latitude: new Float64Array([48, 8, 12.5]), longitude: new Float64Array([24, 30, 1.25]), latitudeRef: 'N', longitudeRef: 'E', altitude: 1840, belowSeaLevel: false },
  };

  async function decode(blob: Blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const v = new DataView(buf.buffer);
    expect(String.fromCharCode(buf[0], buf[1])).toBe('II');
    const ifd = v.getUint32(4, true);
    const tags = new Map<number, number[]>();
    for (let i = 0; i < v.getUint16(ifd, true); i++) {
      const p = ifd + 2 + i * 12;
      const type = v.getUint16(p + 2, true);
      const count = v.getUint32(p + 4, true);
      const size = type === 3 ? 2 : 4;
      const at = count * size > 4 ? v.getUint32(p + 8, true) : p + 8;
      const values = [];
      for (let k = 0; k < count && type !== 2 && type !== 5; k++) values.push(size === 2 ? v.getUint16(at + k * 2, true) : v.getUint32(at + k * 4, true));
      tags.set(v.getUint16(p, true), values);
    }
    let last = -1;
    for (let i = 0; i < v.getUint16(ifd, true); i++) {
      const tag = v.getUint16(ifd + 2 + i * 12, true);
      expect(tag).toBeGreaterThan(last); // sorted
      last = tag;
    }
    expect(tags.get(259)).toEqual([5]);
    expect(tags.get(317)).toEqual([2]);
    const offsets = tags.get(273)!;
    const counts = tags.get(279)!;
    const raw = offsets.map((o, i) => lzwDecode(buf.subarray(o, o + counts[i])));
    return { tags, bytes: Uint8Array.from(raw.flatMap((r) => [...r])), buf };
  }

  for (const bits of [8, 16] as const) {
    it(`writes ${bits}-bit strips that decode to the input`, async () => {
      const w = 700, h = 333;
      const img = Uint16Array.from({ length: w * h * 3 }, (_, i) => ((i * 977) ^ (i >> 5)) & 0xffff);
      const writer = new TiffWriter(w, h, bits);
      for (let y = 0; y < h; y += 100) writer.writeRows(img.subarray(y * w * 3), Math.min(100, h - y));
      const { tags, bytes } = await decode(writer.finish());
      expect(tags.get(256)).toEqual([w]);
      expect(tags.get(257)).toEqual([h]);
      expect(tags.get(273)!.length).toBeGreaterThan(1);
      // Undo the predictor and compare.
      const bps = bits / 8;
      const got = new Uint16Array(w * h * 3);
      const want = img.map((v) => (bits === 16 ? v : Math.trunc((v * 255 + 32767) / 65535)));
      for (let y = 0; y < h; y++) {
        const prev = [0, 0, 0];
        for (let i = 0; i < w * 3; i++) {
          const at = (y * w * 3 + i) * bps;
          const d = bps === 2 ? bytes[at] | (bytes[at + 1] << 8) : bytes[at];
          const value = (d + prev[i % 3]) & (bits === 16 ? 0xffff : 0xff);
          prev[i % 3] = value;
          got[y * w * 3 + i] = value;
        }
      }
      expect(got).toEqual(want);
    });
  }

  it('carries the EXIF of the photo', async () => {
    const w = 64, h = 40;
    const writer = new TiffWriter(w, h, 16, meta);
    writer.writeRows(new Uint16Array(w * h * 3).fill(30000), h);
    const { tags, bytes, buf } = await decode(writer.finish());
    expect(bytes.length).toBe(w * h * 6);
    const str = (tag: number) => {
      const v = new DataView(buf.buffer);
      const ifd = v.getUint32(4, true);
      for (let i = 0; i < v.getUint16(ifd, true); i++) {
        const p = ifd + 2 + i * 12;
        if (v.getUint16(p, true) !== tag) continue;
        const count = v.getUint32(p + 4, true);
        const at = count > 4 ? v.getUint32(p + 8, true) : p + 8;
        return new TextDecoder().decode(buf.subarray(at, at + count - 1));
      }
      return null;
    };
    expect(str(271)).toBe('FUJIFILM');
    expect(str(272)).toBe('GFX 50R');
    expect(str(305)).toBe('RawBoy');
    expect(tags.get(274)).toEqual([1]);
    expect(tags.get(34665)![0]).toBeGreaterThan(0); // Exif IFD
    expect(tags.get(34853)![0]).toBeGreaterThan(0); // GPS IFD
  });
});
