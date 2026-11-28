import type { PreviewImage } from '../gl/PreviewImage';
import { halfToFloat } from '../util/half';

/**
 * The censor brush's eyedropper: a colour of the photo, as it develops, picked from the session preview (scene-linear
 * Rec.2020) and taken through the develop's white balance, exposure, contrast and AgX curve to display sRGB. It is the
 * forward of censor.frag's `displayToScene` (per channel, no AgX matrices, LUTs or film), so a picked colour painted
 * back reads as the same colour.
 */

const MIN_EV = -12.47393;
const MAX_EV = 4.026069;
const PIVOT = (-2.4739311883324122 - MIN_EV) / (MAX_EV - MIN_EV);

/** AgX's display curve (develop.glsl's polynomial), as in censor.frag. */
export function agxCurve(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

const REC2020_TO_REC709 = [
  [1.660491, -0.587641, -0.072850],
  [-0.124550, 1.132900, -0.008349],
  [-0.018151, -0.100579, 1.118730],
];

const encode = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

/** Scene-linear Rec.2020 [rgb] → display sRGB 0..1 through [whiteBalance] (column-major 3x3), [exposure] and [contrast]. */
export function sceneToDisplay(rgb: readonly number[], whiteBalance: ArrayLike<number>, exposure: number, contrast: number): [number, number, number] {
  const wb = whiteBalance;
  const bal = [0, 1, 2].map((r) => wb[r] * rgb[0] + wb[3 + r] * rgb[1] + wb[6 + r] * rgb[2]);
  const disp = bal.map((v) => {
    const ev = Math.log2(Math.max(v * exposure, 1e-10));
    let x = (ev - MIN_EV) / (MAX_EV - MIN_EV);
    x = (x - PIVOT) * Math.max(contrast, 0.05) + PIVOT;
    return Math.max(0, agxCurve(Math.min(1, Math.max(0, x)))) ** 2.2;
  });
  const out = REC2020_TO_REC709.map((row) => encode(row[0] * disp[0] + row[1] * disp[1] + row[2] * disp[2]));
  return [out[0], out[1], out[2]];
}

/** The mean scene colour of [preview] in a box of [radius] (fraction of the long side) around image fractions (x, y). */
export function samplePreview(preview: PreviewImage, x: number, y: number, radius = 0.004): [number, number, number] {
  const { width: w, height: h, pixels } = preview;
  const r = Math.max(0, Math.round(radius * Math.max(w, h)));
  const cx = Math.round(x * (w - 1));
  const cy = Math.round(y * (h - 1));
  const sum = [0, 0, 0];
  let n = 0;
  for (let py = Math.max(0, cy - r); py <= Math.min(h - 1, cy + r); py++) {
    for (let px = Math.max(0, cx - r); px <= Math.min(w - 1, cx + r); px++) {
      const i = (py * w + px) * 3;
      sum[0] += halfToFloat(pixels[i]);
      sum[1] += halfToFloat(pixels[i + 1]);
      sum[2] += halfToFloat(pixels[i + 2]);
      n++;
    }
  }
  return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [0, 0, 0];
}
