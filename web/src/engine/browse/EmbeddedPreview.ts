/**
 * The JPEG preview cameras embed in their raw files, found without decoding the raw: RawBoy Browser's thumbnails
 * and viewer show it, so a folder of raws opens in seconds. Only the bytes needed are read ([Blob.slice]).
 *
 * - TIFF-based raws (DNG, CR2, NEF, ARW, PEF, ORF, RW2, SRW, 3FR, ERF, ...): every IFD (IFD0's chain and SubIFDs) is
 *   searched for JPEGInterchangeFormat, single-strip JPEG data and RW2's JpgFromRaw.
 * - CR3: track 1 (the full-size JPEG) and the PRVW preview; orientation from CMT1.
 * - RAF: the JPEG offset in the header.
 * - Anything else, or when the above find nothing: a scan of the file's start for JPEG streams.
 *
 * Only baseline/progressive JPEGs count (raws keep their sensor data as lossless JPEG too); the largest wins.
 *
 * DNG 1.7 files can keep their previews as JPEG XL instead (Adobe DNG Converter with JPEG XL compression: only a
 * 256 px JPEG thumbnail, the real previews in JXL): [findJxlPreview] finds those, for the worker to decode.
 */

export interface EmbeddedPreview {
  /** The JPEG, with an EXIF orientation added when the raw's orientation applies, so browsers show it upright. */
  jpeg: Blob;
  /** Size of the JPEG as stored (before orientation). */
  width: number;
  height: number;
}

interface Candidate {
  offset: number;
  length: number;
}

interface JpegInfo {
  width: number;
  height: number;
  /** EXIF orientation inside the JPEG itself, 0 if it has none. */
  orientation: number;
}

/** A JPEG XL preview IFD of a DNG: one JXL stream per strip or tile, in reading order. */
export interface JxlPreview {
  pieces: Candidate[];
  width: number;
  height: number;
  /** Size of each piece (the last column and row of tiles may reach past the image). */
  pieceWidth: number;
  pieceHeight: number;
  /** IFD0's orientation, 0 if none. */
  orientation: number;
}

/** How much of a file's start the fallback scan reads. */
const SCAN_BYTES = 16 << 20;

/** Finds the largest embedded preview of [file], or null if there is none. */
export async function findEmbeddedPreview(file: Blob): Promise<EmbeddedPreview | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  let candidates: Candidate[] = [];
  let orientation = 0;
  if (ascii(head, 0, 15) === 'FUJIFILMCCD-RAW') {
    const v = await view(file, 84, 8);
    candidates.push({ offset: v.getUint32(0), length: v.getUint32(4) });
  } else if (ascii(head, 4, 8) === 'ftyp') {
    const r = await cr3Candidates(file);
    candidates = r.candidates;
    orientation = r.orientation;
  } else if (isTiff(head)) {
    const r = await tiffCandidates(file, 0);
    candidates = r.candidates;
    orientation = r.orientation;
  }
  let best = await largest(file, candidates);
  if (!best) best = await largest(file, scanForJpegs(new Uint8Array(await file.slice(0, SCAN_BYTES).arrayBuffer())));
  if (!best) return null;
  const jpeg = file.slice(best.offset, best.offset + best.length, 'image/jpeg');
  // The JPEG's own orientation wins (Fujifilm's carries one); else the raw's, added as an EXIF segment.
  const oriented = !best.info.orientation && orientation > 1 ? withOrientation(jpeg, orientation) : jpeg;
  return { jpeg: oriented, width: best.info.width, height: best.info.height };
}

/** The candidate holding the biggest real (not lossless) JPEG. */
async function largest(file: Blob, candidates: Candidate[]): Promise<(Candidate & { info: JpegInfo }) | null> {
  let best: (Candidate & { info: JpegInfo }) | null = null;
  for (const c of candidates) {
    if (c.length < 20 || c.offset < 0 || c.offset + c.length > file.size) continue;
    let info: JpegInfo | null;
    try {
      info = await jpegInfo(file, c.offset, c.length);
    } catch {
      info = null;
    }
    if (info && (!best || info.width * info.height > best.info.width * best.info.height)) best = { ...c, info };
  }
  return best;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

async function view(file: Blob, offset: number, length: number): Promise<DataView> {
  return new DataView(await file.slice(offset, offset + length).arrayBuffer());
}

/** II/MM followed by 42, or the magics Olympus (ORF: "RO", "RS") and Panasonic (RW2: 0x55) use instead. */
function isTiff(b: Uint8Array): boolean {
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (!le && !be) return false;
  const magic = le ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3];
  return magic === 42 || magic === 0x4f52 || magic === 0x5352 || magic === 0x55;
}

const TAG_WIDTH = 256;
const TAG_HEIGHT = 257;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_ROWS_PER_STRIP = 278;
const TAG_TILE_WIDTH = 322;
const TAG_TILE_LENGTH = 323;
const TAG_TILE_OFFSETS = 324;
const TAG_TILE_BYTE_COUNTS = 325;
const COMPRESSION_JXL = 52546;
/** More strips or tiles than this and the IFD isn't treated as a preview. */
const MAX_JXL_PIECES = 1024;
const TAG_ORIENTATION = 274;
const TAG_STRIP_OFFSETS = 273;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_SUB_IFDS = 330;
const TAG_JPEG_OFFSET = 513;
const TAG_JPEG_LENGTH = 514;
const TAG_RW2_JPEG = 0x2e;

/** Bytes per value of each TIFF type. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

/**
 * Preview candidates of the TIFF structure at [base] in [file] (offsets in it are relative to [base]) and IFD0's
 * orientation (0 if none).
 */
async function tiffCandidates(file: Blob, base: number): Promise<{ candidates: Candidate[]; orientation: number; jxl: JxlPreview[] }> {
  const header = await view(file, base, 8);
  const le = header.getUint8(0) === 0x49;
  const candidates: Candidate[] = [];
  const jxl: JxlPreview[] = [];
  let orientation = 0;
  const queue = [header.getUint32(4, le)];
  const seen = new Set<number>();
  let first = true;
  while (queue.length && seen.size < 32) {
    const at = queue.shift()!;
    if (!at || seen.has(at) || base + at + 2 > file.size) continue;
    seen.add(at);
    const n = (await view(file, base + at, 2)).getUint16(0, le);
    if (n === 0 || n > 1000) continue;
    const ifd = await view(file, base + at + 2, n * 12 + 4);
    const values = async (i: number, max = 64): Promise<number[]> => {
      const p = i * 12;
      const type = ifd.getUint16(p + 2, le);
      const count = ifd.getUint32(p + 4, le);
      const size = TYPE_SIZE[type] ?? 1;
      if (type !== 3 && type !== 4 && type !== 13) return [];
      const wanted = Math.min(count, max);
      const data = size * count <= 4 ? new DataView(ifd.buffer, ifd.byteOffset + p + 8, 4) : await view(file, base + ifd.getUint32(p + 8, le), size * wanted);
      return Array.from({ length: wanted }, (_, k) => (type === 3 ? data.getUint16(k * 2, le) : data.getUint32(k * 4, le)));
    };
    const tags = new Map<number, number>();
    for (let i = 0; i < n; i++) tags.set(ifd.getUint16(i * 12, le), i);
    const one = async (tag: number) => (tags.has(tag) ? (await values(tags.get(tag)!))[0] : undefined);
    if (first) orientation = (await one(TAG_ORIENTATION)) ?? 0;
    first = false;
    const jpegOffset = await one(TAG_JPEG_OFFSET);
    const jpegLength = await one(TAG_JPEG_LENGTH);
    if (jpegOffset && jpegLength) candidates.push({ offset: base + jpegOffset, length: jpegLength });
    const compression = await one(TAG_COMPRESSION);
    if (compression === 6 || compression === 7) {
      const offsets = tags.has(TAG_STRIP_OFFSETS) ? await values(tags.get(TAG_STRIP_OFFSETS)!) : [];
      const counts = tags.has(TAG_STRIP_BYTE_COUNTS) ? await values(tags.get(TAG_STRIP_BYTE_COUNTS)!) : [];
      if (offsets.length === 1 && counts.length === 1) candidates.push({ offset: base + offsets[0], length: counts[0] });
    }
    if (compression === COMPRESSION_JXL && [1, 2, 6].includes((await one(TAG_PHOTOMETRIC)) ?? 0)) {
      const preview = await jxlPreview(tags, one, values);
      if (preview) jxl.push({ ...preview, pieces: preview.pieces.map((c) => ({ offset: base + c.offset, length: c.length })), orientation: 0 });
    }
    if (tags.has(TAG_RW2_JPEG)) {
      const p = tags.get(TAG_RW2_JPEG)! * 12;
      const count = ifd.getUint32(p + 4, le);
      if (count > 4) candidates.push({ offset: base + ifd.getUint32(p + 8, le), length: count });
    }
    if (tags.has(TAG_SUB_IFDS)) queue.push(...(await values(tags.get(TAG_SUB_IFDS)!)));
    queue.push(ifd.getUint32(n * 12, le));
  }
  for (const p of jxl) p.orientation = orientation;
  return { candidates, orientation, jxl };
}

/** The strips or tiles of a JPEG XL IFD; null when they don't add up. */
async function jxlPreview(
  tags: Map<number, number>,
  one: (tag: number) => Promise<number | undefined>,
  values: (i: number, max?: number) => Promise<number[]>,
): Promise<Omit<JxlPreview, 'orientation'> | null> {
  const width = (await one(TAG_WIDTH)) ?? 0;
  const height = (await one(TAG_HEIGHT)) ?? 0;
  if (!width || !height) return null;
  const tiled = tags.has(TAG_TILE_OFFSETS);
  const pieceWidth = tiled ? ((await one(TAG_TILE_WIDTH)) ?? 0) : width;
  const pieceHeight = tiled ? ((await one(TAG_TILE_LENGTH)) ?? 0) : Math.min(height, (await one(TAG_ROWS_PER_STRIP)) ?? height);
  if (!pieceWidth || !pieceHeight) return null;
  const expected = Math.ceil(width / pieceWidth) * Math.ceil(height / pieceHeight);
  const [offsetTag, countTag] = tiled ? [TAG_TILE_OFFSETS, TAG_TILE_BYTE_COUNTS] : [TAG_STRIP_OFFSETS, TAG_STRIP_BYTE_COUNTS];
  if (expected > MAX_JXL_PIECES || !tags.has(offsetTag) || !tags.has(countTag)) return null;
  const offsets = await values(tags.get(offsetTag)!, expected);
  const counts = await values(tags.get(countTag)!, expected);
  if (offsets.length !== expected || counts.length !== expected) return null;
  return { pieces: offsets.map((offset, k) => ({ offset, length: counts[k] })), width, height, pieceWidth, pieceHeight };
}

/**
 * The JPEG XL preview of the DNG [file] to decode for showing it at [maxSide]: the smallest whose long side reaches
 * it, else the largest. Null when there is none, or it is no bigger than the largest embedded JPEG.
 */
export async function findJxlPreview(file: Blob, maxSide: number): Promise<JxlPreview | null> {
  if (!isTiff(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) return null;
  const r = await tiffCandidates(file, 0);
  const valid = r.jxl.filter((p) => p.pieces.every((c) => c.length > 0 && c.offset > 0 && c.offset + c.length <= file.size));
  if (!valid.length) return null;
  const side = (p: { width: number; height: number }) => Math.max(p.width, p.height);
  valid.sort((a, b) => side(a) - side(b));
  const pick = valid.find((p) => side(p) >= maxSide) ?? valid[valid.length - 1];
  const jpeg = await largest(file, r.candidates);
  return jpeg && side(jpeg.info) >= side(pick) ? null : pick;
}

const CANON_UUID = '85c0b687820f11e08111f4ce462b6a48';
const CANON_PREVIEW_UUID = 'eaf42b5e1c984b88b9fbb7dc406e4d16';

interface Box {
  type: string;
  /** Start of the box's payload (after the header and, for uuid boxes, the 16-byte uuid). */
  start: number;
  end: number;
  uuid: string;
}

/** The boxes of an ISO base media file between [from] and [to]. */
async function boxes(file: Blob, from: number, to: number): Promise<Box[]> {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to && out.length < 256) {
    const h = new Uint8Array(await file.slice(at, at + 32).arrayBuffer());
    const v = new DataView(h.buffer);
    let size = v.getUint32(0);
    const type = ascii(h, 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header) break;
    let uuid = '';
    if (type === 'uuid') {
      uuid = Array.from(h.subarray(header, header + 16), (b) => b.toString(16).padStart(2, '0')).join('');
      header += 16;
    }
    out.push({ type, start: at + header, end: Math.min(at + size, to), uuid });
    at += size;
  }
  return out;
}

/** Canon CR3: track 1's full-size JPEG and the PRVW preview; orientation from CMT1 (a TIFF with IFD0). */
async function cr3Candidates(file: Blob): Promise<{ candidates: Candidate[]; orientation: number }> {
  const candidates: Candidate[] = [];
  let orientation = 0;
  const top = await boxes(file, 0, file.size);
  const moov = top.find((b) => b.type === 'moov');
  if (moov) {
    const inner = await boxes(file, moov.start, moov.end);
    const canon = inner.find((b) => b.type === 'uuid' && b.uuid === CANON_UUID);
    const cmt1 = canon && (await boxes(file, canon.start, canon.end)).find((b) => b.type === 'CMT1');
    if (cmt1) orientation = (await tiffCandidates(file, cmt1.start)).orientation;
    const trak = inner.find((b) => b.type === 'trak');
    const stbl = trak && (await descend(file, trak, ['mdia', 'minf', 'stbl']));
    if (stbl) {
      const parts = await boxes(file, stbl.start, stbl.end);
      const stsz = parts.find((b) => b.type === 'stsz');
      const co64 = parts.find((b) => b.type === 'co64');
      const stco = parts.find((b) => b.type === 'stco');
      if (stsz && (co64 || stco)) {
        const sz = await view(file, stsz.start, 16);
        const length = sz.getUint32(4) || sz.getUint32(12);
        const offset = co64 ? Number((await view(file, co64.start + 8, 8)).getBigUint64(0)) : (await view(file, stco!.start + 8, 4)).getUint32(0);
        candidates.push({ offset, length });
      }
    }
  }
  const preview = top.find((b) => b.type === 'uuid' && b.uuid === CANON_PREVIEW_UUID);
  if (preview) {
    // 8 bytes, then the PRVW box: header, 12 bytes of fields, the JPEG's length, the JPEG.
    const prvw = (await boxes(file, preview.start + 8, preview.end)).find((b) => b.type === 'PRVW');
    if (prvw) candidates.push({ offset: prvw.start + 16, length: (await view(file, prvw.start + 12, 4)).getUint32(0) });
  }
  return { candidates, orientation };
}

async function descend(file: Blob, box: Box, path: string[]): Promise<Box | undefined> {
  let at: Box | undefined = box;
  for (const type of path) {
    if (!at) return undefined;
    at = (await boxes(file, at.start, at.end)).find((b) => b.type === type);
  }
  return at;
}

/**
 * Size and orientation of the JPEG at [offset], read from its markers up to the frame header; null when it isn't
 * a baseline, extended or progressive JPEG (a lossless one is raw sensor data).
 */
async function jpegInfo(file: Blob, offset: number, length: number): Promise<JpegInfo | null> {
  const end = offset + length;
  const soi = await view(file, offset, 2);
  if (soi.getUint16(0) !== 0xffd8) return null;
  let at = offset + 2;
  let orientation = 0;
  for (let i = 0; i < 64 && at + 4 <= end; i++) {
    const m = await view(file, at, 4);
    if (m.getUint8(0) !== 0xff) return null;
    const marker = m.getUint8(1);
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    const size = m.getUint16(2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const f = await view(file, at + 4, 5);
      const height = f.getUint16(1);
      const width = f.getUint16(3);
      return width && height ? { width, height, orientation } : null;
    }
    if ((marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) || marker === 0xda) return null;
    if (marker === 0xe1 && !orientation && size > 16) {
      const app1 = new Uint8Array(await file.slice(at + 4, at + 2 + Math.min(size, 4096)).arrayBuffer());
      if (ascii(app1, 0, 4) === 'Exif') orientation = tiffOrientation(app1.subarray(6));
    }
    at += 2 + size;
  }
  return null;
}

/** IFD0's Orientation in the TIFF bytes [b] (an EXIF payload), 0 if absent. */
export function tiffOrientation(b: Uint8Array): number {
  if (b.length < 8 || !isTiff(b)) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[0] === 0x49;
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > b.length) return 0;
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= b.length; i++) {
    const p = ifd + 2 + i * 12;
    if (v.getUint16(p, le) === TAG_ORIENTATION) return v.getUint16(p + 8, le);
  }
  return 0;
}

/**
 * Complete baseline/progressive JPEG streams in [b]: from SOI through the markers to the scan, then the entropy-coded
 * data up to EOI (thumbnails inside APP segments are skipped with their segment).
 */
export function scanForJpegs(b: Uint8Array): Candidate[] {
  const found: Candidate[] = [];
  let i = 0;
  while (i + 4 < b.length && found.length < 16) {
    if (!(b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff)) {
      i++;
      continue;
    }
    const end = jpegEnd(b, i);
    if (end > 0) {
      found.push({ offset: i, length: end - i });
      i = end;
    } else {
      i += 2;
    }
  }
  return found;
}

/** The offset after the EOI of the JPEG starting at [start] in [b], or -1 if it isn't a complete one. */
function jpegEnd(b: Uint8Array, start: number): number {
  let at = start + 2;
  let frame = false;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return -1;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    const size = (b[at + 2] << 8) | b[at + 3];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) frame = true;
    else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return -1;
    at += 2 + size;
    if (marker !== 0xda) continue;
    if (!frame) return -1;
    // Entropy-coded data: FF 00 is a stuffed byte and FF D0-D7 restart markers; other markers end the scan
    // (progressive JPEGs have several scans).
    while (at + 1 < b.length) {
      if (b[at] !== 0xff) {
        at++;
        continue;
      }
      const next = b[at + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
        at += next === 0xff ? 1 : 2;
        continue;
      }
      if (next === 0xd9) return at + 2;
      break; // another segment (DHT, SOS...) follows
    }
  }
  return -1;
}

/** [jpeg] with an APP1 EXIF segment holding only [orientation] inserted after SOI. */
export function withOrientation(jpeg: Blob, orientation: number): Blob {
  const app1 = new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  return new Blob([jpeg.slice(0, 2), app1, jpeg.slice(2)], { type: 'image/jpeg' });
}
