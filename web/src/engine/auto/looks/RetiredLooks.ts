/**
 * Looks and film stocks removed as near-duplicates (port of RetiredLooks.kt): each maps to the closest one kept, so
 * presets, saved picks and settings that name them still work.
 */
const STOCKS: Record<string, string> = { ultramax400: 'portra800', c200: 'xtra400', portra160: 'portra400' };
const LOOKS: Record<string, string> = { ultramax400: 'portra800', portra160: 'portra400' };
const LUTS: Record<string, string> = {
  'asset:luts/Kodak UltraMax 400.cube': 'asset:luts/Kodak Portra 800.cube',
  'asset:luts/Kodak Portra 160.cube': 'asset:luts/Kodak Portra 400.cube',
};

export const RetiredLooks = {
  /** spektrafilm stock ids (FilmStocks, ALL_FILM_LOOKS). */
  stock: (id: string): string => STOCKS[id] ?? id,
  /** Looks ids. */
  look: (id: string): string => LOOKS[id] ?? id,
  /** Bundled LUT ids, as lutIdOf and LutRepository name them. */
  lut: (id: string): string => LUTS[id] ?? id,
};
