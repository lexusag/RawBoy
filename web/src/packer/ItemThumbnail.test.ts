import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearThumbnailCache, releaseThumbnail, requestThumbnail } from './ItemThumbnail';

type Entry = [tag: number, type: number, values: number[]];

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x12, 0x34, 0xff, 0x00, 0x56,
    0xff, 0xd9,
  ]);
}

function tiff(ifds: Entry[][], blobs: Uint8Array[]): Uint8Array {
  const ifdSize = (e: Entry[]) => 2 + e.length * 12 + 4;
  const ifdOffsets: number[] = [];
  let at = 8;
  for (const e of ifds) {
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
  ifds.forEach((entries, k) => {
    let p = ifdOffsets[k];
    v.setUint16(p, entries.length, true);
    p += 2;
    for (const [tag, type, values] of entries) {
      v.setUint16(p, tag, true);
      v.setUint16(p + 2, type, true);
      v.setUint32(p + 4, values.length, true);
      const x = values[0] < 0 ? blobOffsets[-values[0] - 1] : values[0];
      if (type === 3) v.setUint16(p + 8, x, true);
      else v.setUint32(p + 8, x, true);
      p += 12;
    }
    v.setUint32(p, k + 1 < ifds.length ? ifdOffsets[k + 1] : 0, true);
  });
  blobs.forEach((b, i) => out.set(b, blobOffsets[i]));
  return out;
}

function mockRawFile(name = 'sample.dng'): File {
  const preview = jpeg(256, 171);
  const rawBytes = tiff([[[513, 4, [-1]], [514, 4, [preview.length]]]], [preview]);
  return new File([rawBytes], name, { type: 'image/x-adobe-dng' });
}

describe('ItemThumbnail', () => {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls.length = 0;
    revokedUrls.length = 0;
    clearThumbnailCache();

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((_blob: Blob) => {
        const url = `blob:mock-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    });
  });

  afterEach(() => {
    clearThumbnailCache();
    vi.unstubAllGlobals();
  });

  it('returns null gracefully for files without embedded preview', async () => {
    const fakeFile = new File(['not a raw'], 'test.txt', { type: 'text/plain' });
    const result = await requestThumbnail(1, fakeFile);
    expect(result).toBeNull();
  });

  it('loads embedded preview and caches result without recreating URLs', async () => {
    const file = mockRawFile('photo1.dng');

    const res1 = await requestThumbnail(1, file);
    expect(res1).not.toBeNull();
    expect(createdUrls).toHaveLength(1);
    expect(res1?.width).toBe(256);
    expect(res1?.height).toBe(171);

    // Second request with same item should return cached entry
    const res2 = await requestThumbnail(1, file);
    expect(res2?.url).toBe(res1?.url);
    expect(createdUrls).toHaveLength(1);

    releaseThumbnail(1, file);
    expect(revokedUrls).toContain(res1!.url);
  });

  it('handles the same file in different folders with ref counting so removing one does not break the other', async () => {
    const file = mockRawFile('shared.dng');

    // Folder A has item 10, Folder B has item 20 (same underlying file content/name/size)
    const resA = await requestThumbnail(10, file);
    const resB = await requestThumbnail(20, file);

    expect(resA?.url).toBe(resB?.url);
    expect(createdUrls).toHaveLength(1);

    // Removing item 10 from Folder A should NOT revoke the URL because item 20 in Folder B still uses it
    releaseThumbnail(10, file);
    expect(revokedUrls).toHaveLength(0);

    // Removing item 20 should now revoke the URL because ref count reached 0
    releaseThumbnail(20, file);
    expect(revokedUrls).toContain(resA!.url);
  });

  it('revokes URL immediately if an item is removed while its thumbnail decode is in flight', async () => {
    const file = mockRawFile('in_flight.dng');

    // Start request
    const promise = requestThumbnail(99, file);

    // Remove before decode resolves
    releaseThumbnail(99, file);

    const result = await promise;
    expect(result).toBeNull();

    // Verify any created object URL was revoked and not leaked
    for (const url of createdUrls) {
      expect(revokedUrls).toContain(url);
    }
  });

  it('clearThumbnailCache revokes all active object URLs', async () => {
    const file1 = mockRawFile('a.dng');
    const file2 = mockRawFile('b.dng');

    const res1 = await requestThumbnail(1, file1);
    const res2 = await requestThumbnail(2, file2);

    expect(createdUrls.length).toBe(2);
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();

    clearThumbnailCache();
    expect(revokedUrls).toContain(res1!.url);
    expect(revokedUrls).toContain(res2!.url);
    expect(revokedUrls.length).toBe(createdUrls.length);
  });
});
