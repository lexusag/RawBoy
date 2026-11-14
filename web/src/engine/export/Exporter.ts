import { isMonochromeLut } from '../auto/looks/Look';
import type { ShaderParams } from '../gl/ShaderParams';
import { sharedDeveloper } from '../gl/ThumbnailRenderer';
import { SCAN_MARGIN, SCAN_SCALE, filmScanApplies, scanSize } from '../gl/ScanScale';
import { rect, type PixelRect } from '../gl/Zoom';
import type { RawImage } from '../raw/RawImage';
import { rawWorker } from '../raw/RawWorker';
import { BandDownscaler } from './BandDownscaler';
import { DateStamp, type DateStampStyle } from './DateStamp';
import { exifSegment, insertExif } from './ExifWriter';
import { MIME_TYPES, resolveExportFrame, type ExportSettings } from './ExportSettings';
import { Pentax645Frame, type Pentax645Info } from './Pentax645Frame';
import { TiffWriter } from './TiffWriter';

const TILE_WIDTH = 1024;
const TILE_HEIGHT = 512;

type Consume = (y: number, rows: number, band: Uint16Array) => Promise<void> | void;

/**
 * Develops the full-resolution image on the GPU in tiles and encodes JPEG (jpegli, in the decoder worker, with the
 * main EXIF fields) or TIFF (port of export/Exporter.kt). Returns the file's bytes; the caller saves or zips them.
 */
export async function exportImage(image: RawImage, params: ShaderParams, settings: ExportSettings, onProgress: (f: number) => void): Promise<Blob> {
  // Film scan: Film mode rendered 1.5x larger (the size setting doesn't apply to it).
  const scan = settings.filmScan && filmScanApplies(params);
  const size = scan
    ? scanSize(params.lens.outputWidth, params.lens.outputHeight)
    : BandDownscaler.outputSize(params.lens.outputWidth, params.lens.outputHeight, settings.maxLongSide);
  const isMono = params.saturation <= 0 || (params.lutAmount >= 1 && isMonochromeLut(params.lut?.id));
  const resolved = resolveExportFrame(settings, image, isMono);
  const frameLayout = resolved.pentax645
    ? Pentax645Frame.layout(size[0], size[1], resolved.pentax645.style ?? 'PENTAX_645')
    : null;
  const outSize: [number, number] = frameLayout ? [frameLayout.outWidth, frameLayout.outHeight] : size;
  const dateStamp = resolved.pentax645 == null ? (resolved.dateStamp ?? '') : '';
  const dateStampStyle: DateStampStyle = resolved.dateStampStyle ?? 'CLASSIC';
  const mono = Boolean(resolved.monochromeImprint);
  if (resolved.format === 'tiff') {
    const writer = new TiffWriter(outSize[0], outSize[1], resolved.tiffBits, image.metadata);
    await renderOutput(
      image,
      params,
      size,
      scan,
      dateStamp,
      dateStampStyle,
      resolved.pentax645 ?? null,
      mono,
      onProgress,
      (_, rows, band) => writer.writeRows(band, rows),
    );
    return writer.finish();
  }
  const id = await rawWorker().call<number>({ op: 'jpegBegin', width: outSize[0], height: outSize[1], quality: resolved.jpegQuality });
  try {
    // jpegli streams each band as it is developed, at full 16-bit precision.
    await renderOutput(
      image,
      params,
      size,
      scan,
      dateStamp,
      dateStampStyle,
      resolved.pentax645 ?? null,
      mono,
      onProgress,
      async (_, rows, band) => {
        await rawWorker().call({ op: 'jpegWrite', id, rows: band.slice(0, outSize[0] * rows * 3), count: rows });
      },
    );
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
 * as they stream, and the grain is sized to the smaller output; or a film scan, [scan]: [SCAN_SCALE] times larger).
 */
async function renderOutput(
  image: RawImage,
  params: ShaderParams,
  size: [number, number],
  scan: boolean,
  dateStamp: string,
  dateStampStyle: DateStampStyle,
  pentax645: Pentax645Info | null,
  monochrome: boolean,
  onProgress: (f: number) => void,
  consume: Consume,
) {
  const w = params.lens.outputWidth;
  const h = params.lens.outputHeight;
  const layout = pentax645 ? Pentax645Frame.layout(size[0], size[1], pentax645.style ?? 'PENTAX_645') : null;
  let framedBand = new Uint16Array(0);
  const stamped: Consume = layout
    ? async (y, rows, band) => {
        const need = layout.outWidth * rows * 3;
        if (framedBand.length < need) framedBand = new Uint16Array(need);
        Pentax645Frame.wrapPhotoBand(band, framedBand, layout, y, rows, monochrome, pentax645);
        await consume(layout.topPad + y, rows, framedBand);
      }
    : dateStamp
      ? async (y, rows, band) => {
          DateStamp.imprint(band, size[0], size[1], y, rows, dateStamp, monochrome, dateStampStyle);
          await consume(y, rows, band);
        }
      : consume;

  if (layout && pentax645) {
    let barY = 0;
    while (barY < layout.topPad) {
      const rows = Math.min(TILE_HEIGHT, layout.topPad - barY);
      const need = layout.outWidth * rows * 3;
      if (framedBand.length < need) framedBand = new Uint16Array(need);
      Pentax645Frame.renderTopBarBand(framedBand, layout, barY, rows, pentax645, monochrome);
      await consume(barY, rows, framedBand);
      barY += rows;
    }
  }

  const emitBottom = async () => {
    if (!layout) return;
    let botY = 0;
    while (botY < layout.bottomPad) {
      const rows = Math.min(TILE_HEIGHT, layout.bottomPad - botY);
      const need = layout.outWidth * rows * 3;
      if (framedBand.length < need) framedBand = new Uint16Array(need);
      Pentax645Frame.renderBorderBand(
        framedBand,
        layout,
        layout.topPad + layout.photoHeight + botY,
        rows,
        monochrome,
        pentax645,
      );
      await consume(layout.topPad + layout.photoHeight + botY, rows, framedBand);
      botY += rows;
    }
  };

  if (scan) {
    await renderBands(image, params, 1, onProgress, stamped, SCAN_SCALE);
    await emitBottom();
    return;
  }
  if (size[0] === w && size[1] === h) {
    await renderBands(image, params, 1, onProgress, stamped);
    await emitBottom();
    return;
  }
  const scaler = await BandDownscaler.create(w, h, size[0], size[1], stamped);
  try {
    // A grain cell at least one output pixel, as a full-size render of the smaller image would have.
    const minGrain = Math.max(w, h) / Math.max(size[0], size[1]);
    await renderBands(image, params, minGrain, onProgress, (_, rows, band) => scaler.push(rows, band.slice(0, w * rows * 3)));
  } catch (e) {
    await scaler.abort();
    throw e;
  }
  await scaler.finish();
  await emitBottom();
}

/**
 * Renders the image top to bottom in bands of TILE_HEIGHT rows; [consume] gets RGB 16-bit samples. [scale] > 1 (film
 * scan): the tiles are in output pixels, [scale] times the photo's; each one's source region is upscaled first.
 */
async function renderBands(image: RawImage, params: ShaderParams, minGrainPx: number, onProgress: (f: number) => void, consume: Consume, scale = 1) {
  // Output size: rotation by 90 degrees swaps width and height.
  const [w, h] = scale > 1 ? scanSize(params.lens.outputWidth, params.lens.outputHeight) : [params.lens.outputWidth, params.lens.outputHeight];
  const tilesX = Math.ceil(w / TILE_WIDTH);
  const tilesY = Math.ceil(h / TILE_HEIGHT);
  const band = new Uint16Array(w * TILE_HEIGHT * 3);
  let done = 0;

  // The shader's image size is the source image's (display orientation), not the output's: whole-image
  // textures (high-pass base, bloom, skin mask) are sampled in source pixels.
  const developer = sharedDeveloper();
  developer.setImageSize(image.width, image.height);
  developer.minGrainPx = minGrainPx;
  const margin = params.spatialMargin + (scale > 1 ? SCAN_MARGIN : 0);
  // Fetch the next tile's source pixels while the GPU develops this one.
  const tiles: { out: ReturnType<typeof rect> }[] = [];
  for (let ty = 0; ty < tilesY; ty++)
    for (let tx = 0; tx < tilesX; tx++) {
      const x = tx * TILE_WIDTH;
      const y = ty * TILE_HEIGHT;
      tiles.push({ out: rect(x, y, Math.min(TILE_WIDTH, w - x), Math.min(TILE_HEIGHT, h - y)) });
    }
  const fetch = (i: number) => {
    const o = tiles[i].out;
    // The photo's pixels under this tile; a scan upscales them whole, so their edges are even (see render).
    const base = scale > 1 ? rect(Math.floor(o.x / scale), Math.floor(o.y / scale), Math.ceil((o.x + o.width) / scale) - Math.floor(o.x / scale), Math.ceil((o.y + o.height) / scale) - Math.floor(o.y / scale)) : o;
    let src = params.lens.sourceBounds(base, margin);
    if (scale > 1) src = evenRect(src, image.width, image.height);
    return image.copyTile(src).then((pixels) => ({ src, pixels }));
  };
  let next = tiles.length ? fetch(0) : null;
  for (let i = 0; i < tiles.length; i++) {
    const { src, pixels } = await next!;
    next = i + 1 < tiles.length ? fetch(i + 1) : null;
    const out = tiles[i].out;
    const developed = developer.render(params, pixels, src, out, scale);
    pack(developed, out.width, out.height, band, w, out.x);
    done++;
    onProgress(done / tiles.length);
    const lastInBand = out.x + out.width >= w;
    if (lastInBand) await consume(out.y, out.height, band);
  }
}

/** [r] grown to even x, y, width and height inside a [maxW] x [maxH] image (an odd last column or row is dropped). */
function evenRect(r: PixelRect, maxW: number, maxH: number): PixelRect {
  const x0 = r.x - (r.x & 1);
  const y0 = r.y - (r.y & 1);
  const x1 = Math.min(r.x + r.width + ((r.x + r.width) & 1), maxW - (maxW & 1));
  const y1 = Math.min(r.y + r.height + ((r.y + r.height) & 1), maxH - (maxH & 1));
  return rect(x0, y0, x1 - x0, y1 - y0);
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
