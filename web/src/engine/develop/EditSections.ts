import type { DevelopParams } from './DevelopParams';

/**
 * The Pro editor's sections as units that can be switched off: a section that is off keeps its values in the params
 * (`disabledSections`) but renders as the photo's defaults ([effectiveParams]). The same ids and fields as the Mac
 * inspector's (`EditSections.swift`): keep them in step. The tone mapper and the film stock are not part of Light.
 */
export const EDIT_SECTIONS = ['light', 'curve', 'colour', 'primaries', 'detail', 'portrait', 'effects', 'lut', 'lens'] as const;
export type EditSectionId = (typeof EDIT_SECTIONS)[number];

export const EDIT_SECTION_FIELDS: Record<EditSectionId, readonly (keyof DevelopParams)[]> = {
  light: ['exposure', 'contrast', 'lumaContrast', 'highlights', 'shadows', 'whites', 'blacks', 'filmAmount', 'filmGrain', 'halation'],
  curve: ['curves'],
  colour: ['temperature', 'tint', 'saturation'],
  primaries: ['redHue', 'redPurity', 'greenHue', 'greenPurity', 'blueHue', 'bluePurity', 'tintHue', 'tintPurity'],
  detail: ['denoise', 'colorDenoise', 'sharpening', 'localContrast', 'highpassContrast'],
  portrait: ['depthBlur', 'depthFocus', 'depthFalloff', 'depthEdge', 'skinRetouch', 'blemishRemoval', 'portraitRetouch'],
  effects: ['bloom', 'anamorphic', 'anamorphicColor', 'anamorphicGhosts', 'grain', 'grainSize', 'grainRoughness', 'grainColor'],
  lut: ['lut', 'lutAmount'],
  lens: [
    'lensProfile', 'lensDistortion', 'lensAnamorphic', 'lensCrop', 'lensFisheye', 'lensFisheyeFov', 'lensFisheyeAuto',
    'lensFisheyeCircle', 'lensFisheyeX', 'lensFisheyeY', 'vignetteAmount', 'vignetteMidpoint', 'caRed', 'caBlue',
  ],
};

/** The controls tabs, each switching the sections it shows. */
export const TAB_SECTIONS: Record<string, readonly EditSectionId[]> = {
  Light: ['light', 'curve'],
  Color: ['colour', 'primaries'],
  Detail: ['detail', 'portrait', 'effects'],
  LUTs: ['lut'],
  Lens: ['lens'],
};

/** [p]'s fields of [section] put back to [defaults]'. */
export function restoreSection(p: DevelopParams, defaults: DevelopParams, section: EditSectionId): DevelopParams {
  const out: Record<string, unknown> = { ...p };
  for (const f of EDIT_SECTION_FIELDS[section]) out[f] = defaults[f];
  return out as unknown as DevelopParams;
}

/** What to render for [p]: its switched-off sections as the photo's [defaults]. Preview, histogram and export take their params through this. */
export function effectiveParams(p: DevelopParams, defaults: DevelopParams): DevelopParams {
  const off = p.disabledSections;
  if (!off || off.length === 0) return p;
  let out = p;
  for (const s of EDIT_SECTIONS) if (off.includes(s)) out = restoreSection(out, defaults, s);
  return out;
}

/** Whether [section] holds any edit, or is switched off (it then keeps its switch to be brought back). */
export function sectionHasEdits(p: DevelopParams, defaults: DevelopParams, section: EditSectionId): boolean {
  if (p.disabledSections?.includes(section)) return true;
  return EDIT_SECTION_FIELDS[section].some((f) => JSON.stringify(p[f]) !== JSON.stringify(defaults[f]));
}

/** [p] with [sections] switched on or off. */
export function withSectionsEnabled(p: DevelopParams, sections: readonly EditSectionId[], on: boolean): DevelopParams {
  const current = p.disabledSections ?? [];
  const next = on ? current.filter((s) => !sections.includes(s as EditSectionId)) : [...new Set([...current, ...sections])];
  return { ...p, disabledSections: EDIT_SECTIONS.filter((s) => next.includes(s)) };
}
