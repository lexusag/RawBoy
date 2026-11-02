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

interface QueuedTask {
  key: string;
  isCancelled: () => boolean;
  execute: () => Promise<void>;
}

const thumbCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightTask>();

function fileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Max concurrent thumbnail decodes so RAFs / large raws don't overwhelm CPU and memory. */
const MAX_CONCURRENT_THUMBS = 3;
let activeWorkers = 0;
let workQueue: QueuedTask[] = [];

function pumpQueue() {
  while (workQueue.length > 0 && workQueue[0].isCancelled()) {
    workQueue.shift();
  }

  while (activeWorkers < MAX_CONCURRENT_THUMBS && workQueue.length > 0) {
    const task = workQueue.shift()!;
    if (task.isCancelled()) {
      continue;
    }
    activeWorkers++;
    task.execute().finally(() => {
      activeWorkers--;
      pumpQueue();
    });
  }
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
 * Concurrency is capped. If [itemId] is removed while waiting in queue or during decode,
 * the task is dropped immediately without wasting work.
 */
export function requestThumbnail(itemId: number, file: File): Promise<CachedThumb | null> {
  const key = fileCacheKey(file);

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
  let taskResolve: (v: CachedThumb | null) => void;

  const promise = new Promise<CachedThumb | null>((resolve) => {
    taskResolve = resolve;
  });

  const queuedTask: QueuedTask = {
    key,
    isCancelled: () => itemIds.size === 0,
    execute: async () => {
      if (itemIds.size === 0) {
        inFlight.delete(key);
        taskResolve(null);
        return;
      }

      try {
        const decoded = await decodeAndDownscale(file);
        inFlight.delete(key);

        if (!decoded || itemIds.size === 0) {
          taskResolve(null);
          return;
        }

        const url = URL.createObjectURL(decoded.blob);

        if (itemIds.size === 0) {
          URL.revokeObjectURL(url);
          taskResolve(null);
          return;
        }

        const entry: CacheEntry = {
          url,
          width: decoded.width,
          height: decoded.height,
          itemIds,
        };
        thumbCache.set(key, entry);
        taskResolve({ url: entry.url, width: entry.width, height: entry.height });
      } catch {
        inFlight.delete(key);
        taskResolve(null);
      }
    },
  };

  inFlight.set(key, { itemIds, promise });
  workQueue.push(queuedTask);
  pumpQueue();

  return promise;
}

/**
 * Releases [itemId]'s claim on the thumbnail of [file].
 * If this was the last item using this thumbnail or waiting in the queue,
 * queued work is cancelled immediately and object URLs are revoked.
 */
export function releaseThumbnail(itemId: number, file: File) {
  const key = fileCacheKey(file);

  const inflight = inFlight.get(key);
  if (inflight) {
    inflight.itemIds.delete(itemId);
    if (inflight.itemIds.size === 0) {
      workQueue = workQueue.filter((t) => t.key !== key);
    }
  }

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
 * Revokes all cached thumbnail URLs and clears pending queue tasks.
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
}

export function ItemThumbnail({ item, onClick }: { item: PackItem; onClick?: () => void }) {
  const [thumb, setThumb] = useState<CachedThumb | null>(() => getCachedThumbnail(item.id, item.file));
  const [loading, setLoading] = useState(() => !thumb);
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
