import { describe, expect, it } from 'vitest';
import { findEmbeddedPreview, scanForJpegs, tiffOrientation } from '../browse/EmbeddedPreview';
import { readXmp, writeXmp } from '../browse/XmpSidecar';
import { groupPhotos, withSuffix } from '../../ui/browser/PhotoGroups';
import { photosToSend, type BrowsePhoto, type Filter, type SendCriteria } from '../../ui/browser/BrowserStore';
import type { Flag } from '../browse/XmpSidecar';

/** A structurally complete JPEG (not decodable): SOF [sof] with the size, a scan with stuffed and restart bytes, EOI. */
function jpeg(width: number, height: number, sof = 0xc0, extra: number[] = []): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    ...extra,
    0xff, sof, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd3, 0x78,
    0xff, 0xd9,
  ]);
}

/** An APP1 EXIF segment with only an orientation. */
function exifApp1(orientation: number): number[] {
  return [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
}

type Entry = [tag: number, type: number, values: number[]];

/**
 * A little-endian TIFF: IFDs given as entry lists (chained in order), blobs appended after them. Values written as
 * "@n" placeholders: entries whose value is -(n + 1) get blob n's offset.
 */
function tiff(ifds: Entry[][], blobs: Uint8Array[], subIfds: Entry[][] = []): Uint8Array {
  const all = [...ifds, ...subIfds];
  const ifdSize = (e: Entry[]) => 2 + e.length * 12 + 4;
  const ifdOffsets: number[] = [];
  let at = 8;
  for (const e of all) {
    ifdOffsets.push(at);
    at += ifdSize(e);
  }
  const blobOffsets: number[] = [];
  for (const b of blobs) {
    blobOffsets.push(at);
    at += b.length;
  }
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  const resolve = (x: number) => (x <= -1000 ? ifdOffsets[ifds.length + (-x - 1000)] : x < 0 ? blobOffsets[-x - 1] : x);
  all.forEach((entries, k) => {
    let p = ifdOffsets[k];
    v.setUint16(p, entries.length, true);
    p += 2;
    for (const [tag, type, values] of entries) {
      v.setUint16(p, tag, true);
      v.setUint16(p + 2, type, true);
      v.setUint32(p + 4, type === 7 ? values[1] : values.length, true);
      const x = resolve(values[0]);
      if (type === 3) v.setUint16(p + 8, x, true);
      else v.setUint32(p + 8, x, true);
      p += 12;
    }
    v.setUint32(p, k + 1 < ifds.length ? ifdOffsets[k + 1] : 0, true);
  });
  blobs.forEach((b, i) => out.set(b, blobOffsets[i]));
  return out;
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('Embedded previews', () => {
  it('picks the largest real JPEG in a TIFF raw and skips lossless sensor data', async () => {
    const thumb = jpeg(160, 120);
    const preview = jpeg(6000, 4000);
    const sensor = jpeg(8000, 5000, 0xc3);
    const file = tiff(
      [
        [[259, 3, [6]], [273, 4, [-1]], [274, 3, [1]], [279, 4, [preview.length]]], // CR2-style IFD0: full-size JPEG strip
        [[513, 4, [-2]], [514, 4, [thumb.length]]],
        [[259, 3, [7]], [273, 4, [-3]], [279, 4, [sensor.length]]],
      ],
      [preview, thumb, sensor],
    );
    const p = await findEmbeddedPreview(new Blob([file]));
    expect(p).not.toBeNull();
    expect([p!.width, p!.height]).toEqual([6000, 4000]);
    expect(await bytes(p!.jpeg)).toEqual(preview);
  });

  it('follows SubIFDs (NEF, DNG) and adds the raw orientation when the JPEG has none', async () => {
    const preview = jpeg(3000, 2000);
    const file = tiff(
      [[[274, 3, [6]], [330, 4, [-1000]]]],
      [preview],
      [[[259, 3, [7]], [273, 4, [-1]], [279, 4, [preview.length]]]],
    );
    const p = await findEmbeddedPreview(new Blob([file]));
    expect([p!.width, p!.height]).toEqual([3000, 2000]);
    const out = await bytes(p!.jpeg);
    expect(out.length).toBe(preview.length + 36);
    expect(tiffOrientation(out.subarray(12))).toBe(6);
    expect(out.subarray(38)).toEqual(preview.subarray(2));
  });

  it("keeps the JPEG's own orientation", async () => {
    const preview = jpeg(3000, 2000, 0xc0, exifApp1(8));
    const file = tiff([[[274, 3, [6]], [513, 4, [-1]], [514, 4, [preview.length]]]], [preview]);
    const p = await findEmbeddedPreview(new Blob([file]));
    expect(await bytes(p!.jpeg)).toEqual(preview);
  });

  it("reads RW2's JpgFromRaw", async () => {
    const preview = jpeg(1920, 1080);
    const file = tiff([[[0x2e, 7, [-1, preview.length]]]], [preview]);
    file.set([0x49, 0x49, 0x55, 0x00]);
    const p = await findEmbeddedPreview(new Blob([file]));
    expect([p!.width, p!.height]).toEqual([1920, 1080]);
  });

  it('reads the JPEG of a RAF header', async () => {
    const preview = jpeg(1920, 1280, 0xc0, exifApp1(1));
    const file = new Uint8Array(200 + preview.length);
    file.set(new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF383501'));
    new DataView(file.buffer).setUint32(84, 200);
    new DataView(file.buffer).setUint32(88, preview.length);
    file.set(preview, 200);
    const p = await findEmbeddedPreview(new Blob([file]));
    expect([p!.width, p!.height]).toEqual([1920, 1280]);
  });

  it("reads a CR3's full-size JPEG and CMT1 orientation", async () => {
    const full = jpeg(6000, 4000);
    const small = jpeg(1620, 1080);
    const box = (type: string, ...payload: Uint8Array[]) => {
      const size = 8 + payload.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(size);
      new DataView(out.buffer).setUint32(0, size);
      out.set(new TextEncoder().encode(type), 4);
      let at = 8;
      for (const p of payload) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    };
    const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
    const u32 = (...n: number[]) => {
      const out = new Uint8Array(n.length * 4);
      n.forEach((x, i) => new DataView(out.buffer).setUint32(i * 4, x));
      return out;
    };
    const cmt1 = box('CMT1', tiff([[[274, 3, [8]]]], []));
    const canon = box('uuid', hex('85c0b687820f11e08111f4ce462b6a48'), cmt1);
    // The JPEG's offset is only known once the layout is: ftyp, moov, preview uuid, then the JPEG.
    const build = (offset: number) => {
      const stsz = box('stsz', u32(0, full.length, 1));
      const co64 = box('co64', u32(0, 1, 0, offset));
      const trak = box('trak', box('mdia', box('minf', box('stbl', stsz, co64))));
      const moov = box('moov', canon, trak);
      const prvw = box('PRVW', u32(0, 0, 0, small.length), small);
      const preview = box('uuid', hex('eaf42b5e1c984b88b9fbb7dc406e4d16'), new Uint8Array(8), prvw);
      return [box('ftyp', new TextEncoder().encode('crx '), u32(1)), moov, preview];
    };
    const head = build(0).reduce((s, b) => s + b.length, 0);
    const parts = build(head);
    const file = new Blob([...parts, full]);
    const p = await findEmbeddedPreview(file);
    expect([p!.width, p!.height]).toEqual([6000, 4000]);
    expect(tiffOrientation((await bytes(p!.jpeg)).subarray(12))).toBe(8);
  });

  it('finds JPEGs by scanning when the structure is unknown', () => {
    const a = jpeg(100, 100, 0xc0, [0xff, 0xe1, 0x00, 0x12, 0, 0, ...jpeg(10, 10).subarray(0, 14)]);
    const b = jpeg(400, 300, 0xc2);
    const file = new Uint8Array([1, 2, 3, ...a, 9, 9, ...jpeg(50, 50, 0xc3), ...b, 7]);
    const found = scanForJpegs(file);
    expect(found).toEqual([{ offset: 3, length: a.length }, { offset: 3 + a.length + 2 + jpeg(50, 50, 0xc3).length, length: b.length }]);
  });

  it('returns null when there is no preview', async () => {
    expect(await findEmbeddedPreview(new Blob([new Uint8Array(1000)]))).toBeNull();
  });
});

describe('XMP sidecars', () => {
  it('writes a new sidecar that reads back', () => {
    for (const r of [{ stars: 3, flag: null }, { stars: 0, flag: 'reject' }, { stars: 5, flag: 'pick' }] as const) {
      const text = writeXmp(null, r);
      expect(readXmp(text)).toEqual(r);
      expect(text).toContain('xmlns:xmp="http://ns.adobe.com/xap/1.0/"');
    }
  });

  it('marks rejects as rating -1, like Lightroom and darktable', () => {
    expect(writeXmp(null, { stars: 4, flag: 'reject' })).toContain('xmp:Rating="-1"');
    expect(readXmp('<rdf:Description xmp:Rating="-1"/>')).toEqual({ stars: 0, flag: 'reject' });
  });

  it("changes only the rating in another app's sidecar", () => {
    const lr = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   xmp:Rating="2"
   crs:Exposure2012="+0.35">
   <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    expect(readXmp(lr)).toEqual({ stars: 2, flag: null });
    const out = writeXmp(lr, { stars: 4, flag: 'pick' });
    expect(out.replace('xmp:Rating="4"', 'xmp:Rating="2"').replace(/\n\s+xmlns:rawboy="[^"]+"\n\s+rawboy:Pick="1"/, '')).toBe(lr);
    expect(readXmp(out)).toEqual({ stars: 4, flag: 'pick' });
    const unpicked = writeXmp(out, { stars: 4, flag: null });
    expect(readXmp(unpicked)).toEqual({ stars: 4, flag: null });
    expect(unpicked).not.toContain('rawboy:Pick');
  });

  it('updates element-style ratings and declares xmp where missing', () => {
    const dt = `<rdf:Description rdf:about="" xmlns:darktable="http://darktable.sf.net/"><xmp:Rating>1</xmp:Rating></rdf:Description>`;
    expect(readXmp(writeXmp(dt, { stars: 5, flag: null }))).toEqual({ stars: 5, flag: null });
    expect(writeXmp(dt, { stars: 5, flag: null })).toContain('<xmp:Rating>5</xmp:Rating>');
    const bare = `<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="X"/>`;
    const out = writeXmp(bare, { stars: 1, flag: null });
    expect(out).toContain('xmlns:xmp="http://ns.adobe.com/xap/1.0/"');
    expect(out.endsWith('xmp:Rating="1"/>')).toBe(true);
  });
});

describe('Photo groups', () => {
  it('pairs RAW + JPEG, finds both sidecar styles and ignores other files', () => {
    const groups = groupPhotos(['IMG_10.JPG', 'IMG_10.CR2', 'IMG_10.xmp', 'IMG_9.CR2', 'IMG_9.CR2.xmp', 'notes.txt', 'IMG_11.jpg', 'Thumbs.db']);
    expect(groups).toEqual([
      { stem: 'IMG_9', main: 'IMG_9.CR2', companions: [], sidecars: ['IMG_9.CR2.xmp'] },
      { stem: 'IMG_10', main: 'IMG_10.CR2', companions: ['IMG_10.JPG'], sidecars: ['IMG_10.xmp'] },
      { stem: 'IMG_11', main: 'IMG_11.jpg', companions: [], sidecars: [] },
    ]);
  });

  it("attaches darktable's duplicates to their photo", () => {
    const groups = groupPhotos(['DSC_1.NEF', 'DSC_1.NEF.xmp', 'DSC_1_01.NEF.xmp', 'DSC_1_02.NEF.xmp', 'IMG_2.CR2', 'IMG_2_01.CR2', 'IMG_2_01.CR2.xmp', 'X_01.JPG.xmp']);
    expect(groups).toEqual([
      { stem: 'DSC_1', main: 'DSC_1.NEF', companions: [], sidecars: ['DSC_1.NEF.xmp', 'DSC_1_01.NEF.xmp', 'DSC_1_02.NEF.xmp'] },
      // A real file named like a duplicate keeps its own sidecar; one without its photo stays unmatched.
      { stem: 'IMG_2_01', main: 'IMG_2_01.CR2', companions: [], sidecars: ['IMG_2_01.CR2.xmp'] },
      { stem: 'IMG_2', main: 'IMG_2.CR2', companions: [], sidecars: [] },
    ]);
  });

  it('adds a suffix after the photo stem, keeping sidecars matched', () => {
    expect(withSuffix('DSC_1_01.NEF.xmp', 'DSC_1', '-2')).toBe('DSC_1-2_01.NEF.xmp');
    expect(withSuffix('IMG_1.CR2', 'IMG_1', '-2')).toBe('IMG_1-2.CR2');
    expect(withSuffix('IMG_1.CR2.xmp', 'IMG_1', '-2')).toBe('IMG_1-2.CR2.xmp');
    expect(withSuffix('img_1.jpg', 'IMG_1', '-2')).toBe('img_1-2.jpg');
  });
});

describe('photosToSend', () => {
  const photo = (id: string, stars: number, flag: Flag): BrowsePhoto =>
    ({ id, rating: { stars, flag } } as unknown as BrowsePhoto);
  const photos = [photo('a', 5, 'pick'), photo('b', 5, null), photo('c', 3, null), photo('d', 5, 'reject'), photo('e', 0, 'pick')];
  const ids = (c: SendCriteria, filter: Filter = 'all', minStars = 0) => photosToSend(photos, c, filter, minStars).map((p) => p.id);

  it('takes the picks', () => expect(ids({ kind: 'picks' })).toEqual(['a', 'e']));
  it('takes at least or exactly N stars, leaving out rejects', () => {
    expect(ids({ kind: 'stars', stars: 3, exact: false })).toEqual(['a', 'b', 'c']);
    expect(ids({ kind: 'stars', stars: 5, exact: true })).toEqual(['a', 'b']);
    expect(ids({ kind: 'stars', stars: 3, exact: true })).toEqual(['c']);
  });
  it('takes what the grid shows', () => {
    expect(ids({ kind: 'shown' }, 'unflagged', 4)).toEqual(['b']);
    expect(ids({ kind: 'shown' }, 'rejects')).toEqual(['d']);
  });
});
