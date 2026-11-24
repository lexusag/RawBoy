import { describe, expect, it } from 'vitest';
import { computeGuidedDepth, guidedDepthEps } from '../gl/GuidedDepth';
import type { PreviewImage } from '../gl/PreviewImage';
import { floatToHalf } from '../util/half';

function makeBase(w: number, h: number, rgbAt: (x: number, y: number) => [number, number, number]): PreviewImage {
  const pixels = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(x, y);
      const o = (y * w + x) * 3;
      pixels[o] = floatToHalf(r);
      pixels[o + 1] = floatToHalf(g);
      pixels[o + 2] = floatToHalf(b);
    }
  }
  return { width: w, height: h, pixels, fullWidth: w * 8, fullHeight: h * 8 };
}

/** Evaluates the shader formula `clamp(dot(ab.rgb, sqrt(max(rgb, 0))) + ab.a, 0, 1)` with bilinear lookup of `coeffs`. */
function evalShaderDepth(
  coeffs: Float32Array,
  w: number,
  h: number,
  u: number,
  v: number,
  rgb: [number, number, number],
): number {
  const fx = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const fy = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const sample = (c: number) => {
    const c00 = coeffs[(y0 * w + x0) * 4 + c];
    const c10 = coeffs[(y0 * w + x1) * 4 + c];
    const c01 = coeffs[(y1 * w + x0) * 4 + c];
    const c11 = coeffs[(y1 * w + x1) * 4 + c];
    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
  };
  const gr = Math.sqrt(Math.max(rgb[0], 0));
  const gg = Math.sqrt(Math.max(rgb[1], 0));
  const gb = Math.sqrt(Math.max(rgb[2], 0));
  const d = sample(0) * gr + sample(1) * gg + sample(2) * gb + sample(3);
  return Math.max(0, Math.min(1, d));
}

describe('GuidedDepth', () => {
  it('falls back to (0, 0, 0, d) when base is null', () => {
    const data = new Uint8Array([0, 128, 255, 64]);
    const out = computeGuidedDepth({ width: 2, height: 2, data, hardware: false, subjectDetected: false, focusDepth: 0.2 }, null, 0.3);
    for (let i = 0; i < 4; i++) {
      expect(out[i * 4]).toBe(0);
      expect(out[i * 4 + 1]).toBe(0);
      expect(out[i * 4 + 2]).toBe(0);
      expect(out[i * 4 + 3]).toBeCloseTo(data[i] / 255, 5);
    }
  });

  it('produces zero slope and exact depth on uniform depth maps', () => {
    const w = 16, h = 16;
    const data = new Uint8Array(w * h).fill(153); // 0.6
    const base = makeBase(w, h, (x, y) => [0.1 + 0.03 * x, 0.2 + 0.02 * y, 0.5]);
    const coeffs = computeGuidedDepth({ width: w, height: h, data, hardware: false, subjectDetected: false, focusDepth: 0.2 }, base, 0.3);
    for (let i = 0; i < w * h; i++) {
      expect(coeffs[i * 4]).toBeCloseTo(0, 4);
      expect(coeffs[i * 4 + 1]).toBeCloseTo(0, 4);
      expect(coeffs[i * 4 + 2]).toBeCloseTo(0, 4);
      expect(coeffs[i * 4 + 3]).toBeCloseTo(153 / 255, 4);
    }
  });

  it('tracks a diagonal step edge cleanly at full resolution without stair-stepping', () => {
    const w = 32, h = 32;
    const fgRgb: [number, number, number] = [0.05, 0.05, 0.05];
    const bgRgb: [number, number, number] = [0.8, 0.8, 0.8];
    const fgDepth = 0.2;
    const bgDepth = 0.9;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data[y * w + x] = Math.round((x + 0.5 < y + 0.5 ? fgDepth : bgDepth) * 255);
      }
    }
    const base = makeBase(w, h, (x, y) => (x + 0.5 < y + 0.5 ? fgRgb : bgRgb));
    const coeffs = computeGuidedDepth({ width: w, height: h, data, hardware: false, subjectDetected: true, focusDepth: fgDepth }, base, 0.3);

    // Sample sub-texel points right beside the diagonal y = x (0.25 texels on each side):
    // Bilinear depth alone would give ~0.55 on both sides; guided depth separates cleanly.
    for (let k = 8; k <= 24; k++) {
      const uFg = (k - 0.25) / w;
      const vFg = (k + 0.25) / h;
      const dFg = evalShaderDepth(coeffs, w, h, uFg, vFg, fgRgb);
      expect(dFg).toBeLessThan(0.26);

      const uBg = (k + 0.25) / w;
      const vBg = (k - 0.25) / h;
      const dBg = evalShaderDepth(coeffs, w, h, uBg, vBg, bgRgb);
      expect(dBg).toBeGreaterThan(0.84);

      // An anti-aliased pixel right on the edge gets a smooth intermediate depth.
      const midRgb: [number, number, number] = [0.425, 0.425, 0.425];
      const dMid = evalShaderDepth(coeffs, w, h, k / w, k / h, midRgb);
      expect(dMid).toBeGreaterThan(dFg + 0.15);
      expect(dMid).toBeLessThan(dBg - 0.15);
    }
  });

  it('separates isoluminant colour edges using 3-channel RGB guidance', () => {
    const w = 24, h = 24;
    // Same luminance, opposite chromaticity (red vs green).
    const red: [number, number, number] = [0.7, 0.05, 0.05];
    const green: [number, number, number] = [0.05, 0.35, 0.05];
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) data[y * w + x] = x < w / 2 ? 51 : 230;
    }
    const base = makeBase(w, h, (x) => (x < w / 2 ? red : green));
    const coeffs = computeGuidedDepth({ width: w, height: h, data, hardware: false, subjectDetected: true, focusDepth: 0.2 }, base, 0.3);

    const dLeft = evalShaderDepth(coeffs, w, h, (w / 2 - 0.2) / w, 0.5, red);
    const dRight = evalShaderDepth(coeffs, w, h, (w / 2 + 0.2) / w, 0.5, green);
    expect(dLeft).toBeLessThan(0.28);
    expect(dRight).toBeGreaterThan(0.82);
  });

  it('preserves smooth continuous ramps on receding surfaces', () => {
    const w = 32, h = 16;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) data[y * w + x] = Math.round(((x + 0.5) / w) * 255);
    }
    const base = makeBase(w, h, () => [0.3, 0.3, 0.3]);
    const coeffs = computeGuidedDepth({ width: w, height: h, data, hardware: false, subjectDetected: false, focusDepth: 0.2 }, base, 0.3);

    let prev = -1;
    for (let x = 8; x <= 23; x++) {
      const d = evalShaderDepth(coeffs, w, h, (x + 0.5) / w, 0.5, [0.3, 0.3, 0.3]);
      expect(d).toBeGreaterThan(prev);
      expect(d).toBeCloseTo((x + 0.5) / w, 2);
      prev = d;
    }
  });

  it('increases regularization smoothly with edge softness', () => {
    expect(guidedDepthEps(0)).toBeCloseTo(3e-4, 6);
    expect(guidedDepthEps(0.3)).toBeGreaterThan(guidedDepthEps(0));
    expect(guidedDepthEps(1)).toBeCloseTo(3e-2, 5);
  });
});
