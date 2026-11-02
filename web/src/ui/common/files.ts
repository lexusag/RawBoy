import { zipSync } from 'fflate';

/** Raw extensions the decoders handle (LibRaw's common ones plus DNG); anything else is still tried when picked. */
export const RAW_ACCEPT = '.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.rw2,.orf,.pef,.srw,.x3f,.3fr,.fff,.iiq,.mos,.mrw,.erf,.kdc,.dcr,.rwl,.raw';

const rawExtensionSet = (accept: string) => new Set(accept.split(',').map((e) => e.trim().toLowerCase()));
const RAW_EXTENSIONS = rawExtensionSet(RAW_ACCEPT);

/** Checks whether a file name ends in one of the raw / DNG extensions. */
export function isRawFileName(name: string, accept = RAW_ACCEPT): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = name.slice(dot).toLowerCase();
  const set = accept === RAW_ACCEPT ? RAW_EXTENSIONS : rawExtensionSet(accept);
  return set.has(ext);
}

/** RawBoy's and Auto's picker: raws plus JPEG, HEIC, PNG and TIFF (decoded as display sources; HEIC needs Safari). */
export const PHOTO_ACCEPT = `${RAW_ACCEPT},.jpg,.jpeg,.heic,.heif,.png,.tif,.tiff`;

/** Opens the file picker. */
export function pickFiles(multiple: boolean, accept = RAW_ACCEPT): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = accept;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** Whether the browser supports picking a folder via an <input> element (webkitdirectory). */
export const canPickFolder = (): boolean =>
  typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype;

export interface PickFolderResult {
  files: File[];
  skipped: number;
}

/** Opens the folder picker to select files within a folder. */
export function pickFolderFiles(accept = RAW_ACCEPT): Promise<PickFolderResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      const all = Array.from(input.files ?? []);
      const nonHidden = all.filter((f) => !f.name.startsWith('.'));
      const files = accept ? nonHidden.filter((f) => isRawFileName(f.name, accept)) : nonHidden;
      const skipped = nonHidden.length - files.length;
      resolve({ files, skipped });
    };
    input.click();
  });
}

export interface DroppedFilesResult {
  files: { file: File; folder?: string }[];
  skipped: number;
}

/**
 * Reads files from a drop event, traversing directories recursively if folders were dropped.
 * Preserves the relative folder path for items inside directories.
 */
export async function readDroppedFiles(dt: DataTransfer | null, accept = RAW_ACCEPT): Promise<DroppedFilesResult> {
  if (!dt) return { files: [], skipped: 0 };
  const files: { file: File; folder?: string }[] = [];
  let skipped = 0;

  const items = Array.from(dt.items ?? []);
  const entries: FileSystemEntry[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  const isHidden = (name: string) => name.startsWith('.');
  const isMatch = (name: string) => !accept || isRawFileName(name, accept);

  if (!entries.length) {
    for (const file of Array.from(dt.files ?? [])) {
      if (isHidden(file.name)) continue;
      if (isMatch(file.name)) {
        files.push({ file });
      } else {
        skipped++;
      }
    }
    return { files, skipped };
  }

  async function traverse(entry: FileSystemEntry, path: string): Promise<void> {
    if (isHidden(entry.name)) return;
    if (entry.isFile) {
      if (!isMatch(entry.name)) {
        skipped++;
        return;
      }
      const file = await new Promise<File | null>((res) => {
        (entry as FileSystemFileEntry).file(res, () => res(null));
      });
      if (file && isMatch(file.name)) {
        files.push({ file, folder: path || undefined });
      } else if (file) {
        skipped++;
      }
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const readAll = async (): Promise<FileSystemEntry[]> => {
        const batch: FileSystemEntry[] = [];
        while (true) {
          const chunk = await new Promise<FileSystemEntry[]>((res) => {
            dirReader.readEntries(res, () => res([]));
          });
          if (!chunk || !chunk.length) break;
          batch.push(...chunk);
        }
        return batch;
      };
      const children = await readAll();
      for (const child of children) {
        await traverse(child, child.isDirectory ? `${path}/${child.name}` : path);
      }
    }
  }

  const seenRoots = new Map<string, number>();
  for (const entry of entries) {
    if (entry.isDirectory) {
      let rootPath = entry.fullPath ? entry.fullPath.replace(/^\//, '') : entry.name;
      const count = (seenRoots.get(rootPath) ?? 0) + 1;
      seenRoots.set(rootPath, count);
      if (count > 1) rootPath = `${rootPath} (${count})`;
      await traverse(entry, rootPath);
    } else {
      await traverse(entry, '');
    }
  }

  return { files, skipped };
}

/** Hands a file to the browser as a download. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * iPhone and iPad Safari (and the home-screen app) put downloads in Files, so exports go through the share sheet
 * there instead, whose Save Image puts them in Photos. iPadOS reports itself as a Mac; touch tells them apart.
 */
export const savesToPhotos = (() => {
  let cached: boolean | undefined;
  return () => (cached ??= (() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    try {
      return ios && navigator.canShare({ files: [new File([''], 'photo.jpg', { type: 'image/jpeg' })] });
    } catch {
      return false;
    }
  })());
})();

/** Exports waiting for the tap that opens the share sheet (SaveToPhotosSheet): iOS only lets a tap open it. */
let pendingExports: File[] | null = null;
const pendingListeners = new Set<() => void>();

export const pendingPhotos = {
  get: () => pendingExports,
  subscribe: (l: () => void) => {
    pendingListeners.add(l);
    return () => pendingListeners.delete(l);
  },
  set(files: File[] | null) {
    pendingExports = files;
    pendingListeners.forEach((l) => l());
  },
};

/**
 * Saves exported photos: on iOS they wait for Save to Photos (pendingPhotos), elsewhere one is a download and
 * several are one ZIP named [zipName].
 */
export async function saveExports(files: { name: string; blob: Blob }[], zipName: string) {
  if (!files.length) return;
  if (savesToPhotos()) {
    pendingPhotos.set([...(pendingExports ?? []), ...files.map((f) => new File([f.blob], f.name, { type: f.blob.type }))]);
    return;
  }
  await downloadExports(files, zipName);
}

/** One file as a download, several as one ZIP. */
export async function downloadExports(files: { name: string; blob: Blob }[], zipName: string) {
  if (files.length === 1) saveBlob(files[0].name, files[0].blob);
  else saveBlob(zipName, await zipFiles(files));
}

/** One ZIP of already-compressed files (stored, not deflated again). */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

type DirectoryPicker = (o?: object) => Promise<FileSystemDirectoryHandle>;

/** Picks an output folder where the browser can (File System Access API), or null. */
export async function pickOutputFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return null;
  return picker({ id: 'rawboy-export', mode: 'readwrite' });
}

export const canPickOutputFolder = () => 'showDirectoryPicker' in window;

/** Where exports are written: a folder on this device or in Google Drive. */
export interface OutputFolder {
  name: string;
  /** Writes [blob] under the first free name from [nameFor] (counter 0, 1, ...); returns the name used. */
  write(nameFor: (counter: number) => string, blob: Blob): Promise<string>;
}

/** A folder picked on this device as an OutputFolder. */
export const localFolder = (dir: FileSystemDirectoryHandle): OutputFolder => ({
  name: dir.name,
  write: (nameFor, blob) => writeUnique(dir, nameFor, blob),
});

/** Writes [blob] into [dir] under the first free name from [nameFor] (counter 0, 1, ...), like MediaStoreOutput. */
export async function writeUnique(dir: FileSystemDirectoryHandle, nameFor: (counter: number) => string, blob: Blob): Promise<string> {
  for (let counter = 0; counter <= 999; counter++) {
    const name = nameFor(counter);
    try {
      await dir.getFileHandle(name);
      continue; // exists
    } catch {
      // free
    }
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(blob);
    await w.close();
    return name;
  }
  throw new Error(`Too many files named ${nameFor(0)}`);
}

/** An ImageData as an object URL (JPEG), for <img> thumbnails. */
export async function imageUrl(image: ImageData): Promise<string> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
}
