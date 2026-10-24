import { Looks, type Look } from './Look';
import { RetiredLooks } from './RetiredLooks';

/**
 * Looks on the film stocks (luts/spektrafilm; port of FilmLooks.kt): Auto's Film mode. The stock replaces AgX and the
 * LUT: negative, print and scan (slides: scan only), with grain and halation. Looks add only skin retouch on the
 * portrait films; the auto develop's exposure, white balance and denoise stay.
 */
/** Auto's film grain, a little finer than the stock's own (100). */
export const FILM_GRAIN = 80;

const stock = (id: string, name: string, portraitRetouch = 0): Look =>
  ({ ...Looks.NATURAL, id, name, film: id, portraitRetouch, filmGrain: FILM_GRAIN });

export const FilmLooks = {
  PORTRA_400: stock('portra400', 'Yellow Portrait 400', 20),
};

export const ALL_FILM_LOOKS: Look[] = [
  Looks.NATURAL,
  FilmLooks.PORTRA_400,
  stock('portra800', 'Yellow Portrait 800', 20),
  stock('ektar100', 'Yellow Vivid 100'),
  stock('gold200', 'Yellow Warm 200'),
  stock('fuji400h', 'Green Pastel 400', 20),
  stock('xtra400', 'Green Everyday 400'),
  stock('vision250d', 'Yellow Cine 250D'),
  stock('vision500t', 'Yellow Cine 500T'),
  stock('velvia100', 'Green Vivid Slide 100'),
  stock('provia100', 'Green Slide 100'),
  stock('ektachrome100', 'Yellow Slide 100'),
  stock('kodachrome64', 'Yellow Classic 64'),
];

export const filmLookById = (id: string): Look => {
  const key = RetiredLooks.stock(id);
  return ALL_FILM_LOOKS.find((l) => l.id === key) ?? FilmLooks.PORTRA_400;
};
