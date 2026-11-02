import { useEffect, useState } from 'react';
import { findEmbeddedPreview } from '../engine/browse/EmbeddedPreview';

interface CachedThumb {
  url: string;
  width: number;
  height: number;
}

const thumbCache = new Map<string, CachedThumb | null>();

function fileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Loads a compact thumbnail for [file]. If the embedded preview is larger than 256px,
 * downscales it using createImageBitmap/OffscreenCanvas to keep GPU memory under ~25 KB per item.
 */
export async function getCompactThumbnail(file: File): Promise<CachedThumb | null> {
  const key = fileCacheKey(file);
  if (thumbCache.has(key)) return thumbCache.get(key)!;

  try {
    const prev = await findEmbeddedPreview(file);
    if (!prev) {
      thumbCache.set(key, null);
      return null;
    }

    let blob = prev.jpeg;
    if (prev.width > 256 || prev.height > 256) {
      if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
        try {
          const bmp = await createImageBitmap(prev.jpeg, { resizeWidth: 88, resizeQuality: 'medium' });
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
            blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
          }
        } catch {
          blob = prev.jpeg;
        }
      }
    }

    const res: CachedThumb = {
      url: URL.createObjectURL(blob),
      width: prev.width,
      height: prev.height,
    };
    thumbCache.set(key, res);
    return res;
  } catch {
    thumbCache.set(key, null);
    return null;
  }
}

/**
 * Revokes all cached thumbnail object URLs to reclaim memory when queue is cleared.
 */
export function clearThumbnailCache() {
  for (const entry of thumbCache.values()) {
    if (entry?.url) URL.revokeObjectURL(entry.url);
  }
  thumbCache.clear();
}

/**
 * Revokes the thumbnail URL for a single file when removed from the queue.
 */
export function revokeThumbnail(file: File) {
  const key = fileCacheKey(file);
  const entry = thumbCache.get(key);
  if (entry?.url) {
    URL.revokeObjectURL(entry.url);
    thumbCache.delete(key);
  }
}

export function ItemThumbnail({ file, onClick }: { file: File; onClick?: () => void }) {
  const [thumb, setThumb] = useState<CachedThumb | null>(() => thumbCache.get(fileCacheKey(file)) ?? null);
  const [loading, setLoading] = useState(() => !thumbCache.has(fileCacheKey(file)));

  useEffect(() => {
    const key = fileCacheKey(file);
    if (thumbCache.has(key)) {
      setThumb(thumbCache.get(key) ?? null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    getCompactThumbnail(file).then((t) => {
      if (!active) return;
      setThumb(t);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [file]);

  const hasImage = Boolean(thumb?.url);
  const title = hasImage ? `Preview ${file.name}` : file.name;

  return (
    <button
      type="button"
      className={`packer-thumb${hasImage ? ' clickable' : ''}`}
      onClick={hasImage ? onClick : undefined}
      disabled={!hasImage}
      title={title}
      aria-label={title}
    >
      {hasImage ? (
        <img src={thumb!.url} alt="" decoding="async" loading="lazy" />
      ) : (
        <svg className={`packer-thumb-icon${loading ? ' loading' : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
        </svg>
      )}
    </button>
  );
}
