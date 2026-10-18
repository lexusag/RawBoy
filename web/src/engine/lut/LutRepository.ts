import type { LutData, LutEntry } from './LutData';
import { loadLut } from './LutLoader';
import { RetiredLooks } from '../auto/looks/RetiredLooks';

/**
 * Finds LUTs (port of LutRepository.kt): bundled ones from <repo>/luts, and the user's own from files or a folder
 * they pick. Ids match Android's for bundled LUTs ("asset:luts/<file>"), so looks and carried-over edits agree.
 */
const ASSET_PREFIX = 'asset:';
const USER_PREFIX = 'user:';
const EXTENSIONS = ['cube', 'png'];

const bundledUrls = import.meta.glob('../../../../luts/*.{png,cube,PNG,CUBE}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const fileNameOf = (path: string) => path.substring(path.lastIndexOf('/') + 1);
const displayName = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.substring(0, dot) : fileName).trim();
};
const isLut = (name: string) => EXTENSIONS.includes(name.substring(name.lastIndexOf('.') + 1).toLowerCase());
const byName = (a: LutEntry, b: LutEntry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

const bundledById = new Map<string, string>();
for (const [path, url] of Object.entries(bundledUrls)) bundledById.set(`${ASSET_PREFIX}luts/${fileNameOf(path)}`, url);

/** User LUT files by id (this session, plus the remembered folder when the browser supports it). */
const userFiles = new Map<string, File>();
const listeners = new Set<() => void>();
let folderName: string | null = null;

export interface LutLibrary {
  bundled: LutEntry[];
  user: LutEntry[];
  /** Name of the picked LUT folder, if any. */
  folder: string | null;
}

let library: LutLibrary = { bundled: bundledEntries(), user: [], folder: null };

function bundledEntries(): LutEntry[] {
  return [...bundledById.keys()].map((id) => ({ id, name: displayName(fileNameOf(id)), bundled: true })).sort(byName);
}

function publish() {
  library = {
    bundled: library.bundled,
    user: [...userFiles.entries()].map(([id, f]) => ({ id, name: displayName(f.name), bundled: false })).sort(byName),
    folder: folderName,
  };
  for (const l of listeners) l();
}

export const LutRepository = {
  library: () => library,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Adds LUT files the user picked or dropped. */
  addFiles(files: Iterable<File>) {
    for (const f of files) if (isLut(f.name)) userFiles.set(`${USER_PREFIX}${f.name}`, f);
    publish();
  },

  /** Picks a LUT folder (File System Access API); remembered across visits where the browser allows it. */
  async chooseFolder(): Promise<boolean> {
    const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) return false;
    const dir = await picker({ id: 'rawboy-luts', mode: 'read' });
    await scanFolder(dir);
    await saveFolder(dir);
    return true;
  },

  /** Rescans the remembered folder, if permission is still granted (called when the LUTs tab opens). */
  async rescan() {
    const dir = await loadFolder();
    if (!dir) return;
    const perm = await (dir as unknown as { queryPermission?: (o: object) => Promise<string> }).queryPermission?.({ mode: 'read' });
    if (perm === 'granted') await scanFolder(dir);
  },

  async open(id: string): Promise<Blob> {
    const url = bundledById.get(RetiredLooks.lut(id));
    if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Cannot load LUT (${res.status})`);
      return res.blob();
    }
    const file = userFiles.get(id);
    if (file) return file;
    throw new Error(`Unknown LUT ${id}`);
  },
};

async function scanFolder(dir: FileSystemDirectoryHandle) {
  for (const id of [...userFiles.keys()]) if (id.startsWith(`${USER_PREFIX}folder/`)) userFiles.delete(id);
  for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === 'file' && isLut(entry.name)) {
      userFiles.set(`${USER_PREFIX}folder/${entry.name}`, await (entry as FileSystemFileHandle).getFile());
    }
  }
  folderName = dir.name;
  publish();
}

// The folder handle is kept in IndexedDB (handles can't go into localStorage).
const DB = 'rawboy';
const STORE = 'handles';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveFolder(dir: FileSystemDirectoryHandle) {
  try {
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(dir, 'lutFolder');
  } catch {
    // Not remembered; the folder still works for this visit.
  }
}

async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get('lutFolder');
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Recently used LUTs, shared by every session, with in-flight loads deduplicated (see CLAUDE.md: LUT loading). */
const CACHE_SIZE = 6;
const cache = new Map<string, Promise<LutData>>();

export function loadLutCached(id: string): Promise<LutData> {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit); // most recent last
    return hit;
  }
  const load = LutRepository.open(id).then((blob) => loadLut(id, blob));
  cache.set(id, load);
  load.catch(() => cache.delete(id));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return load;
}
