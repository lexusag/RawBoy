import type { MaskLayer } from './Masks';
import { DEFAULT_CURVES, type ToneCurves } from './ToneCurve';

/**
 * Scene -> display tone mapping. All three share AgX's log range, middle grey and slope there, so the
 * sliders mean the same; they differ in toe/shoulder and in colour (see shaders/develop.glsl).
 * The value is the key stored in presets (as in DevelopParams.kt).
 */
export type ToneMapper = 'agx' | 'filmic' | 'sigmoid';

export const TONE_MAPPERS: readonly { key: ToneMapper; label: string; shaderId: number }[] = [
  { key: 'agx', label: 'AgX', shaderId: 0 },
  { key: 'filmic', label: 'Filmic', shaderId: 1 },
  { key: 'sigmoid', label: 'Sigmoid', shaderId: 2 },
];

/** `uToneMapper` for a tone mapper (AgX for anything unknown). */
export const toneMapperId = (t: ToneMapper): number => TONE_MAPPERS.find((m) => m.key === t)?.shaderId ?? 0;

/**
 * Slider values as the user sees them (port of develop/DevelopParams.kt).
 *
 * - toneMapper: the display transform (AgX by default; Pro only, Auto and Camera stay on AgX)
 * - exposure: EV, -5..+5
 * - contrast, saturation, highlights, shadows, whites, blacks, tint: -100..+100
 * - temperature: Kelvin; the as-shot value is the default
 * - denoise, grain, sharpening: 0..100, 0 = off; denoise is luminance noise (and colour noise while colorDenoise is null)
 * - grainSize: 0..100, 25 = the default ~1/3200 of the long edge, each 25 doubles it (0 = half, 100 = 8x);
 *   grainRoughness: 0..100 clumping (0 = even grain); grainColor: 0..100 per-channel colour in the grain (0 = mono)
 * - colorDenoise: 0..100 colour (chroma) noise, Pro's own slider; null = follows denoise (Auto, Camera, older edits)
 * - localContrast: -100..100 edge-aware mid-frequency detail (texture a few pixels across), 0 = off
 * - highpassContrast: -100..100 local (clarity-style) contrast, 0 = off
 * - bloom: 0..100 diffusion-filter glow (spektrafilm-style), 0 = off
 * - skinRetouch: 0..100 smoothing of skin (found by a segmentation model), 0 = off
 * - blemishRemoval: 0..100 automatic spot healing on skin; higher heals fainter spots, 0 = off
 * - lut: LutEntry id or null for "No LUT"; lutAmount: 0..100 strength
 * - film: film stock id (film/FilmStocks.ts) or null for none (Auto's Film mode); filmAmount: 0..100 blend of the
 *   film render over the AgX one; filmGrain, halation: 0..200, 100 = the stock's own
 * - lensProfile: apply the lens corrections embedded in the file (if any)
 * - lensDistortion: -100..100, + removes barrel distortion; auto crop/scale follows
 * - vignetteAmount: -100..100, + brightens corners; vignetteMidpoint: 0..100 (higher = only the corners)
 * - curves: point curves (RGB, then red, green, blue) on the final display-encoded image (see ToneCurve.ts)
 * - RGB primaries (after darktable): red/green/blueHue in degrees (-30..30), red/green/bluePurity -100..100,
 *   tintHue degrees (-180..180), tintPurity 0..100
 * - rotation: clockwise quarter turns; straighten: degrees -45..45, + turns clockwise (auto crop).
 * - flipHorizontal/flipVertical: mirror the photo (display orientation, before rotation) left-right / top-bottom.
 * - cropLeft/Top/Right/Bottom: 0..1 edges of the user crop within the rotated + straightened frame
 *   (0, 0, 1, 1 = no crop). See CropMath.
 *   Rotation, flips, straighten and crop are per photo: they reset when another file is opened.
 *
 * - masks: up to MAX_LAYERS gradient layers with local adjustments (see Masks.ts); per photo, like the crop.
 *
 * Whites/Blacks follow Lightroom: Blacks < 0 raises the black point (deeper blacks), Blacks > 0 lifts/fades
 * them; Whites > 0 lowers the white point (brighter whites), Whites < 0 dims them.
 */
export interface DevelopParams {
  toneMapper: ToneMapper;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  redHue: number;
  redPurity: number;
  greenHue: number;
  greenPurity: number;
  blueHue: number;
  bluePurity: number;
  tintHue: number;
  tintPurity: number;
  denoise: number;
  colorDenoise: number | null;
  grain: number;
  grainSize: number;
  grainRoughness: number;
  grainColor: number;
  sharpening: number;
  localContrast: number;
  highpassContrast: number;
  bloom: number;
  skinRetouch: number;
  blemishRemoval: number;
  lut: string | null;
  lutAmount: number;
  film: string | null;
  filmAmount: number;
  filmGrain: number;
  halation: number;
  curves: ToneCurves;
  lensProfile: boolean;
  lensDistortion: number;
  vignetteAmount: number;
  vignetteMidpoint: number;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  straighten: number;
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  masks: readonly MaskLayer[];
  /**
   * The photo is display-referred (JPEG, HEIC: see display_inverse.cpp), rendered with AgX per channel. Set only on
   * a photo's as-shot defaults, from the decoder; never a slider or preset value.
   */
  displaySource?: boolean;
  /**
   * Pixel value of the photo's blown highlights (RawImage.clipLevel), which white balance changes leave neutral
   * (`uClipLevel`); 0 or absent = unknown. Set only on a photo's as-shot defaults, from the decoder, like displaySource.
   */
  clipLevel?: number;
}

export const DEFAULT_PARAMS: Readonly<DevelopParams> = Object.freeze({
  toneMapper: 'agx',
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 5500,
  tint: 0,
  saturation: 0,
  redHue: 0,
  redPurity: 0,
  greenHue: 0,
  greenPurity: 0,
  blueHue: 0,
  bluePurity: 0,
  tintHue: 0,
  tintPurity: 0,
  denoise: 0,
  colorDenoise: null,
  grain: 0,
  grainSize: 25,
  grainRoughness: 0,
  grainColor: 15,
  sharpening: 0,
  localContrast: 0,
  highpassContrast: 0,
  bloom: 0,
  skinRetouch: 0,
  blemishRemoval: 0,
  lut: null,
  lutAmount: 100,
  film: null,
  filmAmount: 100,
  filmGrain: 100,
  halation: 100,
  curves: DEFAULT_CURVES,
  lensProfile: true,
  lensDistortion: 0,
  vignetteAmount: 0,
  vignetteMidpoint: 50,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  straighten: 0,
  cropLeft: 0,
  cropTop: 0,
  cropRight: 1,
  cropBottom: 1,
  masks: [],
});

/** The colour denoise in effect: colorDenoise, or denoise while it isn't set. */
export const effectiveColorDenoise = (p: DevelopParams): number => p.colorDenoise ?? p.denoise;

export const developParams = (p: Partial<DevelopParams> = {}): DevelopParams => ({ ...DEFAULT_PARAMS, ...p });

/** Numeric slider keys. */
export type SliderKey = { [K in keyof DevelopParams]-?: DevelopParams[K] extends number ? K : never }[keyof DevelopParams];
