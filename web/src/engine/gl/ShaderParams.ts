import { Mat3 } from '../color/Mat3';
import { Primaries } from '../color/Primaries';
import { WhiteBalance } from '../color/WhiteBalance';
import { effectiveColorDenoise, toneMapperId, type DevelopParams } from '../develop/DevelopParams';
import type { BrushRaster } from '../develop/BrushRaster';
import { curveTable } from '../develop/ToneCurve';
import { CURVE_SCALE, MAX_LAYERS, layerIsIdentity, type MaskLayer } from '../develop/Masks';
import type { FilmData } from '../film/FilmStocks';
import type { LensTransform } from '../lens/LensTransform';
import type { LutData } from '../lut/LutData';
import type { SkinMask } from '../retouch/SkinMask';
import type { BloomSources, PreviewImage } from './PreviewImage';
import { ZoomMath } from './Zoom';

/**
 * AgX puts display white ~6.5 EV above middle grey, but a sensor clips only ~2.5 EV above it. This base lift
 * (as darktable does for AgX/filmic) puts clipped highlights near display white at Exposure 0.
 */
const BASE_EXPOSURE_EV = 0.7;

/** Denoise above this adds the coarse stage, fully at 100 (high-ISO noise the fine stage can't reach). */
export const WIDE_DENOISE_FROM = 65;
/** Source pixels the coarse stage reads around a pixel (chroma radius 18 px, plus bilinear). */
export const WIDE_DENOISE_MARGIN = 20;

export const wideDenoise = (denoise: number) => Math.min(1, Math.max(0, (denoise - WIDE_DENOISE_FROM) / (100 - WIDE_DENOISE_FROM)));

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Full layer temperature offset (100) moves the white this many mireds; + = warmer, as the global slider. */
const LAYER_MIRED_RANGE = 100;

/** Mask layers packed for the shader's uniform arrays (see shaders/develop.glsl, layerMask). */
export interface LayerUniforms {
  count: number;
  geom: Float32Array; // MAX_LAYERS x vec4
  shape: Float32Array; // MAX_LAYERS x vec4
  tone: Float32Array; // MAX_LAYERS x vec4
  color: Float32Array; // MAX_LAYERS x vec4
  whiteBalance: Float32Array; // MAX_LAYERS x mat3, column-major
  /** 0 = off, else the shown layer's packed index + 1. */
  view: number;
  /** Painted mask of each packed layer (null = no strokes); slot i of the brush atlas. */
  brush: (BrushRaster | null)[];
}

/** Which painted mask belongs to a layer (the session's cache); none by default (Auto, tests). */
export type BrushLookup = (layer: MaskLayer) => BrushRaster | null;

export const NO_LAYERS: LayerUniforms = {
  count: 0,
  geom: new Float32Array(MAX_LAYERS * 4),
  shape: new Float32Array(MAX_LAYERS * 4),
  tone: new Float32Array(MAX_LAYERS * 4),
  color: new Float32Array(MAX_LAYERS * 4),
  whiteBalance: new Float32Array(MAX_LAYERS * 9),
  view: 0,
  brush: [],
};

/**
 * Packs the layers that change the image (plus [viewId], the layer whose mask is shown, even without adjustments).
 * Positions go from image fractions to full-resolution image pixels. [clarityReady]: the base copy the clarity
 * blur needs is loaded (as for the global slider).
 */
export function packLayers(
  masks: readonly MaskLayer[],
  imageWidth: number,
  imageHeight: number,
  kelvin: number,
  tint: number,
  clarityReady: boolean,
  viewId: string | null = null,
  brushFor: BrushLookup = () => null,
): LayerUniforms {
  const hasMask = (l: MaskLayer) => l.shape.kind !== 'brush' || l.strokes.length > 0;
  const used = masks.filter((l) => hasMask(l) && (!layerIsIdentity(l) || (l.id === viewId && l.enabled))).slice(0, MAX_LAYERS);
  if (used.length === 0) return NO_LAYERS;
  const u: LayerUniforms = {
    count: used.length,
    geom: new Float32Array(MAX_LAYERS * 4),
    shape: new Float32Array(MAX_LAYERS * 4),
    tone: new Float32Array(MAX_LAYERS * 4),
    color: new Float32Array(MAX_LAYERS * 4),
    whiteBalance: new Float32Array(MAX_LAYERS * 9),
    view: 0,
    brush: [],
  };
  const target = WhiteBalance.xyFromTempTint(kelvin, tint);
  const long = Math.max(imageWidth, imageHeight);
  used.forEach((l, i) => {
    const o = i * 4;
    const s = l.shape;
    if (s.kind === 'linear') {
      const x0 = s.x0 * imageWidth;
      const y0 = s.y0 * imageHeight;
      const dx = s.x1 * imageWidth - x0;
      const dy = s.y1 * imageHeight - y0;
      const len2 = Math.max(dx * dx + dy * dy, 1);
      u.geom.set([x0, y0, dx / len2, dy / len2], o);
      // Curvature: t grows by curveOffset(s) / length, with s the perpendicular distance from p0 (see Masks.ts).
      u.shape.set([0, ((s.curve / 100) * CURVE_SCALE * 4) / (long * Math.sqrt(len2)), 0, 0], o);
    } else if (s.kind === 'brush') {
      u.shape.set([2, 0, 0, 0], o); // only the painted mask
    } else {
      const a = rad(s.angle);
      u.geom.set([s.cx * imageWidth, s.cy * imageHeight, 1 / Math.max(s.rx * long, 1), 1 / Math.max(s.ry * long, 1)], o);
      u.shape.set([1, Math.cos(a), Math.sin(a), Math.min(1, Math.max(0.01, s.feather / 100))], o);
    }
    const a = l.adjust;
    u.tone.set([a.exposure, (a.contrast / 100) * 0.7, a.highlights / 100, a.shadows / 100], o);
    u.color.set([1 + a.saturation / 100, clarityReady ? a.clarity / 100 : 0, l.opacity / 100, l.invert ? 1 : 0], o);
    const mired = 1e6 / kelvin - (a.temperature / 100) * LAYER_MIRED_RANGE;
    const layerWhite = WhiteBalance.xyFromTempTint(1e6 / Math.max(mired, 1), tint + a.tint);
    const wb = a.temperature === 0 && a.tint === 0 ? Mat3.diagonal(1, 1, 1) : WhiteBalance.rebalanceMatrix(target, layerWhite);
    u.whiteBalance.set(Mat3.toGlColumnMajor(wb), i * 9);
    if (l.id === viewId) u.view = i + 1;
    u.brush.push(l.strokes.length ? brushFor(l) : null);
  });
  return u;
}

/** Uniform values derived from [DevelopParams] (port of gl/ShaderParams.kt). */
export class ShaderParams {
  constructor(
    readonly whiteBalance: Float32Array, // column-major 3x3
    readonly exposure: number,
    readonly contrast: number,
    readonly saturation: number,
    readonly shadows: number,
    readonly highlights: number,
    readonly blacks: number,
    readonly whites: number,
    readonly denoise: number,
    readonly denoiseWide: number,
    readonly colorDenoise: number,
    readonly colorDenoiseWide: number,
    readonly grain: number,
    /** 0..1 clumping and 0..1 per-channel colour of the grain (`uGrainRoughness`, `uGrainColor`). */
    readonly grainRoughness: number,
    readonly grainColor: number,
    /** Loaded LUT matching DevelopParams.lut, or null for none (always null while a film stock is on). */
    readonly lut: LutData | null,
    readonly lutAmount: number,
    readonly lens: LensTransform,
    readonly sharpening: number,
    /** -1..1 edge-aware mid-frequency detail (`uLocalContrast`). */
    readonly localContrast: number,
    readonly highpassContrast: number,
    /** Small (about 512 px) copy of the whole image, the large-radius blur for high-pass contrast. */
    readonly base: PreviewImage | null,
    readonly bloom: number,
    readonly bloomHalo: PreviewImage | null,
    readonly bloomTail: PreviewImage | null,
    readonly skinRetouch: number,
    readonly skinMask: SkinMask | null,
    /** Multiplies the grain cell size (1 = film-scaled default, ~1/3200 of the long edge). */
    readonly grainSizeScale = 1,
    /** 1 = purity-limited saturation and soft gamut compression (no hard colour clipping), 0 = off. */
    readonly gamutSoft = 1,
    /** `uToneMapper`: see toneMapperId. */
    readonly toneMapper = 0,
    /** `uDisplaySource`: 1 for a JPEG/HEIC (DevelopParams.displaySource of the as-shot defaults), else 0. */
    readonly displaySource = 0,
    readonly layers: LayerUniforms = NO_LAYERS,
    /** Film stock (shaders/film_form.glsl) matching DevelopParams.film, or null for none. */
    readonly film: FilmData | null = null,
    /** 0..1 blend of the film render over AgX; 0 = off. */
    readonly filmAmount = 0,
    /** Film grain and halation/scatter amounts, 1 = the stock's own. */
    readonly filmGrain = 1,
    readonly halation = 1,
    /** `uCurve`: DevelopParams.curves as ToneCurve.ts's curveTable, or null when they are all the identity. */
    readonly curve: Float32Array | null = null,
  ) {}

  /** Extra source pixels needed around an output region for the spatial effects, so tiles join seamlessly. */
  get spatialMargin(): number {
    const skin = this.skinMask;
    const retouch = this.skinRetouch > 0 && skin?.hasSkin ? Math.trunc(skin.sigmaPx * 2.4) + 4 : 0;
    const wide = this.denoiseWide > 0 || this.colorDenoiseWide > 0 ? WIDE_DENOISE_MARGIN : 0;
    return Math.max(ZoomMath.HALO, retouch, wide);
  }

  /** Grain Size slider -> cell size factor: 1 at 25, doubling every 25 (0.5..8). */
  static grainSizeFactor(size: number): number {
    return 2 ** ((size - 25) / 25);
  }

  /** [asShot] holds the defaults the image was decoded with (its as-shot temperature/tint). */
  static from(
    p: DevelopParams,
    asShot: DevelopParams,
    lut: LutData | null,
    lens: LensTransform,
    base: PreviewImage | null,
    bloomSources: BloomSources | null,
    skinMask: SkinMask | null,
    grainSizeScale = 1,
    grainStrength = 1,
    /** Mask layer whose mask is shown in red (Masks tool), or null. */
    maskView: string | null = null,
    brushFor: BrushLookup = () => null,
    /** Loaded film stock for DevelopParams.film (Auto's Film mode). */
    film: FilmData | null = null,
  ): ShaderParams {
    const filmUsed = film && film.stock.id === p.film ? film : null;
    const sourceWhite = WhiteBalance.xyFromTempTint(asShot.temperature, asShot.tint);
    const targetWhite = WhiteBalance.xyFromTempTint(p.temperature, p.tint);
    return new ShaderParams(
      // White balance, then the RGB primaries adjustment; both are 3x3 in linear Rec.2020.
      Mat3.toGlColumnMajor(Mat3.multiply(Primaries.fromParams(p), WhiteBalance.rebalanceMatrix(sourceWhite, targetWhite))),
      2 ** (p.exposure + BASE_EXPOSURE_EV),
      2 ** ((p.contrast / 100) * 0.7),
      1 + p.saturation / 100,
      p.shadows / 100,
      p.highlights / 100,
      p.blacks / 100,
      p.whites / 100,
      p.denoise / 100,
      wideDenoise(p.denoise),
      effectiveColorDenoise(p) / 100,
      wideDenoise(effectiveColorDenoise(p)),
      (p.grain / 100) * grainStrength,
      p.grainRoughness / 100,
      p.grainColor / 100,
      // Film replaces the user LUT (Pro keeps the choice for when Film is turned off).
      lut && lut.id === p.lut && p.film == null ? lut : null,
      p.lutAmount / 100,
      lens,
      p.sharpening / 100,
      p.localContrast / 100,
      p.highpassContrast / 100,
      base,
      (p.bloom / 100) * (0.35 + (0.25 * p.bloom) / 100), // up to 60% of the light scattered
      bloomSources?.halo ?? null,
      bloomSources?.tail ?? null,
      p.skinRetouch / 100,
      skinMask,
      grainSizeScale * ShaderParams.grainSizeFactor(p.grainSize),
      1,
      toneMapperId(p.toneMapper),
      asShot.displaySource ? 1 : 0,
      packLayers(p.masks, lens.width, lens.height, p.temperature, p.tint, base != null, maskView, brushFor),
      filmUsed,
      filmUsed ? Math.min(1, Math.max(0, p.filmAmount / 100)) : 0,
      p.filmGrain / 100,
      p.halation / 100,
      curveTable(p.curves),
    );
  }
}
