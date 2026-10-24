/**
 * Point curves on the final display-encoded (sRGB) image, as in Lightroom (port of develop/ToneCurve.kt).
 * The RGB curve applies to all three channels first, then each channel's own curve. Points are (input, output)
 * pairs in 0..1, sorted by input; the curve between them is a monotone cubic (Fritsch-Carlson), so it never
 * overshoots its points, and it is flat beyond the first and last point.
 */
export type CurvePoint = readonly [number, number];
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';

export type ToneCurves = Readonly<Record<CurveChannel, readonly CurvePoint[]>>;

export const CURVE_CHANNELS: readonly { key: CurveChannel; label: string }[] = [
  { key: 'rgb', label: 'RGB' },
  { key: 'red', label: 'Red' },
  { key: 'green', label: 'Green' },
  { key: 'blue', label: 'Blue' },
];

export const IDENTITY_CURVE: readonly CurvePoint[] = Object.freeze([[0, 0], [1, 1]] as const);

export const DEFAULT_CURVES: ToneCurves = Object.freeze({ rgb: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE });

/** Samples per channel in the shader's `uCurve` table (CURVE_SIZE in develop.glsl). */
export const CURVE_SIZE = 33;
export const MAX_CURVE_POINTS = 16;
/** Closest two points may sit along the input axis. */
export const CURVE_MIN_GAP = 0.02;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Edited positions are kept to 1/1000, so preset files stay readable. */
const snap = (v: number) => Math.round(v * 1000) / 1000;

/** Every point on the diagonal: the curve is the straight identity line. */
export const isIdentityCurve = (points: readonly CurvePoint[]): boolean => points.every(([x, y]) => Math.abs(x - y) < 1e-6);

export const curvesAreIdentity = (c: ToneCurves): boolean => CURVE_CHANNELS.every((ch) => isIdentityCurve(c[ch.key]));

/** Fritsch-Carlson tangents: zero at local extrema, limited so each segment stays monotone. */
function tangents(points: readonly CurvePoint[]): number[] {
  const n = points.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0]));
  if (n === 2) return [d[0], d[0]];
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

/** The curve through points at input x (0..1), clamped to 0..1. */
export function evaluateCurve(points: readonly CurvePoint[], x: number, m: readonly number[] = tangents(points)): number {
  const n = points.length;
  if (x <= points[0][0]) return clamp01(points[0][1]);
  if (x >= points[n - 1][0]) return clamp01(points[n - 1][1]);
  let i = 0;
  while (x > points[i + 1][0]) i++;
  const [x0, y0] = points[i];
  const [x1, y1] = points[i + 1];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  return clamp01(y);
}

/** A channel's curve sampled at count evenly spaced inputs (for drawing it). */
export function sampleCurve(points: readonly CurvePoint[], count: number): number[] {
  const m = tangents(points);
  return Array.from({ length: count }, (_, i) => evaluateCurve(points, i / (count - 1), m));
}

/**
 * The shader's `uCurve` table: CURVE_SIZE rgb triples, each channel's curve after the RGB one, or null when
 * every curve is the identity (`uCurveOn` 0).
 */
export function curveTable(c: ToneCurves): Float32Array | null {
  if (curvesAreIdentity(c)) return null;
  const mm = tangents(c.rgb);
  const mr = tangents(c.red);
  const mg = tangents(c.green);
  const mb = tangents(c.blue);
  const out = new Float32Array(CURVE_SIZE * 3);
  for (let i = 0; i < CURVE_SIZE; i++) {
    const v = evaluateCurve(c.rgb, i / (CURVE_SIZE - 1), mm);
    out[i * 3] = evaluateCurve(c.red, v, mr);
    out[i * 3 + 1] = evaluateCurve(c.green, v, mg);
    out[i * 3 + 2] = evaluateCurve(c.blue, v, mb);
  }
  return out;
}

/**
 * Index of the point within radius of (x, y), the closest one, or -1. radius is a fraction of the box's width; aspect
 * (box height / width) makes the distance round on screen in a box that isn't square.
 */
export function nearestCurvePoint(points: readonly CurvePoint[], x: number, y: number, radius: number, aspect = 1): number {
  let best = -1;
  let bestD = radius * radius;
  points.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + ((py - y) * aspect) ** 2;
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** points with a new point at (x, y) and its index, or null when it is full or too close to another point. */
export function addCurvePoint(points: readonly CurvePoint[], x: number, y: number): { points: CurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  const px = snap(clamp01(x));
  if (points.some(([qx]) => Math.abs(qx - px) < CURVE_MIN_GAP)) return null;
  const index = points.findIndex(([qx]) => qx > px);
  if (index <= 0) return null; // outside the first and last point: move those instead
  const next = [...points];
  next.splice(index, 0, [px, snap(clamp01(y))]);
  return { points: next, index };
}

/** points with point i moved to (x, y), kept between its neighbours. */
export function moveCurvePoint(points: readonly CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
  const lo = i > 0 ? points[i - 1][0] + CURVE_MIN_GAP : 0;
  const hi = i < points.length - 1 ? points[i + 1][0] - CURVE_MIN_GAP : 1;
  const next = [...points];
  next[i] = [Math.min(hi, Math.max(lo, snap(x))), snap(clamp01(y))];
  return next;
}

/** points without point i; the first and last point stay (they can only be moved). */
export function removeCurvePoint(points: readonly CurvePoint[], i: number): readonly CurvePoint[] {
  if (i <= 0 || i >= points.length - 1) return points;
  return points.filter((_, k) => k !== i);
}

/**
 * Curves from a preset file: each channel a list of [x, y] pairs. Channels that are missing or malformed are the
 * identity; null when value isn't an object at all.
 */
export function parseCurves(value: unknown): ToneCurves | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const channel = (raw: unknown): readonly CurvePoint[] => {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_CURVE_POINTS) return IDENTITY_CURVE;
    const pts: CurvePoint[] = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return IDENTITY_CURVE;
      const x = clamp01(p[0]);
      if (pts.length > 0 && x <= pts[pts.length - 1][0]) return IDENTITY_CURVE;
      pts.push([x, clamp01(p[1])]);
    }
    return pts;
  };
  return { rgb: channel(o.rgb), red: channel(o.red), green: channel(o.green), blue: channel(o.blue) };
}
