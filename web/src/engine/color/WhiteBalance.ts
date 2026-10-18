import { Mat3, type M3 } from './Mat3';

/**
 * Temperature/tint <-> chromaticity conversion and the Bradford re-balancing matrix used by the shader
 * (port of color/WhiteBalance.kt). Matrices are row-major arrays of 9.
 */
const LOCUS_MIN_K = 1667;
const LOCUS_MAX_K = 25000;
/** Below Kim's range, Krystek's approximation (valid from 1000 K) takes over. */
const LOCUS_LOW_K = 1000;

/**
 * Duv per tint unit. Tint follows Lightroom: it names the illuminant's offset from the locus, positive = green
 * (above it). So + Tint on the slider (assuming greener light) makes the image more magenta.
 */
const TINT_SCALE = 0.00025;

const REC2020_TO_XYZ: M3 = [
  0.6369580483, 0.1446169036, 0.1688809752,
  0.262700212, 0.6779980715, 0.0593017165,
  0.0, 0.028072693, 1.0609850577,
];
const XYZ_TO_REC2020: M3 = [
  1.716651188, -0.3556707838, -0.2533662814,
  -0.6666843518, 1.6164812366, 0.0157685458,
  0.0176398574, -0.0427706133, 0.9421031212,
];
const BRADFORD: M3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = Mat3.inverse(BRADFORD);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Planckian locus chromaticity: Kim et al. 2002 from 1667 K; below, down to 1000 K, Krystek 1985 shifted to meet Kim's
 * at 1667 K (so the locus stays continuous and nothing above 1667 K changes).
 */
function planckianXY(kelvin: number): number[] {
  const t = clamp(kelvin, LOCUS_LOW_K, LOCUS_MAX_K);
  if (t >= LOCUS_MIN_K) return kimXY(t);
  const k = krystekUV(t);
  const k0 = krystekUV(LOCUS_MIN_K);
  const kimXy = kimXY(LOCUS_MIN_K);
  const kim = xyToUV(kimXy[0], kimXy[1]);
  return uvToXY(k[0] - k0[0] + kim[0], k[1] - k0[1] + kim[1]);
}

/** Krystek's rational approximation of the Planckian locus in CIE 1960 uv (1000 K..15000 K). */
function krystekUV(t: number): number[] {
  const t2 = t * t;
  return [
    (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2) / (1 + 8.42420235e-4 * t + 7.08145163e-7 * t2),
    (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t2),
  ];
}

function kimXY(t: number): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    t <= 4000
      ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039;
  const x2 = x * x;
  const x3 = x2 * x;
  const y =
    t <= 2222
      ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

// CIE 1960 UCS
function xyToUV(x: number, y: number): number[] {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}

function uvToXY(u: number, v: number): number[] {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

function locusUV(mired: number): number[] {
  const xy = planckianXY(1e6 / mired);
  return xyToUV(xy[0], xy[1]);
}

/** Unit normal of the locus pointing above it (towards green). */
function locusNormal(mired: number): number[] {
  const a = locusUV(mired - 0.5);
  const b = locusUV(mired + 0.5);
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  const len = Math.hypot(du, dv);
  return [-dv / len, du / len];
}

const xyToXYZ = (xy: number[]) => [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];

export const WhiteBalance = {
  /** Down to 1000 K so infrared photos (very red raws) can be neutralised. */
  MIN_KELVIN: 1000,
  MAX_KELVIN: 12000,
  /** The Tint slider's range is -MAX_TINT..MAX_TINT (wider than Lightroom's 100, for infrared photos). */
  MAX_TINT: 250,
  planckianXY,

  xyFromTempTint(kelvin: number, tint: number): number[] {
    const mired = 1e6 / clamp(kelvin, LOCUS_LOW_K, LOCUS_MAX_K);
    const uv = locusUV(mired);
    const n = locusNormal(mired);
    const duv = tint * TINT_SCALE;
    return uvToXY(uv[0] + n[0] * duv, uv[1] + n[1] * duv);
  },

  /** Returns [kelvin, tint] for a white chromaticity. */
  tempTintFromXY(x: number, y: number): number[] {
    const p = xyToUV(x, y);
    const minMired = 1e6 / LOCUS_MAX_K;
    const maxMired = 1e6 / LOCUS_LOW_K;
    const dist = (m: number) => {
      const uv = locusUV(m);
      return Math.hypot(p[0] - uv[0], p[1] - uv[1]);
    };
    // Coarse scan, then golden-section refinement around the best sample.
    let best = minMired;
    for (let m = minMired; m <= maxMired; m += 2) if (dist(m) < dist(best)) best = m;
    let lo = Math.max(best - 2, minMired);
    let hi = Math.min(best + 2, maxMired);
    const g = 0.6180339887498949;
    for (let i = 0; i < 40; i++) {
      const a = hi - g * (hi - lo);
      const b = lo + g * (hi - lo);
      if (dist(a) < dist(b)) hi = b;
      else lo = a;
    }
    const mired = (lo + hi) / 2;
    const uv = locusUV(mired);
    const n = locusNormal(mired);
    const duv = (p[0] - uv[0]) * n[0] + (p[1] - uv[1]) * n[1];
    return [1e6 / mired, duv / TINT_SCALE];
  },

  /** Rec.2020 -> Rec.2020 matrix that re-balances an image balanced for [asShotXY] so [targetXY] becomes neutral. */
  rebalanceMatrix(asShotXY: number[], targetXY: number[]): M3 {
    const lmsAsShot = Mat3.apply(BRADFORD, xyToXYZ(asShotXY));
    const lmsTarget = Mat3.apply(BRADFORD, xyToXYZ(targetXY));
    const scale = Mat3.diagonal(lmsAsShot[0] / lmsTarget[0], lmsAsShot[1] / lmsTarget[1], lmsAsShot[2] / lmsTarget[2]);
    const cat = Mat3.multiply(BRADFORD_INV, Mat3.multiply(scale, BRADFORD));
    return Mat3.multiply(XYZ_TO_REC2020, Mat3.multiply(cat, REC2020_TO_XYZ));
  },

  /**
   * The white balance picker: [kelvin, tint] (clamped to the sliders' ranges) that render [rgb] neutral grey. [rgb]
   * is a patch of the decoded image (linear Rec.2020, balanced for the as-shot white), before the shader's white
   * balance. Null when no white makes it grey (black, or a saturated colour).
   *
   * Solves rebalanceMatrix(asShot, target) x rgb = k (1, 1, 1): in Bradford LMS the matrix is a diagonal scale
   * asShot / target, so target = asShot x lms(rgb) / lms(1, 1, 1) per cone.
   */
  neutralTempTint(asShotKelvin: number, asShotTint: number, rgb: number[]): number[] | null {
    const sample = Mat3.apply(BRADFORD, Mat3.apply(REC2020_TO_XYZ, rgb));
    const grey = Mat3.apply(BRADFORD, Mat3.apply(REC2020_TO_XYZ, [1, 1, 1]));
    const asShot = Mat3.apply(BRADFORD, xyToXYZ(WhiteBalance.xyFromTempTint(asShotKelvin, asShotTint)));
    const lms = [0, 1, 2].map((i) => (asShot[i] * sample[i]) / grey[i]);
    if (!lms.every((v) => v > 0)) return null;
    const xyz = Mat3.apply(BRADFORD_INV, lms);
    const sum = xyz[0] + xyz[1] + xyz[2];
    if (!(xyz[1] > 0) || !(sum > 0)) return null;
    const [k, tint] = WhiteBalance.tempTintFromXY(xyz[0] / sum, xyz[1] / sum);
    return [clamp(k, WhiteBalance.MIN_KELVIN, WhiteBalance.MAX_KELVIN), clamp(tint, -WhiteBalance.MAX_TINT, WhiteBalance.MAX_TINT)];
  },
};
