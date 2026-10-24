import type { DevelopParams } from './DevelopParams';
import { parseLeaks, type LightLeak } from './LightLeaks';
import { parseLayers, type MaskLayer } from './Masks';
import { applyPreset } from './Presets';

/**
 * One photo's complete edit as JSON, the form RawBoy keeps in the photo's XMP sidecar (rawboy:Develop, opt-in on the
 * web: RawBoy Browser hands a sidecar to RawBoy with a photo). Unlike a preset it can hold every field, geometry and
 * brush strokes included, so the photo reopens as it was left. Only fields that differ from the photo's as-shot defaults
 * are kept: absolute values, but a small sidecar.
 */
export const EDITS_FORMAT = 'rawboy-edit';
export const EDITS_VERSION = 1;

/** Stroke points rounded to 1/100000 of the image: far below a pixel, and a much smaller sidecar. */
const round = (v: number) => Math.round(v * 1e5) / 1e5;

const valuesOf = (params: DevelopParams): Record<string, unknown> => {
  const { displaySource: _, clipLevel: _c, ...values } = params; // properties of the file, not edits
  return {
    ...values,
    masks: params.masks.map(({ id: _id, ...l }: MaskLayer) => ({
      ...l,
      strokes: l.strokes.map(({ id: _sid, ...s }) => ({ ...s, points: s.points.map(round) })),
    })),
    leaks: params.leaks.map(({ id: _id, ...l }: LightLeak) => l),
  };
};

/** [params] as edits JSON, or null when they are the photo's [defaults] (nothing to keep). */
export function encodeEdits(params: DevelopParams, defaults: DevelopParams): string | null {
  const base = valuesOf(defaults);
  const values = Object.fromEntries(Object.entries(valuesOf(params)).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base[k])));
  if (Object.keys(values).length === 0) return null;
  return JSON.stringify({ format: EDITS_FORMAT, version: EDITS_VERSION, values });
}

/**
 * The photo's [defaults] with the edits in [text]; fields missing from it (unedited, or newer than the RawBoy that
 * wrote it) keep their defaults and values of the wrong type are skipped. null when [text] isn't RawBoy edits.
 */
export function decodeEdits(text: string, defaults: DevelopParams): DevelopParams | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { format?: unknown }).format !== EDITS_FORMAT) return null;
  const raw = (parsed as { values?: unknown }).values;
  const { masks, leaks, flipHorizontal, flipVertical, ...values } = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const p = applyPreset({ id: '', name: '', groups: [], values: values as never }, defaults);
  return {
    ...p,
    rotation: ((Math.round(p.rotation) % 4) + 4) % 4,
    flipHorizontal: typeof flipHorizontal === 'boolean' ? flipHorizontal : defaults.flipHorizontal,
    flipVertical: typeof flipVertical === 'boolean' ? flipVertical : defaults.flipVertical,
    masks: masks === undefined ? defaults.masks : parseLayers(masks, true),
    leaks: leaks === undefined ? defaults.leaks : parseLeaks(leaks),
  };
}
