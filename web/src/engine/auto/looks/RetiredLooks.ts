/**
 * Looks and film stocks removed as near-duplicates (port of RetiredLooks.kt): each maps to the closest one kept, so
 * presets, saved picks and settings that name them still work.
 */
const STOCKS: Record<string, string> = { ultramax400: 'portra800', c200: 'xtra400', portra160: 'portra400' };
const LOOKS: Record<string, string> = { ultramax400: 'portra800', portra160: 'portra400' };
// Also the bundled LUT files renamed to drop trademarked names.
const LUTS: Record<string, string> = {
  'asset:luts/Kodak UltraMax 400.cube': 'asset:luts/Yellow Portrait 800.cube',
  'asset:luts/Kodak Portra 160.cube': 'asset:luts/Yellow Portrait 400.cube',
  'asset:luts/Kodak Portra 400.cube': 'asset:luts/Yellow Portrait 400.cube',
  'asset:luts/Kodak Portra 800.cube': 'asset:luts/Yellow Portrait 800.cube',
  'asset:luts/Kodak Ektar 100.cube': 'asset:luts/Yellow Vivid 100.cube',
  'asset:luts/Kodak Gold 200.cube': 'asset:luts/Yellow Warm 200.cube',
  'asset:luts/Fuji Superia X-Tra 400.cube': 'asset:luts/Green Everyday 400.cube',
  'asset:luts/Fuji Pro 400H.cube': 'asset:luts/Green Pastel 400.cube',
  'asset:luts/Kodak Vision3 500T.cube': 'asset:luts/Yellow Cine 500T.cube',
  'asset:luts/Fuji Velvia 50.cube': 'asset:luts/Green Vivid Slide 50.cube',
  'asset:luts/Kodak Tri-X 400.cube': 'asset:luts/Yellow Mono 400.cube',
  'asset:luts/Kodak Tri-X 400 Push.cube': 'asset:luts/Yellow Mono Push.cube',
  'asset:luts/Kodak Tri-X 400 Hard.cube': 'asset:luts/Yellow Mono Hard.cube',
  'asset:luts/Kodak Double-X 5222.cube': 'asset:luts/Yellow Cine Mono.cube',
  'asset:luts/Kodak Double-X 5222 Soft.cube': 'asset:luts/Yellow Cine Mono Soft.cube',
};

export const RetiredLooks = {
  /** spektrafilm stock ids (FilmStocks, ALL_FILM_LOOKS). */
  stock: (id: string): string => STOCKS[id] ?? id,
  /** Looks ids. */
  look: (id: string): string => LOOKS[id] ?? id,
  /** Bundled LUT ids, as lutIdOf and LutRepository name them. */
  lut: (id: string): string => LUTS[id] ?? id,
};
