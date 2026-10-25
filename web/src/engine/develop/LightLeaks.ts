import { newId } from './Masks';

/**
 * Light leaks (Pro): film-style light over the finished picture, dragged into place on the photo, made like a
 * Photoshop light leak: a white shape, blurred, with an orange then a red outer glow, all in Screen mode
 * (shaders/light_leak.glsl). The photo shows through the glow; at full intensity the white core hides what is under it,
 * so a leak can tastefully cover part of a photo. The photo's grain lies over the leak.
 *
 * kind: 'streak' (a straight beam fading out past its ends), 'glow' (an ellipse) or 'triangle' (apex along the angle).
 * Geometry is a radial mask's (Masks.ts): centre (cx, cy) in fractions of the decoded image, radii rx/ry as fractions
 * of its long side (a streak: half length, half width; a triangle: apex to base, half base), angle in degrees
 * (clockwise), so a leak stays on the same content through crop, rotation and lens corrections.
 * softness 0..100 = the core's blur; glow 0..100 = how far the coloured glow reaches; bend -100..100 curves the shape
 * along its length (100: its ends move one length radius sideways); taper -100..100 narrows it towards one end; warp
 * 0..100 makes its edge uneven (seed 0..1 picks how); intensity 0..100; hue in degrees, -40 (magenta-red) .. 0 (red)
 * .. 37 (orange) .. 60 (yellow), the outer glow 37° redder.
 *
 * Leaks belong to one photo's content: they reset for each new photo and presets don't keep them.
 */
export type LeakKind = 'streak' | 'glow' | 'triangle';

export interface LightLeak {
  id: string;
  enabled: boolean;
  kind: LeakKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  softness: number;
  glow: number;
  bend: number;
  taper: number;
  warp: number;
  intensity: number;
  hue: number;
  seed: number;
}

/** Uniform arrays in the shader are this long. */
export const MAX_LEAKS = 4;

export const LEAK_HUE_MIN = -40;
export const LEAK_HUE_MAX = 60;
/** The default hue: Photoshop's (255, 156, 0) orange. */
export const LEAK_HUE = 37;
/** The outer glow's hue is this much redder: (255, 5, 5) beside that orange. */
const OUTER_SHIFT = 37;

export const LEAK_KINDS: readonly LeakKind[] = ['streak', 'glow', 'triangle'];
const KIND_INDEX: Record<LeakKind, number> = { glow: 0, streak: 1, triangle: 2 };

/** Size, angle, softness and glow a leak of each kind starts with (a streak crosses most of the photo). */
export const LEAK_DEFAULTS: Record<LeakKind, { rx: number; ry: number; angle: number; softness: number; glow: number }> = {
  streak: { rx: 0.6, ry: 0.015, angle: -20, softness: 60, glow: 55 },
  glow: { rx: 0.09, ry: 0.09, angle: 0, softness: 45, glow: 18 },
  triangle: { rx: 0.12, ry: 0.11, angle: -90, softness: 40, glow: 18 },
};

export const newLeakSeed = (): number => Math.round(Math.random() * 1000) / 1000;

/** A warm orange leak in the middle, solid enough to cover what is under its core. */
export const newLightLeak = (cx = 0.5, cy = 0.5, kind: LeakKind = 'streak'): LightLeak => ({
  id: newId(), enabled: true, kind, cx, cy, ...LEAK_DEFAULTS[kind], bend: 0, taper: 0, warp: 0, intensity: 100, hue: LEAK_HUE, seed: newLeakSeed(),
});

/** The leak turned into [kind], with that kind's size, angle, softness and glow; place, bend, colour and intensity stay. */
export const withLeakKind = (l: LightLeak, kind: LeakKind): LightLeak => (l.kind === kind ? l : { ...l, kind, ...LEAK_DEFAULTS[kind] });

/** Fully saturated light of [hue] (display RGB 0..1), hue 0 = red, negative hues lean to magenta. */
function hueColor(hue: number): [number, number, number] {
  const deg = ((hue % 360) + 360) % 360;
  const k = (n: number) => (n + deg / 60) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

/** The inner glow colour for [hue] (display RGB 0..1). */
export const leakColor = (hue: number): [number, number, number] => hueColor(Math.min(LEAK_HUE_MAX, Math.max(LEAK_HUE_MIN, hue)));

/** The outer glow colour for [hue]: the same light, redder. */
export const leakOuterColor = (hue: number): [number, number, number] =>
  hueColor(Math.min(LEAK_HUE_MAX, Math.max(LEAK_HUE_MIN, hue)) - OUTER_SHIFT);

/** CSS colour of a hue's inner glow, for swatches. */
export const leakCss = (hue: number): string => {
  const [r, g, b] = leakColor(hue);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

/** The glow slider 0..100 as the shader's glow reach, in shape radii. */
export const glowReach = (glow: number): number => 0.03 + (Math.min(100, Math.max(0, glow)) / 100) * 3;

/** The bend slider as the axis's curvature in 1/px for a length radius of [rxPx] pixels: v = k u². */
export const bendCurvature = (bend: number, rxPx: number): number => Math.min(1, Math.max(-1, bend / 100)) / Math.max(rxPx, 1);

/**
 * Signed edge distance in shape radii (0 on the outline, negative inside) of [q], a point in the shape's own frame
 * after bend and taper (the shader's leakEdge, without the warp). Triangle: apex (1, 0), base corners (-1, ±1), exact
 * distance outside, inside scaled by its inradius so the middle is -1 as for the other shapes.
 */
export function leakEdge(kind: LeakKind, qx: number, qy: number): number {
  if (kind === 'streak') return Math.abs(qy) - 1;
  if (kind === 'glow') return Math.hypot(qx, qy) - 1;
  const segment = (ax: number, ay: number, bx: number, by: number) => {
    const ex = bx - ax, ey = by - ay;
    const t = Math.min(1, Math.max(0, ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(qx - ax - ex * t, qy - ay - ey * t);
  };
  const d = Math.min(segment(1, 0, -1, 1), segment(-1, 1, -1, -1), segment(-1, -1, 1, 0));
  const inside = qx > -1 && qx + 2 * Math.abs(qy) < 1;
  return inside ? -d / TRIANGLE_INRADIUS : d;
}

/** The leak triangle's inradius in shape radii (base 2, height 2). */
const TRIANGLE_INRADIUS = 0.618;

/** The taper's width factor at [qx] (-1..1 along the length). */
export const taperWidth = (taper: number, qx: number): number => Math.max(1 + (taper / 100) * Math.min(1, Math.max(-1, qx)), 0.05);

export const leakIsIdentity = (l: LightLeak): boolean => !l.enabled || l.intensity <= 0;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

/** A leak from untrusted JSON with a fresh id, or null when it isn't one. Ranges are clamped. */
export function parseLeak(o: unknown): LightLeak | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const [cx, cy, rx, ry] = [num(s.cx, -1, 2), num(s.cy, -1, 2), num(s.rx, 0.002, 3), num(s.ry, 0.002, 3)];
  if (cx == null || cy == null || rx == null || ry == null) return null;
  const kind: LeakKind = s.kind === 'streak' || s.kind === 'triangle' ? s.kind : 'glow'; // leaks saved before streaks were glows
  return {
    id: newId(),
    enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
    kind,
    cx, cy, rx, ry,
    angle: num(s.angle, -360, 360) ?? 0,
    softness: num(s.softness, 0, 100) ?? LEAK_DEFAULTS[kind].softness,
    glow: num(s.glow, 0, 100) ?? LEAK_DEFAULTS[kind].glow,
    bend: num(s.bend, -100, 100) ?? 0,
    taper: num(s.taper, -100, 100) ?? 0,
    warp: num(s.warp, 0, 100) ?? 0,
    intensity: num(s.intensity, 0, 100) ?? 100,
    hue: num(s.hue, LEAK_HUE_MIN, LEAK_HUE_MAX) ?? LEAK_HUE,
    seed: num(s.seed, 0, 1) ?? 0,
  };
}

/** Leaks from untrusted JSON: invalid ones are dropped, at most MAX_LEAKS kept. */
export const parseLeaks = (v: unknown): LightLeak[] =>
  (Array.isArray(v) ? v : []).map(parseLeak).filter((l): l is LightLeak => l != null).slice(0, MAX_LEAKS);

/** Leaks packed for the shader's uniform arrays (see shaders/light_leak.glsl). */
export interface LeakUniforms {
  count: number;
  geom: Float32Array; // MAX_LEAKS x vec4 each
  shape: Float32Array;
  color: Float32Array;
  outer: Float32Array;
  form: Float32Array;
}

const emptyLeaks = (): LeakUniforms => ({
  count: 0,
  geom: new Float32Array(MAX_LEAKS * 4),
  shape: new Float32Array(MAX_LEAKS * 4),
  color: new Float32Array(MAX_LEAKS * 4),
  outer: new Float32Array(MAX_LEAKS * 4),
  form: new Float32Array(MAX_LEAKS * 4),
});

export const NO_LEAKS: LeakUniforms = emptyLeaks();

/** Packs the leaks that show; positions go from image fractions to full-resolution image pixels. */
export function packLeaks(leaks: readonly LightLeak[], imageWidth: number, imageHeight: number): LeakUniforms {
  const used = leaks.filter((l) => !leakIsIdentity(l)).slice(0, MAX_LEAKS);
  if (used.length === 0) return NO_LEAKS;
  const u = { ...emptyLeaks(), count: used.length };
  const long = Math.max(imageWidth, imageHeight);
  used.forEach((l, i) => {
    const o = i * 4;
    const a = (l.angle * Math.PI) / 180;
    const rxPx = Math.max(l.rx * long, 1);
    u.geom.set([l.cx * imageWidth, l.cy * imageHeight, 1 / rxPx, 1 / Math.max(l.ry * long, 1)], o);
    u.shape.set([Math.cos(a), Math.sin(a), Math.min(1, Math.max(0, l.softness / 100)), glowReach(l.glow)], o);
    u.color.set([...leakColor(l.hue), Math.min(1, Math.max(0, l.intensity / 100))], o);
    u.outer.set([...leakOuterColor(l.hue), l.seed], o);
    u.form.set([KIND_INDEX[l.kind], bendCurvature(l.bend, rxPx), Math.min(1, Math.max(0, l.warp / 100)), Math.min(1, Math.max(-1, l.taper / 100))], o);
  });
  return u;
}
