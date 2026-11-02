import { useEffect, useRef, useState } from 'react';
import { findEmbeddedPreview } from '../engine/browse/EmbeddedPreview';
import type { PackItem } from './PackerStore';

export interface CachedThumb {
  url: string;
  width: number;
  height: number;
}

interface CacheEntry extends CachedThumb {
  itemIds: Set<number>;
}

interface InFlightTask {
  itemIds: Set<number>;
  promise: Promise<CachedThumb | null>;
}

const thumbCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightTask>();
const failedKeys = new Set<string>();

function fileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Max concurrent thumbnail decodes so RAFs / large raws don't overwhelm CPU and memory. */
const MAX_CONCURRENT_THUMBS = 3;
let activeWorkers = 0;
const workQueue: (() => void)[] = [];

function pumpQueue() {
  while (activeWorkers < MAX_CONCURRENT_THUMBS && workQueue.length > 0) {
    activeWorkers++;
    const next = workQueue.shift()!;
    next();
  }
}

function queueWork<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    workQueue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeWorkers--;
          pumpQueue();
        });
    });
    pumpQueue();
  });
}

async function decodeAndDownscale(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  const prev = await findEmbeddedPreview(file);
  if (!prev) return null;

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
  return { blob, width: prev.width, height: prev.height };
}

export function getCachedThumbnail(itemId: number, file: File): CachedThumb | null {
  const key = fileCacheKey(file);
  const entry = thumbCache.get(key);
  if (entry) {
    entry.itemIds.add(itemId);
    return { url: entry.url, width: entry.width, height: entry.height };
  }
  return null;
}

/**
 * Loads a thumbnail for [file] attached to [itemId].
 * Concurrency is capped, and if [itemId] is removed while in flight, the decoded URL
 * is revoked immediately and not cached.
 */
export function requestThumbnail(itemId: number, file: File): Promise<CachedThumb | null> {
  const key = fileCacheKey(file);
  if (failedKeys.has(key)) return Promise.resolve(null);

  const existing = thumbCache.get(key);
  if (existing) {
    existing.itemIds.add(itemId);
    return Promise.resolve({ url: existing.url, width: existing.width, height: existing.height });
  }

  const inflight = inFlight.get(key);
  if (inflight) {
    inflight.itemIds.add(itemId);
    return inflight.promise;
  }

  const itemIds = new Set<number>([itemId]);
  const promise = queueWork(async () => {
    try {
      const decoded = await decodeAndDownscale(file);
      inFlight.delete(key);

      if (!decoded) {
        failedKeys.add(key);
        return null;
      }

      // If all items requesting this file were removed before decode finished, free immediately!
      if (itemIds.size === 0) {
        return null;
      }

      const url = URL.createObjectURL(decoded.blob);

      // Re-check after URL creation in case revocation raced
      if (itemIds.size === 0) {
        URL.revokeObjectURL(url);
        return null;
      }

      const entry: CacheEntry = {
        url,
        width: decoded.width,
        height: decoded.height,
        itemIds,
      };
      thumbCache.set(key, entry);
      return { url: entry.url, width: entry.width, height: entry.height };
    } catch {
      inFlight.delete(key);
      failedKeys.add(key);
      return null;
    }
  });

  inFlight.set(key, { itemIds, promise });
  return promise;
}

/**
 * Releases [itemId]'s claim on the thumbnail of [file].
 * If this was the last item using this thumbnail (or waiting for it in flight),
 * the object URL is revoked and memory freed.
 */
export function releaseThumbnail(itemId: number, file: File) {
  const key = fileCacheKey(file);

  // In-flight task cancellation
  const inflight = inFlight.get(key);
  if (inflight) {
    inflight.itemIds.delete(itemId);
  }

  // Cached entry release
  const entry = thumbCache.get(key);
  if (entry) {
    entry.itemIds.delete(itemId);
    if (entry.itemIds.size === 0) {
      URL.revokeObjectURL(entry.url);
      thumbCache.delete(key);
    }
  }
}

/**
 * Revokes all cached thumbnail URLs and cancels all queued tasks.
 */
export function clearThumbnailCache() {
  workQueue.length = 0;
  for (const inflight of inFlight.values()) {
    inflight.itemIds.clear();
  }
  inFlight.clear();

  for (const entry of thumbCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  thumbCache.clear();
  failedKeys.clear();
}

export function ItemThumbnail({ item, onClick }: { item: PackItem; onClick?: () => void }) {
  const [thumb, setThumb] = useState<CachedThumb | null>(() => getCachedThumbnail(item.id, item.file));
  const [loading, setLoading] = useState(() => !thumb && !failedKeys.has(fileCacheKey(item.file)));
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLButtonElement>(null);

  // Lazy loading: only trigger decode when visible on screen (or within 200px margin)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;

    let active = true;
    requestThumbnail(item.id, item.file).then((t) => {
      if (!active) return;
      setThumb(t);
      setLoading(false);
    });

    return () => {
      active = false;
      releaseThumbnail(item.id, item.file);
    };
  }, [item.id, item.file, inView]);

  const hasImage = Boolean(thumb?.url);
  const title = hasImage ? `Preview ${item.file.name}` : item.file.name;

  return (
    <button
      ref={containerRef}
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
