import { newId } from './Masks';

/**
 * Film leaks (Pro, generated): procedural film light and damage, made by a generator rather than drawn by hand
 * (shaders/film_leak.glsl). They live in the Light leaks panel's Generate section beside the hand-made leaks
 * (LightLeaks.ts) and share its budget of MAX_LEAKS layers.
 *
 * Each layer sits in an axis-aligned box: centre (cx, cy) and size (w, h) in fractions of the decoded image's width and
 * height, dragged and stretched along x and y only. turn (0..3) says which side of the box the pattern comes from
 * (left, top, right, bottom: where light enters, where the roll ends, where the film tore); mirror flips it along that
 * side. The pattern is drawn from seed, so the same layer always looks the same (and a port can be checked against
 * this generator for the same seeds, as LightEffects is).
 *
 * Sliders, 0..100 unless noted: intensity; softness (edges and glow); texture (mottling, streaks, colour drift, frayed
 * edges); amount (per type: how far a band reaches, a beam's width, how many slots or specks, where the roll ends);
 * variant (per type: a second band, a corner, the flare's angle, the gate's bow, the tear's white strip, scratches);
 * and a colour grade for the whole photo: warmth and tint -100..100, fade 0..100, contrast -100..100.
 */
export type FilmLeakType =
  | 'edge' | 'blob' | 'streak' | 'sprocket' | 'fog' | 'rebate' | 'flare' | 'start' | 'end' | 'tear' | 'dust' | 'stain' | 'scratches';

export type FilmPalette = 'warm' | 'amber' | 'red' | 'magenta' | 'cool' | 'green' | 'mono';

export interface FilmLeak {
  id: string;
  enabled: boolean;
  type: FilmLeakType;
  seed: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  turn: number;
  mirror: boolean;
  palette: FilmPalette;
  intensity: number;
  softness: number;
  texture: number;
  amount: number;
  variant: number;
  warmth: number;
  tint: number;
  fade: number;
  contrast: number;
}

/** Order matches the FL_* constants in film_leak.glsl. */
export const FILM_LEAK_TYPES: readonly FilmLeakType[] = [
  'edge', 'blob', 'streak', 'sprocket', 'fog', 'rebate', 'flare', 'start', 'end', 'tear', 'dust', 'stain', 'scratches',
];

export const FILM_LEAK_LABELS: Record<FilmLeakType, string> = {
  edge: 'Edge burn',
  blob: 'Blob',
  streak: 'Streak',
  sprocket: 'Sprocket holes',
  fog: 'Fog',
  rebate: 'Rebate glow',
  flare: 'Flare',
  start: 'Start of roll',
  end: 'End of roll',
  tear: 'Film tear',
  dust: 'Dust & scratches',
  stain: 'Chemical stain',
  scratches: 'Scratches',
};

export const FILM_PALETTES: readonly FilmPalette[] = ['warm', 'amber', 'red', 'magenta', 'cool', 'green', 'mono'];

export const FILM_PALETTE_LABELS: Record<FilmPalette, string> = {
  warm: 'Warm',
  amber: 'Amber',
  red: 'Red',
  magenta: 'Magenta',
  cool: 'Cool',
  green: 'Green',
  mono: 'Mono',
};

/**
 * Palettes as exposure ratios per channel (the channel at 1 fills first, so warm light burns red -> orange -> yellow ->
 * white), with the second colour the light drifts towards. Stains use the first as a dye.
 */
export const PALETTE_RGB: Record<FilmPalette, { a: readonly number[]; b: readonly number[]; css: string }> = {
  warm: { a: [1.0, 0.55, 0.18], b: [1.0, 0.25, 0.08], css: '#ff8c2e' },
  amber: { a: [1.0, 0.82, 0.28], b: [1.0, 0.55, 0.18], css: '#ffd147' },
  red: { a: [1.0, 0.22, 0.08], b: [1.0, 0.15, 0.35], css: '#ff3814' },
  magenta: { a: [1.0, 0.25, 0.6], b: [1.0, 0.22, 0.08], css: '#ff4099' },
  cool: { a: [0.25, 0.65, 1.0], b: [0.3, 0.95, 1.0], css: '#40a6ff' },
  green: { a: [0.45, 1.0, 0.5], b: [0.8, 1.0, 0.3], css: '#73ff80' },
  mono: { a: [1.0, 0.95, 0.88], b: [1.0, 0.92, 0.82], css: '#fff2e0' },
};

export const filmPaletteCss = (p: FilmPalette): string => PALETTE_RGB[p].css;

export const filmLeakIsIdentity = (l: FilmLeak): boolean =>
  !l.enabled || (l.intensity <= 0 && l.warmth === 0 && l.tint === 0 && l.fade === 0 && l.contrast === 0);

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

/** A generated film leak from untrusted JSON with a fresh id, or null when it isn't one. Ranges are clamped. */
export function parseFilmLeak(o: unknown): FilmLeak | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const [cx, cy, w, h] = [num(s.cx, -1, 2), num(s.cy, -1, 2), num(s.w, 0.01, 4), num(s.h, 0.01, 4)];
  if (cx == null || cy == null || w == null || h == null) return null;
  const type: FilmLeakType = FILM_LEAK_TYPES.includes(s.type as FilmLeakType) ? (s.type as FilmLeakType) : 'edge';
  const palette: FilmPalette = FILM_PALETTES.includes(s.palette as FilmPalette) ? (s.palette as FilmPalette) : 'warm';
  return {
    id: newId(),
    enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
    type,
    seed: num(s.seed, 0, 1) ?? 0,
    cx,
    cy,
    w,
    h,
    turn: (((Math.round(num(s.turn, -16, 16) ?? 0) % 4) + 4) % 4),
    mirror: typeof s.mirror === 'boolean' ? s.mirror : false,
    palette,
    intensity: num(s.intensity, 0, 100) ?? 80,
    softness: num(s.softness, 0, 100) ?? 50,
    texture: num(s.texture, 0, 100) ?? 65,
    amount: num(s.amount, 0, 100) ?? 55,
    variant: num(s.variant, 0, 100) ?? 50,
    warmth: num(s.warmth, -100, 100) ?? 0,
    tint: num(s.tint, -100, 100) ?? 0,
    fade: num(s.fade, 0, 100) ?? 0,
    contrast: num(s.contrast, -100, 100) ?? 0,
  };
}

/** Generated film leaks from untrusted JSON: invalid ones are dropped, at most MAX_FILM_LEAKS kept. */
export const parseFilmLeaks = (v: unknown): FilmLeak[] =>
  (Array.isArray(v) ? v : []).map(parseFilmLeak).filter((l): l is FilmLeak => l != null).slice(0, MAX_FILM_LEAKS);

export const MAX_FILM_LEAKS = 4;

/** Mulberry32: a small, fast 32-bit generator, the same one LightEffects uses (portable bit for bit). */
export function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const between = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
const pick = <T>(r: Rng, weights: readonly (readonly [T, number])[]): T => {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of weights) if ((x -= w) < 0) return v;
  return weights[weights.length - 1][0];
};

/** How often Random picks each type as the main layer. */
const TYPE_WEIGHTS: readonly (readonly [FilmLeakType, number])[] = [
  ['edge', 24], ['blob', 17], ['streak', 9], ['sprocket', 7], ['fog', 8], ['rebate', 5],
  ['flare', 6], ['start', 7], ['end', 5], ['tear', 3], ['stain', 3], ['dust', 3], ['scratches', 3],
];

const PALETTE_WEIGHTS: Record<FilmLeakType, readonly (readonly [FilmPalette, number])[]> = {
  edge: [['warm', 45], ['amber', 20], ['red', 20], ['cool', 8], ['magenta', 7]],
  blob: [['red', 45], ['warm', 30], ['magenta', 12], ['cool', 13]],
  streak: [['warm', 40], ['mono', 25], ['amber', 20], ['red', 15]],
  sprocket: [['warm', 50], ['red', 30], ['mono', 20]],
  fog: [['mono', 45], ['warm', 30], ['cool', 25]],
  rebate: [['red', 70], ['warm', 30]],
  flare: [['warm', 100]],
  start: [['warm', 40], ['amber', 35], ['red', 25]],
  end: [['warm', 70], ['red', 30]],
  tear: [['mono', 100]],
  dust: [['mono', 100]],
  stain: [['magenta', 35], ['amber', 35], ['green', 30]],
  scratches: [['mono', 100]],
};

/** Which side of the photo a layer of each type prefers: the short sides (film transport) or the long ones. */
const SIDE: Record<FilmLeakType, 'short' | 'long' | 'any'> = {
  edge: 'short', blob: 'any', streak: 'short', sprocket: 'long', fog: 'any', rebate: 'any', flare: 'any',
  start: 'short', end: 'short', tear: 'short', dust: 'any', stain: 'any', scratches: 'any',
};

/** A turn (0 left, 1 top, 2 right, 3 bottom) for a type on a photo of [aspect] (width / height). */
function sideFor(r: Rng, type: FilmLeakType, aspect: number): number {
  const shortSides = aspect >= 1 ? [0, 2] : [1, 3];
  const longSides = aspect >= 1 ? [1, 3] : [0, 2];
  const pref = SIDE[type];
  const pool = pref === 'any' ? [0, 1, 2, 3] : r() < 0.85 ? (pref === 'short' ? shortSides : longSides) : (pref === 'short' ? longSides : shortSides);
  return pool[Math.floor(r() * pool.length)];
}

/** A box flush with side [turn], [depth] deep (fraction across) and [along] long (fraction), [offset] along it. */
function sideBox(turn: number, depth: number, along: number, offset = 0.5, over = 0.02): Pick<FilmLeak, 'cx' | 'cy' | 'w' | 'h'> {
  // over: overhang the photo's edge a little, so a burn starts outside it (0 for what must hug the edge itself)
  const near = depth / 2 - over;
  switch (turn) {
    case 1: return { cx: offset, cy: near, w: along, h: depth };
    case 2: return { cx: 1 - near, cy: offset, w: depth, h: along };
    case 3: return { cx: offset, cy: 1 - near, w: along, h: depth };
    default: return { cx: near, cy: offset, w: depth, h: along };
  }
}

const round = (v: number) => Math.round(v);

/**
 * A plausible random layer of [type] (or a weighted random type) on a photo of [aspect] (width / height), drawn from
 * [seed] (0..1). [grade] gives it a colour grade for the whole photo (the main layer of a Random roll).
 */
export function randomFilmLeak(type: FilmLeakType | undefined, aspect: number, seed: number, grade = true): FilmLeak {
  const r = mulberry32(Math.floor(seed * 4294967296));
  const t = type ?? pick(r, TYPE_WEIGHTS);
  const turn = sideFor(r, t, aspect);
  const palette = pick(r, PALETTE_WEIGHTS[t]);
  let box = { cx: 0.5, cy: 0.5, w: 1.04, h: 1.04 };
  let amount = between(r, 30, 80);
  let intensity = between(r, 65, 100);
  let variant = between(r, 0, 100);
  switch (t) {
    case 'edge': box = sideBox(turn, between(r, 0.3, 0.8), 1.04); amount = between(r, 55, 85); break;
    case 'start': box = sideBox(turn, between(r, 0.45, 0.95), 1.04); amount = between(r, 45, 80); break;
    case 'end': box = sideBox(turn, between(r, 0.3, 0.7), 1.04); amount = between(r, 50, 80); intensity = 100; break;
    case 'tear': box = sideBox(turn, between(r, 0.14, 0.36), 1.04); amount = between(r, 20, 65); intensity = 100; break;
    case 'sprocket': box = sideBox(turn, between(r, 0.15, 0.4), 1.04); amount = between(r, 30, 80); break;
    case 'rebate': box = sideBox(turn, between(r, 0.06, 0.15), 1.04, 0.5, 0); amount = between(r, 20, 70); break;
    case 'blob': box = sideBox(turn, between(r, 0.5, 1.0), between(r, 0.6, 1.1), between(r, 0.2, 0.8)); amount = between(r, 30, 70); break;
    case 'flare': box = sideBox(turn, between(r, 0.6, 1.0), between(r, 0.6, 1.0), between(r, 0.15, 0.85)); amount = between(r, 20, 60); break;
    case 'streak': {
      const thick = between(r, 0.15, 0.45);
      const pos = between(r, 0.2, 0.8);
      box = turn % 2 === 0 ? { cx: 0.5, cy: pos, w: 1.1, h: thick } : { cx: pos, cy: 0.5, w: thick, h: 1.1 };
      amount = between(r, 15, 60);
      break;
    }
    case 'fog': intensity = between(r, 40, 80); break;
    case 'dust': box = { cx: 0.5, cy: 0.5, w: 1, h: 1 }; amount = between(r, 35, 85); intensity = between(r, 65, 95); break;
    case 'scratches': box = { cx: 0.5, cy: 0.5, w: 1, h: 1 }; amount = between(r, 35, 85); intensity = between(r, 65, 95); break;
    case 'stain': {
      const s = between(r, 0.35, 0.8);
      box = { cx: between(r, 0.25, 0.75), cy: between(r, 0.25, 0.75), w: s, h: s * aspect * between(r, 0.7, 1.3) };
      intensity = between(r, 50, 90);
      break;
    }
  }
  const warmBias = palette === 'cool' ? -1 : palette === 'mono' || palette === 'green' ? 0 : 1;
  return {
    id: newId(),
    enabled: true,
    type: t,
    seed: r(),
    ...box,
    turn,
    mirror: r() < 0.5,
    palette,
    intensity: round(intensity),
    softness: round(t === 'tear' ? between(r, 5, 28) : between(r, 25, 75)),
    texture: round(between(r, 40, 90)),
    amount: round(amount),
    variant: round(variant),
    warmth: grade ? round(warmBias * between(r, 5, 35) + between(r, -8, 8)) : 0,
    tint: grade ? round(between(r, -15, 15)) : 0,
    fade: grade ? round(between(r, 0, 35)) : 0,
    contrast: grade ? round(between(r, -25, 5)) : 0,
  };
}

/** Random (full): a main layer with its grade, sometimes with dust, a rebate glow or a second leak opposite. */
export function randomFilmRoll(aspect: number, seed: number): FilmLeak[] {
  const r = mulberry32(Math.floor(seed * 4294967296) ^ 0x9e3779b9);
  const main = randomFilmLeak(undefined, aspect, r());
  const out = [main];
  if (main.type !== 'dust' && main.type !== 'scratches' && r() < 0.3) {
    out.push(randomFilmLeak(r() < 0.45 ? 'scratches' : 'dust', aspect, r(), false));
  }
  if (main.type !== 'rebate' && main.type !== 'end' && r() < 0.15) out.push({ ...randomFilmLeak('rebate', aspect, r(), false), palette: main.palette === 'cool' ? 'red' : main.palette });
  if ((main.type === 'edge' || main.type === 'blob') && r() < 0.2) {
    const second = randomFilmLeak(main.type, aspect, r(), false);
    out.push({ ...sideMove(second, (main.turn + 2) % 4), palette: main.palette, intensity: round(second.intensity * 0.6) });
  }
  return out.slice(0, MAX_FILM_LEAKS);
}

/** Keeps the type (and grade) and rerolls the pattern only. */
export const newVariation = (l: FilmLeak, seed: number): FilmLeak => ({ ...l, seed });

/** Moves a side-hugging layer to another side of the photo, keeping its depth. */
export function sideMove(l: FilmLeak, turn: number): FilmLeak {
  const depth = l.turn % 2 === 0 ? l.w : l.h;
  const along = l.turn % 2 === 0 ? l.h : l.w;
  const offset = l.turn % 2 === 0 ? l.cy : l.cx;
  const hugs = !['streak', 'fog', 'dust', 'stain', 'scratches'].includes(l.type);
  return hugs ? { ...l, turn, ...sideBox(turn, depth, along, offset, l.type === 'rebate' ? 0 : 0.02) } : { ...l, turn };
}

export interface FilmLeakUniforms {
  count: number;
  box: Float32Array;
  form: Float32Array;
  tint: Float32Array;
  tint2: Float32Array;
  look: Float32Array;
  grade: Float32Array;
}

export const NO_FILM_LEAKS: FilmLeakUniforms = {
  count: 0,
  box: new Float32Array(MAX_FILM_LEAKS * 4),
  form: new Float32Array(MAX_FILM_LEAKS * 4),
  tint: new Float32Array(MAX_FILM_LEAKS * 4),
  tint2: new Float32Array(MAX_FILM_LEAKS * 4),
  look: new Float32Array(MAX_FILM_LEAKS * 4),
  grade: new Float32Array(MAX_FILM_LEAKS * 4),
};

/** The uniforms of film_leak.glsl for [leaks] on an image of width × height pixels. */
export function packFilmLeaks(leaks: readonly FilmLeak[], width: number, height: number): FilmLeakUniforms {
  const on = leaks.filter((l) => !filmLeakIsIdentity(l)).slice(0, MAX_FILM_LEAKS);
  const u: FilmLeakUniforms = {
    count: on.length,
    box: new Float32Array(MAX_FILM_LEAKS * 4),
    form: new Float32Array(MAX_FILM_LEAKS * 4),
    tint: new Float32Array(MAX_FILM_LEAKS * 4),
    tint2: new Float32Array(MAX_FILM_LEAKS * 4),
    look: new Float32Array(MAX_FILM_LEAKS * 4),
    grade: new Float32Array(MAX_FILM_LEAKS * 4),
  };
  on.forEach((l, i) => {
    const o = i * 4;
    const pal = PALETTE_RGB[l.palette];
    u.box.set([l.cx * width, l.cy * height, 2 / Math.max(l.w * width, 1), 2 / Math.max(l.h * height, 1)], o);
    u.form.set([FILM_LEAK_TYPES.indexOf(l.type), ((l.turn % 4) + 4) % 4, l.mirror ? 1 : 0, l.seed], o);
    u.tint.set([pal.a[0], pal.a[1], pal.a[2], l.intensity / 100], o);
    u.tint2.set([pal.b[0], pal.b[1], pal.b[2], l.variant / 100], o);
    u.look.set([l.softness / 100, l.texture / 100, l.amount / 100, 0], o);
    u.grade.set([l.warmth / 100, l.tint / 100, l.fade / 100, l.contrast / 100], o);
  });
  return u;
}
