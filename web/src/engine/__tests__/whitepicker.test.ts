import { describe, expect, it } from 'vitest';
import { Mat3 } from '../color/Mat3';
import { WhiteBalance } from '../color/WhiteBalance';
import { WhitePicker, type WhitePick } from '../color/WhitePicker';
import { developParams } from '../develop/DevelopParams';
import type { PreviewImage } from '../gl/PreviewImage';
import { LensInfo } from '../lens/LensInfo';
import { LensTransform } from '../lens/LensTransform';
import { autoWhiteArea } from '../session/PhotoSession';
import { floatToHalf } from '../util/half';

// The same cases as WhitePickerTest.kt.
describe('white balance picker', () => {
  const developed = (rgb: number[], asShotK: number, asShotTint: number, kelvin: number, tint: number) =>
    Mat3.apply(
      WhiteBalance.rebalanceMatrix(WhiteBalance.xyFromTempTint(asShotK, asShotTint), WhiteBalance.xyFromTempTint(kelvin, tint)),
      rgb,
    );
  const patch = (r: number, g: number, b: number, n = 16) => Array.from({ length: n * 3 }, (_, i) => [r, g, b][i % 3]);
  const white = (p: WhitePick) => {
    if (p.kind !== 'white') throw new Error(`expected a white, got ${p.kind}`);
    return p;
  };

  it('a grey patch keeps the as-shot white', () => {
    const p = white(WhitePicker.pick(patch(0.18, 0.18, 0.18), 5200, 8));
    expect(Math.abs(p.kelvin - 5200)).toBeLessThan(2);
    expect(Math.abs(p.tint - 8)).toBeLessThan(0.2);
  });

  it('a tinted patch develops neutral', () => {
    for (const rgb of [[0.2, 0.17, 0.12], [0.1, 0.12, 0.16], [0.15, 0.17, 0.15]]) {
      const p = white(WhitePicker.pick(patch(rgb[0], rgb[1], rgb[2]), 5000, 0));
      const out = developed(rgb, 5000, 0, p.kelvin, p.tint);
      expect(Math.abs(out[0] / out[1] - 1)).toBeLessThan(0.003);
      expect(Math.abs(out[2] / out[1] - 1)).toBeLessThan(0.003);
    }
  });

  it('a warmer patch means a warmer light', () => {
    expect(white(WhitePicker.pick(patch(0.2, 0.17, 0.12), 5000, 0)).kelvin).toBeLessThan(5000);
  });

  it('leaves clipped pixels out', () => {
    const p = white(WhitePicker.pick([...patch(0.18, 0.18, 0.18, 4), ...patch(1, 0.6, 0.2, 12)], 5200, 0));
    expect(Math.abs(p.kelvin - 5200)).toBeLessThan(2);
    expect(WhitePicker.pick(patch(1, 1, 1), 5200, 0).kind).toBe('clipped');
  });

  it('black is not neutral', () => {
    expect(WhitePicker.pick(patch(0, 0, 0), 5200, 0).kind).toBe('notNeutral');
  });

  it('stays in the slider ranges', () => {
    const p = WhitePicker.pick(patch(0.3, 0.1, 0.02), 5000, 0);
    if (p.kind === 'white') {
      expect(p.kelvin).toBeGreaterThanOrEqual(WhiteBalance.MIN_KELVIN);
      expect(p.kelvin).toBeLessThanOrEqual(WhiteBalance.MAX_KELVIN);
      expect(Math.abs(p.tint)).toBeLessThanOrEqual(WhiteBalance.MAX_TINT);
    }
  });

  it('neutralises infrared casts (very red or magenta raws)', () => {
    for (const rgb of [[0.3, 0.1, 0.02], [0.3, 0.12, 0.2], [0.2, 0.1, 0.25]]) {
      const p = white(WhitePicker.pick(patch(rgb[0], rgb[1], rgb[2]), 5000, 0));
      const out = developed(rgb, 5000, 0, p.kelvin, p.tint);
      expect(Math.abs(out[0] / out[1] - 1)).toBeLessThan(0.003);
      expect(Math.abs(out[2] / out[1] - 1)).toBeLessThan(0.003);
    }
  });

  it('the locus below 1667 K joins Kim\'s continuously and round-trips', () => {
    const a = WhiteBalance.planckianXY(1666.9);
    const b = WhiteBalance.planckianXY(1667.1);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-4);
    for (const k of [1000, 1200, 1500]) {
      const xy = WhiteBalance.xyFromTempTint(k, -120);
      const [k2, t2] = WhiteBalance.tempTintFromXY(xy[0], xy[1]);
      expect(Math.abs(k2 - k)).toBeLessThan(0.5);
      expect(Math.abs(t2 + 120)).toBeLessThan(0.01);
    }
  });

  it('samples a small square around the tap, inside the image', () => {
    expect(WhitePicker.box(3000, 2000, 6000, 4000)).toEqual([2980, 3020, 1980, 2020]);
    expect(WhitePicker.box(0, 0, 6000, 4000)).toEqual([0, 40, 0, 40]);
  });

  it('pickFromSum solves for grey and reports clipped when empty', () => {
    const p = white(WhitePicker.pickFromSum(18, 18, 18, 100, 5200, 8));
    expect(Math.abs(p.kelvin - 5200)).toBeLessThan(2);
    expect(Math.abs(p.tint - 8)).toBeLessThan(0.2);
    expect(WhitePicker.pickFromSum(0, 0, 0, 0, 5200, 0)).toEqual({ kind: 'clipped' });
  });

  it('autoWhiteArea solves for the selected rectangle through crop and leaves clipped pixels out', () => {
    const w = 40;
    const h = 20;
    const pixels = new Uint16Array(w * h * 3);
    // Left half: warm [0.2, 0.17, 0.12]; right top: cool [0.1, 0.12, 0.16]; right bottom: clipped [1, 1, 1].
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rgb = x < w / 2 ? [0.2, 0.17, 0.12] : y < h / 2 ? [0.1, 0.12, 0.16] : [1, 1, 1];
        const idx = (y * w + x) * 3;
        pixels[idx] = floatToHalf(rgb[0]);
        pixels[idx + 1] = floatToHalf(rgb[1]);
        pixels[idx + 2] = floatToHalf(rgb[2]);
      }
    }
    const base: PreviewImage = { width: w, height: h, pixels, fullWidth: 400, fullHeight: 200 };
    const defaults = developParams({ temperature: 5000, tint: 0 });
    const fullLens = new LensTransform(LensInfo.none(400, 200), defaults);

    const leftPick = white(autoWhiteArea(base, 400, 200, fullLens, { left: 0.05, top: 0.1, right: 0.45, bottom: 0.9 }, defaults)!);
    const leftOut = developed([0.2, 0.17, 0.12], 5000, 0, leftPick.kelvin, leftPick.tint);
    expect(Math.abs(leftOut[0] / leftOut[1] - 1)).toBeLessThan(0.005);
    expect(Math.abs(leftOut[2] / leftOut[1] - 1)).toBeLessThan(0.005);

    // Selecting the entire right half skips the clipped bottom quadrant and neutralises the cool top quadrant.
    const rightPick = white(autoWhiteArea(base, 400, 200, fullLens, { left: 0.55, top: 0.05, right: 0.95, bottom: 0.95 }, defaults)!);
    const rightOut = developed([0.1, 0.12, 0.16], 5000, 0, rightPick.kelvin, rightPick.tint);
    expect(Math.abs(rightOut[0] / rightOut[1] - 1)).toBeLessThan(0.005);
    expect(Math.abs(rightOut[2] / rightOut[1] - 1)).toBeLessThan(0.005);

    // Selecting only the clipped quadrant reports clipped.
    expect(autoWhiteArea(base, 400, 200, fullLens, { left: 0.55, top: 0.55, right: 0.95, bottom: 0.95 }, defaults)).toEqual({ kind: 'clipped' });

    // Cropped to the right half: a full-output rectangle [0.1..0.9] now samples only the right half.
    const croppedLens = new LensTransform(LensInfo.none(400, 200), developParams({ cropLeft: 0.5, cropRight: 1, cropTop: 0, cropBottom: 0.5 }));
    const croppedPick = white(autoWhiteArea(base, 400, 200, croppedLens, { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }, defaults)!);
    expect(Math.abs(croppedPick.kelvin - rightPick.kelvin)).toBeLessThan(5);
  });
});
