import type { DecodedForAnalysis } from '../../engine/auto/AutoAnalysis';
import { LensInfo } from '../../engine/lens/LensInfo';
import type { SkinMask } from '../../engine/retouch/SkinMask';

/**
 * Bump when what a photo's analysis keeps changes meaning: the decode or its small copies (native code), the noise
 * measurement, skin segmentation, or the stored fields. Entries of other versions are ignored and replaced. The auto
 * develop itself is worked out again from them on every load, so AutoTone changes need no bump.
 */
const VERSION = 1;
/** About 300 photos (3 MB each: 512 px base and halo, skin mask); the least recently used go first. */
const MAX_BYTES = 1_000_000_000;
const DB = 'rawboy-auto-analysis';
const STORE = 'analyses';

interface Entry {
  version: number;
  usedAt: number;
  bytes: number;
  decoded: DecodedForAnalysis;
  skin: SkinMask | null;
}

/**
 * Each photo's analysis inputs (the draft decode's small copies, noise and skin mask), kept in IndexedDB across visits
 * by the file's name, size and date, so a batch opened again develops its grid without decoding (web only). Fails
 * quietly: without IndexedDB, photos are just analysed again.
 */
export class AnalysisCache {
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    return (this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  }

  /** What was kept for [key], or null; a hit counts as a use. */
  async get(key: string): Promise<{ decoded: DecodedForAnalysis; skin: SkinMask | null } | null> {
    const db = await this.open();
    if (!db) return null;
    const entry = (await request<Entry | undefined>(() => db.transaction(STORE).objectStore(STORE).get(key)))?.result;
    if (!entry || entry.version !== VERSION) return null;
    void request(() => db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...entry, usedAt: Date.now() }, key));
    // Structured clone keeps the fields but not the class.
    const l = entry.decoded.lens;
    const lens = new LensInfo(l.lensName, l.width, l.height, l.sensorWidth, l.sensorHeight, l.orientation, l.warp, l.vignette, l.shading, l.gainMapsApplied);
    return { decoded: { ...entry.decoded, lens }, skin: entry.skin };
  }

  /** Keeps [decoded] and [skin] for [key], dropping the least recently used entries past MAX_BYTES. */
  async put(key: string, decoded: DecodedForAnalysis, skin: SkinMask | null) {
    const db = await this.open();
    if (!db) return;
    const d = decoded;
    const bytes = d.base.pixels.byteLength + d.bloom.halo.pixels.byteLength + d.bloom.tail.pixels.byteLength + (skin?.data.byteLength ?? 0);
    const entry: Entry = { version: VERSION, usedAt: Date.now(), bytes, decoded, skin };
    if (!(await request(() => db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key)))) return;
    await this.trim(db);
  }

  private async trim(db: IDBDatabase) {
    const sizes: { key: IDBValidKey; usedAt: number; bytes: number; stale: boolean }[] = [];
    await new Promise<void>((resolve) => {
      try {
        const req = db.transaction(STORE).objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          const e = c.value as Entry;
          sizes.push({ key: c.key, usedAt: e.usedAt, bytes: e.bytes, stale: e.version !== VERSION });
          c.continue();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    // Entries of other versions go whatever the total, then the least recently used.
    const drop = sizes.filter((e) => e.stale);
    const current = sizes.filter((e) => !e.stale).sort((a, b) => a.usedAt - b.usedAt);
    let total = current.reduce((s, e) => s + e.bytes, 0);
    for (const e of current) {
      if (total <= MAX_BYTES) break;
      total -= e.bytes;
      drop.push(e);
    }
    for (const e of drop) await request(() => db.transaction(STORE, 'readwrite').objectStore(STORE).delete(e.key));
  }
}

/** Runs one IndexedDB request; resolves with its result, or null when it fails. */
function request<T>(make: () => IDBRequest): Promise<{ result: T } | null> {
  return new Promise((resolve) => {
    try {
      const req = make();
      req.onsuccess = () => resolve({ result: req.result as T });
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
