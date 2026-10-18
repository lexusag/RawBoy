import type { PhotoMetadata } from '../../worker/protocol';

/**
 * Writes the main EXIF fields into exported JPEGs and TIFFs: the web counterpart of Exporter.copyExif on Android (same
 * tags, plus Orientation 1, Software RawBoy and ColorSpace sRGB). A TIFF block: header, IFD0, Exif IFD and GPS IFD,
 * little endian; JPEGs carry it in one APP1 segment, TIFFs ([tiffIfds]) put the image's own tags in the same IFD0.
 */

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const SRATIONAL = 10;
const UNDEFINED = 7;
const TYPE_SIZE: Record<number, number> = { [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [SRATIONAL]: 8, [UNDEFINED]: 1 };

export interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Writes the value bytes at [at]. */
  write: (v: DataView, at: number) => void;
}

export const ascii = (tag: number, s: string): Entry => {
  const bytes = new TextEncoder().encode(`${s}\0`);
  return { tag, type: ASCII, count: bytes.length, write: (v, at) => bytes.forEach((b, i) => v.setUint8(at + i, b)) };
};
export const short = (tag: number, n: number): Entry => ({ tag, type: SHORT, count: 1, write: (v, at) => v.setUint16(at, n, true) });
export const long = (tag: number, n: number): Entry => ({ tag, type: LONG, count: 1, write: (v, at) => v.setUint32(at, n, true) });
const undefinedBytes = (tag: number, bytes: number[]): Entry => ({
  tag, type: UNDEFINED, count: bytes.length, write: (v, at) => bytes.forEach((b, i) => v.setUint8(at + i, b)),
});

/** Unsigned rationals; [den] fixes the precision (exposure times use 1/n where that is exact). */
export const rationals = (tag: number, values: [number, number][]): Entry => ({
  tag, type: RATIONAL, count: values.length,
  write: (v, at) => values.forEach(([n, d], i) => {
    v.setUint32(at + i * 8, n, true);
    v.setUint32(at + i * 8 + 4, d, true);
  }),
});
const srational = (tag: number, n: number, d: number): Entry => ({
  tag, type: SRATIONAL, count: 1, write: (v, at) => {
    v.setInt32(at, n, true);
    v.setInt32(at + 4, d, true);
  },
});

/** A positive number as a rational with [den] as denominator (rounded), clamped to 32 bits. */
const rational = (x: number, den: number): [number, number] => [Math.min(0xffffffff, Math.round(x * den)), den];

/** Exposure time as photographers write it: 1/250 exactly, longer times in tenths of a second. */
function exposureRational(t: number): [number, number] {
  if (t < 1) {
    const inv = 1 / t;
    if (Math.abs(inv - Math.round(inv)) < 0.01 * inv) return [1, Math.round(inv)];
    return rational(t, 1_000_000);
  }
  return rational(t, 10);
}

const known = (x: number) => Number.isFinite(x) && x > 0;
const text = (s: string) => s.trim();

// Tags (TIFF 6 / EXIF 2.32 / GPS).
const T = {
  Make: 0x010f, Model: 0x0110, Orientation: 0x0112, Software: 0x0131, Artist: 0x013b, Copyright: 0x8298,
  ExifIfd: 0x8769, GpsIfd: 0x8825,
  ExposureTime: 0x829a, FNumber: 0x829d, Iso: 0x8827, ExifVersion: 0x9000, DateTimeOriginal: 0x9003,
  OffsetTimeOriginal: 0x9011, ExposureBias: 0x9204, FocalLength: 0x920a, SubSecTimeOriginal: 0x9291,
  ColorSpace: 0xa001, FocalLength35mm: 0xa405, LensMake: 0xa433, LensModel: 0xa434,
  GpsVersion: 0x0000, GpsLatRef: 0x0001, GpsLat: 0x0002, GpsLonRef: 0x0003, GpsLon: 0x0004, GpsAltRef: 0x0005, GpsAlt: 0x0006,
};

const dms = (v: Float64Array | number[]): [number, number][] => [rational(v[0], 1), rational(v[1], 1), rational(v[2], 10000)];

function ifds(m: PhotoMetadata) {
  const ifd0: Entry[] = [];
  if (text(m.make)) ifd0.push(ascii(T.Make, text(m.make)));
  if (text(m.model)) ifd0.push(ascii(T.Model, text(m.model)));
  ifd0.push(short(T.Orientation, 1)); // the exported pixels are already upright
  ifd0.push(ascii(T.Software, 'RawBoy'));
  if (text(m.artist)) ifd0.push(ascii(T.Artist, text(m.artist)));
  if (text(m.copyright)) ifd0.push(ascii(T.Copyright, text(m.copyright)));

  const exif: Entry[] = [];
  if (known(m.exposureTime)) exif.push(rationals(T.ExposureTime, [exposureRational(m.exposureTime)]));
  if (known(m.fNumber)) exif.push(rationals(T.FNumber, [rational(m.fNumber, 10)]));
  if (known(m.iso)) exif.push(short(T.Iso, Math.min(65535, Math.round(m.iso))));
  exif.push(undefinedBytes(T.ExifVersion, [0x30, 0x32, 0x33, 0x32])); // "0232"
  if (/^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(m.dateTimeOriginal)) exif.push(ascii(T.DateTimeOriginal, m.dateTimeOriginal));
  if (/^[+-]\d\d:\d\d$/.test(m.offsetTimeOriginal)) exif.push(ascii(T.OffsetTimeOriginal, m.offsetTimeOriginal));
  if (Number.isFinite(m.exposureBias)) exif.push(srational(T.ExposureBias, Math.round(m.exposureBias * 100), 100));
  if (known(m.focalLength)) exif.push(rationals(T.FocalLength, [rational(m.focalLength, 100)]));
  if (/^\d+$/.test(m.subSecTimeOriginal)) exif.push(ascii(T.SubSecTimeOriginal, m.subSecTimeOriginal));
  exif.push(short(T.ColorSpace, 1)); // sRGB
  if (known(m.focalLength35mm)) exif.push(short(T.FocalLength35mm, Math.min(65535, Math.round(m.focalLength35mm))));
  if (text(m.lensMake)) exif.push(ascii(T.LensMake, text(m.lensMake)));
  if (text(m.lensModel)) exif.push(ascii(T.LensModel, text(m.lensModel)));

  const gps: Entry[] = [];
  const g = m.gps;
  if (g) {
    gps.push(undefinedBytes(T.GpsVersion, [2, 3, 0, 0]));
    gps.push(ascii(T.GpsLatRef, g.latitudeRef));
    gps.push(rationals(T.GpsLat, dms(g.latitude)));
    gps.push(ascii(T.GpsLonRef, g.longitudeRef));
    gps.push(rationals(T.GpsLon, dms(g.longitude)));
    if (Number.isFinite(g.altitude)) {
      gps.push(undefinedBytes(T.GpsAltRef, [g.belowSeaLevel ? 1 : 0]));
      gps.push(rationals(T.GpsAlt, [rational(Math.abs(g.altitude), 100)]));
    }
  }
  return { ifd0, exif, gps };
}

const valueSize = (e: Entry) => TYPE_SIZE[e.type] * e.count;
/** Bytes an IFD takes: count, entries, next-IFD offset, then values that don't fit in 4 bytes (word aligned). */
const ifdSize = (entries: Entry[]) =>
  2 + entries.length * 12 + 4 + entries.reduce((s, e) => s + (valueSize(e) > 4 ? (valueSize(e) + 1) & ~1 : 0), 0);

/** Writes [entries] (sorted by tag) at [offset] of the TIFF block; returns the offset after it. */
function writeIfd(v: DataView, base: number, offset: number, entries: Entry[]): number {
  entries.sort((a, b) => a.tag - b.tag);
  let p = base + offset;
  let data = offset + 2 + entries.length * 12 + 4;
  v.setUint16(p, entries.length, true);
  p += 2;
  for (const e of entries) {
    v.setUint16(p, e.tag, true);
    v.setUint16(p + 2, e.type, true);
    v.setUint32(p + 4, e.count, true);
    if (valueSize(e) <= 4) {
      e.write(v, p + 8);
    } else {
      v.setUint32(p + 8, data, true);
      e.write(v, base + data);
      data += (valueSize(e) + 1) & ~1;
    }
    p += 12;
  }
  v.setUint32(p, 0, true); // no next IFD
  return data;
}

/**
 * Lays out a TIFF block: header, IFD0 with [own] entries plus [m]'s (own tags win), then the Exif and GPS IFDs.
 * [size] doesn't depend on the entries' values, only on their types and counts.
 */
export function tiffIfds(m: PhotoMetadata | null, own: Entry[]): { size: number; write: (v: DataView, base: number) => void } {
  const { ifd0: meta, exif, gps } = m ? ifds(m) : { ifd0: [], exif: [], gps: [] };
  const ifd0 = [...own, ...meta.filter((e) => !own.some((o) => o.tag === e.tag))];
  // Pointers to the sub-IFDs are LONG entries in IFD0; their values are set below once offsets are known.
  const exifPointer = exif.length ? long(T.ExifIfd, 0) : null;
  const gpsPointer = gps.length ? long(T.GpsIfd, 0) : null;
  if (exifPointer) ifd0.push(exifPointer);
  if (gpsPointer) ifd0.push(gpsPointer);
  const exifOffset = 8 + ifdSize(ifd0);
  const gpsOffset = exifOffset + (exif.length ? ifdSize(exif) : 0);
  if (exifPointer) exifPointer.write = (v, at) => v.setUint32(at, exifOffset, true);
  if (gpsPointer) gpsPointer.write = (v, at) => v.setUint32(at, gpsOffset, true);
  const size = gpsOffset + (gps.length ? ifdSize(gps) : 0);
  return {
    size,
    write: (v, base) => {
      v.setUint8(base, 0x49); // "II": little endian
      v.setUint8(base + 1, 0x49);
      v.setUint16(base + 2, 42, true);
      v.setUint32(base + 4, 8, true);
      writeIfd(v, base, 8, ifd0);
      if (exif.length) writeIfd(v, base, exifOffset, exif);
      if (gps.length) writeIfd(v, base, gpsOffset, gps);
    },
  };
}

/** The complete APP1 segment (marker, length, "Exif\0\0", TIFF block). */
export function exifSegment(m: PhotoMetadata): Uint8Array {
  const tiff = tiffIfds(m, []);
  const header = 10; // FFE1, length, "Exif\0\0"
  if (tiff.size + 8 > 0xffff) throw new Error('EXIF too large');
  const out = new Uint8Array(header + tiff.size);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0xffe1);
  v.setUint16(2, tiff.size + 8); // length counts itself and "Exif\0\0"
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  tiff.write(v, header);
  return out;
}

/** Inserts [app1] into a JPEG after SOI and any APP0 (JFIF) segment, as EXIF readers expect. */
export function insertExif(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(app1, at);
  out.set(jpeg.subarray(at), at + app1.length);
  return out;
}
