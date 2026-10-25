/**
 * Mask layers (Capture One style): each layer is a gradient mask with its own adjustments, blended over the global
 * develop. Positions are fractions of the decoded image (display orientation, before crop and lens), so a gradient
 * stays on the same scene content when the photo is cropped, straightened, rotated or lens-corrected.
 *
 * - linear: full effect on the (x0, y0) side, fading to none at (x1, y1). curve -100..100 bends the lines into arcs:
 *   + pulls their ends towards the full-effect side (a dome over a horizon), 0 = straight.
 * - radial: centre (cx, cy), radii rx/ry as fractions of the image's long side (circles stay round), angle in
 *   degrees (clockwise), feather 0..100 = the outer part of the radius over which the effect fades.
 * - stripe: a band (light leaks' streak) with a radial's geometry: centre (cx, cy), half length rx and half width ry
 *   (fractions of the long side), angle in degrees (clockwise). feather 0..100 = the outer part of the half width over
 *   which the effect fades (the ends fade over the same distance); bend -100..100 curves it along its length (100: its
 *   ends move one half length sideways), taper -100..100 narrows it towards one end, as a light leak's.
 * - brush: no gradient; the mask is only what is painted.
 *
 * Any layer can also be painted on: strokes add to its mask (brush) or take away from it (erase, also from the
 * gradient), in order. Strokes belong to one photo's content, so presets never keep them (see forPreset).
 *
 * Adjustments use the global sliders' units (exposure EV -5..5, others -100..100). Temperature and tint are offsets
 * from the global white balance (+ = warmer / more magenta, as the global sliders). All 0 = no change.
 */
export type MaskShape =
  | { kind: 'linear'; x0: number; y0: number; x1: number; y1: number; curve: number }
  | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number }
  | { kind: 'stripe'; cx: number; cy: number; rx: number; ry: number; angle: number; feather: number; bend: number; taper: number }
  | { kind: 'brush' };

/** One brush or erase stroke. Positions are image fractions, like gradient positions. */
export interface BrushStroke {
  id: string;
  erase: boolean;
  /** Auto mask: paint only on colours like the one under the brush centre. */
  auto: boolean;
  /** Fraction of the image's long side. */
  radius: number;
  /** 0..100 */
  hardness: number;
  /** 1..100: how much one pass adds. */
  flow: number;
  /** Flat x, y pairs. */
  points: readonly number[];
}

export interface LayerAdjust {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  clarity: number;
  /** 0..100: lens blur (round, bokeh-like discs), up to MAX_LENS_BLUR of the long side at 100. */
  lensBlur: number;
}

export interface MaskLayer {
  id: string;
  name: string;
  enabled: boolean;
  /** 0..100 */
  opacity: number;
  invert: boolean;
  shape: MaskShape;
  adjust: LayerAdjust;
  strokes: readonly BrushStroke[];
}

/**
 * Linear curvature: at curve 100 the lines' ends, half the image's long side from the middle, are pulled this many
 * long sides along the gradient. Shared by the shader packing and the overlay so both bend alike.
 */
export const CURVE_SCALE = 0.5;

/** How far (px) a linear mask's lines are pulled along the gradient at perpendicular distance s (px). */
export const curveOffset = (curve: number, s: number, long: number): number => ((curve / 100) * CURVE_SCALE * 4 * s * s) / long;

/** Uniform arrays in the shader are this long. */
export const MAX_LAYERS = 4;

export const LAYER_ADJUST_KEYS: readonly (keyof LayerAdjust)[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'tint', 'saturation', 'clarity', 'lensBlur',
];

/** Lens blur radius at 100, a fraction of the image's long side. */
export const MAX_LENS_BLUR = 0.03;

export const NO_ADJUST: Readonly<LayerAdjust> = Object.freeze({
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, clarity: 0, lensBlur: 0,
});

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** A graduated filter for the sky: full at the top, gone by the middle. */
export const newLinearLayer = (name = 'Linear'): MaskLayer => ({
  id: newId(), name, enabled: true, opacity: 100, invert: false,
  shape: { kind: 'linear', x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.5, curve: 0 },
  adjust: { ...NO_ADJUST },
  strokes: [],
});

/** A centred ellipse with a soft edge. */
export const newRadialLayer = (name = 'Radial'): MaskLayer => ({
  id: newId(), name, enabled: true, opacity: 100, invert: false,
  shape: { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18, angle: 0, feather: 50 },
  adjust: { ...NO_ADJUST },
  strokes: [],
});

/** A soft horizontal band across the middle, a little longer than the photo is wide (its length handles just past the edges). */
export const newStripeLayer = (name = 'Stripe'): MaskLayer => ({
  id: newId(), name, enabled: true, opacity: 100, invert: false,
  shape: { kind: 'stripe', cx: 0.5, cy: 0.5, rx: 0.55, ry: 0.08, angle: 0, feather: 50, bend: 0, taper: 0 },
  adjust: { ...NO_ADJUST },
  strokes: [],
});

/** Nothing until painted. */
export const newBrushLayer = (name = 'Brush'): MaskLayer => ({
  id: newId(), name, enabled: true, opacity: 100, invert: false,
  shape: { kind: 'brush' },
  adjust: { ...NO_ADJUST },
  strokes: [],
});

export const SHAPE_NAMES: Record<MaskShape['kind'], string> = { linear: 'Linear', radial: 'Radial', stripe: 'Stripe', brush: 'Brush' };

/** Brush radius limits, fractions of the long side (the upper one bounds the cost of one dab). */
export const MIN_BRUSH_RADIUS = 0.002;
export const MAX_BRUSH_RADIUS = 0.15;

/** The layers as a preset keeps them: gradients without strokes; brush-only layers are dropped. */
export const forPreset = (layers: readonly MaskLayer[]): MaskLayer[] =>
  layers.filter((l) => l.shape.kind !== 'brush').map((l) => (l.strokes.length ? { ...l, strokes: [] } : l));

/** True when the layer can't change the image (off, transparent or no adjustments). */
export const layerIsIdentity = (l: MaskLayer): boolean =>
  !l.enabled || l.opacity <= 0 || LAYER_ADJUST_KEYS.every((k) => l.adjust[k] === 0);

const ADJUST_RANGE: Record<keyof LayerAdjust, [number, number]> = {
  exposure: [-5, 5], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100], temperature: [-100, 100],
  tint: [-100, 100], saturation: [-100, 100], clarity: [-100, 100], lensBlur: [0, 100],
};

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;

function parseShape(o: unknown, brush: boolean): MaskShape | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  if (s.kind === 'brush') return brush ? { kind: 'brush' } : null;
  const f = (k: string, min = -1, max = 2) => num(s[k], min, max);
  if (s.kind === 'linear') {
    const [x0, y0, x1, y1] = [f('x0'), f('y0'), f('x1'), f('y1')];
    if (x0 == null || y0 == null || x1 == null || y1 == null) return null;
    return { kind: 'linear', x0, y0, x1, y1, curve: f('curve', -100, 100) ?? 0 }; // older files: straight
  }
  if (s.kind === 'radial') {
    const [cx, cy, rx, ry, angle, feather] = [f('cx'), f('cy'), f('rx', 0.005, 3), f('ry', 0.005, 3), f('angle', -360, 360), f('feather', 0, 100)];
    if (cx == null || cy == null || rx == null || ry == null || angle == null || feather == null) return null;
    return { kind: 'radial', cx, cy, rx, ry, angle, feather };
  }
  if (s.kind === 'stripe') {
    const [cx, cy, rx, ry, angle, feather] = [f('cx'), f('cy'), f('rx', 0.005, 3), f('ry', 0.002, 3), f('angle', -360, 360), f('feather', 0, 100)];
    if (cx == null || cy == null || rx == null || ry == null || angle == null || feather == null) return null;
    return { kind: 'stripe', cx, cy, rx, ry, angle, feather, bend: f('bend', -100, 100) ?? 0, taper: f('taper', -100, 100) ?? 0 };
  }
  return null;
}

function parseStroke(o: unknown): BrushStroke | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const points = Array.isArray(s.points) ? s.points.map((v) => num(v, -1, 2)) : [];
  const radius = num(s.radius, MIN_BRUSH_RADIUS, MAX_BRUSH_RADIUS);
  if (radius == null || points.length < 2 || points.length % 2 || points.some((v) => v == null)) return null;
  return {
    id: newId(), erase: s.erase === true, auto: s.auto === true, radius,
    hardness: num(s.hardness, 0, 100) ?? 50, flow: num(s.flow, 1, 100) ?? 100, points: points as number[],
  };
}

/**
 * A layer from untrusted JSON with a fresh id, or null when it isn't one. Ranges are clamped. Preset files hold
 * gradients only; [strokes] (a photo's own saved edits, Edits.ts) also keeps brush layers and every layer's strokes.
 */
export function parseLayer(o: unknown, strokes = false): MaskLayer | null {
  if (!o || typeof o !== 'object') return null;
  const l = o as Record<string, unknown>;
  const shape = parseShape(l.shape, strokes);
  if (!shape) return null;
  const a = l.adjust && typeof l.adjust === 'object' ? (l.adjust as Record<string, unknown>) : {};
  const adjust = { ...NO_ADJUST };
  for (const k of LAYER_ADJUST_KEYS) adjust[k] = num(a[k], ...ADJUST_RANGE[k]) ?? 0;
  return {
    id: newId(),
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : SHAPE_NAMES[shape.kind],
    enabled: typeof l.enabled === 'boolean' ? l.enabled : true,
    opacity: num(l.opacity, 0, 100) ?? 100,
    invert: l.invert === true,
    shape,
    adjust,
    // Strokes never come from presets.
    strokes: strokes && Array.isArray(l.strokes) ? l.strokes.map(parseStroke).filter((s): s is BrushStroke => s != null) : [],
  };
}

/** Layers from untrusted JSON: invalid ones are dropped, at most MAX_LAYERS kept; [strokes] as for parseLayer. */
export const parseLayers = (v: unknown, strokes = false): MaskLayer[] =>
  (Array.isArray(v) ? v : []).map((o) => parseLayer(o, strokes)).filter((l): l is MaskLayer => l != null).slice(0, MAX_LAYERS);
