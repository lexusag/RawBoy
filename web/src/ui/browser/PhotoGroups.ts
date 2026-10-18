import { RAW_ACCEPT } from '../common/files';

const RAW_EXTENSIONS = new Set(RAW_ACCEPT.split(',').map((e) => e.slice(1)));
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png', 'tif', 'tiff']);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const stemOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

export const isRawName = (name: string) => RAW_EXTENSIONS.has(extensionOf(name));
export const isPhotoName = (name: string) => isRawName(name) || IMAGE_EXTENSIONS.has(extensionOf(name));
const isSidecarName = (name: string) => extensionOf(name) === 'xmp';

/** One photo of a folder: its files sharing a base name (a RAW + JPEG pair is one photo) and their sidecars. */
export interface PhotoGroup {
  stem: string;
  /** The file shown and opened: the raw when there is one. */
  main: string;
  /** The other files of the photo (the JPEG of a RAW + JPEG pair); they go to the bin with it. */
  companions: string[];
  /** Existing XMP sidecars: NAME.xmp (Lightroom, Capture One) and NAME.EXT.xmp (darktable). */
  sidecars: string[];
}

/** Groups a folder's file names into photos, in name order; other files are ignored. Names compare case-insensitively. */
export function groupPhotos(names: string[]): PhotoGroup[] {
  const byStem = new Map<string, string[]>();
  const sidecars = new Map<string, string[]>();
  for (const name of names) {
    if (isPhotoName(name)) {
      const key = stemOf(name).toLowerCase();
      byStem.set(key, [...(byStem.get(key) ?? []), name]);
    } else if (isSidecarName(name)) {
      // NAME.xmp belongs to NAME; NAME.CR2.xmp to NAME.CR2's stem.
      const inner = stemOf(name);
      const key = (isPhotoName(inner) ? stemOf(inner) : inner).toLowerCase();
      sidecars.set(key, [...(sidecars.get(key) ?? []), name]);
    }
  }
  const groups: PhotoGroup[] = [];
  for (const [key, files] of byStem) {
    files.sort((a, b) => Number(isRawName(b)) - Number(isRawName(a)) || a.localeCompare(b));
    const [main, ...companions] = files;
    groups.push({ stem: stemOf(main), main, companions, sidecars: (sidecars.get(key) ?? []).sort() });
  }
  return groups.sort((a, b) => a.main.localeCompare(b.main, undefined, { numeric: true }));
}

/** [name] with [suffix] after the photo's [stem] ("IMG_1.CR2.xmp", "-2" -> "IMG_1-2.CR2.xmp"). */
export function withSuffix(name: string, stem: string, suffix: string): string {
  return name.toLowerCase().startsWith(stem.toLowerCase()) ? name.slice(0, stem.length) + suffix + name.slice(stem.length) : stemOf(name) + suffix + name.slice(stemOf(name).length);
}
