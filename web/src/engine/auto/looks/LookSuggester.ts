import type { SceneStats } from '../analysis/SceneAnalyzer';
import { filmLookById } from './FilmLooks';
import { Looks, type Look } from './Look';

/** Key below this (about 4 EV under a typical daylight scene) counts as low light. */
const LOW_KEY = 0.008;
/** A face at least this share of the frame makes it a portrait. */
const PORTRAIT_FACE_AREA = 0.015;
/** As-shot white below this is tungsten light: Vision3 500T, the tungsten-balanced stock, for film looks. */
const TUNGSTEN_KELVIN = 3800;
/** Gold 200 (warm) only for scenes shot in light warmer than this: in cool daylight it turned snow yellow. */
const WARM_LIGHT_KELVIN = 5500;

/** Picks a look from what's in the photo (port of LookSuggester.kt). Monochrome is never suggested. */
export function suggestLook(stats: SceneStats, asShotKelvin: number): Look {
  const lowLight = stats.iso >= 3200 || stats.key < LOW_KEY;
  if (stats.faceArea > PORTRAIT_FACE_AREA) {
    if (lowLight) return Looks.PORTRA_800;
    return Looks.PORTRA_400;
  }
  if (lowLight) return Looks.PORTRA_800;
  if (stats.chroma > 0.25 && stats.greenBlue > 0.3) return Looks.EKTAR_100;
  if (stats.warm > 0.35 && stats.warm > stats.greenBlue && asShotKelvin < WARM_LIGHT_KELVIN) return Looks.GOLD_200;
  return Looks.PORTRA_400;
}

/** The film stock (ALL_FILM_LOOKS) for a photo: the stock of the look suggestLook picks, tungsten scenes on 500T. */
export function suggestFilm(stats: SceneStats, asShotKelvin: number): Look {
  if (stats.faceArea <= PORTRAIT_FACE_AREA && asShotKelvin < TUNGSTEN_KELVIN) return filmLookById('vision500t');
  return filmLookById(suggestLook(stats, asShotKelvin).id);
}
