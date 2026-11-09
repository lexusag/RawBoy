import { describe, expect, it } from 'vitest';
import type { PreviewImage } from '../gl/PreviewImage';
import { buildRetouchMap, fromLab, gauss, minFilter, skinFixOf, toLab } from '../retouch/PortraitRetouch';
import type { SkinMask } from '../retouch/SkinMask';
import { floatToHalf } from '../util/half';

const W = 400;
const H = 400;
const FACE = 300; // face width in pixels: landmarks spread over it

/** Even skin-coloured image (linear Rec.2020) with [spots]: (x, y, radius, brightness factor). */
function image(spots: [number, number, number, number][]): PreviewImage {
  const pixels = new Uint16Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let f = 1;
      for (const [sx, sy, r, k] of spots) if ((x - sx) ** 2 + (y - sy) ** 2 <= r * r) f = k;
      const i = (y * W + x) * 3;
      pixels[i] = floatToHalf(0.3 * f);
      pixels[i + 1] = floatToHalf(0.2 * f);
      pixels[i + 2] = floatToHalf(0.15 * f);
    }
  }
  return { width: W, height: H, pixels, fullWidth: W, fullHeight: H };
}

/** Skin everywhere, one face whose 478 landmarks spread over FACE pixels (only their extent matters here). */
function skin(): SkinMask {
  const face = new Float32Array(478 * 2);
  for (let i = 0; i < 478; i++) {
    face[i * 2] = (50 + (FACE * i) / 477) / W;
    face[i * 2 + 1] = 0.05; // regions (under-eyes, lines) up at the top edge, away from the spots
  }
  const data = new Float32Array(100 * 100).fill(1);
  return { width: 100, height: 100, data, sigmaPx: 4, hasSkin: true, faceDiameterPx: FACE, face: data, faces: [face] };
}

const gainAt = (m: { width: number; data: Float32Array }, x: number, y: number) => m.data[(y * m.width + x) * 4 + 2];

describe('PortraitRetouch', () => {
  it('heals a small dark spot and leaves even skin alone', () => {
    const map = buildRetouchMap(image([[200, 250, 2, 0.6]]), skin(), 40)!;
    expect(map.width).toBe(W);
    expect(gainAt(map, 200, 250)).toBeGreaterThan(0.2); // lifted toward the surrounding skin (0.74 EV down)
    expect(Math.abs(gainAt(map, 100, 300))).toBeLessThan(0.01);
    expect(map.data[(300 * W + 100) * 4]).toBeCloseTo(1, 3); // the skin mask rides along in r
  });

  it('keeps moles (very dark, sharp)', () => {
    const map = buildRetouchMap(image([[200, 250, 3, 0.2]]), skin(), 40)!;
    expect(gainAt(map, 200, 250)).toBeLessThan(0.1);
  });

  it('heals more at higher strength', () => {
    const img = image([[200, 250, 2, 0.75]]);
    expect(gainAt(buildRetouchMap(img, skin(), 80)!, 200, 250)).toBeGreaterThan(gainAt(buildRetouchMap(img, skin(), 20)!, 200, 250));
  });

  it('is off without strength or skin', () => {
    expect(buildRetouchMap(image([]), skin(), 0)).toBeNull();
    expect(buildRetouchMap(image([]), { ...skin(), hasSkin: false }, 40)).toBeNull();
    expect(skinFixOf(0, null)).toBe(0);
    expect(skinFixOf(60, { width: 1, height: 1, data: new Float32Array(4), strength: 40 })).toBeCloseTo(1.5);
  });

  it('has helpers that agree with their definitions', () => {
    const [r, g, b] = fromLab(...toLab(0.3, 0.2, 0.15));
    expect([r, g, b].map((v) => +v.toFixed(4))).toEqual([0.3, 0.2, 0.15]);
    const impulse = new Float32Array(61 * 61);
    impulse[30 * 61 + 30] = 1;
    for (const s of [1.5, 6]) {
      const g2 = gauss(impulse, 61, 61, s);
      expect(g2.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 4);
      // Variance along x matches sigma² within the box approximation.
      let v = 0;
      for (let y = 0; y < 61; y++) for (let x = 0; x < 61; x++) v += g2[y * 61 + x] * (x - 30) ** 2;
      expect(Math.sqrt(v)).toBeCloseTo(s, 0);
    }
    const bin = new Float32Array(9 * 9).fill(1);
    bin[4 * 9 + 4] = 0;
    const er = minFilter(bin, 9, 9, 1);
    expect(er[3 * 9 + 3]).toBe(0);
    expect(er[2 * 9 + 2]).toBe(1);
  });
});
