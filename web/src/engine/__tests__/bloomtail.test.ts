import { describe, expect, it } from 'vitest';
import { BLOOM_TAIL_BANDS, bloomKnee, scatterBloomTail } from '../gl/BloomTail';
import { floatToHalf, halfToFloat } from '../util/half';

describe('floatToHalf', () => {
  it('round-trips every finite half', () => {
    for (let h = 0; h < 0x7c00; h++) {
      expect(floatToHalf(halfToFloat(h))).toBe(h);
      expect(floatToHalf(halfToFloat(h | 0x8000))).toBe(h | 0x8000);
    }
  });
  it('rounds to nearest even and saturates to infinity', () => {
    expect(floatToHalf(1 + 2 ** -11)).toBe(0x3c00); // halfway, even stays
    expect(floatToHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(floatToHalf(70000)).toBe(0x7c00);
    expect(floatToHalf(2 ** -26)).toBe(0);
  });
});

describe('scatterBloomTail', () => {
  const w = 64;
  const h = 43;
  const image = (put: (x: number, y: number) => number) => {
    const pixels = new Uint16Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.fill(floatToHalf(put(x, y)), (y * w + x) * 3, (y * w + x) * 3 + 3);
    return { width: w, height: h, pixels, fullWidth: 4000, fullHeight: 2687 };
  };
  const at = (p: Uint16Array, x: number, y: number) => halfToFloat(p[(y * w + x) * 3]);

  it('keeps a flat image flat in every band, kneed at its exposure', () => {
    const out = scatterBloomTail(image(() => 0.5));
    expect(out.height).toBe(h * BLOOM_TAIL_BANDS);
    for (let band = 0; band < BLOOM_TAIL_BANDS; band++) {
      const want = 0.5 * bloomKnee(0.5, 0.5, 0.5, 2 ** band);
      for (let i = band * w * h * 3; i < (band + 1) * w * h * 3; i++) expect(halfToFloat(out.pixels[i])).toBeCloseTo(want, 3);
    }
  });

  it('scatters only the highlights', () => {
    expect(bloomKnee(0.18, 0.18, 0.18, 1)).toBe(0); // middle grey
    expect(bloomKnee(0.3, 0.45, 0.2, 2)).toBeCloseTo(0.5, 6); // the brightest channel x exposure, halfway: 2.3 EV over grey
    expect(bloomKnee(1, 1, 1, 2)).toBe(1);
    // A midtone wall with a lamp: band 0 holds the lamp's glow alone; brighter bands lift the wall into it.
    const out = scatterBloomTail(image((x, y) => (x === 32 && y === 21 ? 100 : 0.1))).pixels;
    expect(at(out, 2, 2)).toBe(0);
    expect(at(out, 33, 21)).toBeGreaterThan(0.5);
    expect(at(out, 2, 2 + 4 * h)).toBeCloseTo(0.1 * bloomKnee(0.1, 0.1, 0.1, 16), 3);
  });

  it('spreads a point light into a round glow that keeps its energy', () => {
    const out = scatterBloomTail(image((x, y) => (x === 32 && y === 21 ? 100 : 0))).pixels;
    let sum = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sum += at(out, x, y);
    expect(sum).toBeCloseTo(100, 0);
    expect(at(out, 32, 21)).toBeGreaterThan(at(out, 33, 21)); // dense next to the light
    expect(at(out, 36, 21)).toBeCloseTo(at(out, 32, 25), 6); // round: same on both axes
    expect(at(out, 35, 25)).toBeCloseTo(at(out, 37, 21), 1); // r 5 diagonal vs r 5 axis, within the kernel's lattice
    expect(at(out, 39, 21)).toBe(0); // nothing past the rim
  });
});
