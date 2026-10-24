import { describe, expect, it } from 'vitest';
import { exifSegment, insertExif } from '../export/ExifWriter';
import type { PhotoMetadata } from '../../worker/protocol';

const meta = (p: Partial<PhotoMetadata> = {}): PhotoMetadata => ({
  make: 'FUJIFILM', model: 'GFX 50R', lensMake: 'FUJIFILM', lensModel: 'GF110mmF2 R LM WR', artist: 'A. Person', copyright: '',
  dateTimeOriginal: '2026:04:27 14:03:09', subSecTimeOriginal: '25', offsetTimeOriginal: '+02:00',
  exposureTime: 1 / 250, fNumber: 2.8, exposureBias: -0.67, focalLength: 110, focalLength35mm: 87, iso: 1000,
  gps: { latitude: new Float64Array([48, 8, 12.5]), longitude: new Float64Array([24, 30, 1.25]), latitudeRef: 'N', longitudeRef: 'E', altitude: 1840, belowSeaLevel: false },
  ...p,
});

/** A minimal EXIF reader for the tests: tag -> value from IFD0, Exif and GPS IFDs. */
function read(app1: Uint8Array) {
  const v = new DataView(app1.buffer, app1.byteOffset);
  expect(v.getUint16(0)).toBe(0xffe1);
  expect(v.getUint16(2)).toBe(app1.length - 2);
  const base = 10;
  expect(String.fromCharCode(app1[base], app1[base + 1])).toBe('II');
  const tags = new Map<string, unknown>();
  const ifd = (name: string, offset: number) => {
    const n = v.getUint16(base + offset, true);
    let last = -1;
    for (let i = 0; i < n; i++) {
      const p = base + offset + 2 + i * 12;
      const tag = v.getUint16(p, true);
      expect(tag).toBeGreaterThan(last); // sorted
      last = tag;
      const type = v.getUint16(p + 2, true);
      const count = v.getUint32(p + 4, true);
      const size = { 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 }[type]! * count;
      const at = size <= 4 ? p + 8 : base + v.getUint32(p + 8, true);
      let value: unknown;
      if (type === 2) value = new TextDecoder().decode(app1.subarray(at, at + count - 1));
      else if (type === 3) value = v.getUint16(at, true);
      else if (type === 4) value = v.getUint32(at, true);
      else if (type === 5) value = Array.from({ length: count }, (_, k) => v.getUint32(at + k * 8, true) / v.getUint32(at + k * 8 + 4, true));
      else if (type === 10) value = v.getInt32(at, true) / v.getInt32(at + 4, true);
      else value = Array.from(app1.subarray(at, at + count));
      tags.set(`${name}.${tag.toString(16)}`, value);
      if (name === 'ifd0' && tag === 0x8769) ifd('exif', value as number);
      if (name === 'ifd0' && tag === 0x8825) ifd('gps', value as number);
    }
  };
  ifd('ifd0', v.getUint32(base + 4, true));
  return tags;
}

describe('EXIF writer', () => {
  it('writes the fields Android copies, readable back', () => {
    const t = read(exifSegment(meta()));
    expect(t.get('ifd0.10f')).toBe('FUJIFILM');
    expect(t.get('ifd0.110')).toBe('GFX 50R');
    expect(t.get('ifd0.112')).toBe(1);
    expect(t.get('ifd0.131')).toBe('RawBoy');
    expect(t.get('ifd0.13b')).toBe('A. Person');
    expect(t.has('ifd0.8298')).toBe(false); // empty copyright left out
    expect(t.get('exif.829a')).toEqual([1 / 250]);
    expect(t.get('exif.829d')).toEqual([2.8]);
    expect(t.get('exif.8827')).toBe(1000);
    expect(t.get('exif.9003')).toBe('2026:04:27 14:03:09');
    expect(t.get('exif.9011')).toBe('+02:00');
    expect(t.get('exif.9291')).toBe('25');
    expect(t.get('exif.9204')).toBeCloseTo(-0.67, 9);
    expect(t.get('exif.920a')).toEqual([110]);
    expect(t.get('exif.a405')).toBe(87);
    expect(t.get('exif.a001')).toBe(1);
    expect(t.get('exif.a434')).toBe('GF110mmF2 R LM WR');
    expect(t.get('gps.1')).toBe('N');
    expect(t.get('gps.2')).toEqual([48, 8, 12.5]);
    expect(t.get('gps.3')).toBe('E');
    expect(t.get('gps.4')).toEqual([24, 30, 1.25]);
    expect(t.get('gps.5')).toEqual([0]);
    expect(t.get('gps.6')).toEqual([1840]);
    expect(t.has('gps.7')).toBe(false); // no time stamp in the source
    expect(t.has('gps.1d')).toBe(false);
  });

  it('keeps the GPS time and date stamps', () => {
    const gps = { ...meta().gps!, timeStamp: new Float64Array([18, 5, 9.25]), dateStamp: '2026:10:24' };
    const t = read(exifSegment(meta({ gps })));
    expect(t.get('gps.7')).toEqual([18, 5, 9.25]);
    expect(t.get('gps.1d')).toBe('2026:10:24');
    const bad = read(exifSegment(meta({ gps: { ...gps, timeStamp: new Float64Array([NaN, NaN, NaN]), dateStamp: '' } })));
    expect(bad.has('gps.7')).toBe(false);
    expect(bad.has('gps.1d')).toBe(false);
  });

  it('leaves unknown values out', () => {
    const t = read(exifSegment(meta({ exposureTime: NaN, fNumber: NaN, exposureBias: NaN, offsetTimeOriginal: '', dateTimeOriginal: '', gps: null, iso: 0 })));
    for (const k of ['exif.829a', 'exif.829d', 'exif.9204', 'exif.9011', 'exif.9003', 'exif.8827', 'ifd0.8825']) expect(t.has(k)).toBe(false);
  });

  it('writes long exposures in tenths of a second', () => {
    expect(read(exifSegment(meta({ exposureTime: 2.5 }))).get('exif.829a')).toEqual([2.5]);
  });

  it('goes after the JFIF segment', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xdb, 0xff, 0xd9]);
    const app1 = exifSegment(meta());
    const out = insertExif(jpeg, app1);
    expect(Array.from(out.subarray(0, 8))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2]);
    expect(Array.from(out.subarray(8, 10))).toEqual([0xff, 0xe1]);
    expect(Array.from(out.subarray(8 + app1.length))).toEqual([0xff, 0xdb, 0xff, 0xd9]);
  });
});
