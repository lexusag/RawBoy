import { meterBox, meterSpot } from '../auto/analysis/MeterArea';
import { WhiteBalance } from './WhiteBalance';

/**
 * Pro's white balance picker (port of WhitePicker.kt): the user taps something neutral grey and the temperature and
 * tint are set so it renders grey. Samples the decoded image (linear, as-shot balanced, before any develop step),
 * averaged over a small square so noise and texture don't decide the result.
 */
export const WhitePicker = {
  /** Side of the averaged square, as a fraction of the image's short side (~40 px on a 24 MP photo). */
  SPOT_SIZE: 0.01,
  /** Pixels with a channel at or above this (1.0 = sensor clip) are left out: blown highlights aren't neutral. */
  CLIP: 0.95,

  /** Full-resolution box [x0, x1, y0, y1) to sample around image pixel (x, y), kept inside the image. */
  box(x: number, y: number, width: number, height: number): [number, number, number, number] {
    return meterBox(meterSpot(x / width, y / height, WhitePicker.SPOT_SIZE), width, height);
  },

  /** rgb: the box's pixels (RGB triplets, linear Rec.2020 as decoded); as-shot white from the photo's defaults. */
  pick(rgb: ArrayLike<number>, asShotKelvin: number, asShotTint: number): WhitePick {
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i + 2 < rgb.length; i += 3) {
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      if (r >= WhitePicker.CLIP || g >= WhitePicker.CLIP || b >= WhitePicker.CLIP) continue;
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      n++;
    }
    if (n === 0) return { kind: 'clipped' };
    const wb = WhiteBalance.neutralTempTint(asShotKelvin, asShotTint, sum.map((v) => v / n));
    return wb ? { kind: 'white', kelvin: wb[0], tint: wb[1] } : { kind: 'notNeutral' };
  },
};

export type WhitePick =
  | { kind: 'white'; kelvin: number; tint: number }
  /** Every pixel in the square is clipped. */
  | { kind: 'clipped' }
  /** No white balance makes the spot grey (black, or a strongly saturated colour). */
  | { kind: 'notNeutral' };
