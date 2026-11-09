import { newId } from './Masks';

/**
 * Light effects (Pro, "lomo" effects): procedural light drawn over the finished picture like a double exposure on
 * film: lightning bolts, electric spark clusters, light-trail streaks and neon swirls. Each is generated from a seed
 * (a new one every time it's added or shuffled), placed on the photo like a light leak (dragged, sized, stretched and
 * turned on MaskOverlay) and drawn by shaders/light_fx.glsl as glowing lines: a white-hot core, a coloured glow and a
 * wide soft halo (bloom), exposed into the picture per channel so strong light burns to white and the grain lies over it.
 *
 * Geometry is a radial mask's (Masks.ts): centre (cx, cy) in fractions of the decoded image, rx/ry the half extent along
 * and across as fractions of its long side, angle in degrees (clockwise). The pattern lives in its own frame
 * (-1..1 on both axes), so stretching the box stretches the pattern, while line widths and glows scale with the box's
 * mean size. amount 0..100 = how much there is (lightning branches, sparks, strands); thickness 0..100 = line width
 * (50 = as generated); glow 0..100 = how far the glow and halo reach; intensity 0..100; hue in degrees (0..360);
 * spread 0..100 = how far each line's colour may drift from it (sparks: blue, violet and green together).
 *
 * Effects belong to one photo's content, like leaks: they reset for each new photo and presets don't keep them.
 */
export type FxKind = 'lightning' | 'sparks' | 'trails' | 'swirl';

export interface LightEffect {
  id: string;
  enabled: boolean;
  kind: FxKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  seed: number;
  amount: number;
  thickness: number;
  glow: number;
  intensity: number;
  hue: number;
  spread: number;
}

/** Uniform arrays in the shader are this long. */
export const MAX_EFFECTS = 4;
export const FX_KINDS: readonly FxKind[] = ['lightning', 'sparks', 'trails', 'swirl'];

/** Start values of each kind: size, angle, how much, colour (a white-blue bolt, blue/violet/green sparks...). */
export const FX_DEFAULTS: Record<FxKind, { angle: number; amount: number; thickness: number; glow: number; hue: number; spread: number }> = {
  lightning: { angle: 0, amount: 50, thickness: 50, glow: 50, hue: 222, spread: 10 },
  sparks: { angle: 0, amount: 50, thickness: 50, glow: 55, hue: 235, spread: 70 },
  trails: { angle: 0, amount: 50, thickness: 50, glow: 45, hue: 285, spread: 45 },
  swirl: { angle: 0, amount: 40, thickness: 50, glow: 50, hue: 190, spread: 35 },
};

/** A new effect's box is this many times the photo, so most of the pattern sits outside the frame and only a part of it overlaps the picture. */
export const FX_START_SCALE = 1.75;

/**
 * The box a new effect starts in (radii as fractions of the photo's long side) for a photo [aspect] = width / height wide:
 * [FX_START_SCALE] times the photo, centred on it.
 */
export const fxCoverSize = (aspect: number): { rx: number; ry: number } => {
  const h = 0.5 * FX_START_SCALE;
  return aspect >= 1 ? { rx: h, ry: h / aspect } : { rx: h * aspect, ry: h };
};

/** A seed 0..1 (stored like a leak's); the generator turns it into 32 bits. */
export const newFxSeed = (): number => Math.floor(Math.random() * 1e9) / 1e9;

/** A new random effect of [kind] covering the whole photo of [aspect] (width / height), centred at ([cx], [cy]). */
export const newLightEffect = (kind: FxKind = 'lightning', cx = 0.5, cy = 0.5, aspect = 1.5): LightEffect => ({
  id: newId(), enabled: true, kind, cx, cy, ...fxCoverSize(aspect), ...FX_DEFAULTS[kind], intensity: 100, seed: newFxSeed(),
});

/** The effect turned into [kind] with that kind's amount, colour and widths; place, size, angle, intensity and seed stay. */
export const withFxKind = (e: LightEffect, kind: FxKind): LightEffect => {
  if (e.kind === kind) return e;
  const { angle: _angle, ...look } = FX_DEFAULTS[kind];
  return { ...e, kind, ...look };
};

export const fxIsIdentity = (e: LightEffect): boolean => !e.enabled || e.intensity <= 0;

/** CSS colour of a hue at full light, for swatches. */
export const fxCss = (hue: number): string => {
  const [r, g, b] = fxColor(hue);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

/** The shader's colour of [hue] (degrees): a light, slightly pastel neon (saturation 0.8, value 1). */
export function fxColor(hue: number): [number, number, number] {
  const h = ((((hue % 360) + 360) % 360) / 60);
  const f = (n: number) => {
    const k = (n + h) % 6;
    return 1 - 0.8 * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

// ---------------------------------------------------------------------------------------------------------------
// Generation: segments in the effect's own frame (-1..1), widths in its mean radius.

/** One glowing line piece: from (x0, y0) to (x1, y1), half widths w0 → w1, brightness b, colour offset h (-1..1). */
export interface FxSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w0: number;
  w1: number;
  b: number;
  h: number;
}

/** At most this many segments per effect (the shader's data texture holds MAX_EFFECTS of them). */
export const MAX_SEGMENTS = 1280;
/** Segments per chunk: a chunk's bounding box lets the shader skip it where none of its light reaches. */
export const FX_CHUNK = 16;

/** A small, fast deterministic PRNG (mulberry32): the same pattern for the same seed everywhere. */
export function fxRandom(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
type Pt = [number, number];
const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
/** Roughly normal, mean 0, sd 1. */
const gauss = (r: Rng) => (r() + r() + r() + r() - 2) * 1.732;

/** Points of a jagged bolt from a to b: midpoint displacement, [levels] times, sideways by [rough] x the piece's length. */
function jagged(r: Rng, a: Pt, b: Pt, levels: number, rough: number): Pt[] {
  let pts: Pt[] = [a, b];
  let amp = rough;
  for (let l = 0; l < levels; ++l) {
    const next: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; ++i) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const off = gauss(r) * 0.5 * amp * len;
      const along = (r() - 0.5) * 0.2;
      next.push([x0 + dx * (0.5 + along) - (dy / (len || 1)) * off, y0 + dy * (0.5 + along) + (dx / (len || 1)) * off], pts[i]);
    }
    pts = next;
    amp *= 0.92; // keeps fine kinks at every scale: real lightning is jagged all the way down
  }
  return pts;
}

/** Segments along [pts], half width w0 → w1 and brightness b0 → b1 from start to end, flickering a little. */
function polyline(out: FxSegment[], r: Rng, pts: Pt[], w0: number, w1: number, b0: number, b1: number, h: number, flicker = 0.15) {
  const n = pts.length - 1;
  for (let i = 0; i < n && out.length < MAX_SEGMENTS; ++i) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const fl = 1 - flicker * r();
    out.push({
      x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1],
      w0: w0 + (w1 - w0) * t0, w1: w0 + (w1 - w0) * t1,
      b: Math.max(0.001, (b0 + (b1 - b0) * (t0 + t1) * 0.5) * fl), h,
    });
  }
}

/** A lightning bolt from top to bottom with forks: branches leave the channel at shallow angles and branch again. */
function lightning(r: Rng, amount: number): FxSegment[] {
  const out: FxSegment[] = [];
  const density = amount / 100;
  const branch = (from: Pt, dir: number, len: number, level: number, w: number, b: number) => {
    const to: Pt = [from[0] + Math.cos(dir) * len, from[1] + Math.sin(dir) * len];
    const pts = jagged(r, from, to, level === 0 ? 8 : level === 1 ? 6 : 5, level === 0 ? 0.42 : 0.5);
    polyline(out, r, pts, w, w * (level === 0 ? 0.55 : 0.2), b, b * (level === 0 ? 0.8 : 0.35), (r() - 0.5) * 0.6, 0.25);
    if (level >= 2) return;
    // Forks: more near the bottom of a channel; each heads off 15..55° to one side, its length a part of what's left.
    const forks = Math.round((level === 0 ? 2 + 9 * density : 0.5 + 3 * density) * range(r, 0.7, 1.3));
    for (let f = 0; f < forks && out.length < MAX_SEGMENTS - 100; ++f) {
      const t = level === 0 ? 0.12 + 0.8 * Math.sqrt(r()) : 0.15 + 0.7 * r();
      const k = Math.min(pts.length - 2, Math.max(1, Math.floor(t * (pts.length - 1))));
      const [px, py] = pts[k];
      const local = Math.atan2(pts[k + 1][1] - pts[k - 1][1], pts[k + 1][0] - pts[k - 1][0]);
      const side = r() < 0.5 ? -1 : 1;
      const turn = side * range(r, 0.26, 0.95);
      const left = len * (1 - t);
      branch([px, py], local * 0.4 + dir * 0.6 + turn, left * range(r, 0.3, 0.75), level + 1, w * range(r, 0.4, 0.6), b * range(r, 0.45, 0.7));
    }
  };
  const x0 = range(r, -0.25, 0.25);
  const x1 = x0 + range(r, -0.35, 0.35);
  const len = Math.hypot(x1 - x0, 1.9);
  branch([x0, -0.95], Math.atan2(1.9, x1 - x0), len, 0, 0.006, 1);
  return out;
}

/**
 * An electric spark cluster: a hot centre, short crackling arcs out of it, and many sparks around it, most of them tiny,
 * some flying outwards as short streaks; colours spread so blue, violet and green sit together.
 */
function sparks(r: Rng, amount: number): FxSegment[] {
  const out: FxSegment[] = [];
  const density = amount / 100;
  const arcs = Math.round(3 + 6 * density * range(r, 0.6, 1.4));
  for (let a = 0; a < arcs; ++a) {
    const dir = r() * Math.PI * 2;
    const len = range(r, 0.25, 0.75);
    const from: Pt = [gauss(r) * 0.04, gauss(r) * 0.04];
    const pts = jagged(r, from, [from[0] + Math.cos(dir) * len, from[1] + Math.sin(dir) * len], 5, 0.55);
    polyline(out, r, pts, 0.006, 0.0015, 0.9, 0.25, gauss(r) * 0.35, 0.3);
    // One small fork per arc, sometimes.
    if (r() < 0.6) {
      const k = 2 + Math.floor(r() * (pts.length - 4));
      const fd = dir + (r() < 0.5 ? -1 : 1) * range(r, 0.4, 1);
      const fl = len * range(r, 0.2, 0.4);
      polyline(out, r, jagged(r, pts[k], [pts[k][0] + Math.cos(fd) * fl, pts[k][1] + Math.sin(fd) * fl], 3, 0.6), 0.003, 0.001, 0.5, 0.15, gauss(r) * 0.35, 0.3);
    }
  }
  // The hot centre: a few overlapping bright dots.
  for (let i = 0; i < 3; ++i) {
    const x = gauss(r) * 0.02;
    const y = gauss(r) * 0.02;
    out.push({ x0: x, y0: y, x1: x, y1: y, w0: 0.02, w1: 0.02, b: 1.4, h: gauss(r) * 0.2 });
  }
  const particles: FxSegment[] = [];
  // A few soft orbs of light around the cluster, out of focus like bokeh.
  const orbs = Math.round(3 + 8 * density * r());
  for (let i = 0; i < orbs; ++i) {
    const dir = r() * Math.PI * 2;
    const dist = range(r, 0.15, 0.85);
    const x = Math.cos(dir) * dist;
    const y = Math.sin(dir) * dist;
    const w = range(r, 0.012, 0.03);
    particles.push({ x0: x, y0: y, x1: x, y1: y, w0: w, w1: w, b: range(r, 0.12, 0.3), h: r() * 2 - 1 });
  }
  const n = Math.round(80 + 520 * density);
  for (let i = 0; i < n; ++i) {
    const dir = r() * Math.PI * 2;
    const dist = Math.min(1, Math.abs(gauss(r)) * 0.45 + 0.03);
    const x = Math.cos(dir) * dist;
    const y = Math.sin(dir) * dist;
    const big = r() ** 6; // most sparks are tiny, a few large
    const w = 0.0025 + 0.012 * big;
    const b = range(r, 0.35, 1.1) * (1.15 - dist * 0.6);
    const h = (r() * 2 - 1);
    if (r() < 0.35) {
      // A flying spark: a short streak outwards, thinning towards its tail.
      const len = range(r, 0.03, 0.16) * (0.4 + dist);
      particles.push({ x0: x, y0: y, x1: x + Math.cos(dir) * len, y1: y + Math.sin(dir) * len, w0: w * 0.9, w1: w * 0.25, b, h });
    } else {
      particles.push({ x0: x, y0: y, x1: x, y1: y, w0: w, w1: w, b, h });
    }
  }
  // Spatial order, so each chunk's bounding box stays small and the shader can skip far chunks.
  const morton = (s: FxSegment) => {
    const qx = Math.min(63, Math.max(0, Math.floor((s.x0 + 1) * 32)));
    const qy = Math.min(63, Math.max(0, Math.floor((s.y0 + 1) * 32)));
    let m = 0;
    for (let bit = 0; bit < 6; ++bit) m |= (((qx >> bit) & 1) << (2 * bit)) | (((qy >> bit) & 1) << (2 * bit + 1));
    return m;
  };
  particles.sort((a, b) => morton(a) - morton(b));
  for (const p of particles) if (out.length < MAX_SEGMENTS) out.push(p);
  return out;
}

/** Smooth 1D noise (-1..1) from a few random sines: wobble for trails and swirls. */
function wobble(r: Rng): (t: number) => number {
  const waves = Array.from({ length: 3 }, (_, i) => ({ f: range(r, 1.5, 4) * (i + 1), p: r() * Math.PI * 2, a: 1 / (i + 1.5) }));
  return (t) => waves.reduce((s, w) => s + w.a * Math.sin(w.f * t + w.p), 0) / 1.2;
}

/** Light trails: a few long, nearly parallel streaks of moving light, like a long exposure, flickering along their length. */
function trails(r: Rng, amount: number): FxSegment[] {
  const out: FxSegment[] = [];
  const strands = Math.round(2 + 5 * (amount / 100) * range(r, 0.7, 1.3));
  const bow = range(r, -0.5, 0.5);
  for (let s = 0; s < strands; ++s) {
    const y0 = (strands === 1 ? 0 : (s / (strands - 1)) * 1.3 - 0.65) + gauss(r) * 0.08;
    const amp = range(r, 0.04, 0.2);
    const wob = wobble(r);
    const flick = wobble(r);
    const xs = range(r, -1, -0.75);
    const xe = range(r, 0.75, 1);
    const w = range(r, 0.004, 0.011);
    const b = range(r, 0.55, 1.1);
    const h = s / Math.max(1, strands - 1) * 2 - 1 + gauss(r) * 0.2;
    const pts: Pt[] = [];
    const N = 128;
    for (let i = 0; i <= N; ++i) {
      const t = i / N;
      const x = xs + (xe - xs) * t;
      pts.push([x, y0 + bow * (x * x - 0.5) * 0.6 + amp * wob(t * 3)]);
    }
    for (let i = 0; i < N && out.length < MAX_SEGMENTS; ++i) {
      const t = (i + 0.5) / N;
      const fade = Math.min(1, t / 0.15, (1 - t) / 0.12); // trails fade in and out at their ends
      const level = Math.max(0, 0.65 + 0.45 * flick(t * 4));
      out.push({
        x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1],
        w0: w * (0.7 + 0.3 * level), w1: w * (0.7 + 0.3 * level), b: Math.max(0.001, b * fade * level), h,
      });
    }
  }
  return out;
}

/** Neon swirls: one to four loose spirals of light winding round the centre, wobbling, fading at their ends. */
function swirl(r: Rng, amount: number): FxSegment[] {
  const out: FxSegment[] = [];
  const strands = Math.round(1 + 3 * (amount / 100) * range(r, 0.7, 1.3));
  for (let s = 0; s < strands; ++s) {
    const turns = range(r, 1.2, 2.6);
    const r0 = range(r, 0.08, 0.35);
    const r1 = range(r, 0.7, 1);
    const tilt = range(r, 0.55, 1); // an ellipse seen at an angle
    const rot = r() * Math.PI * 2;
    const th0 = r() * Math.PI * 2;
    const dir = r() < 0.5 ? -1 : 1;
    const wob = wobble(r);
    const w = range(r, 0.004, 0.009);
    const b = range(r, 0.7, 1.1);
    const h = gauss(r) * 0.5;
    const N = Math.min(320, Math.floor((MAX_SEGMENTS - out.length) / Math.max(1, strands - s)) - 1);
    if (N < 8) break;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; ++i) {
      const t = i / N;
      const th = th0 + dir * turns * 2 * Math.PI * t;
      const rr = (r0 + (r1 - r0) * t) * (1 + 0.12 * wob(t * 5));
      const ex = Math.cos(th) * rr;
      const ey = Math.sin(th) * rr * tilt;
      pts.push([ex * Math.cos(rot) - ey * Math.sin(rot), ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    for (let i = 0; i < N; ++i) {
      const t = (i + 0.5) / N;
      const fade = Math.min(1, t / 0.2, (1 - t) / 0.25);
      out.push({ x0: pts[i][0], y0: pts[i][1], x1: pts[i + 1][0], y1: pts[i + 1][1], w0: w, w1: w, b: Math.max(0.001, b * fade), h });
    }
  }
  return out;
}

const GENERATORS: Record<FxKind, (r: Rng, amount: number) => FxSegment[]> = { lightning, sparks, trails, swirl };

/** The effect's segments, freshly generated (fxSegments caches them). */
export const generateFx = (kind: FxKind, seed: number, amount: number): FxSegment[] =>
  GENERATORS[kind](fxRandom(seed), Math.round(Math.min(100, Math.max(0, amount)))).slice(0, MAX_SEGMENTS);

const generated = new Map<string, FxSegment[]>();

/** The effect's segments (cached: the same kind, seed and amount always give the same pattern). */
export function fxSegments(e: Pick<LightEffect, 'kind' | 'seed' | 'amount'>): FxSegment[] {
  const amount = Math.round(Math.min(100, Math.max(0, e.amount)));
  const key = `${e.kind}:${e.seed}:${amount}`;
  let s = generated.get(key);
  if (!s) {
    s = generateFx(e.kind, e.seed, amount);
    if (generated.size > 32) generated.delete(generated.keys().next().value!);
    generated.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing and packing.

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

/** An effect from untrusted JSON with a fresh id, or null when it isn't one. Ranges are clamped. */
export function parseEffect(o: unknown): LightEffect | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  if (!FX_KINDS.includes(s.kind as FxKind)) return null;
  const kind = s.kind as FxKind;
  const [cx, cy, rx, ry] = [num(s.cx, -1, 2), num(s.cy, -1, 2), num(s.rx, 0.005, 3), num(s.ry, 0.005, 3)];
  if (cx == null || cy == null || rx == null || ry == null) return null;
  const d = FX_DEFAULTS[kind];
  return {
    id: newId(),
    enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
    kind, cx, cy, rx, ry,
    angle: num(s.angle, -360, 360) ?? 0,
    seed: num(s.seed, 0, 1) ?? 0,
    amount: num(s.amount, 0, 100) ?? d.amount,
    thickness: num(s.thickness, 0, 100) ?? d.thickness,
    glow: num(s.glow, 0, 100) ?? d.glow,
    intensity: num(s.intensity, 0, 100) ?? 100,
    hue: num(s.hue, 0, 360) ?? d.hue,
    spread: num(s.spread, 0, 100) ?? d.spread,
  };
}

/** Effects from untrusted JSON: invalid ones are dropped, at most MAX_EFFECTS kept. */
export const parseEffects = (v: unknown): LightEffect[] =>
  (Array.isArray(v) ? v : []).map(parseEffect).filter((e): e is LightEffect => e != null).slice(0, MAX_EFFECTS);

/** Texels per chunk row of the data texture: the chunk's bounding box, then two per segment. */
export const FX_ROW = 1 + 2 * FX_CHUNK;

/** The segments of all shown effects as the shader's RGBA32F data texture (FX_ROW x rows). */
export interface FxData {
  rows: number;
  data: Float32Array;
}

/** Effects packed for the shader's uniform arrays (see shaders/light_fx.glsl). */
export interface FxUniforms {
  count: number;
  geom: Float32Array; // MAX_EFFECTS x vec4 each
  shape: Float32Array;
  color: Float32Array;
  range: Float32Array;
  /** null when no effect shows. */
  data: FxData | null;
}

const emptyFx = (): FxUniforms => ({
  count: 0,
  geom: new Float32Array(MAX_EFFECTS * 4),
  shape: new Float32Array(MAX_EFFECTS * 4),
  color: new Float32Array(MAX_EFFECTS * 4),
  range: new Float32Array(MAX_EFFECTS * 4),
  data: null,
});

export const NO_FX: FxUniforms = emptyFx();

/** The thickness slider as a width factor: 1/4 .. 1 (at 50) .. 4. */
export const thicknessFactor = (t: number): number => 4 ** ((Math.min(100, Math.max(0, t)) - 50) / 50);
/** The glow slider as the glow's radius in core half widths. */
export const glowRadius = (g: number): number => 2 + (Math.min(100, Math.max(0, g)) / 100) * 8;
/** The glow slider as the halo's radius in the effect's mean radius. */
export const haloRadius = (g: number): number => 0.02 + (Math.min(100, Math.max(0, g)) / 100) * 0.16;

/** How much each kind's lines crackle (the shader bends them with fine noise): lightning and the sparks' arcs do, trails and swirls stay smooth. */
const FX_WOBBLE: Record<FxKind, number> = { lightning: 1, sparks: 0.6, trails: 0, swirl: 0 };

/** Lays segment lists into chunk rows. */
function packData(lists: readonly FxSegment[][]): { data: FxData; first: number[]; rows: number[] } {
  const rowsOf = lists.map((l) => Math.ceil(l.length / FX_CHUNK));
  const total = Math.max(1, rowsOf.reduce((a, b) => a + b, 0));
  const data = new Float32Array(total * FX_ROW * 4);
  const first: number[] = [];
  let row = 0;
  lists.forEach((segs, i) => {
    first.push(row);
    for (let c = 0; c < rowsOf[i]; ++c, ++row) {
      const chunk = segs.slice(c * FX_CHUNK, (c + 1) * FX_CHUNK);
      let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
      chunk.forEach((s, k) => {
        minX = Math.min(minX, s.x0, s.x1);
        minY = Math.min(minY, s.y0, s.y1);
        maxX = Math.max(maxX, s.x0, s.x1);
        maxY = Math.max(maxY, s.y0, s.y1);
        const o = (row * FX_ROW + 1 + 2 * k) * 4;
        data.set([s.x0, s.y0, s.x1, s.y1, s.w0, s.w1, s.b, s.h], o);
      });
      data.set([minX, minY, maxX, maxY], row * FX_ROW * 4);
    }
  });
  return { data: { rows: total, data }, first, rows: rowsOf };
}

let lastData: { key: string; packed: ReturnType<typeof packData> } | null = null;

/**
 * Packs the effects that show; positions go from image fractions to full-resolution image pixels. The data texture is
 * reused (same object) while only placement, size or colour change, so dragging never re-uploads it.
 */
export function packEffects(effects: readonly LightEffect[], imageWidth: number, imageHeight: number): FxUniforms {
  const used = effects.filter((e) => !fxIsIdentity(e)).slice(0, MAX_EFFECTS);
  if (used.length === 0) return NO_FX;
  const lists = used.map(fxSegments);
  const key = used.map((e) => `${e.kind}:${e.seed}:${Math.round(e.amount)}`).join('|');
  if (lastData?.key !== key) lastData = { key, packed: packData(lists) };
  const { data, first, rows } = lastData.packed;
  const u = { ...emptyFx(), count: used.length, data };
  const long = Math.max(imageWidth, imageHeight);
  used.forEach((e, i) => {
    const o = i * 4;
    const a = (e.angle * Math.PI) / 180;
    const rxPx = Math.max(e.rx * long, 1);
    const ryPx = Math.max(e.ry * long, 1);
    const mean = Math.sqrt(rxPx * ryPx);
    u.geom.set([e.cx * imageWidth, e.cy * imageHeight, rxPx, ryPx], o);
    u.shape.set([Math.cos(a), Math.sin(a), mean * thicknessFactor(e.thickness), glowRadius(e.glow)], o);
    u.color.set([((e.hue % 360) + 360) % 360 / 360, Math.min(1, Math.max(0, e.spread / 100)), Math.min(1, Math.max(0, e.intensity / 100)), mean * haloRadius(e.glow)], o);
    // How far the effect's light reaches beyond its lines: past it, the shader skips a chunk.
    const widest = lists[i].reduce((m, s) => Math.max(m, s.w0, s.w1), 0) * u.shape[o + 2];
    // Far enough out that a segment's glow, halo and crackle are all within it (the crackle bends a line by up to ~2% of the size).
    const reach = 3.2 * Math.max(u.color[o + 3], widest * u.shape[o + 3]) + 2 + 0.02 * mean * FX_WOBBLE[e.kind];
    u.range.set([first[i], rows[i], reach, FX_WOBBLE[e.kind]], o);
  });
  return u;
}
