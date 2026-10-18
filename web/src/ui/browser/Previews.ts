import { findEmbeddedPreview, findJxlPreview, withOrientation, type JxlPreview } from '../../engine/browse/EmbeddedPreview';
import { ShaderParams } from '../../engine/gl/ShaderParams';
import { renderThumbnail } from '../../engine/gl/ThumbnailRenderer';
import { LensTransform } from '../../engine/lens/LensTransform';
import { RawImage } from '../../engine/raw/RawImage';
import { rawWorker } from '../../engine/raw/RawWorker';
import type { JxlPixels } from '../../worker/protocol';
import { asShotDefaults, BASE_MAX_DIMENSION } from '../../engine/session/PhotoSession';
import { isRawName } from './PhotoGroups';

/** What the viewer shows for a photo, and where it came from. */
export interface ViewImage {
  /** An image the browser decodes itself (JPEG, PNG, HEIC on Safari), upright through its EXIF orientation. */
  blob: Blob;
  /** Width × height as stored, for the info line ("" when unknown). */
  size: string;
  source: 'embedded' | 'decoded' | 'image';
}

/** Long side of a raw developed by RawBoy when it has no embedded preview, and of a decoded JPEG XL preview. */
const DECODED_SIZE = 2560;

/** Full decodes run one at a time (memory); they are the slow path. */
let decodeTail: Promise<unknown> = Promise.resolve();

/**
 * The image to show for [file]: a JPEG/PNG/HEIC as it is, a raw's embedded preview (a DNG's JPEG XL one when it is
 * bigger than its JPEG), else the raw developed as shot (white balance as shot, every slider at default) at
 * [DECODED_SIZE].
 */
export async function viewImageOf(file: File): Promise<ViewImage> {
  if (!isRawName(file.name) && !/\.tiff?$/i.test(file.name)) return { blob: file, size: '', source: 'image' };
  const jxl = await jxlViewImageOf(file, DECODED_SIZE);
  if (jxl) return jxl;
  const embedded = await findEmbeddedPreview(file);
  if (embedded) return { blob: embedded.jpeg, size: `${embedded.width} × ${embedded.height}`, source: 'embedded' };
  const run = decodeTail.then(() => developAsShot(file));
  decodeTail = run.catch(() => undefined);
  return run;
}

/**
 * A DNG's JPEG XL preview at long side [maxSide] at most (from the smallest preview that reaches it), when it is bigger
 * than the DNG's JPEG preview; null otherwise, or when it can't be decoded (the build without the DNG SDK has no
 * libjxl). Adobe DNG Converter's JPEG XL DNGs keep only a 256 px JPEG thumbnail beside them.
 */
export async function jxlViewImageOf(file: File, maxSide: number): Promise<ViewImage | null> {
  if (!isRawName(file.name) && !/\.tiff?$/i.test(file.name)) return null;
  const preview = await findJxlPreview(file, maxSide);
  if (!preview) return null;
  const run = decodeTail.then(() => decodeJxlPreview(file, preview, maxSide));
  decodeTail = run.catch(() => undefined);
  try {
    return await run;
  } catch {
    return null;
  }
}

async function decodeJxlPreview(file: File, preview: JxlPreview, maxSide: number): Promise<ViewImage> {
  const canvas = new OffscreenCanvas(preview.width, preview.height);
  const ctx = canvas.getContext('2d')!;
  const across = Math.ceil(preview.width / preview.pieceWidth);
  for (const [k, piece] of preview.pieces.entries()) {
    const bytes = await file.slice(piece.offset, piece.offset + piece.length).arrayBuffer();
    const px = await rawWorker().call<JxlPixels>({ op: 'decodeJxl', bytes }, [bytes]);
    const image = new ImageData(new Uint8ClampedArray(px.rgba.buffer, px.rgba.byteOffset, px.rgba.length), px.width, px.height);
    ctx.putImageData(image, (k % across) * preview.pieceWidth, Math.floor(k / across) * preview.pieceHeight);
  }
  const scale = Math.min(1, maxSide / Math.max(preview.width, preview.height));
  const bitmap = canvas.transferToImageBitmap();
  try {
    const jpeg = await jpegOf(bitmap, Math.max(1, Math.round(preview.width * scale)), Math.max(1, Math.round(preview.height * scale)));
    return {
      blob: preview.orientation > 1 ? withOrientation(jpeg, preview.orientation) : jpeg,
      size: `${preview.width} × ${preview.height}`,
      source: 'embedded',
    };
  } finally {
    bitmap.close();
  }
}

async function developAsShot(file: File): Promise<ViewImage> {
  const img = await RawImage.open(file);
  try {
    const defaults = asShotDefaults(img);
    const base = await img.createPreview(BASE_MAX_DIMENSION);
    const preview = await img.createPreview(DECODED_SIZE);
    const shader = ShaderParams.from(defaults, defaults, null, new LensTransform(img.lens, defaults), base, null, null);
    const image = renderThumbnail(shader, preview, DECODED_SIZE);
    return { blob: await jpegOf(image), size: `${img.width} × ${img.height}`, source: 'decoded' };
  } finally {
    img.close();
  }
}

async function jpegOf(image: ImageData | ImageBitmap, width = image.width, height = image.height): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  if (image instanceof ImageData) ctx.putImageData(image, 0, 0);
  else {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/** A small upright JPEG of [image] (long side at most [maxSide]), for the grid. */
export async function thumbnailOf(image: ViewImage, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(image.blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    return await jpegOf(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  } finally {
    bitmap.close();
  }
}
