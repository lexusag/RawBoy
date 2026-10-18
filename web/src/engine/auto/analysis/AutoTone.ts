import type { DevelopParams } from '../../develop/DevelopParams';
import type { SceneStats } from './SceneAnalyzer';

/**
 * The automatic base develop (port of AutoTone.kt): exposure and tone from [SceneStats], set through the same
 * sliders RawBoy Pro has. White balance stays as shot; a look may warm or cool it afterwards.
 */
const BASE_EXPOSURE_EV = 0.7;
/** Where the scene's key should land (decoded units, 1.0 = sensor clip); cameras meter ~0.06, film reads darker. */
const TARGET_KEY = 0.043;
/** Where the brightest 2% should sit, in EV below sensor clip, before exposure is raised. */
const TARGET_P98 = -1.3;
/** Skin is metered brighter than the scene key (about a stop). */
const TARGET_SKIN = 0.09;
/** Faces start to steer exposure at the first share of the frame and get their full weight at the second (a ramp). */
const FACE_AREA_FROM = 0.003;
const FACE_AREA_FULL = 0.02;
/** How much the skin decides when a face is large enough. */
const SKIN_WEIGHT = 0.6;
/**
 * Phones that store their own auto exposure in the DNG's BaselineExposure (HDR+, Smart HDR); their metering knows the
 * scene better than ours. Other cameras' BaselineExposure (e.g. Adobe DNG Converter's) is a fixed per-model offset.
 */
const CAMERA_METERED_MAKES = new Set(['google', 'apple', 'samsung']);
/** A fine film grain every photo gets, even without a look (10 read too noisy). */
const BASE_GRAIN = 5;
/** Contrast every photo starts from. */
const BASE_CONTRAST = 15;
/** Saturation every photo starts from (the plain AgX render under the looks read too muted; 40 too much). */
const BASE_SATURATION = 30;
/**
 * Measured noise (NoiseLevel, std in the shader's sqrt domain) -> Denoise and Color denoise slider values, times how far
 * the develop's exposure lifts it (see AutoTone.kt).
 */
const LUMA_DENOISE_PER_STD = 2000;
const COLOR_DENOISE_PER_STD = 2600;
/** The auto Denoise (luma) is this much of what the measured fit gives (see AutoTone.kt). */
const LUMA_DENOISE_SCALE = 0.8;
/** Scene-linear value AgX maps to display white (0.18 * 2^4.03). */
const DISPLAY_WHITE = 2.95;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Kotlin's roundToInt (half up). */
const round = (v: number) => Math.round(v);

/**
 * EV that brings the key to its target, but never brighter than what puts the highlights near the top.
 * [cameraMetered]: the camera's own exposure is kept instead (see cameraMetered). With a face, mostly the skin decides.
 */
export function autoExposure(stats: SceneStats, cameraMetered = false): number {
  let ev = cameraMetered ? 0 : Math.min(Math.log2(TARGET_KEY / stats.key), TARGET_P98 - stats.p98);
  if (stats.skinLuminance > 0) {
    const t = clamp((stats.faceArea - FACE_AREA_FROM) / (FACE_AREA_FULL - FACE_AREA_FROM), 0, 1);
    const w = SKIN_WEIGHT * t * t * (3 - 2 * t);
    const bySkin = Math.log2(TARGET_SKIN / stats.skinLuminance);
    ev = w * bySkin + (1 - w) * ev;
  }
  return clamp(ev, -2, 2);
}

/** Whether a raw from [make] with this [baselineExposure] (EV, NaN if none) carries the camera's own exposure. */
export function cameraMetered(make: string, baselineExposure: number): boolean {
  return !Number.isNaN(baselineExposure) && CAMERA_METERED_MAKES.has(make.toLowerCase());
}

/**
 * A photo's measured noise (RawImage.measureNoise, native estimateNoise): the std of luma and of colour noise in the
 * develop shader's denoise domain (sqrt of the decoded linear values), 0 = not measured.
 */
export interface NoiseLevel {
  luma: number;
  chroma: number;
}

export const NO_NOISE: NoiseLevel = { luma: 0, chroma: 0 };

/** [denoise, colour denoise, sharpening] for the measured [noise] at auto [exposure] (EV). */
export function measuredNoiseSettings(noise: NoiseLevel, exposure: number): [number, number, number] {
  const shown = 2 ** ((exposure + BASE_EXPOSURE_EV) / 2);
  const full = clamp(round(LUMA_DENOISE_PER_STD * noise.luma * shown), 0, 100);
  const color = clamp(round(COLOR_DENOISE_PER_STD * noise.chroma * shown), 0, 100);
  const sharpening = full <= 20 ? 15 : full <= 45 ? 15 - ((full - 20) / 25) * 5 : full <= 65 ? 10 - ((full - 45) / 20) * 5 : 5;
  return [round(full * LUMA_DENOISE_SCALE), color, round(sharpening)];
}

/** [denoise, colour denoise = null: follows denoise, sharpening] by ISO, interpolated in stops between measured points; ISO 0 = unknown. */
function noiseSettings(iso: number): [number, number | null, number] {
  if (iso <= 0) return [0, null, 15];
  const points = [
    [400, 0, 15],
    [1600, 20, 15],
    [6400, 45, 10],
    [25600, 65, 5],
  ];
  const first = points[0];
  const last = points[points.length - 1];
  if (iso <= first[0]) return [first[1], null, first[2]];
  if (iso >= last[0]) return [last[1], null, last[2]];
  let i = 0;
  for (let k = 0; k < points.length; k++) if (points[k][0] <= iso) i = k;
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  const t = clamp(Math.log2(iso / a[0]) / Math.log2(b[0] / a[0]), 0, 1);
  return [round(a[1] + (b[1] - a[1]) * t), null, round(a[2] + (b[2] - a[2]) * t)];
}

/**
 * [noise]: the photo's measured noise; when measured it sets Denoise, Color denoise and sharpening, else they come from
 * the ISO table, whose ISO [noiseIsoScale] multiplies (phone sensors are noisier). A display source (JPEG,
 * HEIC: DevelopParams.displaySource) is already exposed, toned, denoised and sharpened by the camera, and its neutral
 * render is the file itself: it gets only the base grain.
 */
export function autoDevelop(
  stats: SceneStats,
  asShot: DevelopParams,
  noiseIsoScale = 1,
  cameraMetered = false,
  noise: NoiseLevel = NO_NOISE,
): DevelopParams {
  if (asShot.displaySource) return { ...asShot, grain: BASE_GRAIN };
  const exposure = autoExposure(stats, cameraMetered);
  const gainEv = exposure + BASE_EXPOSURE_EV;
  // Highlights: recover when a noticeable part of the frame lands in AgX's top stop.
  const nearWhite = stats.fractionAbove(Math.log2(DISPLAY_WHITE / 2) - gainEv);
  const highlights = -clamp(nearWhite * 400, 0, 60);
  // Shadows: lift when the darkest 5% sit far below grey after exposure.
  const shadowDepth = Math.log2(0.18) - (stats.p5 + gainEv);
  const shadows = clamp((shadowDepth - 5) * 12, 0, 40);
  // Contrast: a punchier base, a little less for very wide scenes, more for flat ones.
  const contrast = clamp(BASE_CONTRAST + (9 - stats.dynamicRange) * 4, 0, 30);
  const [denoise, colorDenoise, sharpening] = noise.luma > 0 ? measuredNoiseSettings(noise, exposure) : noiseSettings(stats.iso * noiseIsoScale);
  return {
    ...asShot,
    exposure: round(exposure * 20) / 20, // 0.05 EV steps, as the slider shows
    highlights: round(highlights),
    shadows: round(shadows),
    contrast: round(contrast),
    saturation: BASE_SATURATION,
    denoise,
    colorDenoise,
    sharpening,
    grain: BASE_GRAIN,
  };
}

/**
 * [current] with the light, colour and detail of the auto develop [auto] (RawBoy Pro's Auto button): exposure, tone,
 * white balance, saturation, denoise and sharpening, on AgX (what AutoTone is tuned for). The LUT, grain, retouch, lens
 * corrections, geometry, masks and the rest of the user's edit stay as they are.
 */
export function applyAuto(current: DevelopParams, auto: DevelopParams): DevelopParams {
  return {
    ...current,
    toneMapper: auto.toneMapper,
    exposure: auto.exposure,
    contrast: auto.contrast,
    highlights: auto.highlights,
    shadows: auto.shadows,
    whites: auto.whites,
    blacks: auto.blacks,
    temperature: auto.temperature,
    tint: auto.tint,
    saturation: auto.saturation,
    denoise: auto.denoise,
    colorDenoise: auto.colorDenoise,
    sharpening: auto.sharpening,
  };
}
