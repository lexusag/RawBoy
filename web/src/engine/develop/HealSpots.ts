import { newId } from './Masks';

/**
 * Healing brush (Pro, web): strokes the user painted over dust, blemishes and small objects. A click is a disk on the
 * photo, a drag a stroke of such disks along a path (path: the points after the first, flat x, y pairs). A disk's centre
 * (x, y) is in fractions of the decoded image (display orientation, before crop and lens, like masks), radius as a
 * fraction of its long side (circles stay round). It is healed in the full-resolution image, like Blemish removal, by
 * seamless (Poisson) cloning: inside the disk the picture takes the detail (grain, skin, foliage) of a source area and
 * the tone of its surroundings, so the repair has no smooth patch or visible edge.
 *
 * source: where the texture comes from (image fractions, the stroke's first point; the rest of the stroke keeps the same
 * offset, clone-stamp style), or null to let the engine pick the cleanest same-size area nearby for each disk. The repair
 * is seamless cloning, so its edge always matches the surroundings; feather 0..100 only sets how much of the old picture
 * stays near the edge (the outer part of half the radius, up to 50%).
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
  /** The stroke's points after the first (flat x, y image fractions); empty for a single click. */
  path: readonly number[];
}

/** Strokes per photo: every one is healed again whenever the list changes. */
export const MAX_HEAL_SPOTS = 64;
/** Points per stroke (a longer drag stops adding), and disks per photo's healing (the spacing widens past it). */
export const MAX_HEAL_POINTS = 1500;
const MAX_HEAL_DABS = 3000;
/** The brush radius range, fractions of the image's long side (0.04% of 6000 px = 2.4 px, 3% = 180 px; the engine floors a disk at 2 px). */
export const HEAL_RADIUS_MIN = 0.0004;
export const HEAL_RADIUS_MAX = 0.03;
export const DEFAULT_HEAL_FEATHER = 80;

export const newHealSpot = (
  x: number,
  y: number,
  radius: number,
  source: readonly [number, number] | null,
  feather = DEFAULT_HEAL_FEATHER,
): HealSpot => ({ id: newId(), x, y, radius, source, feather, path: [] });

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
      path: Array.isArray(s.path)
        ? s.path.slice(0, MAX_HEAL_POINTS * 2).map((v) => (finite(v) ? clamp(v, 0, 1) : 0)).slice(0, Math.floor(s.path.length / 2) * 2)
        : [],
    });
    if (out.length >= MAX_HEAL_SPOTS) break;
  }
  return out;
}

/**
 * The disks the engine heals for [spots], in order: (x, y, radius, srcX, srcY, feather) per disk in full-resolution
 * pixels of an image [width] x [height]; srcX is -1 without a source. A stroke is cut into disks a third of a radius
 * apart (wider on very long ones), each with the stroke's source offset.
 */
export function healStrokes(spots: readonly HealSpot[], width: number, height: number): Float32Array {
  const long = Math.max(width, height);
  const polylines = spots.map((s) => {
    const pts: [number, number][] = [[s.x * width, s.y * height]];
    for (let i = 0; i + 1 < s.path.length; i += 2) pts.push([s.path[i] * width, s.path[i + 1] * height]);
    return pts;
  });
  const length = (pts: [number, number][]) => pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  let spacing = 1 / 3;
  const count = (k: number) => spots.reduce((sum, s, i) => sum + 1 + Math.ceil(length(polylines[i]) / Math.max(1, Math.max(2, s.radius * long) * k)), 0);
  while (count(spacing) > MAX_HEAL_DABS) spacing *= 1.5;
  const out: number[] = [];
  spots.forEach((s, i) => {
    const r = Math.max(2, s.radius * long);
    const step = Math.max(1, r * spacing);
    const pts = polylines[i];
    const dx = s.source ? (s.source[0] - s.x) * width : 0;
    const dy = s.source ? (s.source[1] - s.y) * height : 0;
    const dab = (x: number, y: number) => out.push(x, y, r, s.source ? x + dx : -1, s.source ? y + dy : 0, s.feather / 100);
    dab(pts[0][0], pts[0][1]);
    let toNext = step; // distance along the path to the next disk
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1];
      const len = Math.hypot(pts[k][0] - x0, pts[k][1] - y0);
      let d = toNext;
      for (; d <= len; d += step) dab(x0 + ((pts[k][0] - x0) * d) / len, y0 + ((pts[k][1] - y0) * d) / len);
      toNext = d - len;
    }
    // The stroke's end gets a disk too.
    if (pts.length > 1) dab(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  });
  return Float32Array.from(out);
}

/** A key that changes whenever the healing the spots ask for does (ids don't count). */
export const healKey = (spots: readonly HealSpot[]): string =>
  spots
    .map(
      (s) =>
        `${s.x.toFixed(5)},${s.y.toFixed(5)},${s.radius.toFixed(5)},${s.source ? `${s.source[0].toFixed(5)},${s.source[1].toFixed(5)}` : '-'},${s.feather}` +
        (s.path.length ? `,${s.path.length}:${s.path.map((v) => v.toFixed(4)).join(' ')}` : ''),
    )
    .join(';');
