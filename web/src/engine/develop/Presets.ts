import { RetiredLooks } from '../auto/looks/RetiredLooks';
import { TONE_MAPPERS, type DevelopParams } from './DevelopParams';
import { forPreset, parseLayers, type MaskLayer } from './Masks';
import { parseCurves, type ToneCurves } from './ToneCurve';

/**
 * Groups of sliders a preset can hold (port of develop/Presets.kt). Geometry (rotation, flips, straighten, crop) belongs
 * to one photo and is never part of a preset. The key is the name in preset files (shared with Android).
 */
export type PresetGroup = 'light' | 'whiteBalance' | 'curves' | 'color' | 'detail' | 'retouch' | 'lut' | 'lens' | 'masks';

export const PRESET_GROUPS: readonly { key: PresetGroup; label: string; fields: readonly (keyof DevelopParams)[] }[] = [
  {
    key: 'light',
    label: 'Light',
    // The film fields belong to the tone mapper: Film is its fourth choice (film != null).
    fields: ['toneMapper', 'film', 'filmAmount', 'filmGrain', 'halation', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  },
  { key: 'whiteBalance', label: 'White balance', fields: ['temperature', 'tint'] },
  { key: 'curves', label: 'Curves', fields: ['curves'] },
  {
    key: 'color',
    label: 'Color',
    fields: ['saturation', 'redHue', 'redPurity', 'greenHue', 'greenPurity', 'blueHue', 'bluePurity', 'tintHue', 'tintPurity'],
  },
  { key: 'detail', label: 'Detail', fields: ['denoise', 'colorDenoise', 'sharpening', 'localContrast', 'highpassContrast', 'grain', 'bloom'] },
  { key: 'retouch', label: 'Retouch', fields: ['skinRetouch', 'blemishRemoval'] },
  { key: 'lut', label: 'LUT', fields: ['lut', 'lutAmount'] },
  { key: 'lens', label: 'Lens', fields: ['lensProfile', 'lensDistortion', 'vignetteAmount', 'vignetteMidpoint'] },
  { key: 'masks', label: 'Masks (gradients only)', fields: ['masks'] },
];

/** What the save dialog ticks first: white balance is usually specific to one light, masks to one composition. */
export const DEFAULT_PRESET_GROUPS: readonly PresetGroup[] = PRESET_GROUPS.map((g) => g.key).filter((k) => k !== 'whiteBalance' && k !== 'masks');

/**
 * A named set of slider values. values holds only the fields of groups; applying it overrides those and leaves
 * everything else as it is. id is local to one browser.
 */
export interface Preset {
  id: string;
  name: string;
  groups: PresetGroup[];
  values: Partial<Record<keyof DevelopParams, number | boolean | string | null | readonly MaskLayer[] | ToneCurves>>;
}

export const PRESET_FORMAT = 'rawboy-preset';
export const PRESET_VERSION = 1;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function capturePreset(name: string, params: DevelopParams, groups: readonly PresetGroup[]): Preset {
  const values: Preset['values'] = {};
  const chosen = PRESET_GROUPS.filter((g) => groups.includes(g.key));
  for (const g of chosen) for (const f of g.fields) values[f] = f === 'masks' ? forPreset(params.masks) : params[f]; // strokes stay with the photo
  return { id: newId(), name: name.trim(), groups: chosen.map((g) => g.key), values };
}

/** params with the preset's stored fields; a value of the wrong type (a hand-edited file) leaves the field. */
export function applyPreset(preset: Preset, params: DevelopParams): DevelopParams {
  const p: Record<string, unknown> = { ...params };
  for (const [field, value] of Object.entries(preset.values)) {
    if (field === 'masks') {
      p.masks = parseLayers(value); // fresh ids, so two photos never share a layer id
    } else if (field === 'curves') {
      const c = parseCurves(value);
      if (c) p.curves = c;
    } else if (field === 'lut' || field === 'film') {
      if (value === null) p[field] = value;
      else if (typeof value === 'string') p[field] = field === 'lut' ? RetiredLooks.lut(value) : RetiredLooks.stock(value);
    } else if (field === 'colorDenoise') {
      if (value === null || (typeof value === 'number' && Number.isFinite(value))) p.colorDenoise = value;
    } else if (field === 'lensProfile') {
      if (typeof value === 'boolean') p.lensProfile = value;
    } else if (field === 'toneMapper') {
      if (TONE_MAPPERS.some((m) => m.key === value)) p.toneMapper = value;
    } else if (typeof value === 'number' && Number.isFinite(value) && typeof p[field] === 'number') {
      p[field] = value;
    }
  }
  return p as unknown as DevelopParams;
}

const toJson = (p: Preset) => ({
  format: PRESET_FORMAT,
  version: PRESET_VERSION,
  name: p.name,
  groups: PRESET_GROUPS.map((g) => g.key).filter((k) => p.groups.includes(k)),
  values: p.values,
});

/** One preset as an object, several as an array (what "Export all" writes). */
export function encodePresets(presets: readonly Preset[]): string {
  return JSON.stringify(presets.length === 1 ? toJson(presets[0]) : presets.map(toJson), null, 2);
}

/**
 * Presets in text (an object or an array of them), each with a fresh id. Unknown groups and fields are skipped,
 * so files from newer versions still load. Throws on text that isn't a preset file.
 */
export function decodePresets(text: string): Preset[] {
  const parsed: unknown = JSON.parse(text);
  const objects = Array.isArray(parsed) ? parsed : [parsed];
  return objects.map((o) => {
    if (!o || typeof o !== 'object' || (o as { format?: unknown }).format !== PRESET_FORMAT) throw new Error('Not a RawBoy preset');
    const { name, groups: rawGroups, values: rawValues } = o as { name?: unknown; groups?: unknown; values?: unknown };
    const groupKeys = Array.isArray(rawGroups) ? rawGroups : [];
    const groups = PRESET_GROUPS.filter((g) => groupKeys.includes(g.key));
    const v = rawValues && typeof rawValues === 'object' ? (rawValues as Record<string, unknown>) : {};
    const values: Preset['values'] = {};
    for (const g of groups) {
      for (const f of g.fields) {
        const x = v[f];
        if (f === 'masks') values.masks = parseLayers(x);
        else if (f === 'curves') {
          const c = parseCurves(x);
          if (c) values.curves = c;
        }
        else if (x === null || typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') values[f] = x;
      }
    }
    // Presets from before the separate colour denoise had one denoise for both: colour follows it.
    if ('denoise' in values && groups.some((g) => g.fields.includes('colorDenoise')) && !('colorDenoise' in v)) values.colorDenoise = null;
    return { id: newId(), name: typeof name === 'string' && name.trim() ? name : 'Preset', groups: groups.map((g) => g.key), values };
  });
}
