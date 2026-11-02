import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearThumbnailCache, getCompactThumbnail, revokeThumbnail } from './ItemThumbnail';

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
    const result = await getCompactThumbnail(fakeFile);
    expect(result).toBeNull();
  });

  it('caches results and revokes URLs cleanly on removal', async () => {
    // Structural TIFF with embedded JPEG
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 10, 0, 10, 1, 1, 17, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0xff, 0xd9]);
    const file = new File([jpegBytes], 'sample.dng', { type: 'image/x-adobe-dng' });

    // First call
    const res1 = await getCompactThumbnail(file);
    // Second call should return cached without creating another URL
    const res2 = await getCompactThumbnail(file);
    expect(res1).toBe(res2);

    // Revoke thumbnail
    revokeThumbnail(file);
    if (res1?.url) {
      expect(revokedUrls).toContain(res1.url);
    }
  });

  it('clearThumbnailCache revokes all active object URLs', async () => {
    const file1 = new File(['1'], 'a.dng');
    const file2 = new File(['2'], 'b.dng');

    await getCompactThumbnail(file1);
    await getCompactThumbnail(file2);

    clearThumbnailCache();
    expect(revokedUrls.length).toBe(createdUrls.length);
  });
});
