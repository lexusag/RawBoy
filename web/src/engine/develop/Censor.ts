import { newId } from './Masks';

/**
 * Censor (Pro's Artistic Paintbrush): areas of the photo painted over with an artistic effect that hides what is under
 * them (nudity for social media), applied to the *source* image before anything else develops it (CensorPass), so no
 * later stage (sharpening, clarity, bloom...) can bring the original back. See docs/rawboy.md, Censor.
 *
 * A layer is one effect over its own coverage: brush strokes (painted or erased, in order) and optionally one ellipse
 * (cx, cy, rx, ry as fractions of the image / of its long side, angle in degrees, like a radial mask). Positions are
 * fractions of the decoded image (display orientation, before crop and lens), so a layer stays on the content through
 * crop, rotation, flips and lens corrections.
 *
 * Strokes are vectors: points (flat x, y image fractions) through which a centripetal Catmull-Rom spline is drawn as
 * capsules (CensorRaster), with an optional radius per point (pen pressure). A stroke's colour (display sRGB "#rrggbb",
 * or absent: the area's own colours) is the paint the effect moves towards by [colourMix].
 *
 * The edge always falls off smoothly over the soft part of the brush (Hardness).
 *
 * Layers belong to one photo's content: never carried over, never in presets; edits sidecars keep them.
 */
export type CensorEffect = 'paint' | 'mosaic' | 'smear' | 'glass' | 'halftone' | 'hatching' | 'brush';
export type MosaicShape = 'square' | 'hex' | 'shards';

export const CENSOR_EFFECTS: readonly CensorEffect[] = ['paint', 'mosaic', 'smear', 'glass', 'halftone', 'hatching', 'brush'];
export const CENSOR_EFFECT_NAMES: Record<CensorEffect, string> = {
  paint: 'Oil paint',
  mosaic: 'Mosaic',
  smear: 'Smear',
  glass: 'Frosted glass',
  halftone: 'Halftone',
  hatching: 'Hatching',
  brush: 'Ink brush',
};
export const MOSAIC_SHAPES: readonly MosaicShape[] = ['square', 'hex', 'shards'];

/** Shader ids of the effects (censor.frag's uCensorKind.x) and mosaic shapes (uCensorKind.z). */
export const CENSOR_EFFECT_ID: Record<CensorEffect, number> = { paint: 0, mosaic: 1, smear: 2, glass: 3, halftone: 4, hatching: 5, brush: 6 };
export const MOSAIC_SHAPE_ID: Record<MosaicShape, number> = { square: 0, hex: 1, shards: 2 };
/** Each effect's own default Effect size (fraction of the long side): oil strokes and mosaic read best finer. */
export const CENSOR_DEFAULT_SIZES: Record<CensorEffect, number> = {
  paint: 0.011,
  mosaic: 0.013,
  smear: 0.025,
  glass: 0.025,
  halftone: 0.02,
  hatching: 0.02,
  brush: 0.02,
};
/** Old effect ids (first web version) and what they open as. */
const RETIRED_EFFECTS: Record<string, CensorEffect> = { ink: 'glass', heal: 'paint' };

export interface CensorStroke {
  id: string;
  erase: boolean;
  /** Fraction of the image's long side (at full pressure). */
  radius: number;
  /** 0..100: the soft part of the radius (100 = a hard edge, as the mask brush's hardness). */
  hardness: number;
  /** Flat x, y pairs, image fractions. */
  points: readonly number[];
  /** Optional radius factor per point (0..1, pen pressure), one per point; absent = 1 everywhere. */
  widths?: readonly number[];
  /** Display sRGB "#rrggbb" the effect moves towards, or absent: the area's own colours. */
  colour?: string;
  /** 0..100: how far the effect moves towards [colour]. */
  colourMix?: number;
}

export interface CensorEllipse {
  cx: number;
  cy: number;
  /** Radii as fractions of the image's long side (circles stay round). */
  rx: number;
  ry: number;
  /** Degrees, clockwise. */
  angle: number;
}

export interface CensorLayer {
  id: string;
  name: string;
  enabled: boolean;
  effect: CensorEffect;
  /** Effect scale (cell, dab, tile, smear length), fraction of the image's long side. */
  size: number;
  /** 0..100: how much of the original is replaced (100 = nothing of it). */
  strength: number;
  /** Pattern seed (New pattern rerolls it). */
  seed: number;
  mosaicShape: MosaicShape;
  /** 0..100, Mosaic: how strongly each piece is tinted like coloured glass (0 = the photo's own colours). */
  glassColour: number;
  /** 0..100, Halftone and Hatching: how far the print or the lines go from the area's own colour. */
  contrast: number;
  /** 0..100, Hatching: how much of the area's colour the paper and lines keep (0 = ink on paper). */
  keepColour: number;
  /** Optional ellipse coverage (the fastest cover), painted strokes add to it or erase from it. */
  ellipse: CensorEllipse | null;
  strokes: readonly CensorStroke[];
}

/** Layers per photo (one 2x2 atlas, like the mask brush). */
export const MAX_CENSOR_LAYERS = 4;
/** Strokes per layer and points per stroke (a longer drag stops adding). */
export const MAX_CENSOR_STROKES = 200;
export const MAX_CENSOR_POINTS = 4000;
/** Brush radius range, fractions of the long side. */
export const CENSOR_RADIUS_MIN = 0.002;
export const CENSOR_RADIUS_MAX = 0.15;
/**
 * Effect size range, fractions of the long side. The floor keeps every effect coarse enough that no contour or shading
 * of what it covers survives inside a cell (0.6% of a 6000 px photo is 36 px).
 */
export const CENSOR_SIZE_MIN = 0.006;
export const CENSOR_SIZE_MAX = 0.08;
export const DEFAULT_CENSOR_SIZE = 0.025;
/** Defaults of the effects' own sliders. */
export const DEFAULT_GLASS_COLOUR = 0;
export const DEFAULT_HALFTONE_CONTRAST = 50;
export const DEFAULT_HATCHING_CONTRAST = 70;
export const DEFAULT_KEEP_COLOUR = 60;
/** Pen pressure scales the radius between this and 1 (size only: opacity stays full, so a cover stays solid). */
export const PRESSURE_MIN_RADIUS = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const newCensorSeed = (): number => Math.floor(Math.random() * 100000) / 100;

export function newCensorLayer(effect: CensorEffect = 'paint', name = CENSOR_EFFECT_NAMES[effect]): CensorLayer {
  return {
    id: newId(),
    name,
    enabled: true,
    effect,
    size: CENSOR_DEFAULT_SIZES[effect],
    strength: 100,
    seed: newCensorSeed(),
    mosaicShape: 'square',
    glassColour: DEFAULT_GLASS_COLOUR,
    contrast: effect === 'hatching' ? DEFAULT_HATCHING_CONTRAST : DEFAULT_HALFTONE_CONTRAST,
    keepColour: DEFAULT_KEEP_COLOUR,
    ellipse: null,
    strokes: [],
  };
}

/** A new ellipse centred on image fractions (x, y). */
export const newCensorEllipse = (x = 0.5, y = 0.5, r = 0.05): CensorEllipse => ({ cx: x, cy: y, rx: r, ry: r * 0.8, angle: 0 });

/** Whether the layer covers anything at all. */
export const censorHasCoverage = (l: CensorLayer): boolean => l.ellipse != null || l.strokes.some((s) => !s.erase);

/** Layers the GPU pass draws: enabled, covering something, with some strength. */
export const activeCensorLayers = (layers: readonly CensorLayer[]): CensorLayer[] =>
  layers.filter((l) => l.enabled && l.strength > 0 && censorHasCoverage(l)).slice(0, MAX_CENSOR_LAYERS);

/** [layer] switched to [effect]: the effect's own default size and slider defaults, the rest kept. */
export function withCensorEffect(layer: CensorLayer, effect: CensorEffect): CensorLayer {
  if (layer.effect === effect) return layer;
  return {
    ...layer,
    effect,
    name: layer.name === CENSOR_EFFECT_NAMES[layer.effect] ? CENSOR_EFFECT_NAMES[effect] : layer.name,
    size: CENSOR_DEFAULT_SIZES[effect],
    contrast: effect === 'hatching' ? DEFAULT_HATCHING_CONTRAST : effect === 'halftone' ? DEFAULT_HALFTONE_CONTRAST : layer.contrast,
  };
}

/** "#rrggbb" -> display sRGB 0..1, or null. */
export function parseColour(hex: string | undefined): [number, number, number] | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function colourHex(rgb: readonly number[]): string {
  const c = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

/** [raw] (edits JSON, anything) as layers: unknown fields dropped, values clamped, ids made when missing. */
export function parseCensor(raw: unknown): CensorLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: CensorLayer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const effect = CENSOR_EFFECTS.includes(l.effect as CensorEffect)
      ? (l.effect as CensorEffect)
      : (RETIRED_EFFECTS[String(l.effect)] ?? 'paint');
    const e = l.ellipse as Record<string, unknown> | null | undefined;
    const ellipse =
      e && typeof e === 'object' && finite(e.cx) && finite(e.cy) && finite(e.rx) && finite(e.ry)
        ? { cx: clamp(e.cx, -0.5, 1.5), cy: clamp(e.cy, -0.5, 1.5), rx: clamp(e.rx, 0.001, 1), ry: clamp(e.ry, 0.001, 1), angle: finite(e.angle) ? e.angle : 0 }
        : null;
    const strokes: CensorStroke[] = [];
    if (Array.isArray(l.strokes)) {
      for (const sv of l.strokes) {
        if (!sv || typeof sv !== 'object') continue;
        const s = sv as Record<string, unknown>;
        if (!Array.isArray(s.points)) continue;
        const pts = s.points.slice(0, MAX_CENSOR_POINTS * 2).map((v) => (finite(v) ? clamp(v, -0.5, 1.5) : 0));
        const points = pts.slice(0, Math.floor(pts.length / 2) * 2);
        if (points.length < 2) continue;
        const n = points.length / 2;
        const widths = Array.isArray(s.widths) && s.widths.length === n ? s.widths.map((v) => (finite(v) ? clamp(v, 0, 1) : 1)) : undefined;
        const colour = typeof s.colour === 'string' && parseColour(s.colour) ? s.colour.toLowerCase() : undefined;
        strokes.push({
          id: typeof s.id === 'string' ? s.id : newId(),
          erase: s.erase === true,
          radius: finite(s.radius) ? clamp(s.radius, CENSOR_RADIUS_MIN, CENSOR_RADIUS_MAX) : 0.02,
          hardness: finite(s.hardness) ? clamp(s.hardness, 0, 100) : 50,
          points,
          ...(widths ? { widths } : {}),
          ...(colour ? { colour, colourMix: finite(s.colourMix) ? clamp(s.colourMix, 0, 100) : 100 } : {}),
        });
        if (strokes.length >= MAX_CENSOR_STROKES) break;
      }
    }
    out.push({
      id: typeof l.id === 'string' ? l.id : newId(),
      name: typeof l.name === 'string' ? l.name : CENSOR_EFFECT_NAMES[effect],
      enabled: l.enabled !== false,
      effect,
      size: finite(l.size) ? clamp(l.size, CENSOR_SIZE_MIN, CENSOR_SIZE_MAX) : DEFAULT_CENSOR_SIZE,
      strength: finite(l.strength) ? clamp(l.strength, 0, 100) : 100,
      seed: finite(l.seed) ? l.seed : 0,
      mosaicShape: MOSAIC_SHAPES.includes(l.mosaicShape as MosaicShape) ? (l.mosaicShape as MosaicShape) : 'square',
      glassColour: finite(l.glassColour) ? clamp(l.glassColour, 0, 100) : DEFAULT_GLASS_COLOUR,
      contrast: finite(l.contrast) ? clamp(l.contrast, 0, 100) : effect === 'hatching' ? DEFAULT_HATCHING_CONTRAST : DEFAULT_HALFTONE_CONTRAST,
      keepColour: finite(l.keepColour) ? clamp(l.keepColour, 0, 100) : DEFAULT_KEEP_COLOUR,
      ellipse,
      strokes,
    });
    if (out.length >= MAX_CENSOR_LAYERS) break;
  }
  return out;
}

/** Stroke points rounded to 1/100000 of the image (edits JSON), widths to 1/1000. */
export function censorForEdits(layers: readonly CensorLayer[]): unknown[] {
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
  return layers.map(({ id: _id, ...l }) => ({
    ...l,
    strokes: l.strokes.map(({ id: _sid, ...s }) => ({ ...s, points: s.points.map(r5), ...(s.widths ? { widths: s.widths.map(r3) } : {}) })),
  }));
}
