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
  PORTRA_400: look('portra400', 'Portra 400', 'Kodak Portra 400.cube', { grain: 20, bloom: 5, portraitRetouch: 20 }),
  PORTRA_800: look('portra800', 'Portra 800', 'Kodak Portra 800.cube', { grain: 35, bloom: 15, portraitRetouch: 20 }),
  EKTAR_100: look('ektar100', 'Ektar 100', 'Kodak Ektar 100.cube', { grain: 10, highpass: 10 }),
  GOLD_200: look('gold200', 'Gold 200', 'Kodak Gold 200.cube', { grain: 25, warmth: 200, vignette: -10 }),
  SUPERIA_400: look('superia400', 'Superia 400', 'Fuji Superia X-Tra 400.cube', { grain: 25 }),
  FUJI_400H: look('fuji400h', 'Fuji 400H', 'Fuji Pro 400H.cube', { grain: 20, bloom: 5, portraitRetouch: 20 }),
  /** Tungsten cinema film, the base of CineStill 800T. */
  VISION3_500T: look('vision500t', 'Vision3 500T', 'Kodak Vision3 500T.cube', { grain: 35, bloom: 20 }),
  /** Slide film: vivid colour, deep shadows. */
  VELVIA_50: look('velvia50', 'Velvia 50', 'Fuji Velvia 50.cube', { grain: 8, vignette: -10 }),
  REDSCALE: look('redscale', 'Redscale', 'Redscale.png', { contrast: 5, grain: 30, vignette: -15 }),
  /** Monochrome, classic: Tri-X on a normal paper grade. */
  TRIX_400: look('trix400', 'Tri-X 400', 'Kodak Tri-X 400.cube', { grain: 25, monochrome: true }),
  /** Monochrome, Tri-X developed longer: harder and grainier. */
  TRIX_PUSH: look('trixpush', 'Tri-X Push', 'Kodak Tri-X 400 Push.cube', { grain: 40, monochrome: true }),
  /** Monochrome, hard: pushed Tri-X on a hard paper grade, deep blacks, bright whites. */
  TRIX_HARD: look('trixhard', 'Tri-X Hard', 'Kodak Tri-X 400 Hard.cube', { grain: 30, vignette: -10, monochrome: true }),
  /** Monochrome, Eastman Double-X cinema film. */
  DOUBLE_X: look('doublex', 'Double-X', 'Kodak Double-X 5222.cube', { grain: 20, monochrome: true }),
  /** Monochrome, soft: Double-X developed short on a soft paper grade, open shadows. */
  DOUBLE_X_SOFT: look('doublexsoft', 'Double-X Soft', 'Kodak Double-X 5222 Soft.cube', { grain: 20, monochrome: true }),
};

export const ALL_LOOKS: Look[] = [
  Looks.NATURAL, Looks.PORTRA_400, Looks.PORTRA_800, Looks.EKTAR_100, Looks.GOLD_200,
  Looks.SUPERIA_400, Looks.FUJI_400H, Looks.VISION3_500T, Looks.VELVIA_50, Looks.REDSCALE,
  Looks.TRIX_400, Looks.TRIX_PUSH, Looks.TRIX_HARD, Looks.DOUBLE_X, Looks.DOUBLE_X_SOFT,
];

export const lookById = (id: string): Look => {
  const key = RetiredLooks.look(id);
  return ALL_LOOKS.find((l) => l.id === key) ?? Looks.NATURAL;
};

