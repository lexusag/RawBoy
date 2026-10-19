import { Warmth } from '../analysis/Warmth';
import type { DevelopParams } from '../../develop/DevelopParams';
import { applyPreset, replacesLook, type Preset } from '../../develop/Presets';
import { lutIdOf, type Look } from './Look';

/**
 * The user's controls on top of the auto develop and the look; all 0 = as suggested. [brightness] -100..100 shifts
 * exposure; [warmth] -100..100 warms or cools; [tint] -50..50 (+ = magenta), [contrast] -50..50, [saturation]
 * -100..100, [grain] -50..50 and [denoise] -100..100 are added to the slider values the auto develop and the look arrive at,
 * except negative [saturation], which moves the saturation they arrive at towards -100 (-100 = black and white).
 * [rotation] is clockwise quarter turns (0..3) on top of the photo's own orientation.
 */
export interface Adjustments {
  brightness: number;
  warmth: number;
  tint: number;
  contrast: number;
  saturation: number;
  grain: number;
  denoise: number;
  rotation: number;
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, warmth: 0, tint: 0, contrast: 0, saturation: 0, grain: 0, denoise: 0, rotation: 0 };

export function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
  return a.brightness === b.brightness && a.warmth === b.warmth && a.tint === b.tint
    && a.contrast === b.contrast && a.saturation === b.saturation && a.grain === b.grain && a.denoise === b.denoise
    && a.rotation === b.rotation;
}

/** Combines the auto develop with a look and the user's [Adjustments] (port of LookApplier.kt). */
export const DEFAULT_STRENGTH = 100;
/** Brightness ±100 = ±3 EV on top of auto exposure. */
const BRIGHTNESS_EV = 3;
/** Warmth ±100 = temperature x2 / ÷2 on top of the auto white balance (tint follows). */
const WARMTH_RANGE = 2;

/**
 * Positive [adjust] adds to the auto + look saturation; negative scales it towards -100, so the slider's bottom is
 * black and white whatever the auto develop and the look added (an offset left ~30% of the colour).
 */
function saturation(combined: number, adjust: number): number {
  const c = Math.min(100, Math.max(-100, combined));
  if (adjust >= 0) return Math.min(100, c + adjust);
  return c + (-100 - c) * Math.min(1, -adjust / 100);
}

/**
 * [strength] 0..100 scales the LUT and every adjustment of [look] (0 = the auto develop alone); [adjust] comes on
 * top, at full strength.
 */
export function applyLook(base: DevelopParams, look: Look, strength: number, adjust: Adjustments, hasFace: boolean): DevelopParams {
  const k = strength / 100;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const add = (value: number, delta: number, min = -100, max = 100) => clamp(value + delta * k, min, max);
  const developed: DevelopParams = {
    ...base,
    exposure: clamp(base.exposure + look.exposure * k + (adjust.brightness / 100) * BRIGHTNESS_EV, -5, 5),
    contrast: clamp(base.contrast + look.contrast * k + adjust.contrast, -100, 100),
    saturation: saturation(base.saturation + look.saturation * k, adjust.saturation),
    denoise: clamp(base.denoise + adjust.denoise, 0, 100),
    // A measured colour denoise (AutoTone) moves with Denoise too; null keeps following it.
    colorDenoise: base.colorDenoise == null ? null : clamp(base.colorDenoise + adjust.denoise, 0, 100),
    highlights: add(base.highlights, look.highlights),
    blacks: add(base.blacks, look.blacks),
    whites: add(base.whites, look.whites),
    grain: clamp(base.grain + look.grain * k + adjust.grain, 0, 100),
    bloom: add(base.bloom, look.bloom, 0),
    highpassContrast: add(base.highpassContrast, look.highpass),
    vignetteAmount: add(base.vignetteAmount, look.vignette),
    temperature: Math.min(Warmth.MAX_KELVIN, Math.max(Warmth.MIN_KELVIN, base.temperature + look.warmth * k)),
    skinRetouch: hasFace ? add(base.skinRetouch, look.portraitRetouch, 0) : base.skinRetouch,
    lut: k > 0 ? lutIdOf(look) : null,
    lutAmount: look.lutAmount * k,
    // A film look renders the stock in place of AgX; Strength blends it with the AgX render.
    film: k > 0 ? look.film : null,
    filmAmount: 100 * k,
    // A film look's grain is the stock's (AgX grain isn't rendered): Grain -50..50 scales it 0..2x.
    filmGrain: clamp(look.filmGrain * (1 + adjust.grain / 50), 0, 200),
    halation: look.halation,
    rotation: (((base.rotation + adjust.rotation) % 4) + 4) % 4,
  };
  const warmed = Warmth.shift(developed, WARMTH_RANGE ** (adjust.warmth / 100));
  return adjust.tint === 0 ? warmed : { ...warmed, tint: clamp(warmed.tint + adjust.tint, -100, 100) };
}

/**
 * A RawBoy preset in place of a look: [base] (the auto develop) with every field the preset holds, exactly as RawBoy
 * applies it (tone mapper, film, LUT, colour, detail, retouch, lens corrections, gradient masks...), then [adjust] on
 * top as with a look. Fields the preset leaves out keep the auto develop's values; there is no Strength.
 * Denoise, Color denoise and sharpening always come from the auto develop, measured on this photo (its ISO and
 * exposure), never from the photo the preset was made on; the Denoise adjustment still works on top.
 */
export function applyPresetDevelop(base: DevelopParams, preset: Preset, adjust: Adjustments): DevelopParams {
  return adjustDevelop(applyPreset(preset, base), base, adjust);
}

/**
 * A partial RawBoy preset (see replacesLook) on top of a look: [look] at [strength] as applyLook develops it, then only
 * the fields of the preset's groups, then [adjust]. A Detail group's denoise and sharpening are the preset's (that is
 * what a Detail preset is for); without one they stay the auto develop's.
 */
export function applyPresetOnLook(base: DevelopParams, look: Look, strength: number, adjust: Adjustments, hasFace: boolean, preset: Preset): DevelopParams {
  const p = applyPreset(preset, applyLook(base, look, strength, NO_ADJUSTMENTS, hasFace));
  return adjustDevelop(p, preset.groups.includes('detail') ? p : base, adjust);
}

/**
 * A whole develop from the RawBoy tab (web: "Back to Auto") in place of a look: [edits] exactly as RawBoy rendered them,
 * denoise and sharpening included, with [adjust] on top as with a preset.
 */
export function applyEditsDevelop(edits: DevelopParams, adjust: Adjustments): DevelopParams {
  return adjustDevelop(edits, edits, adjust);
}

/** [p] with [adjust] on top; denoise and sharpening start from [base]'s. */
function adjustDevelop(p: DevelopParams, base: DevelopParams, adjust: Adjustments): DevelopParams {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const developed: DevelopParams = {
    ...p,
    exposure: clamp(p.exposure + (adjust.brightness / 100) * BRIGHTNESS_EV, -5, 5),
    contrast: clamp(p.contrast + adjust.contrast, -100, 100),
    saturation: saturation(p.saturation, adjust.saturation),
    denoise: clamp(base.denoise + adjust.denoise, 0, 100),
    colorDenoise: base.colorDenoise == null ? null : clamp(base.colorDenoise + adjust.denoise, 0, 100),
    sharpening: base.sharpening,
    // With a film stock its grain is the one rendered, so Grain scales that one, as in Film mode.
    grain: p.film != null ? p.grain : clamp(p.grain + adjust.grain, 0, 100),
    filmGrain: p.film != null ? clamp(p.filmGrain * (1 + adjust.grain / 50), 0, 200) : p.filmGrain,
    rotation: (((p.rotation + adjust.rotation) % 4) + 4) % 4,
  };
  const warmed = Warmth.shift(developed, WARMTH_RANGE ** (adjust.warmth / 100));
  return adjust.tint === 0 ? warmed : { ...warmed, tint: clamp(warmed.tint + adjust.tint, -100, 100) };
}

/**
 * A photo's whole develop: preset (a RawBoy preset with the Light group, see applyPresetDevelop) or else look (see
 * applyLook) with a partial preset's groups on top (applyPresetOnLook), then its lens preset (isLensPreset, or null),
 * which changes only the lens corrections: the profile switch, distortion, vignette radius and vignetting. A look's own vignette stays on top of the lens preset's vignetting; a RawBoy preset's Lens
 * group gives way to the lens preset.
 */
export function developAuto(
  base: DevelopParams,
  look: Look,
  strength: number,
  adjust: Adjustments,
  hasFace: boolean,
  preset: Preset | null,
  lensPreset: Preset | null,
): DevelopParams {
  const whole = preset != null && replacesLook(preset);
  const developed = !preset ? applyLook(base, look, strength, adjust, hasFace)
    : whole ? applyPresetDevelop(base, preset, adjust)
    : applyPresetOnLook(base, look, strength, adjust, hasFace, preset);
  if (!lensPreset) return developed;
  const lens = applyPreset(lensPreset, base);
  const lookVignette = whole || preset?.groups.includes('lens') ? 0 : developed.vignetteAmount - base.vignetteAmount;
  return {
    ...developed,
    lensProfile: lens.lensProfile,
    lensDistortion: lens.lensDistortion,
    vignetteAmount: Math.min(100, Math.max(-100, lens.vignetteAmount + lookVignette)),
    vignetteMidpoint: lens.vignetteMidpoint,
  };
}
