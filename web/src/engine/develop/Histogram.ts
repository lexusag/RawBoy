export const HISTOGRAM_BINS = 64;

/**
 * RGB histogram of a developed 8-bit image (Pro's histogram), HISTOGRAM_BINS bins per channel, with the share of
 * clipped pixels: highlights have a channel at 255, shadows every channel at 1 or below. The shader's clipping warning
 * (clipWarning in develop.glsl) marks the same pixels. Port of develop/Histogram.kt.
 */
export interface Histogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  /** Fraction 0..1 of pixels with a channel at 255. */
  highlights: number;
  /** Fraction 0..1 of pixels with every channel at 1 or below. */
  shadows: number;
  /** Largest bin, ignoring the two end bins (a clipped spike there would flatten everything else). */
  peak: number;
}

/** From RGBA bytes (ImageData.data). */
export function histogramFromRgba(rgba: Uint8ClampedArray | Uint8Array): Histogram {
  const r = new Uint32Array(HISTOGRAM_BINS);
  const g = new Uint32Array(HISTOGRAM_BINS);
  const b = new Uint32Array(HISTOGRAM_BINS);
  let high = 0;
  let low = 0;
  const n = rgba.length >> 2;
  for (let i = 0; i < n; i++) {
    const pr = rgba[i * 4];
    const pg = rgba[i * 4 + 1];
    const pb = rgba[i * 4 + 2];
    r[(pr * HISTOGRAM_BINS) >> 8]++;
    g[(pg * HISTOGRAM_BINS) >> 8]++;
    b[(pb * HISTOGRAM_BINS) >> 8]++;
    const m = Math.max(pr, pg, pb);
    if (m === 255) high++;
    else if (m <= 1) low++;
  }
  const inner = (bins: Uint32Array) => Math.max(...bins.subarray(1, HISTOGRAM_BINS - 1));
  const total = Math.max(1, n);
  return { red: r, green: g, blue: b, highlights: high / total, shadows: low / total, peak: Math.max(1, inner(r), inner(g), inner(b)) };
}
