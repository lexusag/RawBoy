import { newId } from './Masks';

/**
 * Light leaks (Pro): film-style warm glows over the finished picture, dragged into place on the photo. At full
 * intensity a leak's core replaces what is under it, so it can tastefully cover part of a photo (shaders/light_leak.glsl).
 *
 * Geometry is a radial mask's (Masks.ts): centre (cx, cy) in fractions of the decoded image, radii rx/ry as fractions
 * of its long side, angle in degrees (clockwise), so a leak stays on the same content through crop, rotation and lens
 * corrections. softness 0..100 = the outer part of the radius over which the glow fades (the rest is its solid core);
 * intensity 0..100 (glow up to ~60, then it also covers: fully in the core at 100); hue in degrees, -40 (magenta-red)
 * .. 0 (red) .. 30 (orange) .. 60 (yellow); seed 0..1 picks the rim's uneven shape.
 *
 * Leaks belong to one photo's content: they reset for each new photo and presets don't keep them.
 */
export interface LightLeak {
  id: string;
  enabled: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  softness: number;
  intensity: number;
  hue: number;
  seed: number;
}

/** Uniform arrays in the shader are this long. */
export const MAX_LEAKS = 4;

export const LEAK_HUE_MIN = -40;
export const LEAK_HUE_MAX = 60;

/** A warm orange leak in the middle, solid enough to cover what is under its core. */
export const newLightLeak = (cx = 0.5, cy = 0.5): LightLeak => ({
  id: newId(), enabled: true, cx, cy, rx: 0.16, ry: 0.11, angle: -20, softness: 50, intensity: 100, hue: 22, seed: Math.round(Math.random() * 1000) / 1000,
});

/** The rim colour for [hue] (display RGB 0..1): fully saturated warm light, brightest at yellow. */
export function leakColor(hue: number): [number, number, number] {
  const h = Math.min(LEAK_HUE_MAX, Math.max(LEAK_HUE_MIN, hue));
  // HSV with value 1 and saturation 0.92, hue 0 = red; negative hues lean to magenta.
  const deg = (h + 360) % 360;
  const k = (n: number) => (n + deg / 60) % 6;
  const f = (n: number) => 1 - 0.92 * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

/** CSS colour of a hue's rim, for swatches. */
export const leakCss = (hue: number): string => {
  const [r, g, b] = leakColor(hue);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

export const leakIsIdentity = (l: LightLeak): boolean => !l.enabled || l.intensity <= 0;

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

/** A leak from untrusted JSON with a fresh id, or null when it isn't one. Ranges are clamped. */
export function parseLeak(o: unknown): LightLeak | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const [cx, cy, rx, ry] = [num(s.cx, -1, 2), num(s.cy, -1, 2), num(s.rx, 0.005, 3), num(s.ry, 0.005, 3)];
  if (cx == null || cy == null || rx == null || ry == null) return null;
  return {
    id: newId(),
    enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
    cx, cy, rx, ry,
    angle: num(s.angle, -360, 360) ?? 0,
    softness: num(s.softness, 0, 100) ?? 50,
    intensity: num(s.intensity, 0, 100) ?? 100,
    hue: num(s.hue, LEAK_HUE_MIN, LEAK_HUE_MAX) ?? 22,
    seed: num(s.seed, 0, 1) ?? 0,
  };
}

/** Leaks from untrusted JSON: invalid ones are dropped, at most MAX_LEAKS kept. */
export const parseLeaks = (v: unknown): LightLeak[] =>
  (Array.isArray(v) ? v : []).map(parseLeak).filter((l): l is LightLeak => l != null).slice(0, MAX_LEAKS);

/** Leaks packed for the shader's uniform arrays (see shaders/light_leak.glsl). */
export interface LeakUniforms {
  count: number;
  geom: Float32Array; // MAX_LEAKS x vec4
  shape: Float32Array; // MAX_LEAKS x vec4
  color: Float32Array; // MAX_LEAKS x vec4
}

export const NO_LEAKS: LeakUniforms = {
  count: 0,
  geom: new Float32Array(MAX_LEAKS * 4),
  shape: new Float32Array(MAX_LEAKS * 4),
  color: new Float32Array(MAX_LEAKS * 4),
};

/** Packs the leaks that show; positions go from image fractions to full-resolution image pixels. */
export function packLeaks(leaks: readonly LightLeak[], imageWidth: number, imageHeight: number): LeakUniforms {
  const used = leaks.filter((l) => !leakIsIdentity(l)).slice(0, MAX_LEAKS);
  if (used.length === 0) return NO_LEAKS;
  const u: LeakUniforms = {
    count: used.length,
    geom: new Float32Array(MAX_LEAKS * 4),
    shape: new Float32Array(MAX_LEAKS * 4),
    color: new Float32Array(MAX_LEAKS * 4),
  };
  const long = Math.max(imageWidth, imageHeight);
  used.forEach((l, i) => {
    const o = i * 4;
    const a = (l.angle * Math.PI) / 180;
    u.geom.set([l.cx * imageWidth, l.cy * imageHeight, 1 / Math.max(l.rx * long, 1), 1 / Math.max(l.ry * long, 1)], o);
    u.shape.set([Math.cos(a), Math.sin(a), Math.min(1, Math.max(0, l.softness / 100)), l.seed], o);
    u.color.set([...leakColor(l.hue), Math.min(1, Math.max(0, l.intensity / 100))], o);
  });
  return u;
}
