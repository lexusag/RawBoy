import type { DevelopParams } from '../develop/DevelopParams';
import { Mat3, type M3 } from './Mat3';

/**
 * RGB primaries adjustment, after darktable's "rgb primaries" module (reimplemented from its description;
 * darktable is GPL). Port of color/Primaries.kt: each Rec.2020 primary is rotated in hue and pushed/pulled in
 * purity around the white point in CIE xy, and the white point itself can be tinted. One 3x3 matrix in
 * scene-linear light.
 */
const PRIMARIES = [
  [0.708, 0.292],
  [0.17, 0.797],
  [0.131, 0.046],
];
const WHITE = [0.3127, 0.329];

const XYZ_TO_REC2020: M3 = [
  1.716651188, -0.3556707838, -0.2533662814,
  -0.6666843518, 1.6164812366, 0.0157685458,
  0.0176398574, -0.0427706133, 0.9421031212,
];

/** Distance from the white point along (dx, dy) to the Rec.2020 triangle's edge. */
function distanceToGamutEdge(dx: number, dy: number): number {
  let best = Number.MAX_VALUE;
  for (let i = 0; i < 3; i++) {
    const a = PRIMARIES[i];
    const b = PRIMARIES[(i + 1) % 3];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const det = dx * -ey - dy * -ex;
    if (det === 0) continue;
    const wx = a[0] - WHITE[0];
    const wy = a[1] - WHITE[1];
    const t = (wx * -ey - wy * -ex) / det;
    const u = (dx * wy - dy * wx) / det;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

function rotateAndScale(index: number, scale: number, rotation: number): number[] {
  const p = PRIMARIES[index];
  const angle = Math.atan2(p[1] - WHITE[1], p[0] - WHITE[0]) + rotation;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const edge = distanceToGamutEdge(dx, dy);
  return [WHITE[0] + scale * edge * dx, WHITE[1] + scale * edge * dy];
}

function rgbToXyz(primaries: number[][], white: number[]): M3 {
  const xyz = (xy: number[]) => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
  const r = xyz(primaries[0]);
  const g = xyz(primaries[1]);
  const b = xyz(primaries[2]);
  const p = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const s = Mat3.apply(Mat3.inverse(p), xyz(white));
  return Mat3.multiply(p, Mat3.diagonal(s[0], s[1], s[2]));
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export const Primaries = {
  /** Slider values -> primaries matrix (identity when untouched). */
  fromParams(p: DevelopParams): M3 {
    const hues = [p.redHue, p.greenHue, p.blueHue].map(rad);
    // -200..200 -> purity x0.5 .. x2 (exponential, so +/- feel symmetric).
    const purities = [p.redPurity, p.greenPurity, p.bluePurity].map((v) => 2 ** (v / 200));
    const tintPurity = (p.tintPurity / 100) * 0.1; // full slider = 10% towards the gamut edge
    if (Primaries.isIdentity(hues, purities, tintPurity)) return Mat3.diagonal(1, 1, 1);
    return Primaries.matrix(hues, purities, rad(p.tintHue), tintPurity);
  },

  /** Row-major Rec.2020 -> Rec.2020 matrix (identity for the defaults). Hues and tintHue in radians. */
  matrix(hues: number[], purities: number[], tintHue: number, tintPurity: number): M3 {
    const custom = [0, 1, 2].map((i) => rotateAndScale(i, purities[i], hues[i]));
    const white = rotateAndScale(0, tintPurity, tintHue);
    return Mat3.multiply(XYZ_TO_REC2020, rgbToXyz(custom, white));
  },

  isIdentity: (hues: number[], purities: number[], tintPurity: number) =>
    hues.every((h) => h === 0) && purities.every((p) => p === 1) && tintPurity === 0,
};
