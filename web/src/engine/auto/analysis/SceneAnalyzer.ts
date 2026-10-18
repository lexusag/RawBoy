import type { PreviewImage } from '../../gl/PreviewImage';
import type { SkinMask } from '../../retouch/SkinMask';
import { halfToFloat } from '../../util/half';
import { meterBox, type MeterArea } from './MeterArea';

export const MIN_LOG = -20;
export const MAX_LOG = 1;
export const BINS_PER_EV = 16;
const BINS = Math.trunc((MAX_LOG - MIN_LOG) * BINS_PER_EV) + 1;

export const bin = (log2Luminance: number) => Math.trunc((Math.min(MAX_LOG, Math.max(MIN_LOG, log2Luminance)) - MIN_LOG) * BINS_PER_EV);

// Rec.2020 luminance weights.
const KR = 0.2627;
const KG = 0.678;
const KB = 0.0593;

/**
 * What the auto decisions need to know about a photo (port of SceneStats). Luminances are linear scene light as
 * decoded (1.0 = sensor clip, as-shot white balance); percentiles are log2.
 */
export class SceneStats {
  constructor(
    /** Centre-weighted geometric mean luminance. */
    readonly key: number,
    readonly p1: number,
    readonly p5: number,
    readonly p50: number,
    readonly p98: number,
    readonly p99: number,
    /** Fraction of pixels with any channel at sensor clip. */
    readonly clipped: number,
    /** Mean saturation of the display-encoded image, 0..1. */
    readonly chroma: number,
    /** Share of the frame that is clearly green/blue, and warm (red to yellow). */
    readonly greenBlue: number,
    readonly warm: number,
    /** Share of the frame covered by a face (0 = none found). */
    readonly faceArea: number,
    /** Mean linear luminance of skin, 0 if there is none. */
    readonly skinLuminance: number,
    readonly iso: number,
    private readonly histogram: Int32Array,
  ) {}

  /** p99 - p1 in EV. */
  get dynamicRange() {
    return this.p99 - this.p1;
  }

  get hasFace() {
    return this.faceArea > 0;
  }

  /** Fraction of pixels whose log2 luminance is at least [log2Luminance]. */
  fractionAbove(log2Luminance: number): number {
    const from = bin(log2Luminance);
    let count = 0;
    let total = 0;
    for (let i = 0; i < this.histogram.length; i++) {
      total += this.histogram[i];
      if (i >= from) count += this.histogram[i];
    }
    return total > 0 ? count / total : 0;
  }
}

function hueDegrees(r: number, g: number, b: number): number {
  // Hue angle in an opponent space (like HSV hue, but smooth).
  const a = r - (g + b) / 2;
  const bb = ((g - b) * Math.sqrt(3)) / 2;
  const deg = (Math.atan2(bb, a) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * Reads the 512 px whole-image copy on the CPU (port of SceneAnalyzer.kt). [meter]: meter only that box (key and p98);
 * null = the centre-weighted whole frame.
 */
export function analyzeScene(base: PreviewImage, skin: SkinMask | null, iso: number, meter: MeterArea | null = null): SceneStats {
  const w = base.width;
  const h = base.height;
  const px = base.pixels;
  const histogram = new Int32Array(BINS);
  let weightedLog = 0;
  let weightSum = 0;
  let clipped = 0;
  let chromaSum = 0;
  let greenBlue = 0;
  let warm = 0;
  let skinSum = 0;
  let skinCount = 0;
  const centreHistogram = meter != null ? new Int32Array(BINS) : null;
  let centreLog = 0;
  let centreCount = 0;
  const [cx0, cx1, cy0, cy1] = meter != null ? meterBox(meter, w, h) : [0, w, 0, h];
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const useSkin = skin != null && skin.hasSkin;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = Math.max(0, halfToFloat(px[i]));
      const g = Math.max(0, halfToFloat(px[i + 1]));
      const b = Math.max(0, halfToFloat(px[i + 2]));
      const lum = Math.max(KR * r + KG * g + KB * b, 1e-6);
      const logLum = Math.log2(lum);
      histogram[bin(logLum)]++;

      // Centre-weighted metering: the middle counts 2.5x the corners.
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const weight = 1 + 1.5 * Math.max(0, 1 - (dx * dx + dy * dy) / 2);
      weightedLog += weight * logLum;
      weightSum += weight;
      if (centreHistogram && x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centreHistogram[bin(logLum)]++;
        centreLog += logLum;
        centreCount++;
      }
      if (Math.max(r, g, b) >= 0.98) clipped++;

      // Colour judged on a display-like encoding, where saturation means what it looks like.
      const er = r ** (1 / 2.2);
      const eg = g ** (1 / 2.2);
      const eb = b ** (1 / 2.2);
      const hi = Math.max(er, eg, eb);
      const lo = Math.min(er, eg, eb);
      const sat = hi > 1e-4 ? (hi - lo) / hi : 0;
      chromaSum += sat;
      if (sat > 0.15 && hi > 0.1) {
        const hue = hueDegrees(er, eg, eb);
        if (hue >= 75 && hue <= 260) greenBlue++;
        else if ((hue >= 0 && hue <= 60) || (hue >= 330 && hue <= 360)) warm++;
      }

      if (useSkin) {
        const mx = Math.min(skin.width - 1, Math.trunc((x * skin.width) / w));
        const my = Math.min(skin.height - 1, Math.trunc((y * skin.height) / h));
        if (skin.data[my * skin.width + mx] > 0.5) {
          skinSum += lum;
          skinCount++;
        }
      }
    }
  }

  const n = w * h;
  const percentile = (p: number, hist: Int32Array = histogram, count: number = n): number => {
    const target = p * count;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return MIN_LOG + (b + 0.5) / BINS_PER_EV;
    }
    return MAX_LOG;
  };
  const metered = centreHistogram != null && centreCount > 0;
  let faceArea = 0;
  if (skin && skin.faceDiameterPx > 0) {
    const radius = skin.faceDiameterPx / 2;
    faceArea = Math.min(1, Math.max(0, (Math.PI * radius * radius) / (base.fullWidth * base.fullHeight)));
  }
  return new SceneStats(
    2 ** (metered ? centreLog / centreCount : weightedLog / weightSum),
    percentile(0.01),
    percentile(0.05),
    percentile(0.5),
    metered ? percentile(0.98, centreHistogram!, centreCount) : percentile(0.98),
    percentile(0.99),
    clipped / n,
    chromaSum / n,
    greenBlue / n,
    warm / n,
    faceArea,
    skinCount > 0 ? skinSum / skinCount : 0,
    iso,
    histogram,
  );
}
