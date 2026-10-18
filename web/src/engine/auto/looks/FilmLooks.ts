import { Looks, type Look } from './Look';
import { RetiredLooks } from './RetiredLooks';

/**
 * Looks on the film stocks (luts/spektrafilm; port of FilmLooks.kt): Auto's Film mode. The stock replaces AgX and the
 * LUT: negative, print and scan (slides: scan only), with grain and halation. Looks add only skin retouch on the
 * portrait films; the auto develop's exposure, white balance and denoise stay.
 */
const stock = (id: string, name: string, portraitRetouch = 0): Look => ({ ...Looks.NATURAL, id, name, film: id, portraitRetouch });

export const FilmLooks = {
  PORTRA_400: stock('portra400', 'Portra 400', 20),
};

export const ALL_FILM_LOOKS: Look[] = [
  Looks.NATURAL,
  FilmLooks.PORTRA_400,
  stock('portra800', 'Portra 800', 20),
  stock('ektar100', 'Ektar 100'),
  stock('gold200', 'Gold 200'),
  stock('fuji400h', 'Fuji 400H', 20),
  stock('xtra400', 'X-Tra 400'),
  stock('vision250d', 'Vision3 250D'),
  stock('vision500t', 'Vision3 500T'),
  stock('velvia100', 'Velvia 100'),
  stock('provia100', 'Provia 100F'),
  stock('ektachrome100', 'Ektachrome 100'),
  stock('kodachrome64', 'Kodachrome 64'),
];

export const filmLookById = (id: string): Look => {
  const key = RetiredLooks.stock(id);
  return ALL_FILM_LOOKS.find((l) => l.id === key) ?? FilmLooks.PORTRA_400;
};
