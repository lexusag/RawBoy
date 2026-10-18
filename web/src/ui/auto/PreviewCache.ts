import type { PreviewImage } from '../../engine/gl/PreviewImage';

/** About 90 photos at 2048 px (as Android). */
const MAX_BYTES = 1_500_000_000;
/** Without the origin private file system the previews stay in memory: only the last few. */
const MEMORY_ENTRIES = 6;
const DIR = 'auto-previews';
const HEADER_BYTES = 16;

/**
 * The detail view's preview of each analysed photo (PREVIEW_MAX_DIMENSION, as the session makes), so moving to a
 * photo shows its develop at once instead of after a full decode (port of PreviewCache.kt). Written by the analysis,
 * which has the full image decoded anyway. Kept in the origin private file system (about 17 MB per photo, oldest
 * dropped past MAX_BYTES), or in memory where that can't be written. The batch isn't kept across reloads, so the
 * folder is emptied on start. Photos not cached fall back to the grid thumbnail until decoded.
 */
export class PreviewCache {
  /** Cached ids, oldest first, with their files. */
  private readonly files = new Map<string, { name: string; size: number }>();
  private readonly memory = new Map<string, PreviewImage>();
  private total = 0;
  private nextFile = 0;
  private readonly dir: Promise<FileSystemDirectoryHandle | null>;
  /** File operations run one at a time, so a read never sees a half-written file. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor() {
    this.dir = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(DIR, { recursive: true }).catch(() => undefined);
        const dir = await root.getDirectoryHandle(DIR, { create: true });
        const probe = await dir.getFileHandle('probe', { create: true });
        await dir.removeEntry('probe');
        return typeof probe.createWritable === 'function' ? dir : null;
      } catch {
        return null;
      }
    })();
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  put(id: string, image: PreviewImage): Promise<void> {
    return this.queue(async () => {
      await this.drop(id);
      const dir = await this.dir;
      if (!dir) {
        this.memory.set(id, image);
        while (this.memory.size > MEMORY_ENTRIES) this.memory.delete(this.memory.keys().next().value!);
        return;
      }
      const name = `${this.nextFile++}.f16`;
      const header = new Int32Array([image.width, image.height, image.fullWidth, image.fullHeight]);
      try {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(header);
        await w.write(image.pixels);
        await w.close();
      } catch {
        await dir.removeEntry(name).catch(() => undefined); // storage full or similar: this photo isn't cached
        return;
      }
      const size = HEADER_BYTES + image.pixels.byteLength;
      this.files.set(id, { name, size });
      this.total += size;
      while (this.total > MAX_BYTES && this.files.size > 1) await this.drop(this.files.keys().next().value!);
    });
  }

  /** The cached preview of [id], or null. */
  get(id: string): Promise<PreviewImage | null> {
    return this.queue(async () => {
      const inMemory = this.memory.get(id);
      if (inMemory) return inMemory;
      const file = this.files.get(id);
      const dir = await this.dir;
      if (!file || !dir) return null;
      try {
        const buf = await (await (await dir.getFileHandle(file.name)).getFile()).arrayBuffer();
        const [width, height, fullWidth, fullHeight] = new Int32Array(buf, 0, 4);
        const pixels = new Uint16Array(buf, HEADER_BYTES);
        if (pixels.length !== width * height * 3) return null;
        return { width, height, pixels, fullWidth, fullHeight };
      } catch {
        return null;
      }
    });
  }

  remove(id: string): Promise<void> {
    return this.queue(() => this.drop(id));
  }

  private async drop(id: string) {
    this.memory.delete(id);
    const file = this.files.get(id);
    if (!file) return;
    this.files.delete(id);
    this.total -= file.size;
    const dir = await this.dir;
    await dir?.removeEntry(file.name).catch(() => undefined);
  }
}
