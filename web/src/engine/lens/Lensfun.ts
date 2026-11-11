import type { RadialVignette, Warp } from './LensInfo';

/**
 * Lens corrections from the Lensfun database (https://lensfun.github.io, database CC BY-SA 3.0; see
 * web/public/lensfun/README.txt). RawBoy does not use Lensfun's LGPL code: this file re-implements the documented
 * calibration models (ptlens / poly3 / poly5 distortion, linear / poly3 lateral CA, "pa" vignetting) and their
 * rescaling to the photo's sensor, then fits the result into the structures the develop shader already has for
 * DNG opcodes (WarpRectilinear per colour plane, FixVignetteRadial), so there is no shader change.
 *
 * Data: public/lensfun/index.json (cameras, lenses) and calib-<file>.json (calibrations of the lenses of one upstream
 * XML file), made by tools/lensfun/convert.mjs; the calibrations are fetched only for the lens in use.
 */

/** Lens projection types in the database's order (index.json `types`). */
export const LENS_TYPES = ['rectilinear', 'fisheye', 'panoramic', 'equirectangular', 'orthographic', 'stereographic', 'equisolid'] as const;
export type LensType = (typeof LENS_TYPES)[number];
export const FISHEYE_TYPES: readonly LensType[] = ['fisheye', 'orthographic', 'stereographic', 'equisolid'];

export interface LensfunCamera {
  maker: string;
  model: string;
  variant: string;
  mount: string;
  crop: number;
}

export interface LensfunLens {
  /** Position in the database, the key of its calibrations. */
  id: number;
  maker: string;
  model: string;
  mounts: string[];
  crop: number;
  aspect: number;
  type: LensType;
  minFocal: number;
  maxFocal: number;
  minAperture: number;
  maxAperture: number;
  chunk: number;
  /** Which calibrations exist. */
  hasDistortion: boolean;
  hasTca: boolean;
  hasVignetting: boolean;
}

export interface LensfunIndex {
  source: { commit: string; date: string };
  mounts: Record<string, string[]>;
  cameras: LensfunCamera[];
  lenses: LensfunLens[];
  chunks: string[];
}

/** index.json as written by the converter. */
export interface RawIndex {
  format: number;
  source: { commit: string; date: string };
  types: string[];
  mounts: Record<string, string[]>;
  cameras: [string, string, string, string, number][];
  lenses: [string, string, string[], number, number, number, number, number, number, number, number, number][];
  chunks: string[];
}

export function parseIndex(raw: RawIndex): LensfunIndex {
  return {
    source: raw.source,
    mounts: raw.mounts,
    cameras: raw.cameras.map(([maker, model, variant, mount, crop]) => ({ maker, model, variant, mount, crop })),
    lenses: raw.lenses.map(([maker, model, mounts, crop, aspect, type, minFocal, maxFocal, minAperture, maxAperture, chunk, flags], id) => ({
      id, maker, model, mounts, crop, aspect, type: LENS_TYPES[type] ?? 'rectilinear', minFocal, maxFocal, minAperture, maxAperture, chunk,
      hasDistortion: (flags & 1) !== 0, hasTca: (flags & 2) !== 0, hasVignetting: (flags & 4) !== 0,
    })),
    chunks: raw.chunks,
  };
}

/** One calibration set of a lens (a crop factor and aspect ratio it was measured with). */
export interface CalibrationSet {
  crop: number;
  aspect: number;
  /** [focal, realFocal (0 = focal), model 0 poly3 / 1 poly5 / 2 ptlens, terms...] */
  distortion: number[][];
  /** [focal, model 0 linear / 1 poly3, vr, vb, cr, cb, br, bb] (linear: [focal, 0, kr, kb]) */
  tca: number[][];
  /** [focal, aperture, distance, k1, k2, k3] */
  vignetting: number[][];
}

export type ChunkJson = Record<string, [number, number, number[][], number[][], number[][]][]>;

export function calibrationsOf(chunk: ChunkJson, lensId: number): CalibrationSet[] {
  return (chunk[lensId] ?? []).map(([crop, aspect, distortion, tca, vignetting]) => ({ crop, aspect, distortion, tca, vignetting }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching

const STOP = new Set(['lens', 'the', 'for']);
/** Lowercase letters and digits only: "XF18-55mmF2.8-4 R LM OIS" and "XF 18-55mm f/2.8-4 R LM OIS" both give the same. */
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []).filter((t) => !STOP.has(t));

/** Makers' names as cameras write them in EXIF versus the database ("NIKON CORPORATION" → "nikon"). */
function makerKey(maker: string): string {
  const m = maker.toLowerCase();
  const names = ['canon', 'nikon', 'sony', 'fuji', 'olympus', 'panasonic', 'pentax', 'ricoh', 'leica', 'sigma', 'tamron', 'tokina', 'samsung', 'kodak', 'casio', 'hasselblad', 'zeiss', 'samyang', 'konica', 'minolta', 'om digital', 'om system', 'apple', 'google'];
  return names.find((n) => m.includes(n)) ?? squash(maker);
}

/** The database camera for the EXIF make and model, or null. */
export function matchCamera(index: LensfunIndex, make: string, model: string): LensfunCamera | null {
  if (!model.trim()) return null;
  const mk = makerKey(make);
  const sq = squash(model);
  const sqNoMaker = sq.startsWith(squash(make)) ? sq.slice(squash(make).length) : sq;
  let best: LensfunCamera | null = null;
  let bestScore = 0;
  for (const c of index.cameras) {
    if (makerKey(c.maker) !== mk && mk !== '') continue;
    const cm = squash(c.model);
    let score = 0;
    if (cm === sq || cm === sqNoMaker) score = 3;
    else if (squash(`${c.maker}${c.model}`) === sq) score = 3;
    if (score && c.variant) score -= 0.1;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Mounts a lens of [mount] fits: the mount itself and the ones the database lists as compatible. */
export function compatibleMounts(index: LensfunIndex, mount: string): string[] {
  return [mount, ...(index.mounts[mount] ?? [])];
}

/**
 * The database lens for the EXIF lens make/model on [camera] (its mount decides which lenses can be on it), or null.
 * [focal] (mm) must lie in the lens's range when it is known. Names are compared with punctuation and spaces removed,
 * then by shared words; below a score of 0.6 nothing is returned, because a wrong profile is worse than none.
 */
export function matchLens(index: LensfunIndex, lensMake: string, lensModel: string, camera: LensfunCamera | null, focal = 0): LensfunLens | null {
  const name = lensModel.trim();
  if (!name) return null;
  const mounts = camera ? compatibleMounts(index, camera.mount) : null;
  const sq = squash(name);
  const want = tokens(name);
  let best: LensfunLens | null = null;
  let bestScore = 0;
  for (const l of index.lenses) {
    if (mounts && !l.mounts.some((m) => mounts.includes(m))) continue;
    let score: number;
    const lm = squash(l.model);
    const full = squash(`${l.maker}${l.model}`);
    if (lm === sq || full === sq) score = 1;
    else if (sq.includes(lm) || lm.includes(sq)) score = 0.9 * Math.min(lm.length, sq.length) / Math.max(lm.length, sq.length) + 0.1;
    else {
      const have = tokens(`${l.maker} ${l.model}`);
      const common = want.filter((t) => have.includes(t)).length;
      score = common / Math.max(want.length, have.length, 1);
    }
    if (lensMake) score += makerKey(l.maker) === makerKey(lensMake) ? 0.05 : -0.35;
    if (focal > 0 && l.maxFocal > 0 && (focal < l.minFocal - 0.5 || focal > l.maxFocal + 0.5)) score -= 0.5;
    if (camera && Math.abs(Math.log(camera.crop / l.crop)) < 0.05) score += 0.03;
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

/** Case-insensitive search by words, for the pickers: every word must appear in "maker model". */
export function searchByWords<T>(items: readonly T[], query: string, text: (t: T) => string, limit = 50): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: T[] = [];
  for (const item of items) {
    const t = text(item).toLowerCase();
    if (words.every((w) => t.includes(w))) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Correction

/** The photo a profile is worked out for. */
export interface Shot {
  /** Crop factor of the sensor (35 mm frame = 1): sets the sensor's size, and so what a pixel is in millimetres. */
  crop: number;
  /** Focal length in mm (as the lens reports it, not 35 mm equivalent). */
  focal: number;
  aperture: number;
  /** Focus distance in metres (1000 = infinity). */
  distance: number;
}

const HALF_DIAGONAL_35MM = Math.hypot(36, 24) / 2;

/** The calibration set of the closest crop factor that is not much smaller than the lens's (Lensfun's rule), or null. */
function pickSet(sets: CalibrationSet[], crop: number, has: (s: CalibrationSet) => boolean): CalibrationSet | null {
  let best: CalibrationSet | null = null;
  let ratio = 1e6;
  for (const s of sets) {
    const r = crop / s.crop;
    if (has(s) && r >= 0.96 && r < ratio) {
      ratio = r;
      best = s;
    }
  }
  return best;
}

/** Linear interpolation weights of [focal] between the entries of a list sorted by focal (index 0 of each entry). */
function bracket<T extends number[]>(entries: T[], focal: number): [T, T, number] {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  if (focal <= sorted[0][0]) return [sorted[0], sorted[0], 0];
  const last = sorted[sorted.length - 1];
  if (focal >= last[0]) return [last, last, 0];
  let i = 0;
  while (sorted[i + 1][0] < focal) i++;
  const a = sorted[i];
  const b = sorted[i + 1];
  return [a, b, (focal - a[0]) / (b[0] - a[0])];
}

/**
 * Distortion as a function of the normalised radius: the multiplier of the position (output → source), with u = 1 at
 * the corner of the sensor. Evaluates a calibration entry the way Lensfun does after "rescale_polynomial_coefficients":
 * Terms are put on the photo's sensor and the real focal length, and the ptlens/poly3 constant is moved into the
 * other terms (so the corrected picture is enlarged by it).
 */
export function distortionFactor(entry: number[], set: CalibrationSet, shotCrop: number, realFocal: number): (u: number) => number {
  const [, , model, ...t] = entry;
  // Hugin's unit: half the calibration sensor's short side, in mm.
  const huginMm = HALF_DIAGONAL_35MM / set.crop / Math.hypot(set.aspect, 1);
  const hs = realFocal / huginMm;
  // u = 1 is the corner of this photo's sensor.
  const s = HALF_DIAGONAL_35MM / shotCrop / realFocal;
  if (model === 0) {
    const k1 = t[0];
    const d = 1 - k1;
    const k = (k1 * hs * hs) / d ** 3;
    return (u) => 1 + k * (u * s) ** 2;
  }
  if (model === 1) {
    const k1 = t[0] * hs ** 2;
    const k2 = t[1] * hs ** 4;
    return (u) => {
      const r2 = (u * s) ** 2;
      return 1 + r2 * (k1 + r2 * k2);
    };
  }
  const d = 1 - t[0] - t[1] - t[2];
  const a = (t[0] * hs ** 3) / d ** 4;
  const b = (t[1] * hs ** 2) / d ** 3;
  const c = (t[2] * hs) / d ** 2;
  return (u) => {
    const r = u * s;
    return 1 + r * (c + r * (b + r * a));
  };
}

/** Lateral CA of one plane (0 red, 2 blue): the extra multiplier at the radius the distortion left the point at. */
function tcaFactor(entry: number[], set: CalibrationSet, shotCrop: number, realFocal: number, plane: 0 | 2): (rd: number) => number {
  const huginMm = HALF_DIAGONAL_35MM / set.crop / Math.hypot(set.aspect, 1);
  const hs = realFocal / huginMm;
  const s = HALF_DIAGONAL_35MM / shotCrop / realFocal;
  if (entry[1] === 0) {
    const k = plane === 0 ? entry[2] : entry[3];
    return () => k;
  }
  const [, , vr, vb, cr, cb, br, bb] = entry;
  const v = plane === 0 ? vr : vb;
  const c = (plane === 0 ? cr : cb) * hs;
  const b = (plane === 0 ? br : bb) * hs * hs;
  return (rd) => {
    const r = rd * s;
    return b * r * r + c * r + v;
  };
}

/** Vignetting gain 1 / (1 + k1 r² + k2 r⁴ + k3 r⁶) of one "pa" entry; r = 1 at the corner of the photo's sensor. */
function vignetteGain(entry: number[], set: CalibrationSet, shotCrop: number): (u: number) => number {
  const scale = set.crop / shotCrop;
  const [, , , k1, k2, k3] = entry;
  return (u) => {
    const r2 = (u * scale) ** 2;
    return 1 / (1 + r2 * (k1 + r2 * (k2 + r2 * k3)));
  };
}

const SAMPLES = 41;
const us = Array.from({ length: SAMPLES }, (_, i) => i / (SAMPLES - 1));

/** Weighted least squares fit of f(u) ≈ Σ c_i u^(2 i + 2 * first) over the samples; [first] 0 includes the constant term. */
export function fitEven(f: (u: number) => number, terms: number, first: 0 | 1, weight: (u: number) => number = () => 1): number[] {
  const n = terms;
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  for (const u of us) {
    const basis = Array.from({ length: n }, (_, i) => u ** (2 * (i + first)));
    const y = f(u) - (first === 1 ? 1 : 0);
    const w = weight(u);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += w * basis[i] * basis[j];
      A[i][n] += w * basis[i] * y;
    }
  }
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = i + 1; r < n; r++) {
      const m = A[r][i] / A[i][i];
      for (let c = i; c <= n; c++) A[r][c] -= m * A[i][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = A[i][n];
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
    x[i] = sum / A[i][i];
  }
  return x;
}

export interface Correction {
  /** Distortion and lateral CA as a DNG-style warp (3 planes with CA data, else 1), in sensor coordinates; null = none. */
  warp: Warp | null;
  vignette: RadialVignette | null;
  /** What was found for this lens, e.g. "distortion, chromatic aberration, vignetting"; empty = nothing. */
  summary: string;
  /** Largest deviation of the fitted warp from the model over the frame, as a fraction of the half diagonal. */
  warpError: number;
  /** The real focal length used (mm). */
  realFocal: number;
}

/**
 * The correction of a lens [sets] for [shot]. The lens's calibrations are interpolated linearly between the two
 * nearest focal lengths (Lensfun uses a spline), vignetting by inverse distance weights over focal length, aperture
 * and distance as Lensfun does.
 */
export function lensfunCorrection(sets: CalibrationSet[], shot: Shot, lens?: Pick<LensfunLens, 'minFocal' | 'maxFocal'>): Correction {
  const found: string[] = [];
  const dset = pickSet(sets, shot.crop, (s) => s.distortion.length > 0);
  const tset = pickSet(sets, shot.crop, (s) => s.tca.length > 0);
  const vset = pickSet(sets, shot.crop, (s) => s.vignetting.length > 0);

  // Distortion, with the real focal length it implies.
  let realFocal = shot.focal;
  let dist: ((u: number) => number) | null = null;
  if (dset) {
    const [a, b, w] = bracket(dset.distortion, shot.focal);
    const ra = a[1] || a[0];
    const rb = b[1] || b[0];
    // The real focal length follows the nominal one's ratio, interpolated.
    realFocal = ra + (rb - ra) * w;
    const fa = distortionFactor(a, dset, shot.crop, realFocal);
    const fb = distortionFactor(b, dset, shot.crop, realFocal);
    dist = (u) => fa(u) + (fb(u) - fa(u)) * w;
    found.push('distortion');
  }

  // Lateral CA.
  let tca: { r: (rd: number) => number; b: (rd: number) => number } | null = null;
  if (tset) {
    const [a, b, w] = bracket(tset.tca, shot.focal);
    const lerp = (fa: (x: number) => number, fb: (x: number) => number) => (x: number) => fa(x) + (fb(x) - fa(x)) * w;
    tca = {
      r: lerp(tcaFactor(a, tset, shot.crop, realFocal, 0), tcaFactor(b, tset, shot.crop, realFocal, 0)),
      b: lerp(tcaFactor(a, tset, shot.crop, realFocal, 2), tcaFactor(b, tset, shot.crop, realFocal, 2)),
    };
    found.push('chromatic aberration');
  }

  let warp: Warp | null = null;
  let warpError = 0;
  if (dist || tca) {
    const fd = dist ?? (() => 1);
    const planes = tca ? [(u: number) => fd(u) * tca!.r(u * fd(u)), fd, (u: number) => fd(u) * tca!.b(u * fd(u))] : [fd];
    const coefficients: number[] = [];
    for (const f of planes) {
      // Weighted by u²: the error that shows is the position's (u f(u)), which the centre barely has.
      const k = fitEven(f, 4, 0, (u) => u * u + 0.02);
      coefficients.push(...k, 0, 0);
      for (const u of us) {
        const fit = k[0] + u * u * (k[1] + u * u * (k[2] + u * u * k[3]));
        warpError = Math.max(warpError, Math.abs(fit - f(u)) * u);
      }
    }
    warp = { planes: planes.length, coefficients, centerX: 0.5, centerY: 0.5 };
  }

  // Vignetting: inverse distance weighting (power 3.5) over focal length, aperture and distance, as Lensfun.
  let vignette: RadialVignette | null = null;
  if (vset) {
    const lo = lens?.minFocal ?? 0;
    const df = (lens?.maxFocal ?? 0) - lo;
    const norm = (f: number) => (df > 0 ? (f - lo) / df : f);
    const dist3 = (e: number[]) =>
      Math.sqrt((norm(e[0]) - norm(shot.focal)) ** 2 + (4 / e[1] - 4 / shot.aperture) ** 2 + (0.1 / e[2] - 0.1 / shot.distance) ** 2);
    const gains: { w: number; g: (u: number) => number }[] = [];
    for (const e of vset.vignetting) {
      const d = dist3(e);
      if (d < 1e-4) {
        gains.length = 0;
        gains.push({ w: 1, g: vignetteGain(e, vset, shot.crop) });
        break;
      }
      gains.push({ w: 1 / d ** 3.5, g: vignetteGain(e, vset, shot.crop) });
    }
    const total = gains.reduce((s, x) => s + x.w, 0);
    const g = (u: number) => gains.reduce((s, x) => s + x.w * x.g(u), 0) / total;
    vignette = { k: fitEven(g, 5, 1), centerX: 0.5, centerY: 0.5 };
    found.push('vignetting');
  }
  return { warp, vignette, summary: found.join(', '), warpError, realFocal };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generic lenses

/** A lens that is not in the database, described by hand. */
export interface GenericLens {
  /** Crop factor of the sensor (35 mm frame = 1). */
  crop: number;
  /** Focal length, mm. */
  focal: number;
  aperture: number;
  type: LensType;
  /** Optional PTLens distortion coefficients (Rd = Ru (a Ru³ + b Ru² + c Ru + 1 - a - b - c), Ru in half-short-side units). */
  a: number;
  b: number;
  c: number;
  /** Optional vignetting terms (gain 1 / (1 + k1 r² + k2 r⁴ + k3 r⁶), r = 1 at the corner). */
  k1: number;
  k2: number;
  k3: number;
}

export const DEFAULT_GENERIC: GenericLens = { crop: 1, focal: 50, aperture: 2.8, type: 'rectilinear', a: 0, b: 0, c: 0, k1: 0, k2: 0, k3: 0 };

/** Crop factor of a sensor [width] x [height] mm (the 35 mm frame is 36 x 24). */
export const cropFactorOf = (width: number, height: number): number => (width > 0 && height > 0 ? Math.hypot(36, 24) / Math.hypot(width, height) : 1);

/** Calibration sets for [g]'s coefficients: the same data a database lens has, at its one focal length and aperture. */
export function genericCalibration(g: GenericLens): CalibrationSet[] {
  const hasDist = g.a !== 0 || g.b !== 0 || g.c !== 0;
  const hasVig = g.k1 !== 0 || g.k2 !== 0 || g.k3 !== 0;
  if (!hasDist && !hasVig) return [];
  return [{
    crop: g.crop,
    aspect: 1.5,
    distortion: hasDist ? [[g.focal, 0, 2, g.a, g.b, g.c]] : [],
    tca: [],
    vignetting: hasVig ? [[g.focal, g.aperture, 1000, g.k1, g.k2, g.k3]] : [],
  }];
}

/**
 * Field of view across the sensor diagonal, degrees, of a fisheye of [type] and [focal] mm on a sensor of [crop]:
 * equidistant r = f θ ("fisheye"), equisolid r = 2 f sin(θ/2), stereographic r = 2 f tan(θ/2), orthographic r = f sin θ.
 * 0 for a type that is not a fisheye.
 */
export function fisheyeFov(type: LensType, focal: number, crop: number): number {
  if (!(focal > 0) || !(crop > 0)) return 0;
  const r = HALF_DIAGONAL_35MM / crop;
  let theta: number;
  switch (type) {
    case 'fisheye':
      theta = r / focal;
      break;
    case 'equisolid':
      theta = 2 * Math.asin(Math.min(1, r / (2 * focal)));
      break;
    case 'stereographic':
      theta = 2 * Math.atan(r / (2 * focal));
      break;
    case 'orthographic':
      theta = Math.asin(Math.min(1, r / focal));
      break;
    default:
      return 0;
  }
  return (2 * theta * 180) / Math.PI;
}
