import type { BwFilter } from '../color/BwFilter';
import type { MaskLayer } from './Masks';
import type { LightEffect } from './LightEffects';
import type { LightLeak } from './LightLeaks';
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
 * Coating colour of Pro's fake anamorphic lens flare (see `anamorphicFlare` in shaders/develop.glsl). `tint` is the
 * linear Rec.2020 colour of the streak, `length` how far each channel's streak reaches (1 = full: a short red and a long
 * blue make a white core, cyan, then blue tips) and `bar` the colour of the soft glow round it. Stored by key in presets
 * and sidecars.
 */
export type AnamorphicColor = 'neutral' | 'blue' | 'golden' | 'magenta';

export const ANAMORPHIC_COLORS: readonly {
  key: AnamorphicColor;
  label: string;
  tint: readonly [number, number, number];
  length: readonly [number, number, number];
  bar: readonly [number, number, number];
}[] = [
  { key: 'neutral', label: 'Neutral', tint: [1, 1, 1], length: [0.85, 0.85, 0.85], bar: [0.8, 0.85, 0.95] },
  { key: 'blue', label: 'Blue', tint: [0.7, 0.9, 1.45], length: [0.3, 0.55, 1], bar: [0.2, 0.5, 1] },
  { key: 'golden', label: 'Golden', tint: [1.2, 0.9, 0.55], length: [1, 0.7, 0.4], bar: [1, 0.6, 0.2] },
  { key: 'magenta', label: 'Magenta', tint: [1.15, 0.8, 1.25], length: [0.8, 0.45, 1], bar: [0.7, 0.3, 1] },
];

const coatingOf = (c: AnamorphicColor) => ANAMORPHIC_COLORS.find((m) => m.key === c) ?? ANAMORPHIC_COLORS[0];

/** `uAnamorphicTint`: the streak's colour, and a = 1 when ghosts are on. */
export const anamorphicTintOf = (c: AnamorphicColor, ghosts = false): Float32Array =>
  new Float32Array([...coatingOf(c).tint, ghosts ? 1 : 0]);

/** `uAnamorphicLen`: the streak's reach per channel. */
export const anamorphicLengthOf = (c: AnamorphicColor): Float32Array => new Float32Array([...coatingOf(c).length, 0]);

/** `uAnamorphicBar`: the colour of the soft bar. */
export const anamorphicBarOf = (c: AnamorphicColor): Float32Array => new Float32Array([...coatingOf(c).bar, 0]);

/**
 * Slider values as the user sees them (port of develop/DevelopParams.kt).
 *
 * - toneMapper: the display transform (AgX by default; Pro only, Auto and Camera stay on AgX)
 * - exposure: EV, -5..+5
 * - lumaContrast: -100..+100 contrast on luminance only (colour ratios kept), 0 = off
 * - contrast, saturation, highlights, shadows, whites, blacks, tint: -100..+100
 * - temperature: Kelvin; the as-shot value is the default
 * - denoise, grain, sharpening: 0..100, 0 = off; denoise is luminance noise (and colour noise while colorDenoise is null)
 * - grainSize: 0..100, 25 = the default ~1/3200 of the long edge, each 25 doubles it (0 = half, 100 = 8x);
 *   grainRoughness: 0..100 clumping (0 = even grain); grainColor: 0..100 per-channel colour in the grain (0 = mono)
 * - colorDenoise: 0..100 colour (chroma) noise, Pro's own slider; null = follows denoise (Auto, Camera, older edits)
 * - localContrast: -100..100 edge-aware mid-frequency detail (texture a few pixels across), 0 = off
 * - highpassContrast: -100..100 local (clarity-style) contrast, 0 = off
 * - bloom: 0..100 diffusion-filter glow, 0 = off
 * - anamorphic: 0..100 horizontal anamorphic lens flare, 0 = off; anamorphicColor: 'neutral' | 'blue' | 'golden' | 'magenta'; anamorphicGhosts: faint oval ghosts of the lights
 * - skinRetouch: 0..100 smoothing of skin (found by a segmentation model), 0 = off
 * - blemishRemoval: 0..100 automatic spot healing on skin; higher heals fainter spots, 0 = off
 * - portraitRetouch: 0..100 natural portrait retouch (spots, under-eyes, lines, evening; PortraitRetouch), 0 = off,
 *   40 = about Reblum's Natural preset at 40
 * - lut: LutEntry id or null for "No LUT"; lutAmount: 0..100 strength
 * - film: film stock id (film/FilmStocks.ts) or null for none (Auto's Film mode); filmAmount: 0..100 blend of the
 *   film render over the AgX one; filmGrain, halation: 0..200, 100 = the stock's own
 * - lensProfile: apply the lens corrections embedded in the file (if any)
 * - lensDistortion: -100..100, + removes barrel distortion; auto crop/scale follows
 * - lensAnamorphic: -100..100 cylindrical (horizontal) distortion; - bows vertical edges outward like an anamorphic lens
 * - lensFisheye: 0..100 straightens a fisheye lens (equidistant projection assumed) towards rectilinear, 0 = off; lensFisheyeFov: 90..220
 *   degrees across the lens's image circle (the frame's diagonal when the circle fills it), lensFisheyeAuto: find the circle
 *   (size and centre) in the photo while the lens info has one (LensInfo.fisheyeCircle), else use the sliders; lensFisheyeCircle: 20..100 radius
 *   of that circle in % of the frame's half diagonal, lensFisheyeX/Y: -50..50 offset of the circle's centre in % of width/height
 * - lensCrop: -100..100 scale around the auto crop (0 = no empty edges; < 0 reveals curved borders; > 0 crops tighter)
 * - caRed, caBlue: -100..100, lateral chromatic aberration: + enlarges the red (blue) plane around the image centre
 * - vignetteAmount: -100..100, + brightens corners; vignetteMidpoint: 0..100 (higher = only the corners)
 * - curves: point curves (RGB, then red, green, blue) on the final display-encoded image (see ToneCurve.ts)
 * - RGB primaries (after darktable): red/green/blueHue in degrees (-45..45), red/green/bluePurity -200..200,
 *   tintHue degrees (-180..180), tintPurity 0..100
 * - bwFilter: colour filter for black and white (BwFilter.ts, RawBoy Camera's B&W mode; 'none' = identity), channel gains
 *   after white balance and the RGB primaries
 * - rotation: clockwise quarter turns; straighten: degrees -45..45, + turns clockwise (auto crop).
 * - scale: 100..200%, 100% = normal (scales image within the full frame to preserve final resolution).
 * - flipHorizontal/flipVertical: mirror the photo (display orientation, before rotation) left-right / top-bottom.
 * - cropLeft/Top/Right/Bottom: 0..1 edges of the user crop within the rotated + straightened frame
 *   (0, 0, 1, 1 = no crop). See CropMath.
 *   Rotation, flips, straighten, scale and crop are per photo: they reset when another file is opened.
 *
 * - masks: up to MAX_LAYERS gradient layers with local adjustments (see Masks.ts); per photo, like the crop.
 * - leaks: up to MAX_LEAKS light leaks over the finished picture (see LightLeaks.ts); per photo, like the masks.
 * - fx: up to MAX_EFFECTS light effects (lightning, sparks, trails, swirls; LightEffects.ts) over the leaks; per photo.
 *
 * Whites/Blacks follow Lightroom: Blacks < 0 raises the black point (deeper blacks), Blacks > 0 lifts/fades
 * them; Whites > 0 lowers the white point (brighter whites), Whites < 0 dims them.
 */
export interface DevelopParams {
  toneMapper: ToneMapper;
  exposure: number;
  contrast: number;
  /** Luminance-only contrast: a log slope on brightness that keeps channel ratios, so colour saturation holds. */
  lumaContrast: number;
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
  bwFilter: BwFilter;
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
  anamorphic: number;
  anamorphicColor: AnamorphicColor;
  anamorphicGhosts: boolean;
  skinRetouch: number;
  blemishRemoval: number;
  portraitRetouch: number;
  lut: string | null;
  lutAmount: number;
  film: string | null;
  filmAmount: number;
  filmGrain: number;
  halation: number;
  curves: ToneCurves;
  lensProfile: boolean;
  lensDistortion: number;
  lensAnamorphic: number;
  lensFisheye: number;
  lensFisheyeFov: number;
  lensFisheyeAuto: boolean;
  lensFisheyeCircle: number;
  lensFisheyeX: number;
  lensFisheyeY: number;
  lensCrop: number;
  caRed: number;
  caBlue: number;
  vignetteAmount: number;
  vignetteMidpoint: number;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  straighten: number;
  scale: number;
  cropLeft: number;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  masks: readonly MaskLayer[];
  leaks: readonly LightLeak[];
  fx: readonly LightEffect[];
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
  lumaContrast: 0,
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
  bwFilter: 'none',
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
  anamorphic: 0,
  anamorphicColor: 'neutral',
  anamorphicGhosts: false,
  skinRetouch: 0,
  blemishRemoval: 0,
  portraitRetouch: 0,
  lut: null,
  lutAmount: 100,
  film: null,
  filmAmount: 100,
  filmGrain: 75,
  halation: 100,
  curves: DEFAULT_CURVES,
  lensProfile: true,
  lensDistortion: 0,
  lensAnamorphic: 0,
  lensFisheye: 0,
  lensFisheyeFov: 180,
  lensFisheyeAuto: true,
  lensFisheyeCircle: 100,
  lensFisheyeX: 0,
  lensFisheyeY: 0,
  lensCrop: 0,
  caRed: 0,
  caBlue: 0,
  vignetteAmount: 0,
  vignetteMidpoint: 50,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  straighten: 0,
  scale: 100,
  cropLeft: 0,
  cropTop: 0,
  cropRight: 1,
  cropBottom: 1,
  masks: [],
  leaks: [],
  fx: [],
});

/** The colour denoise in effect: colorDenoise, or denoise while it isn't set. */
export const effectiveColorDenoise = (p: DevelopParams): number => p.colorDenoise ?? p.denoise;

export const developParams = (p: Partial<DevelopParams> = {}): DevelopParams => ({ ...DEFAULT_PARAMS, ...p });

/** Numeric slider keys. */
export type SliderKey = { [K in keyof DevelopParams]-?: DevelopParams[K] extends number ? K : never }[keyof DevelopParams];
