import { type NoiseLevel } from '../auto/analysis/AutoTone';
import type { PreviewImage } from '../gl/PreviewImage';
import type { DetailTile, PixelRect } from '../gl/Zoom';
import { LensInfo } from '../lens/LensInfo';
import type { SkinMask } from '../retouch/SkinMask';
import type { OpenResult, PhotoMetadata } from '../../worker/protocol';
import { rawWorker } from './RawWorker';

/**
 * A decoded raw file held in the decoder worker as linear Rec.2020 half floats, white balanced for the as-shot
 * illuminant and oriented for display (port of raw/RawImage.kt).
 */
export class RawImage {
  private closed = false;
  readonly width: number;
  readonly height: number;
  readonly description: string;
  readonly camera: string;
  /** ISO speed from the file's metadata, 0 if unknown. */
  readonly iso: number;
  /** DNG BaselineExposure in EV, already applied to the pixels; NaN if the file has none. */
  readonly baselineExposure: number;
  /** Pixel value of blown highlights (clipped in every channel), 0 if unknown (see DevelopParams.clipLevel). */
  readonly clipLevel: number;
  /** A JPEG/HEIC, not a raw: rendered with `uDisplaySource` (see DevelopParams.displaySource). */
  readonly displayReferred: boolean;
  /** As-shot white chromaticity, CIE 1931 xy. */
  readonly asShotWhite: number[];
  readonly lens: LensInfo;
  /** EXIF essentials, written into exported JPEGs. */
  readonly metadata: PhotoMetadata;

  private constructor(private readonly handle: number, r: OpenResult) {
    this.width = r.width;
    this.height = r.height;
    this.description = r.description;
    this.camera = r.camera;
    this.iso = r.iso;
    this.baselineExposure = r.baselineExposure;
    this.clipLevel = r.clipLevel;
    this.displayReferred = r.displayReferred;
    this.asShotWhite = r.asShotWhite;
    this.lens = LensInfo.fromNative(r.lensName, r.width, r.height, r.lensInfo, r.lensShading);
    this.metadata = r.metadata;
  }

  /** [extraBlack]: black to take off beyond the file's, as a fraction of the white range (LibRaw path only). */
  static async open(file: Blob, extraBlack = 0): Promise<RawImage> {
    const bytes = await file.arrayBuffer();
    if (isHeif(bytes) || isPng(bytes)) return RawImage.openWithBrowser(file, bytes, isHeif(bytes) ? 'HEIC' : 'PNG');
    const r = await rawWorker().call<OpenResult>({ op: 'open', bytes, extraBlack }, [bytes]);
    return new RawImage(r.handle, r);
  }

  /**
   * HEIC and PNG through the browser's own decoder (HEIC: Safari has one; there is no HEVC decoder of our own), read
   * back from a canvas in Display P3 where the browser supports it. createImageBitmap already applies the orientation.
   */
  private static async openWithBrowser(file: Blob, bytes: ArrayBuffer, kind: string): Promise<RawImage> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(kind === 'HEIC'
        ? 'This browser cannot decode HEIC photos. Open them in Safari, or convert them to JPEG.'
        : `This browser cannot decode this ${kind}.`);
    }
    const { width, height } = bitmap;
    // Display P3 where the browser supports it (Safari does), else sRGB: the pixels say which they are.
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'display-p3' });
    if (!ctx) throw new Error(`Cannot read the decoded ${kind}`);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, width, height, { colorSpace: 'display-p3' });
    const p3 = image.colorSpace === 'display-p3';
    const rgba = image.data.buffer;
    const r = await rawWorker().call<OpenResult>(
      { op: 'openPixels', rgba, width, height, p3, bytes }, [rgba, bytes]);
    return new RawImage(r.handle, r);
  }

  private check() {
    if (this.closed) throw new Error('image closed');
  }

  /** Downscaled copy; [boostHighlights] makes it a bloom source. */
  async createPreview(maxDimension: number, boostHighlights = false): Promise<PreviewImage> {
    this.check();
    const scale = Math.min(1, maxDimension / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * scale));
    const h = Math.max(1, Math.round(this.height * scale));
    const pixels = await rawWorker().call<Uint16Array>({ op: 'downsample', handle: this.handle, width: w, height: h, boost: boostHighlights });
    return { width: w, height: h, pixels, fullWidth: this.width, fullHeight: this.height };
  }

  /** A full-resolution region as tightly packed RGB half floats. */
  async copyTile(r: PixelRect): Promise<Uint16Array> {
    this.check();
    return rawWorker().call<Uint16Array>({ op: 'copyTile', handle: this.handle, x: r.x, y: r.y, width: r.width, height: r.height });
  }

  async createTile(r: PixelRect): Promise<DetailTile> {
    return { rect: r, pixels: await this.copyTile(r) };
  }

  /** Measures the photo's noise on the full-resolution pixels (~30 ms); NO_NOISE for JPEG/HEIC. */
  async measureNoise(): Promise<NoiseLevel> {
    this.check();
    const [luma, chroma] = await rawWorker().call<[number, number]>({ op: 'noiseLevel', handle: this.handle });
    return { luma, chroma };
  }

  /** Blemish candidates on [mask]: (x, y, radius, score) per spot, most obvious first. */
  async detectBlemishes(mask: SkinMask): Promise<Float32Array> {
    this.check();
    return rawWorker().call<Float32Array>({
      op: 'detectBlemishes', handle: this.handle, mask: mask.data, maskW: mask.width, maskH: mask.height, faceDiameter: mask.faceDiameterPx,
    });
  }

  /** Replaces any earlier healing with healing of exactly [spots]. Previews must be rebuilt afterwards. */
  async healBlemishes(spots: Float32Array): Promise<void> {
    this.check();
    await rawWorker().call({ op: 'healBlemishes', handle: this.handle, spots });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    void rawWorker().call({ op: 'close', handle: this.handle });
  }
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/** An ISO base media file with a HEIF brand ("ftyp" box first). */
function isHeif(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 12) return false;
  const text = new TextDecoder('ascii').decode(new Uint8Array(bytes, 4, 8));
  return text.startsWith('ftyp') && HEIF_BRANDS.has(text.slice(4));
}

/** The PNG signature. */
function isPng(bytes: ArrayBuffer): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return head.length === 8 && sig.every((b, i) => head[i] === b);
}
