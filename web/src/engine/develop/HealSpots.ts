import { newId } from './Masks';

/**
 * Healing brush (Pro, web): spots the user painted over dust, blemishes and small objects. A spot is a disk on the photo:
 * centre (x, y) in fractions of the decoded image (display orientation, before crop and lens, like masks), radius as a
 * fraction of its long side (circles stay round). It is healed in the full-resolution image, like Blemish removal:
 * the tone inside the disk is filled in from its surroundings (a membrane over the smoothed picture) and the texture
 * (grain, skin, foliage) is carried over from a source disk, so the repair has no smooth patch or visible edge.
 *
 * source: the centre of the disk the texture comes from (image fractions), or null to let the engine pick the cleanest
 * same-size disk nearby. feather 0..100 = the outer part of the radius over which the healing fades into the photo.
 *
 * Spots belong to one photo's content: they reset for each new photo and presets don't keep them (edits sidecars do).
 */
export interface HealSpot {
  id: string;
  x: number;
  y: number;
  radius: number;
  source: readonly [number, number] | null;
  feather: number;
}

/** Spots per photo: every one is healed again whenever the list changes. */
export const MAX_HEAL_SPOTS = 64;
/** The brush radius range, fractions of the image's long side (0.2% of 6000 px = 12 px, 3% = 180 px). */
export const HEAL_RADIUS_MIN = 0.002;
export const HEAL_RADIUS_MAX = 0.03;
export const DEFAULT_HEAL_FEATHER = 40;

export const newHealSpot = (
  x: number,
  y: number,
  radius: number,
  source: readonly [number, number] | null,
  feather = DEFAULT_HEAL_FEATHER,
): HealSpot => ({ id: newId(), x, y, radius, source, feather });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Spots from untrusted JSON: invalid ones are dropped, at most MAX_HEAL_SPOTS kept, values brought into range. */
export function parseHealSpots(v: unknown): HealSpot[] {
  const out: HealSpot[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (!finite(s.x) || !finite(s.y) || !finite(s.radius)) continue;
    const src = Array.isArray(s.source) && finite(s.source[0]) && finite(s.source[1]) ? ([clamp(s.source[0], 0, 1), clamp(s.source[1], 0, 1)] as const) : null;
    out.push({
      id: newId(),
      x: clamp(s.x, 0, 1),
      y: clamp(s.y, 0, 1),
      radius: clamp(s.radius, HEAL_RADIUS_MIN, HEAL_RADIUS_MAX),
      source: src,
      feather: finite(s.feather) ? clamp(s.feather, 0, 100) : DEFAULT_HEAL_FEATHER,
    });
    if (out.length >= MAX_HEAL_SPOTS) break;
  }
  return out;
}

/**
 * The spots as the engine takes them: (x, y, radius, srcX, srcY, feather) per spot in full-resolution pixels of an image
 * [width] x [height]; srcX is -1 without a source.
 */
export function healStrokes(spots: readonly HealSpot[], width: number, height: number): Float32Array {
  const long = Math.max(width, height);
  const out = new Float32Array(spots.length * 6);
  spots.forEach((s, i) => {
    out.set(
      [s.x * width, s.y * height, Math.max(2, s.radius * long), s.source ? s.source[0] * width : -1, s.source ? s.source[1] * height : 0, s.feather / 100],
      i * 6,
    );
  });
  return out;
}

/** A key that changes whenever the healing the spots ask for does (ids don't count). */
export const healKey = (spots: readonly HealSpot[]): string =>
  spots
    .map((s) => `${s.x.toFixed(5)},${s.y.toFixed(5)},${s.radius.toFixed(5)},${s.source ? `${s.source[0].toFixed(5)},${s.source[1].toFixed(5)}` : '-'},${s.feather}`)
    .join(';');
