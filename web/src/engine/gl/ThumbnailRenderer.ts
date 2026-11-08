import { OffscreenDeveloper } from './OffscreenDeveloper';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import type { PixelRect } from './Zoom';

let developer: OffscreenDeveloper | null = null;

/** The off-screen developer shared by thumbnails and export (one WebGL2 context). */
export function sharedDeveloper(): OffscreenDeveloper {
  return (developer ??= new OffscreenDeveloper());
}

const to8 = (v: number) => Math.trunc((v * 255 + 32767) / 65535);

/**
 * Develops [preview] with [params] into an 8-bit image whose long edge is at most [maxDimension] (and no larger
 * than the preview). Port of gl/ThumbnailRenderer.kt.
 */
export function renderThumbnail(params: ShaderParams, preview: PreviewImage, maxDimension: number): ImageData {
  const outW = params.lens.outputWidth;
  const outH = params.lens.outputHeight;
  const longEdge = Math.min(maxDimension, Math.max(preview.width, preview.height));
  const scale = longEdge / Math.max(outW, outH);
  const w = Math.max(1, Math.round(outW * scale));
  const h = Math.max(1, Math.round(outH * scale));
  const samples = sharedDeveloper().renderPreview(params, preview, w, h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = to8(samples[i * 4]);
    rgba[i * 4 + 1] = to8(samples[i * 4 + 1]);
    rgba[i * 4 + 2] = to8(samples[i * 4 + 2]);
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, w, h);
}

/**
 * Develops the part [region] of the picture (output pixels, as `params.lens.outputWidth` x `outputHeight`) from
 * [preview] into a [width] x [height] image: the fit view's pixels for that area. Calls in a row on one preview
 * upload it once.
 */
export function renderRegion(params: ShaderParams, preview: PreviewImage, region: PixelRect, width: number, height: number): ImageData {
  const samples = sharedDeveloper().renderPreviewRegion(params, preview, region, width, height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = to8(samples[i * 4]);
    rgba[i * 4 + 1] = to8(samples[i * 4 + 1]);
    rgba[i * 4 + 2] = to8(samples[i * 4 + 2]);
    rgba[i * 4 + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}
