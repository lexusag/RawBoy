import { calibrationsOf, parseIndex, type CalibrationSet, type ChunkJson, type LensfunIndex, type LensfunLens, type RawIndex } from './Lensfun';

/**
 * Loads the Lensfun database from public/lensfun/ (see web/public/lensfun/README.txt): the index (about 27 kB gzipped) on
 * first use, then the calibration file of the lens in use. Nothing is fetched until the Lens tab's Lensfun switch is on.
 */
const url = (file: string) => new URL(`lensfun/${file}`, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;

async function json<T>(file: string): Promise<T> {
  const response = await fetch(url(file));
  if (!response.ok) throw new Error(`Could not load the Lensfun database (${file}: ${response.status})`);
  return (await response.json()) as T;
}

let index: Promise<LensfunIndex> | null = null;
const chunks = new Map<number, Promise<ChunkJson>>();

export const LensfunData = {
  /** The cameras and lenses; a failed load is retried on the next call. */
  index(): Promise<LensfunIndex> {
    index ??= json<RawIndex>('index.json').then(parseIndex).catch((e) => {
      index = null;
      throw e;
    });
    return index;
  },

  /** The calibration sets of [lens] (none when the database has no data for it). */
  async calibrations(db: LensfunIndex, lens: LensfunLens): Promise<CalibrationSet[]> {
    if (!lens.hasDistortion && !lens.hasTca && !lens.hasVignetting) return [];
    let chunk = chunks.get(lens.chunk);
    if (!chunk) {
      chunk = json<ChunkJson>(`calib-${db.chunks[lens.chunk]}.json`).catch((e) => {
        chunks.delete(lens.chunk);
        throw e;
      });
      chunks.set(lens.chunk, chunk);
    }
    return calibrationsOf(await chunk, lens.id);
  },
};
