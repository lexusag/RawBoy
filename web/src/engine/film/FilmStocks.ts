import type { LutData } from '../lut/LutData';
import { parseCube } from '../lut/LutLoader';
import { RetiredLooks } from '../auto/looks/RetiredLooks';
import formationJson from '../../../../luts/spektrafilm/formation.json';
import stocksJson from '../../../../luts/spektrafilm/stocks.json';

/**
 * Parameters of shaders/film_form.glsl, from formation.json (RawBoy's data, not spektrafilm's): per film layer
 * (C, M, Y) RMS granularity at net density 1 through a 48 um aperture, per channel the fraction of light the base
 * returns and its disc radius, and the in-emulsion scatter.
 */
export interface Formation {
  grainRms: number[];
  halation: number[];
  haloRadiusUm: number;
  scatter: number[];
  scatterUm: number;
}

/**
 * A film stock simulated with spektrafilm (https://github.com/andreavolpato/spektrafilm, Andrea Volpato), as baked with
 * spektrafilm's LUT creator into luts/spektrafilm (see CHANGELOG.txt there): a film LUT (Apple Log -> normalised film
 * density) and a print LUT (density -> sRGB), plus RawBoy's own grain, halation and scatter ([formation]). Port of
 * FilmStocks.kt.
 */
export interface FilmStock {
  id: string;
  name: string;
  filmLut: string;
  printLut: string;
  /** Density wire of the film LUT's output: D = code * (max - min) + min. */
  densityMin: number[];
  densityMax: number[];
  formation: Formation;
}

/** A stock with both its LUTs loaded, ready for ShaderParams. */
export interface FilmData {
  stock: FilmStock;
  film: LutData;
  print: LutData;
}

/** Default format: a 35 mm frame, 36 mm on the long side. Sizes grain and halation. */
export const FRAME_WIDTH_UM = 36000;

const NO_FORMATION: Formation = { grainRms: [0, 0, 0], halation: [0, 0, 0], haloRadiusUm: 0, scatter: [0, 0, 0], scatterUm: 0 };

interface FormationFile {
  defaults: { layerGrain: number[]; halation: number[]; haloRadiusUm: number; scatter: number[]; scatterUm: number };
  stocks: Record<string, Partial<Omit<Formation, 'grainRms'>> & { rms: number }>;
}

/** The stock [id] in formation.json, its own values over the file's defaults. */
export function parseFormation(json: FormationFile, id: string): Formation {
  const s = json.stocks[id];
  if (!s) return NO_FORMATION;
  const d = json.defaults;
  return {
    grainRms: d.layerGrain.map((l) => s.rms * l),
    halation: s.halation ?? d.halation,
    haloRadiusUm: s.haloRadiusUm ?? d.haloRadiusUm,
    scatter: s.scatter ?? d.scatter,
    scatterUm: s.scatterUm ?? d.scatterUm,
  };
}

interface StockJson {
  id: string;
  name: string;
  filmLut: string;
  printLut: string;
  densityMin: number[];
  densityMaxWire: number[];
}

/** The cubes as URLs only: each stock's pair is fetched when it is first shown (30 cubes, ~1.3 MB each as text). */
const cubeUrls = import.meta.glob('../../../../luts/spektrafilm/*.cube', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (file: string): string => {
  const url = Object.entries(cubeUrls).find(([path]) => path.endsWith(`/${file}`))?.[1];
  if (!url) throw new Error(`Missing film LUT ${file}`);
  return url;
};

const ALL: FilmStock[] = (stocksJson.stocks as StockJson[]).map((s) => ({
  id: s.id,
  name: s.name,
  filmLut: s.filmLut,
  printLut: s.printLut,
  densityMin: s.densityMin,
  densityMax: s.densityMaxWire,
  formation: parseFormation(formationJson as FormationFile, s.id),
}));

const loading = new Map<string, Promise<FilmData>>();

async function fetchCube(file: string): Promise<LutData> {
  const response = await fetch(urlOf(file));
  if (!response.ok) throw new Error(`Could not load ${file}: ${response.status}`);
  return parseCube(`film:${file}`, await response.text());
}

export const FilmStocks = {
  all: (): readonly FilmStock[] => ALL,

  byId: (id: string): FilmStock | null => {
    const key = RetiredLooks.stock(id);
    return ALL.find((s) => s.id === key) ?? null;
  },

  /** Loads both LUTs of stock [id] once; later calls share the result (about 0.9 MB of floats per stock). */
  load(id: string): Promise<FilmData> {
    let p = loading.get(id);
    if (!p) {
      const stock = FilmStocks.byId(id);
      if (!stock) return Promise.reject(new Error(`Unknown film stock ${id}`));
      p = Promise.all([fetchCube(stock.filmLut), fetchCube(stock.printLut)]).then(([film, print]) => ({ stock, film, print }));
      p.catch(() => loading.delete(id)); // a failed load can be retried
      loading.set(id, p);
    }
    return p;
  },
};
