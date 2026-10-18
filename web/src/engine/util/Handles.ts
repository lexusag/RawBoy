// File System Access handles kept between visits in IndexedDB (handles can't go into localStorage).
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

/** Remembers [handle] under [key]; quietly not when IndexedDB is unavailable. */
export async function saveHandle(key: string, handle: FileSystemHandle) {
  try {
    const d = await db();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, key);
  } catch {
    // Not remembered; the handle still works for this visit.
  }
}

/** The handle remembered under [key], or null. */
export async function loadHandle<T extends FileSystemHandle>(key: string): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
