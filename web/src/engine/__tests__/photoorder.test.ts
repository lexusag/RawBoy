import { describe, expect, it } from 'vitest';
import { compareNames, fileDate, sortPhotos, validDate } from '../auto/PhotoOrder';
import { findCaptureDate } from '../browse/CaptureDate';

const text = (s: string) => new TextEncoder().encode(s);
const le16 = (v: number) => [v & 255, (v >> 8) & 255];
const le32 = (v: number) => [...le16(v & 0xffff), ...le16(v >>> 16)];
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** A little-endian TIFF: IFD0 with DateTime [ifd0Date] and, when given, an EXIF IFD with DateTimeOriginal [exifDate]. */
function tiff(ifd0Date: string, exifDate?: string): Uint8Array {
  const d0 = [...text(ifd0Date), 0];
  const d1 = exifDate ? [...text(exifDate), 0] : [];
  const n0 = exifDate ? 2 : 1;
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + n0 * 12 + 4;
  const exifSize = exifDate ? 2 + 12 + 4 : 0;
  const d0At = exifAt + exifSize;
  const d1At = d0At + d0.length;
  const out = [0x49, 0x49, 42, 0, ...le32(ifd0At), ...le16(n0), ...le16(0x0132), ...le16(2), ...le32(d0.length), ...le32(d0At)];
  if (exifDate) out.push(...le16(0x8769), ...le16(4), ...le32(1), ...le32(exifAt));
  out.push(...le32(0));
  if (exifDate) out.push(...le16(1), ...le16(0x9003), ...le16(2), ...le32(d1.length), ...le32(d1At), ...le32(0));
  out.push(...d0, ...d1);
  return new Uint8Array(out);
}

/** A JPEG holding [exif] in APP1 (nothing decodable after it). */
function jpeg(exif: Uint8Array): Uint8Array {
  const size = 2 + 6 + exif.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 255, ...text('Exif'), 0, 0, ...exif, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

function box(type: string, payload: number[] | Uint8Array, uuid = ''): number[] {
  const u = uuid.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
  return [...be32(8 + u.length + payload.length), ...text(type), ...u, ...payload];
}

describe('Photo order', () => {
  const photos = [
    { name: 'IMG_10.CR3', date: '2026:10:01 12:00:00' },
    { name: 'img_9.CR3', date: '2026:10:01 12:00:05' },
    { name: 'DSCF0001.RAF', date: null },
    { name: 'IMG_2.CR3', date: '2026:09:30 08:00:00' },
    { name: 'A.dng', date: null },
  ];

  it('sorts by shoot date, undated photos last by name', () => {
    expect(sortPhotos(photos, 'date').map((p) => p.name)).toEqual(['IMG_2.CR3', 'IMG_10.CR3', 'img_9.CR3', 'A.dng', 'DSCF0001.RAF']);
  });

  it('sorts by name with numbers by value, case-insensitively', () => {
    expect(sortPhotos(photos, 'name').map((p) => p.name)).toEqual(['A.dng', 'DSCF0001.RAF', 'IMG_2.CR3', 'img_9.CR3', 'IMG_10.CR3']);
    expect(compareNames('IMG_9', 'IMG_10')).toBeLessThan(0);
  });

  it('keeps only real EXIF dates', () => {
    expect(validDate('2026:10:01 12:00:00\0')).toBe('2026:10:01 12:00:00');
    expect(validDate('0000:00:00 00:00:00')).toBeNull();
    expect(validDate('    :  :     :  :  ')).toBeNull();
    expect(fileDate(0)).toBeNull();
    expect(fileDate(new Date(2026, 9, 21, 16, 10, 59).getTime())).toBe('2026:10:21 16:10:59');
  });
});

describe('Capture dates', () => {
  it('reads TIFF raws: the EXIF IFD first, else IFD0', async () => {
    expect(await findCaptureDate(new Blob([tiff('2026:08:15 10:00:00', '2026:08:14 19:03:27')]))).toBe('2026:08:14 19:03:27');
    expect(await findCaptureDate(new Blob([tiff('2026:08:15 10:00:00')]))).toBe('2026:08:15 10:00:00');
  });

  it('reads JPEGs and RAFs (their embedded JPEG)', async () => {
    const j = jpeg(tiff('2026:08:15 10:00:00', '2026:07:01 06:30:00'));
    expect(await findCaptureDate(new Blob([j]))).toBe('2026:07:01 06:30:00');
    const header = new Uint8Array(100);
    header.set(text('FUJIFILMCCD-RAW 0201'));
    new DataView(header.buffer).setUint32(84, 100);
    expect(await findCaptureDate(new Blob([header, j]))).toBe('2026:07:01 06:30:00');
  });

  it('reads CR3: CMT2, else CMT1', async () => {
    const cr3 = (cmt: number[]) => new Blob([new Uint8Array([
      ...box('ftyp', text('crx ')),
      ...box('moov', box('uuid', cmt, '85c0b687820f11e08111f4ce462b6a48')),
    ])]);
    const exifIfd = new Uint8Array([0x49, 0x49, 42, 0, ...le32(8), ...le16(1), ...le16(0x9003), ...le16(2), ...le32(20), ...le32(26), ...le32(0), ...text('2026:05:05 05:05:05'), 0]);
    expect(await findCaptureDate(cr3([...box('CMT1', tiff('2026:08:15 10:00:00')), ...box('CMT2', exifIfd)]))).toBe('2026:05:05 05:05:05');
    expect(await findCaptureDate(cr3(box('CMT1', tiff('2026:08:15 10:00:00'))))).toBe('2026:08:15 10:00:00');
  });

  it('gives null for files without one', async () => {
    expect(await findCaptureDate(new Blob([new Uint8Array(64)]))).toBeNull();
    expect(await findCaptureDate(new Blob([]))).toBeNull();
  });
});
