import { RetiredLooks } from './RetiredLooks';

/**
 * A film look: one of the bundled LUTs plus adjustments added on top of the auto develop (port of Look.kt).
 * Deltas are in slider units; all are scaled by Strength.
 */
export interface Look {
  id: string;
  name: string;
  /** Bundled LUT file in luts/, or null for none. */
  lutFile: string | null;
  lutAmount: number;
  exposure: number;
  contrast: number;
  saturation: number;
  highlights: number;
  blacks: number;
  whites: number;
  grain: number;
  bloom: number;
  highpass: number;
  vignette: number;
  /** Kelvin added to the white balance; + is warmer. */
  warmth: number;
  /** Skin retouch applied when the photo has a face. */
  portraitRetouch: number;
  monochrome: boolean;
  /** Film stock id (film/FilmStocks.ts) rendered as negative + print instead of AgX + LUT, or null. */
  film: string | null;
  /** Film grain and halation, 100 = the stock's own. */
  filmGrain: number;
  halation: number;
}

const look = (id: string, name: string, lutFile: string | null, p: Partial<Look> = {}): Look => ({
  id, name, lutFile, lutAmount: 100, exposure: 0, contrast: 0, saturation: 0, highlights: 0, blacks: 0, whites: 0,
  grain: 0, bloom: 0, highpass: 0, vignette: 0, warmth: 0, portraitRetouch: 0, monochrome: false,
  film: null, filmGrain: 100, halation: 100, ...p,
});

/** LutEntry id, as LutRepository names bundled LUTs. */
export const lutIdOf = (l: Look): string | null => (l.lutFile ? `asset:luts/${l.lutFile}` : null);

/**
 * The looks RawBoy Auto offers, built on the LUTs in <repo>/luts. The film LUTs come from
 * tools/film_luts/generate.py and already carry the film's tone curve and keep middle grey, so looks
 * only add grain, bloom and skin retouch.
 */
export const Looks = {
  NATURAL: look('natural', 'Natural', null),
  /** The default: suggested for portraits and everyday scenes. */
  PORTRA_400: look('portra400', 'Yellow Portrait 400', 'Yellow Portrait 400.cube', { grain: 20, bloom: 5, portraitRetouch: 20 }),
  PORTRA_800: look('portra800', 'Yellow Portrait 800', 'Yellow Portrait 800.cube', { grain: 35, bloom: 15, portraitRetouch: 20 }),
  EKTAR_100: look('ektar100', 'Yellow Vivid 100', 'Yellow Vivid 100.cube', { grain: 10, highpass: 10 }),
  GOLD_200: look('gold200', 'Yellow Warm 200', 'Yellow Warm 200.cube', { grain: 25, warmth: 200, vignette: -10 }),
  SUPERIA_400: look('superia400', 'Green Everyday 400', 'Green Everyday 400.cube', { grain: 25 }),
  FUJI_400H: look('fuji400h', 'Green Pastel 400', 'Green Pastel 400.cube', { grain: 20, bloom: 5, portraitRetouch: 20 }),
  /** Tungsten cinema film, the base of CineStill 800T. */
  VISION3_500T: look('vision500t', 'Yellow Cine 500T', 'Yellow Cine 500T.cube', { grain: 35, bloom: 20 }),
  /** Slide film: vivid colour, deep shadows. */
  VELVIA_50: look('velvia50', 'Green Vivid Slide 50', 'Green Vivid Slide 50.cube', { grain: 8, vignette: -10 }),
  REDSCALE: look('redscale', 'Redscale', 'Redscale.png', { contrast: 5, grain: 30, vignette: -15 }),
  /** Monochrome, soft: Tri-X on a soft paper grade, gentle highlights, open shadows. */
  TRIX_SOFT: look('trixsoft', 'Yellow Mono Soft', 'Yellow Mono Soft.cube', { grain: 20, monochrome: true }),
  /** Monochrome, classic: Tri-X on a normal paper grade. */
  TRIX_400: look('trix400', 'Yellow Mono 400', 'Yellow Mono 400.cube', { grain: 25, monochrome: true }),
  /** Monochrome, Tri-X developed longer: harder and grainier. */
  TRIX_PUSH: look('trixpush', 'Yellow Mono Push', 'Yellow Mono Push.cube', { grain: 40, monochrome: true }),
  /** Monochrome, hard: pushed Tri-X on a hard paper grade, deep blacks, bright whites. */
  TRIX_HARD: look('trixhard', 'Yellow Mono Hard', 'Yellow Mono Hard.cube', { grain: 30, vignette: -10, monochrome: true }),
  /** Monochrome, Eastman Double-X cinema film. */
  DOUBLE_X: look('doublex', 'Yellow Cine Mono', 'Yellow Cine Mono.cube', { grain: 20, monochrome: true }),
  /** Monochrome, soft: Double-X developed short on a soft paper grade, open shadows. */
  DOUBLE_X_SOFT: look('doublexsoft', 'Yellow Cine Mono Soft', 'Yellow Cine Mono Soft.cube', { grain: 20, monochrome: true }),
};

export const ALL_LOOKS: Look[] = [
  Looks.NATURAL, Looks.PORTRA_400, Looks.PORTRA_800, Looks.EKTAR_100, Looks.GOLD_200,
  Looks.SUPERIA_400, Looks.FUJI_400H, Looks.VISION3_500T, Looks.VELVIA_50, Looks.REDSCALE,
  Looks.TRIX_SOFT, Looks.TRIX_400, Looks.TRIX_PUSH, Looks.TRIX_HARD, Looks.DOUBLE_X, Looks.DOUBLE_X_SOFT,
];

/** Bundled LUT ids of the monochrome looks: the LUT alone makes a photo black and white. */
const MONOCHROME_LUTS = new Set(ALL_LOOKS.filter((l) => l.monochrome).map(lutIdOf).filter((id) => id != null));

/** True for a bundled black and white LUT (retired ids too); pickers list these in their own section. */
export const isMonochromeLut = (id: string | null | undefined): boolean => id != null && MONOCHROME_LUTS.has(RetiredLooks.lut(id));

export const lookById = (id: string): Look => {
  const key = RetiredLooks.look(id);
  return ALL_LOOKS.find((l) => l.id === key) ?? Looks.NATURAL;
};

