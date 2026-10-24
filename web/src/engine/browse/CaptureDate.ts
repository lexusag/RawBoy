import { validDate } from '../auto/PhotoOrder';
import { boxes, isTiff } from './EmbeddedPreview';

/**
 * When a photo was shot, for ordering Auto's batch and RawBoy Browser's grid (PhotoOrder): EXIF's DateTimeOriginal
 * (else when it was digitised or last written), found as EmbeddedPreview finds previews, reading only the bytes needed
 * ([Blob.slice]), never decoding the raw. Port of CaptureDate.kt, which uses ExifInterface (and its own CR3 reader).
 *
 * - TIFF-based raws (DNG, CR2, NEF, ARW, ORF, RW2, PEF...): IFD0's EXIF IFD, else IFD0's DateTime.
 * - CR3: CMT2 (the EXIF IFD), else CMT1 (IFD0).
 * - RAF and JPEG: the JPEG's APP1 EXIF (a RAF's embedded JPEG carries the camera's EXIF).
 * - Anything else (HEIC, PNG): null; callers fall back to the file's date.
 */
export async function findCaptureDate(file: Blob): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (head.length < 16) return null;
    if (ascii(head, 0, 15) === 'FUJIFILMCCD-RAW') {
      const v = await view(file, 84, 4);
      return await jpegDate(file, v.getUint32(0));
    }
    if (ascii(head, 4, 8) === 'ftyp') return await cr3Date(file);
    if (isTiff(head)) return await tiffDate(file, 0);
    if (head[0] === 0xff && head[1] === 0xd8) return await jpegDate(file, 0);
  } catch {
    // truncated or unexpected structure: no date
  }
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

async function view(file: Blob, offset: number, length: number): Promise<DataView> {
  return new DataView(await file.slice(offset, offset + length).arrayBuffer());
}

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;

/** The tags of the IFD at [at] (relative to [base]), as tag -> entry offset in [ifd]; null when it isn't one. */
async function readIfd(file: Blob, base: number, at: number, le: boolean): Promise<{ ifd: DataView; tags: Map<number, number> } | null> {
  if (!at || base + at + 2 > file.size) return null;
  const n = (await view(file, base + at, 2)).getUint16(0, le);
  if (n === 0 || n > 1000) return null;
  const ifd = await view(file, base + at + 2, n * 12);
  const tags = new Map<number, number>();
  for (let i = 0; i < n && i * 12 + 12 <= ifd.byteLength; i++) tags.set(ifd.getUint16(i * 12, le), i * 12);
  return { ifd, tags };
}

/** ASCII entry [tag] as a valid EXIF date, else null. */
async function dateOf(file: Blob, base: number, d: { ifd: DataView; tags: Map<number, number> }, tag: number, le: boolean): Promise<string | null> {
  const p = d.tags.get(tag);
  if (p == null || d.ifd.getUint16(p + 2, le) !== 2) return null;
  const count = d.ifd.getUint32(p + 4, le);
  if (count < 19) return null;
  // 20 bytes with its NUL, so never inline in the entry.
  const at = base + d.ifd.getUint32(p + 8, le);
  const bytes = new Uint8Array(await file.slice(at, at + 19).arrayBuffer());
  return bytes.length === 19 ? validDate(ascii(bytes, 0, 19)) : null;
}

/** The date in the TIFF structure at [base] of [file]: the EXIF IFD's capture date, else IFD0's DateTime. */
async function tiffDate(file: Blob, base: number): Promise<string | null> {
  const header = await view(file, base, 8);
  const le = header.getUint8(0) === 0x49;
  const ifd0 = await readIfd(file, base, header.getUint32(4, le), le);
  if (!ifd0) return null;
  const exifAt = ifd0.tags.get(TAG_EXIF_IFD);
  if (exifAt != null) {
    const exif = await readIfd(file, base, ifd0.ifd.getUint32(exifAt + 8, le), le);
    if (exif) {
      const d = (await dateOf(file, base, exif, TAG_DATE_TIME_ORIGINAL, le)) ?? (await dateOf(file, base, exif, TAG_DATE_TIME_DIGITIZED, le));
      if (d) return d;
    }
  }
  return dateOf(file, base, ifd0, TAG_DATE_TIME, le);
}

/** The date in the EXIF segment of the JPEG at [offset], else null. */
async function jpegDate(file: Blob, offset: number): Promise<string | null> {
  if ((await view(file, offset, 2)).getUint16(0) !== 0xffd8) return null;
  let at = offset + 2;
  for (let i = 0; i < 32 && at + 4 <= file.size; i++) {
    const m = await view(file, at, 4);
    if (m.getUint8(0) !== 0xff) return null;
    const marker = m.getUint8(1);
    if (marker === 0xda || marker === 0xd9) return null;
    const size = m.getUint16(2);
    if (marker === 0xe1 && size > 16 && ascii(new Uint8Array(await file.slice(at + 4, at + 8).arrayBuffer()), 0, 4) === 'Exif') {
      return tiffDate(file, at + 10);
    }
    at += 2 + size;
  }
  return null;
}

const CANON_UUID = '85c0b687820f11e08111f4ce462b6a48';

/** Canon CR3: moov's Canon box holds CMT1 (IFD0) and CMT2 (the EXIF IFD), each a little TIFF. */
async function cr3Date(file: Blob): Promise<string | null> {
  const moov = (await boxes(file, 0, file.size)).find((b) => b.type === 'moov');
  if (!moov) return null;
  const canon = (await boxes(file, moov.start, moov.end)).find((b) => b.type === 'uuid' && b.uuid === CANON_UUID);
  if (!canon) return null;
  const inner = await boxes(file, canon.start, canon.end);
  const first = async (start: number, tags: number[]) => {
    const header = await view(file, start, 8);
    const le = header.getUint8(0) === 0x49;
    const ifd = await readIfd(file, start, header.getUint32(4, le), le);
    if (!ifd) return null;
    for (const tag of tags) {
      const d = await dateOf(file, start, ifd, tag, le);
      if (d) return d;
    }
    return null;
  };
  const cmt2 = inner.find((b) => b.type === 'CMT2');
  const fromExif = cmt2 ? await first(cmt2.start, [TAG_DATE_TIME_ORIGINAL, TAG_DATE_TIME_DIGITIZED]) : null;
  if (fromExif) return fromExif;
  const cmt1 = inner.find((b) => b.type === 'CMT1');
  return cmt1 ? first(cmt1.start, [TAG_DATE_TIME]) : null;
}
