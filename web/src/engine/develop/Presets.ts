import { isMonochromeLut } from '../auto/looks/Look';
import { RetiredLooks } from '../auto/looks/RetiredLooks';
import { TONE_MAPPERS, type DevelopParams } from './DevelopParams';
import { forPreset, parseLayers, type MaskLayer } from './Masks';
import { parseCurves, type ToneCurves } from './ToneCurve';

/**
 * Groups of sliders a preset can hold (port of develop/Presets.kt). Geometry (rotation, flips, straighten, crop) belongs
 * to one photo and is never part of a preset. The key is the name in preset files (shared with Android).
 */
export type PresetGroup = 'light' | 'whiteBalance' | 'curves' | 'color' | 'detail' | 'denoise' | 'retouch' | 'lut' | 'lens' | 'masks';

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
  { key: 'detail', label: 'Detail', fields: ['localContrast', 'highpassContrast', 'grain', 'grainSize', 'grainRoughness', 'grainColor', 'bloom'] },
  // Its own group, off by default: RawBoy Auto measures denoise and sharpening on each photo (its ISO and noise), and
  // a preset overrides that only when it holds this group.
  { key: 'denoise', label: 'Denoise & sharpening', fields: ['denoise', 'colorDenoise', 'sharpening'] },
  { key: 'retouch', label: 'Retouch', fields: ['skinRetouch', 'blemishRemoval'] },
  { key: 'lut', label: 'LUT', fields: ['lut', 'lutAmount'] },
  { key: 'lens', label: 'Lens', fields: ['lensProfile', 'lensDistortion', 'vignetteAmount', 'vignetteMidpoint'] },
  { key: 'masks', label: 'Masks (gradients only)', fields: ['masks'] },
];

/**
 * What the save dialog ticks first: lens corrections are usually specific to one camera and lens, masks to one
 * composition, and denoise to one photo's noise (Auto measures it per photo).
 */
export const DEFAULT_PRESET_GROUPS: readonly PresetGroup[] = PRESET_GROUPS.map((g) => g.key).filter((k) => k !== 'lens' && k !== 'masks' && k !== 'denoise');

/**
 * A named set of slider values. values holds only the fields of groups; applying it overrides those and leaves
 * everything else as it is. id is local to one browser. lens is the lens name of the photo it was saved on ('' = the
 * file names none), absent for presets from before it was recorded.
 */
export interface Preset {
  id: string;
  name: string;
  groups: PresetGroup[];
  values: Partial<Record<keyof DevelopParams, number | boolean | string | null | readonly MaskLayer[] | ToneCurves>>;
  lens?: string;
}

/**
 * A lens preset holds the Lens group alone: RawBoy Auto applies it to photos taken with its lens on top of their look
 * (or RawBoy preset), changing only the lens corrections.
 */
export const isLensPreset = (p: Preset): boolean => p.groups.length === 1 && p.groups[0] === 'lens';

/**
 * The preset makes photos black and white: Saturation -100, or a bundled monochrome LUT at full strength (and no film
 * stock, which drops the LUT). Preset lists show these in their own section (port of Preset.isMonochrome).
 */
export function isMonochromePreset(p: Preset): boolean {
  const { saturation, lut, lutAmount, film } = p.values;
  if (typeof saturation === 'number' && saturation <= -100) return true;
  return film == null && typeof lut === 'string' && isMonochromeLut(lut) && (typeof lutAmount === 'number' ? lutAmount : 100) >= 100;
}

/**
 * Presets in sections for a list: colour ones, then black and white ones (isMonochromePreset) under their own
 * heading. With no black and white preset there is one section without a heading (port of Presets.sections).
 */
export function presetSections(presets: readonly Preset[]): { label: string | null; presets: Preset[] }[] {
  const mono = presets.filter(isMonochromePreset);
  if (mono.length === 0) return [{ label: null, presets: [...presets] }];
  const color = presets.filter((p) => !isMonochromePreset(p));
  return [
    ...(color.length > 0 ? [{ label: 'Color', presets: color }] : []),
    { label: 'Black & white', presets: mono },
  ];
}

export const PRESET_FORMAT = 'rawboy-preset';
export const PRESET_VERSION = 1;

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function capturePreset(name: string, params: DevelopParams, groups: readonly PresetGroup[], lens?: string): Preset {
  const values: Preset['values'] = {};
  const chosen = PRESET_GROUPS.filter((g) => groups.includes(g.key));
  for (const g of chosen) {
    for (const f of g.fields) {
      if (f === 'leaks') continue; // in no group: light leaks stay with the photo
      values[f] = f === 'masks' ? forPreset(params.masks) : params[f]; // strokes stay with the photo
    }
  }
  const preset: Preset = { id: newId(), name: name.trim(), groups: chosen.map((g) => g.key), values };
  if (lens !== undefined) preset.lens = lens.trim();
  return preset;
}

/**
 * A lens preset of params' lens corrections for the lens named lens, called name (by default after the lens, or "Lens
 * preset" when the file names none). Manual lenses record no name: their presets are named by hand and picked in Auto
 * (chosenLensPreset).
 */
export const captureLensPreset = (params: DevelopParams, lens: string, name: string = lens): Preset =>
  capturePreset(name.trim() || lens.trim() || 'Lens preset', params, ['lens'], lens.trim() || undefined);

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether preset was made for the lens named lens: same name, ignoring case and outer spaces; never a blank one. */
export const isPresetFor = (preset: Preset, lens: string): boolean =>
  lens.trim() !== '' && preset.lens !== undefined && same(preset.lens, lens);

/**
 * The lens preset among presets for the lens named lens (the last one when there are several); null if none or the file
 * names no lens (a manual lens: its presets are picked by hand, chosenLensPreset).
 */
export const lensPresetFor = (presets: readonly Preset[], lens: string): Preset | null =>
  presets.findLast((p) => isLensPreset(p) && isPresetFor(p, lens)) ?? null;

/** chosenLensPreset's choice for "no lens preset". */
export const NO_LENS_PRESET = 'none';

/**
 * The lens preset a photo taken with lens gets for choice: null = by its lens (lensPresetFor), NO_LENS_PRESET = none,
 * else the lens preset with that id (none if it was removed).
 */
export function chosenLensPreset(presets: readonly Preset[], choice: string | null, lens: string): Preset | null {
  if (choice === null) return lensPresetFor(presets, lens);
  if (choice === NO_LENS_PRESET) return null;
  return presets.find((p) => isLensPreset(p) && p.id === choice) ?? null;
}

/**
 * presets with lensPreset in place of the one it updates, keeping its id and position; else added at the end. It
 * updates the one of the same name for the same lens (or for no lens, as manual lenses record), so one photo can save
 * several named lens presets side by side.
 */
export function putLensPreset(presets: readonly Preset[], lensPreset: Preset): Preset[] {
  const old = sameLensPreset(presets, lensPreset);
  return old ? presets.map((p) => (p === old ? { ...lensPreset, id: old.id } : p)) : [...presets, lensPreset];
}

/**
 * The lens preset among presets that lensPreset stands for (putLensPreset would replace it): the one of the same name
 * for the same lens (or no lens); null if none. Finds a copy kept elsewhere (a sidecar) in this list.
 */
export function sameLensPreset(presets: readonly Preset[], lensPreset: Preset): Preset | null {
  const lens = lensPreset.lens?.trim() ?? '';
  return presets.findLast(
    (p) => isLensPreset(p) && (lens !== '' ? isPresetFor(p, lens) : !p.lens?.trim()) && same(p.name, lensPreset.name),
  ) ?? null;
}

/**
 * Whether RawBoy Auto develops a photo with preset in place of its look: it holds the Light group (tone mapper, film,
 * exposure), which is what a look is. Any other preset (only Detail, only Color...) changes just its own groups on top
 * of the photo's look, preset or RawBoy edits (layerPreset).
 */
export const replacesLook = (p: Preset): boolean => p.groups.includes('light');

/**
 * under with over's groups in place of its own, the rest of under as it was, named after both: a partial preset
 * (see replacesLook) applied on top of a photo's preset.
 */
export function layerPreset(under: Preset, over: Preset): Preset {
  const replaced = new Set(PRESET_GROUPS.filter((g) => over.groups.includes(g.key)).flatMap((g) => g.fields));
  const values: Preset['values'] = {};
  for (const [f, v] of Object.entries(under.values)) if (!replaced.has(f as keyof DevelopParams)) values[f as keyof DevelopParams] = v;
  Object.assign(values, over.values);
  const groups = PRESET_GROUPS.map((g) => g.key).filter((k) => under.groups.includes(k) || over.groups.includes(k));
  const preset: Preset = { id: newId(), name: `${under.name} + ${over.name}`, groups, values };
  if (under.lens !== undefined) preset.lens = under.lens;
  return preset;
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
  ...(p.lens !== undefined ? { lens: p.lens } : {}),
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
    const { name, lens, groups: rawGroups, values: rawValues } = o as { name?: unknown; lens?: unknown; groups?: unknown; values?: unknown };
    const groupKeys = Array.isArray(rawGroups) ? [...rawGroups] : [];
    const v = rawValues && typeof rawValues === 'object' ? (rawValues as Record<string, unknown>) : {};
    // Before denoise had its own group it was part of Detail (Android's presets still keep it there). A preset with
    // Detail but no Light (a denoise or grain preset) keeps its denoise; one with Light leaves denoise to Auto, as it did.
    const oldDetail = groupKeys.includes('detail') && !groupKeys.includes('denoise') && ['denoise', 'colorDenoise', 'sharpening'].some((f) => f in v);
    if (oldDetail && !groupKeys.includes('light')) groupKeys.push('denoise');
    const groups = PRESET_GROUPS.filter((g) => groupKeys.includes(g.key));
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
    const preset: Preset = { id: newId(), name: typeof name === 'string' && name.trim() ? name : 'Preset', groups: groups.map((g) => g.key), values };
    if (typeof lens === 'string') preset.lens = lens;
    return preset;
  });
}
