import { zipSync } from 'fflate';

/** Raw extensions the decoders handle (LibRaw's common ones plus DNG); anything else is still tried when picked. */
export const RAW_ACCEPT = '.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.rw2,.orf,.pef,.srw,.x3f,.3fr,.fff,.iiq,.mos,.mrw,.erf,.kdc,.dcr,.rwl,.raw';

/** RawBoy Auto's picker: raws plus JPEG, HEIC, PNG and TIFF (decoded as display sources; HEIC needs Safari). */
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
