import type { ShaderParams } from '../gl/ShaderParams';
import { sharedDeveloper } from '../gl/ThumbnailRenderer';
import { rect } from '../gl/Zoom';
import type { RawImage } from '../raw/RawImage';
import { rawWorker } from '../raw/RawWorker';
import { BandDownscaler } from './BandDownscaler';
import { exifSegment, insertExif } from './ExifWriter';
import { MIME_TYPES, type ExportSettings } from './ExportSettings';
import { TiffWriter } from './TiffWriter';

const TILE_WIDTH = 1024;
const TILE_HEIGHT = 512;

type Consume = (y: number, rows: number, band: Uint16Array) => Promise<void> | void;

/**
 * Develops the full-resolution image on the GPU in tiles and encodes JPEG (jpegli, in the decoder worker, with the
 * main EXIF fields) or TIFF (port of export/Exporter.kt). Returns the file's bytes; the caller saves or zips them.
 */
export async function exportImage(image: RawImage, params: ShaderParams, settings: ExportSettings, onProgress: (f: number) => void): Promise<Blob> {
  const size = BandDownscaler.outputSize(params.lens.outputWidth, params.lens.outputHeight, settings.maxLongSide);
  if (settings.format === 'tiff') {
    const writer = new TiffWriter(size[0], size[1], settings.tiffBits, image.metadata);
    await renderOutput(image, params, size, onProgress, (_, rows, band) => writer.writeRows(band, rows));
    return writer.finish();
  }
  const id = await rawWorker().call<number>({ op: 'jpegBegin', width: size[0], height: size[1], quality: settings.jpegQuality });
  try {
    // jpegli streams each band as it is developed, at full 16-bit precision.
    await renderOutput(image, params, size, onProgress, async (_, rows, band) => {
      await rawWorker().call({ op: 'jpegWrite', id, rows: band.slice(0, size[0] * rows * 3), count: rows });
    });
  } catch (e) {
    await rawWorker().call({ op: 'release', id });
    throw e;
  }
  const bytes = await rawWorker().call<Uint8Array>({ op: 'jpegFinish', id });
  // Metadata is best effort, as on Android: the image is already encoded.
  let withExif = bytes;
  try {
    withExif = insertExif(bytes, exifSegment(image.metadata));
  } catch (e) {
    console.warn('EXIF not written', e);
  }
  return new Blob([withExif], { type: MIME_TYPES.jpeg });
}

/**
 * Renders the image at [size] (the full output size, or smaller: then the full-resolution bands are area-downscaled
 * as they stream, and the grain is sized to the smaller output).
 */
async function renderOutput(image: RawImage, params: ShaderParams, size: [number, number], onProgress: (f: number) => void, consume: Consume) {
  const w = params.lens.outputWidth;
  const h = params.lens.outputHeight;
  if (size[0] === w && size[1] === h) return renderBands(image, params, 1, onProgress, consume);
  const scaler = await BandDownscaler.create(w, h, size[0], size[1], consume);
  try {
    // A grain cell at least one output pixel, as a full-size render of the smaller image would have.
    const minGrain = Math.max(w, h) / Math.max(size[0], size[1]);
    await renderBands(image, params, minGrain, onProgress, (_, rows, band) => scaler.push(rows, band.slice(0, w * rows * 3)));
  } catch (e) {
    await scaler.abort();
    throw e;
  }
  await scaler.finish();
}

/** Renders the image top to bottom in bands of TILE_HEIGHT rows; [consume] gets RGB 16-bit samples. */
async function renderBands(image: RawImage, params: ShaderParams, minGrainPx: number, onProgress: (f: number) => void, consume: Consume) {
  // Output size: rotation by 90 degrees swaps width and height.
  const w = params.lens.outputWidth;
  const h = params.lens.outputHeight;
  const tilesX = Math.ceil(w / TILE_WIDTH);
  const tilesY = Math.ceil(h / TILE_HEIGHT);
  const band = new Uint16Array(w * TILE_HEIGHT * 3);
  let done = 0;

  // The shader's image size is the source image's (display orientation), not the output's: whole-image
  // textures (high-pass base, bloom, skin mask) are sampled in source pixels.
  const developer = sharedDeveloper();
  developer.setImageSize(image.width, image.height);
  developer.minGrainPx = minGrainPx;
  const margin = params.spatialMargin;
  // Fetch the next tile's source pixels while the GPU develops this one.
  const tiles: { out: ReturnType<typeof rect> }[] = [];
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const x = tx * TILE_WIDTH;
      const y = ty * TILE_HEIGHT;
      tiles.push({ out: rect(x, y, Math.min(TILE_WIDTH, w - x), Math.min(TILE_HEIGHT, h - y)) });
    }
  const fetch = (i: number) => {
    const src = params.lens.sourceBounds(tiles[i].out, margin);
    return image.copyTile(src).then((pixels) => ({ src, pixels }));
  };
  let next = tiles.length ? fetch(0) : null;
  for (let i = 0; i < tiles.length; i++) {
    const { src, pixels } = await next!;
    next = i + 1 < tiles.length ? fetch(i + 1) : null;
    const out = tiles[i].out;
    const developed = developer.render(params, pixels, src, out);
    pack(developed, out.width, out.height, band, w, out.x);
    done++;
    onProgress(done / tiles.length);
    const lastInBand = out.x + out.width >= w;
    if (lastInBand) await consume(out.y, out.height, band);
  }
}

/** Copies a developed RGBA tile into a band of interleaved RGB 16-bit samples [bandWidth] wide, from column [x]. */
function pack(src: Uint16Array | Uint32Array, cols: number, rows: number, dst: Uint16Array, bandWidth: number, x: number) {
  for (let r = 0; r < rows; r++) {
    let s = r * cols * 4;
    let d = (r * bandWidth + x) * 3;
    for (let c = 0; c < cols; c++, s += 4, d += 3) {
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
    }
  }
}
