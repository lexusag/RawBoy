import { zipSync } from 'fflate';

/** Raw extensions the decoders handle (LibRaw's common ones plus DNG); anything else is still tried when picked. */
export const RAW_ACCEPT = '.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.rw2,.orf,.pef,.srw,.x3f,.3fr,.fff,.iiq,.mos,.mrw,.erf,.kdc,.dcr,.rwl,.raw';

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

/** Opens the folder picker to select files within a folder. */
export function pickFolderFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as unknown as { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/**
 * Reads files from a drop event, traversing directories recursively if folders were dropped.
 * Preserves the relative folder path for items inside directories.
 */
export async function readDroppedFiles(dt: DataTransfer | null): Promise<{ file: File; folder?: string }[]> {
  if (!dt) return [];
  const result: { file: File; folder?: string }[] = [];

  const items = Array.from(dt.items ?? []);
  const entries: any[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = (item as unknown as { webkitGetAsEntry?: () => any }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (!entries.length) {
    for (const file of Array.from(dt.files ?? [])) {
      if (!file.name.startsWith('.')) {
        result.push({ file });
      }
    }
    return result;
  }

  async function traverse(entry: any, path: string): Promise<void> {
    if (entry.name.startsWith('.')) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((res) => {
        entry.file(res, () => res(null));
      });
      if (file && !file.name.startsWith('.')) {
        result.push({ file, folder: path || undefined });
      }
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAll = async (): Promise<any[]> => {
        const batch: any[] = [];
        while (true) {
          const chunk = await new Promise<any[]>((res) => {
            dirReader.readEntries(res, () => res([]));
          });
          if (!chunk || !chunk.length) break;
          batch.push(...chunk);
        }
        return batch;
      };
      const children = await readAll();
      const currentPath = path ? `${path}/${entry.name}` : entry.name;
      for (const child of children) {
        await traverse(child, currentPath);
      }
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      await traverse(entry, '');
    } else {
      await traverse(entry, '');
    }
  }

  return result;
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
