import { filmLookById } from '../../engine/auto/looks/FilmLooks';
import { lookById, type Look } from '../../engine/auto/looks/Look';
import { NO_ADJUSTMENTS, type Adjustments } from '../../engine/auto/looks/LookApplier';
import { developParams, type DevelopParams } from '../../engine/develop/DevelopParams';
import { decodeEdits, encodeEdits, EDITS_FORMAT, EDITS_VERSION } from '../../engine/develop/Edits';
import { decodePresets, encodePresets, type Preset } from '../../engine/develop/Presets';

/**
 * A photo's RawBoy Auto settings as kept in its XMP sidecar (rawboy:Auto, opt-in: RawBoy Browser's Edits in sidecars),
 * so the photo comes back to Auto as it was left. The analysis isn't kept: it is made again from the raw.
 */
export interface SavedAuto {
  mode: 'looks' | 'film';
  look: Look;
  filmLook: Look;
  strength: number;
  adjust: Adjustments;
  /** The preset itself (name, groups, values), so it doesn't depend on this browser's preset list. */
  preset: Preset | null;
  /** RawBoy edits (Back to Auto); stored as edits JSON against the global defaults, so no analysis is needed to read them. */
  edits: DevelopParams | null;
}

export const AUTO_FORMAT = 'rawboy-auto';
export const AUTO_VERSION = 1;

export function encodeAuto(s: SavedAuto): string {
  const edits = s.edits ? JSON.parse(encodeEdits(s.edits, developParams()) ?? JSON.stringify({ format: EDITS_FORMAT, version: EDITS_VERSION, values: {} })) : null;
  return JSON.stringify({
    format: AUTO_FORMAT, version: AUTO_VERSION, mode: s.mode, look: s.look.id, filmLook: s.filmLook.id, strength: s.strength,
    adjust: s.adjust, preset: s.preset ? JSON.parse(encodePresets([s.preset])) : null, edits,
  });
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** The settings in [text]; unknown or broken parts fall back to Auto's defaults. null when it isn't Auto's JSON. */
export function decodeAuto(text: string): SavedAuto | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || o.format !== AUTO_FORMAT) return null;
  const a = o.adjust && typeof o.adjust === 'object' ? (o.adjust as Record<string, unknown>) : {};
  const adjust = { ...NO_ADJUSTMENTS };
  for (const k of Object.keys(NO_ADJUSTMENTS) as (keyof Adjustments)[]) adjust[k] = num(a[k], k === 'rotation' ? 0 : -100, k === 'rotation' ? 3 : 100, 0);
  adjust.rotation = Math.round(adjust.rotation);
  let preset: Preset | null = null;
  try {
    preset = o.preset ? decodePresets(JSON.stringify(o.preset))[0] ?? null : null;
  } catch {
    // not a preset: the look develops it
  }
  return {
    mode: o.mode === 'film' ? 'film' : 'looks',
    look: lookById(typeof o.look === 'string' ? o.look : ''),
    filmLook: filmLookById(typeof o.filmLook === 'string' ? o.filmLook : ''),
    strength: num(o.strength, 0, 100, 100),
    adjust,
    preset,
    edits: o.edits ? decodeEdits(JSON.stringify(o.edits), developParams()) : null,
  };
}
