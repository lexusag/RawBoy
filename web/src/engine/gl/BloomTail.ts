import { floatToHalf, halfToFloat } from '../util/half';
import type { PreviewImage } from './PreviewImage';

/**
 * Bloom's wide tail, scattered once per photo on its small (~64 px) copy: a round power law (alpha 2.2, knee
 * 0.6 texel) out to 7 texels (~10% of the long edge), its weights falling to zero at the rim. The develop shader
 * samples the result as a B-spline, so the glow is smooth: summed per pixel from a bilinear copy, the coarse
 * texels showed as bands and squares. Port of BloomTail.kt.
 */
export const BLOOM_TAIL_RADIUS = 6;

/** Tap offsets and their weights, summing to 1. */
const taps = (() => {
  const dx: number[] = [];
  const dy: number[] = [];
  const ws: number[] = [];
  const rim2 = (BLOOM_TAIL_RADIUS + 1) * (BLOOM_TAIL_RADIUS + 1);
  for (let j = -BLOOM_TAIL_RADIUS; j <= BLOOM_TAIL_RADIUS; j++) {
    for (let i = -BLOOM_TAIL_RADIUS; i <= BLOOM_TAIL_RADIUS; i++) {
      const r2 = i * i + j * j;
      const rim = 1 - r2 / rim2;
      if (rim <= 0) continue;
      dx.push(i);
      dy.push(j);
      ws.push((1 + Math.sqrt(r2) / 0.6) ** -2.2 * rim * rim);
    }
  }
  const sum = ws.reduce((a, b) => a + b, 0);
  return { dx, dy, weight: Float32Array.from(ws, (w) => w / sum) };
})();

/** `img` (half-float RGB) scattered by the tail kernel, edges clamped. */
export function scatterBloomTail(img: PreviewImage): PreviewImage {
  const { width: w, height: h } = img;
  const rgb = Float32Array.from(img.pixels, halfToFloat);
  const out = new Uint16Array(w * h * 3);
  const { dx, dy, weight } = taps;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < weight.length; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + dy[k]));
        const sx = Math.min(w - 1, Math.max(0, x + dx[k]));
        const o = (sy * w + sx) * 3;
        r += weight[k] * rgb[o];
        g += weight[k] * rgb[o + 1];
        b += weight[k] * rgb[o + 2];
      }
      const o = (y * w + x) * 3;
      out[o] = floatToHalf(r);
      out[o + 1] = floatToHalf(g);
      out[o + 2] = floatToHalf(b);
    }
  }
  return { ...img, pixels: out };
}
