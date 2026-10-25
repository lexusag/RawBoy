import { analyzeFile, type Analysis } from '../../engine/auto/AutoAnalysis';
import { ALL_LOOKS, Looks, type Look } from '../../engine/auto/looks/Look';
import { DEFAULT_STRENGTH, NO_ADJUSTMENTS, applyEditsDevelop, developAuto, sameAdjustments, type Adjustments } from '../../engine/auto/looks/LookApplier';
import { ALL_FILM_LOOKS, FilmLooks } from '../../engine/auto/looks/FilmLooks';
import { suggestFilm, suggestLook } from '../../engine/auto/looks/LookSuggester';
import { autoDevelop } from '../../engine/auto/analysis/AutoTone';
import type { DevelopParams } from '../../engine/develop/DevelopParams';
import { applyPreset, chosenLensPreset, decodePresets, isLensPreset, layerPreset, NO_LENS_PRESET, PRESET_GROUPS, putLensPreset, replacesLook, sameLensPreset, type Preset } from '../../engine/develop/Presets';
import { PresetStore } from '../pro/PresetStore';
import { exportImage } from '../../engine/export/Exporter';
import { baseNameOf, EXTENSIONS, ExportSettingsStore, fileName, type ExportSettings, type OutputNaming } from '../../engine/export/ExportSettings';
import { FilmStocks, type FilmData } from '../../engine/film/FilmStocks';
import type { LutData } from '../../engine/lut/LutData';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import { ShaderParams } from '../../engine/gl/ShaderParams';
import { renderThumbnail } from '../../engine/gl/ThumbnailRenderer';
import { LensTransform } from '../../engine/lens/LensTransform';
import { loadLutCached } from '../../engine/lut/LutRepository';
import { RawImage } from '../../engine/raw/RawImage';
import type { PreviewImage } from '../../engine/gl/PreviewImage';
import { blemishesToHeal, brushLookup, editTexturesOf, PhotoSession } from '../../engine/session/PhotoSession';
import type { MaskLayer } from '../../engine/develop/Masks';
import { segmentSkin } from '../../engine/retouch/SkinSegmenter';
import type { BrushLookup } from '../../engine/gl/ShaderParams';
import { quickImageOf, thumbnailOf } from '../browser/Previews';
import { EditHistory } from '../common/EditHistory';
import { imageUrl, saveExports, savesToPhotos, writeUnique } from '../common/files';
import type { EditsSidecar } from '../../engine/browse/XmpSidecar';
import { findCaptureDate } from '../../engine/browse/CaptureDate';
import { fileDate, saveSort, savedSort, sortPhotos, type PhotoSort } from '../../engine/auto/PhotoOrder';
import { decodeAuto, encodeAuto } from './AutoSidecar';
import { PreviewCache } from './PreviewCache';

/** Where a photo is in the batch. */
export type PhotoStatus = 'queued' | 'analyzing' | 'ready' | 'failed' | 'exporting' | 'exported';

/** Which strip the Look tab shows: the LUT looks or film stocks rendered as negative + print (ALL_FILM_LOOKS). */
export type LookMode = 'looks' | 'film';

/** How photos are added: in a look mode, or "As is" (plain): no auto develop and no look, only what the user applies. */
export type ImportMode = LookMode | 'plain';

/**
 * One photo of the batch (port of AutoPhoto). Only small whole-image copies are kept; the full-resolution raw is
 * decoded again for the detail view and for export.
 */
export interface AutoPhoto {
  id: string;
  file: File;
  name: string;
  /** When it was shot, else the file's date, as an EXIF date (CaptureDate); null if unknown. Orders the batch. */
  date: string | null;
  status: PhotoStatus;
  error: string | null;
  analysis: Analysis | null;
  look: Look;
  suggested: Look;
  /** The look applied: [look] in Looks mode, [filmLook] in Film mode; each mode keeps its own pick. */
  mode: LookMode;
  filmLook: Look;
  suggestedFilm: Look;
  strength: number;
  adjust: Adjustments;
  /** A RawBoy preset developing the photo in place of its look (see applyPresetDevelop), or null. */
  preset: Preset | null;
  /**
   * The develop the photo came back with from the RawBoy tab ("Back to Auto"), in place of its look or preset, with the
   * adjustments on top (see applyEditsDevelop); null = none. The look and preset stay for when it's removed.
   */
  edits: DevelopParams | null;
  /** Which lens preset the photo gets (see chosenLensPreset): null = by its lens, else a pick. */
  lensChoice: string | null;
  /** The lens preset lensChoice gives, on top of the look or preset; null = none. */
  lensPreset: Preset | null;
  /** True once "Apply to all" gave the photo its looks: its analysis then keeps them instead of the suggestions. */
  looksApplied: boolean;
  /** Object URL of the grid thumbnail. */
  thumbnail: string | null;
  /** Where the photo's Auto settings are kept (sent from RawBoy Browser with Edits in sidecars on), else null. */
  sidecar: EditsSidecar | null;
  /**
   * Added "As is": its analysis skips the auto develop (and the skin and noise measurements behind it), so the photo
   * starts as the file itself, Natural with nothing added; a preset, look or slider is all it gets.
   */
  plain: boolean;
}

/** A photo's edits, as Undo and Redo bring them back. */
type Develop = Pick<AutoPhoto, 'look' | 'mode' | 'filmLook' | 'strength' | 'adjust' | 'preset' | 'edits' | 'looksApplied'>;

const developOf = ({ look, mode, filmLook, strength, adjust, preset, edits, looksApplied }: AutoPhoto): Develop =>
  ({ look, mode, filmLook, strength, adjust, preset, edits, looksApplied });

/**
 * [p] with the look (or preset), strength, warmth, tint, contrast, saturation and grain of [source] ("Apply to all", "Copy previous");
 * brightness, denoise and rotation stay (they follow this photo's exposure, noise and framing). RawBoy edits aren't
 * copied (they hold the source's crop and masks); [p]'s own are replaced by the look.
 */
function withLookOf(p: AutoPhoto, source: AutoPhoto): AutoPhoto {
  const { warmth, tint, contrast, saturation, grain } = source.adjust;
  return {
    ...p, look: source.look, mode: source.mode, filmLook: source.filmLook, strength: source.strength, preset: source.preset,
    edits: null, looksApplied: true,
    adjust: { ...p.adjust, warmth, tint, contrast, saturation, grain },
  };
}

/**
 * [p] given [preset]: one with the Light group (replacesLook) develops it in place of its look and RawBoy edits; any
 * other changes only its own groups, in the RawBoy edits, the preset or on top of the look the photo has, and leaves
 * the rest as it was. [layered] is what the photo's preset becomes when it has one (layerPreset by default).
 */
export function withPreset(p: AutoPhoto, preset: Preset, layered: (under: Preset) => Preset = (under) => layerPreset(under, preset)): AutoPhoto {
  if (replacesLook(preset)) return { ...p, preset, edits: null };
  if (p.edits) return { ...p, edits: applyPreset(preset, p.edits) };
  return { ...p, preset: p.preset ? layered(p.preset) : preset };
}

/** The fields of a preset's Denoise & sharpening group, which "Auto denoise all" gives back to each photo's auto develop. */
const DENOISE_FIELDS = PRESET_GROUPS.find((g) => g.key === 'denoise')!.fields;

/**
 * Denoise, Color denoise and sharpening of the auto develop for analysis [a]: measured on the photo (its noise, ISO and
 * exposure). A photo added "As is" skipped the noise measurement, so it gets the ISO table's values.
 */
export function autoNoiseOf(a: Analysis, plain: boolean): Pick<DevelopParams, 'denoise' | 'colorDenoise' | 'sharpening'> {
  const auto = plain ? autoDevelop(a.stats, a.defaults) : a.autoBase;
  return { denoise: auto.denoise, colorDenoise: auto.colorDenoise, sharpening: auto.sharpening };
}

/** [preset] without its Denoise & sharpening group (null when nothing else is left); [preset] itself when it has none. */
export function withoutDenoise(preset: Preset): Preset | null {
  if (!preset.groups.includes('denoise')) return preset;
  const groups = preset.groups.filter((g) => g !== 'denoise');
  if (groups.length === 0) return null;
  const values = { ...preset.values };
  for (const f of DENOISE_FIELDS) delete values[f];
  return { ...preset, groups, values };
}

export const activeLook = (p: AutoPhoto): Look => (p.mode === 'film' ? p.filmLook : p.look);

/** Label of RawBoy edits (AutoPhoto.edits) in place of a look. */
export const EDITS_NAME = 'RawBoy edits';

/** Label of a photo added "As is" while nothing is applied to it. */
export const AS_IS_NAME = 'As is';

/**
 * What develops the photo, for labels: RawBoy edits, the preset's name, else the active look's ("As is" for a plain
 * photo's Natural), with a partial preset's name after the look's (alone on a plain photo).
 */
export function lookName(p: AutoPhoto): string {
  if (p.edits) return EDITS_NAME;
  if (p.preset && replacesLook(p.preset)) return p.preset.name;
  const asIs = p.plain && activeLook(p) === Looks.NATURAL;
  if (p.preset) return asIs ? p.preset.name : `${activeLook(p).name} + ${p.preset.name}`;
  return asIs ? AS_IS_NAME : activeLook(p).name;
}

/** The develop settings for the current look (or preset) and controls (null until analysed). */
export function paramsOf(p: AutoPhoto): DevelopParams | null {
  const a = p.analysis;
  if (!a) return null;
  // Edits read back from a sidecar don't know the photo is display-referred; the analysis does.
  if (p.edits) return applyEditsDevelop({ ...p.edits, displaySource: a.defaults.displaySource }, p.adjust);
  return developAuto(a.autoBase, activeLook(p), p.strength, p.adjust, a.stats.hasFace, p.preset, p.lensPreset);
}

/** Progress of "Export all". */
export interface BatchExport {
  done: number;
  total: number;
  failed: number;
  current: number;
  /** Stop was pressed: the photo being exported finishes, the rest are left as they are. */
  stopping?: boolean;
  /**
   * "Export all": the photos not yet done, the one being exported included. The grid shows them desaturated, so the
   * batch can be followed as each turns to colour once saved.
   */
  waiting?: ReadonlySet<string>;
}

export const NAMING: OutputNaming = { suffix: 'auto' };
export const SETTINGS: ExportSettings = { format: 'jpeg', jpegQuality: 92, tiffBits: 16, maxLongSide: null };
/** Export sizes offered (long side in pixels; null = full resolution). */
export const EXPORT_SIZES: (number | null)[] = [null, 5600, 4096, 2048, 1080];
const EXPORT_KEY = 'rawboy.auto.export';
const GRID_THUMBNAIL = 512;
const LOOK_THUMBNAIL = 192;

export interface AutoState {
  photos: AutoPhoto[];
  export: BatchExport | null;
  message: string | null;
  /** Photo shown in the detail view, or null for the grid. */
  selected: string | null;
  /** Id of the photo [session] holds, once it has loaded. */
  sessionReady: string | null;
  /** The selected photo's cached preview while [session] is still decoding it (see PreviewCache). */
  cachedPreview: { id: string; image: PreviewImage } | null;
  /** The mode photos are added in, chosen in the grid before importing (remembered in this browser). */
  importMode: ImportMode;
  /** How the batch is ordered: by shoot date (the default) or file name (remembered in this browser). */
  sort: PhotoSort;
  /** Format, JPEG quality, TIFF bit depth and size of exports, chosen in the grid (remembered in this browser). */
  exportSettings: ExportSettings;
  /** The RawBoy preset applied to the whole batch, which photos added later get too; null = looks. */
  preset: Preset | null;
  /**
   * Lens presets from the RawBoy tab (isLensPreset): each photo taken with a preset's lens gets its lens corrections on
   * top of its look or preset.
   */
  lensPresets: Preset[];
  /** The lens preset choice for the whole batch, which photos added later get too (null = by lens). */
  lensChoice: string | null;
  /** Frame colour around the photo in the detail view (index into FrameColors, remembered in this browser). */
  frameColor: number;
  /** A waiting photo clicked in the grid: analysed next, ahead of the rest, then opened (null: none). */
  opening: string | null;
}

const IMPORT_MODE_KEY = 'rawboy.auto.importMode';
const SORT_KEY = 'rawboy.auto.sort';
const FRAME_KEY = 'rawboy.auto.frame';

/** Auto's own export choice, apart from RawBoy's; defaults are SETTINGS' (JPEG 92, 16-bit TIFF, full size). */
function savedExportSettings(): ExportSettings {
  const s = ExportSettingsStore.load(EXPORT_KEY);
  return { ...s, maxLongSide: EXPORT_SIZES.includes(s.maxLongSide) ? s.maxLongSide : null };
}

function savedFrame(): number {
  try {
    const i = Number(localStorage.getItem(FRAME_KEY));
    return Number.isInteger(i) && i >= 0 && i < FrameColors.length ? i : 0;
  } catch {
    return 0;
  }
}

function savedImportMode(): ImportMode {
  try {
    const mode = localStorage.getItem(IMPORT_MODE_KEY);
    return mode === 'film' || mode === 'plain' ? mode : 'looks';
  } catch {
    return 'looks';
  }
}

/** Files with the same name, size and date are the same photo. */
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** A simple async mutex: full-resolution decodes run one at a time. */
class Lock {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** RawBoy Auto's batch, look and export logic (port of AutoViewModel.kt). */
export class AutoStore {
  private _state: AutoState = { photos: [], export: null, message: null, selected: null, sessionReady: null, cachedPreview: null, importMode: savedImportMode(), sort: savedSort(SORT_KEY),
    exportSettings: savedExportSettings(), preset: null, lensPresets: PresetStore.load().filter(isLensPreset), lensChoice: null, frameColor: savedFrame(),
    opening: null };
  /**
   * Keeps lens presets opened from a file with the RawBoy tab's presets (set by the page; null: in this browser's
   * preset store directly); the RawBoy tab then hands the new list back through setLensPresets.
   */
  saveLensPresets: ((presets: Preset[]) => void) | null = null;
  /** Deletes a lens preset from the RawBoy tab's presets (set by the page; null: from this browser's preset store). */
  deleteLensPreset: ((id: string) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  /** The detail view's photo, decoded at full resolution (preview, 100% view, single export). */
  readonly session = new PhotoSession((m) => this.update({ message: m }));
  private readonly decodeLock = new Lock();
  /** Each analysed photo's detail preview, so a photo shows at once while [session] decodes it. */
  private readonly previews = new PreviewCache();
  /** The open photo's full-resolution image was freed for the RawBoy tab ([editInRawBoy]); [resume] decodes it again. */
  private released = false;
  /** The detail preview's frame width in device pixels. */
  private frameWidth = 0;
  private analyzing = false;
  private nextId = 1;
  private readonly thumbTimers = new Map<string, number>();
  /** Painted masks of RawBoy edits on the analysis's base, by the edits' mask list (see smallShader). */
  private readonly brushes = new WeakMap<readonly MaskLayer[], BrushLookup>();
  /** Each photo's edits, for Undo and Redo in the photo view. */
  private readonly histories = new Map<string, EditHistory<Develop>>();
  /** Settings read back from photos' sidecars; analysis waits for them, so it keeps their looks. */
  private restoring: Promise<unknown> = Promise.resolve();
  private readonly saveTimers = new Map<string, number>();
  /** What each photo's sidecar was last given, so unchanged settings aren't written again. */
  private readonly saved = new Map<string, string>();
  /** Grid thumbnails from the files' own previews, made one at a time while photos wait for their analysis. */
  private quickThumbs: Promise<unknown> = Promise.resolve();
  /** Look-strip thumbnails: the latest per photo and look, with the adjustments it was rendered at. */
  private readonly lookThumbs = new Map<string, { adjust: Adjustments; lensPreset: Preset | null; url: string }>();

  get state() {
    return this._state;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private update(patch: Partial<AutoState>) {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l();
  }

  private photo(id: string) {
    return this._state.photos.find((p) => p.id === id);
  }

  private updatePhoto(id: string, change: (p: AutoPhoto) => AutoPhoto) {
    this.update({ photos: this._state.photos.map((p) => (p.id === id ? change(p) : p)) });
  }

  consumeMessage() {
    this.update({ message: null });
  }

  showMessage(message: string) {
    this.update({ message });
  }

  /**
   * Adds photos; files already listed (same name, size and date) are skipped. Returns how many were added. [sidecars]
   * (same order as [files]; RawBoy Browser's): photos come back with the Auto settings kept there, and keep them there.
   */
  add(files: File[], sidecars: readonly (EditsSidecar | null)[] = []): number {
    const known = new Set(this._state.photos.map((p) => fileKey(p.file)));
    const fresh: AutoPhoto[] = [];
    const importMode = this._state.importMode;
    const plain = importMode === 'plain';
    const mode: LookMode = importMode === 'plain' ? 'looks' : importMode;
    for (const [i, file] of files.entries()) {
      if (known.has(fileKey(file))) continue;
      known.add(fileKey(file));
      fresh.push({ sidecar: sidecars[i] ?? null,
        id: String(this.nextId++), file, name: file.name, date: fileDate(file.lastModified), status: 'queued', error: null, analysis: null,
        look: Looks.NATURAL, suggested: Looks.NATURAL, mode, plain, filmLook: FilmLooks.PORTRA_400,
        suggestedFilm: FilmLooks.PORTRA_400, strength: DEFAULT_STRENGTH, adjust: NO_ADJUSTMENTS, preset: this._state.preset, edits: null,
        lensChoice: this._state.lensChoice, lensPreset: null, looksApplied: false,
        thumbnail: null,
      });
    }
    if (!fresh.length) return 0;
    // "As is" is for finished files: no note that they aren't raws.
    const note = plain ? null : nonRawNote(fresh.map((p) => p.name));
    this.update({ photos: sortPhotos([...this._state.photos, ...fresh], this._state.sort), ...(note ? { message: note } : {}) });
    void this.readDates(fresh);
    for (const p of fresh) this.quickThumbs = this.quickThumbs.then(() => this.quickThumbnail(p.id)).catch(() => undefined);
    const restore = Promise.all(fresh.filter((p) => p.sidecar).map((p) => this.restoreSaved(p.id, p.sidecar!)));
    this.restoring = Promise.all([this.restoring, restore]);
    void this.processQueue();
    return fresh.length;
  }

  /**
   * Gives [photos] their capture dates (they start with their files' dates) and reorders the batch once for all of
   * them, so a big import moves at most once.
   */
  private async readDates(photos: AutoPhoto[]) {
    const dates = new Map<string, string>();
    for (const p of photos) {
      const date = await findCaptureDate(p.file);
      if (date && date !== p.date) dates.set(p.id, date);
    }
    if (!dates.size) return;
    const photosNow = this._state.photos.map((p) => (dates.has(p.id) ? { ...p, date: dates.get(p.id)! } : p));
    this.update({ photos: sortPhotos(photosNow, this._state.sort) });
  }

  /** Orders the batch by [sort] from now on (remembered in this browser). */
  setSort(sort: PhotoSort) {
    saveSort(SORT_KEY, sort);
    this.update({ sort, photos: sortPhotos(this._state.photos, sort) });
  }

  /** Gives photo [id] the settings kept in its sidecar, if any (they count as given, so analysis keeps the look). */
  private async restoreSaved(id: string, sidecar: EditsSidecar) {
    let text: string | null = null;
    try {
      text = await sidecar.read('Auto');
    } catch {
      return; // unreadable: starts as a new photo, and the first change rewrites it
    }
    const saved = text != null ? decodeAuto(text) : null;
    if (!saved || !this.photo(id)) return;
    this.saved.set(id, text!);
    // A picked lens preset is found in this browser's lens presets (by lens, or name for manual lenses), else kept there.
    let lens = saved.lensPreset ? sameLensPreset(this._state.lensPresets, saved.lensPreset) : null;
    if (saved.lensPreset && !lens) {
      this.keepLensPresets([saved.lensPreset]);
      lens = sameLensPreset(this._state.lensPresets, saved.lensPreset);
    }
    const lensChoice = saved.lensChoice === NO_LENS_PRESET ? NO_LENS_PRESET : lens?.id ?? null;
    this.updatePhoto(id, (p) => ({ ...p, ...saved, lensChoice, lensPreset: lens, looksApplied: true }));
    this.refreshThumbnail(id, true);
  }

  /**
   * Shows photo [id] in the grid at once from the file's own preview (as RawBoy Browser does: a JPEG as it is, a raw's
   * embedded JPEG), until its analysis renders the develop; nothing when the file has none or it was rendered already.
   */
  private async quickThumbnail(id: string) {
    const p = this.photo(id);
    if (!p || p.thumbnail || p.analysis) return;
    const image = await quickImageOf(p.file);
    if (!image || this.photo(id)?.thumbnail) return;
    const url = URL.createObjectURL(await thumbnailOf(image, GRID_THUMBNAIL));
    const now = this.photo(id);
    if (!now || now.thumbnail) return URL.revokeObjectURL(url);
    this.updatePhoto(id, (q) => ({ ...q, thumbnail: url }));
  }

  /** Keeps photo [id]'s settings in its sidecar once they rest for a moment (a slider drag is one write). */
  private scheduleSave(id: string) {
    if (!this.photo(id)?.sidecar) return;
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(id, window.setTimeout(() => void this.saveSidecar(id), 800));
  }

  private async saveSidecar(id: string) {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.delete(id);
    const p = this.photo(id);
    if (!p?.sidecar) return;
    const text = encodeAuto(p);
    if (this.saved.get(id) === text) return;
    this.saved.set(id, text);
    try {
      await p.sidecar.write(text, 'Auto');
    } catch (e) {
      this.saved.delete(id);
      this.update({ message: `Couldn't save ${p.name}'s settings to ${p.sidecar.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** Writes settings waiting for sidecars now. */
  async flushSidecars() {
    await Promise.all([...this.saveTimers.keys()].map((id) => this.saveSidecar(id)));
  }

  setViewSize(width: number, height: number, frame: number) {
    this.frameWidth = frame;
    this.session.setViewSize(width, height, frame);
  }

  toggleZoom = (x: number, y: number) => this.session.toggleZoom(x, y, this.frameWidth);
  zoomBy = (x: number, y: number, factor: number) => this.session.zoomBy(x, y, factor, this.frameWidth);

  /** Single click in the detail preview: outside the photo (fit view) cycles the frame colour, as in RawBoy. Remembered. */
  onPreviewClick(x: number, y: number) {
    if (this.session.state.zoomCenter || !this.session.hasImage) return;
    if (this.session.fitToImage(x, y, this.frameWidth)) return;
    const next = (this._state.frameColor + 1) % FrameColors.length;
    try {
      localStorage.setItem(FRAME_KEY, String(next));
    } catch {
      // not remembered
    }
    this.update({ frameColor: next });
  }

  /** Mode for photos added from now on; photos already in the batch keep theirs. */
  setImportMode(importMode: ImportMode) {
    this.update({ importMode });
    try {
      localStorage.setItem(IMPORT_MODE_KEY, importMode);
    } catch {
      // not remembered (private window, blocked storage)
    }
  }

  /**
   * Develops every photo, and those added later, with [preset] in place of its look: all the preset holds, lens
   * corrections included, on top of each photo's auto develop. Each photo keeps its look for when the preset is removed.
   * A preset without the Light group changes only its own groups on every photo (see withPreset), and joins the batch
   * preset for photos added later.
   */
  applyPresetToAll(preset: Preset) {
    if (isLensPreset(preset)) return this.addLensPresets([preset]);
    if (this._state.export) return;
    const before = this._state.preset;
    const batch = before && !replacesLook(preset) ? layerPreset(before, preset) : preset;
    this.update({ preset: batch });
    // Photos with the batch preset keep sharing it (removePreset finds them by it).
    for (const p of this._state.photos) this.changeDevelop(p.id, (q) => withPreset(q, preset, (under) => (under === before ? batch : layerPreset(under, preset))), true);
    this.update({ message: `${preset.name} applied to all photos` });
  }

  /**
   * Develops only the photos in [ids] (the grid's selection, e.g. one scene) with [preset], so one batch can hold a
   * preset per scene. The batch preset, which photos added later get, stays as it is. A preset without the Light group
   * changes only its own groups (see withPreset).
   */
  applyPresetTo(preset: Preset, ids: ReadonlySet<string>) {
    if (isLensPreset(preset)) return this.addLensPresets([preset]);
    if (this._state.export) return;
    const photos = this._state.photos.filter((p) => ids.has(p.id));
    for (const p of photos) this.changeDevelop(p.id, (q) => withPreset(q, preset), true);
    this.update({ message: `${preset.name} applied to ${photos.length === 1 ? '1 photo' : `${photos.length} photos`}` });
  }

  /**
   * Takes the batch preset off the photos it develops (and photos added later): each goes back to its look. Photos
   * given another preset on a selection keep theirs.
   */
  removePreset() {
    const batch = this._state.preset;
    if (this._state.export || !batch) return;
    this.update({ preset: null });
    for (const p of this._state.photos) if (p.preset === batch) this.changeDevelop(p.id, (q) => ({ ...q, preset: null }), true);
  }

  /**
   * Keeps lens presets (opened from a file) in place of those for the same lenses; photos taken with those lenses get
   * their lens corrections on top of their look or preset, here and in the RawBoy tab's presets.
   */
  addLensPresets(presets: readonly Preset[]) {
    this.keepLensPresets(presets);
    const name = presets.length === 1 ? `Lens preset ${presets[0].name}` : `${presets.length} lens presets`;
    if (presets.every((p) => !p.lens?.trim())) {
      this.update({ message: `${name} saved: pick ${presets.length === 1 ? 'it' : 'them'} under Lens presets` });
      return;
    }
    const lenses = new Set(presets.flatMap((p) => (p.lens?.trim() ? [p.lens.trim().toLowerCase()] : [])));
    const matched = this._state.photos.filter((p) => p.lensPreset?.lens && lenses.has(p.lensPreset.lens.trim().toLowerCase())).length;
    this.update({
      message: `${name} saved for photos taken with ${presets.length === 1 ? 'that lens' : 'those lenses'} (${matched === 1 ? '1 photo' : `${matched} photos`} here)`,
    });
  }

  /** Keeps lens presets with the RawBoy tab's presets, in place of those for the same lenses (see putLensPreset). */
  private keepLensPresets(presets: readonly Preset[]) {
    const save = this.saveLensPresets;
    if (save) save([...presets]);
    else {
      const all = presets.reduce(putLensPreset, PresetStore.load());
      if (!PresetStore.save(all)) this.update({ message: 'Could not save presets in this browser' });
      this.setLensPresets(all.filter(isLensPreset));
    }
  }

  /** Forgets lens preset id (here and in the RawBoy tab's presets); photos that picked it go back to matching by lens. */
  removeLensPreset(id: string) {
    const remove = this.deleteLensPreset;
    if (remove) remove(id);
    else {
      const all = PresetStore.load().filter((p) => p.id !== id);
      if (!PresetStore.save(all)) this.update({ message: 'Could not save presets in this browser' });
      this.setLensPresets(all.filter(isLensPreset));
    }
  }

  /**
   * The lens presets (from the RawBoy tab's presets); each analysed photo takes the one its lensChoice gives. A removed
   * preset's photos go back to matching by lens.
   */
  setLensPresets(lensPresets: Preset[]) {
    const kept = (c: string | null) => (c === null || c === NO_LENS_PRESET || lensPresets.some((p) => p.id === c) ? c : null);
    this.update({ lensPresets, lensChoice: kept(this._state.lensChoice) });
    for (const p of this._state.photos) {
      const lensChoice = kept(p.lensChoice);
      if (lensChoice !== p.lensChoice) this.updatePhoto(p.id, (q) => ({ ...q, lensChoice }));
      if (!p.analysis) continue;
      const next = chosenLensPreset(lensPresets, lensChoice, p.analysis.lens.lensName);
      if (next !== p.lensPreset) this.changeDevelop(p.id, (q) => ({ ...q, lensPreset: next }), null);
    }
  }

  /**
   * Gives the photos in ids, or the whole batch and photos added later when null, the lens preset choice (see
   * chosenLensPreset): manual lenses record no lens name, so their presets are picked by hand.
   */
  chooseLensPreset(choice: string | null, ids: ReadonlySet<string> | null = null) {
    if (this._state.export) return;
    if (!ids) this.update({ lensChoice: choice });
    const photos = this._state.photos.filter((p) => !ids || ids.has(p.id));
    for (const p of photos) {
      // Before analysis by-lens finds nothing yet, but a picked preset is known (and kept in the photo's sidecar).
      const lensPreset = chosenLensPreset(this._state.lensPresets, choice, p.analysis?.lens.lensName ?? '');
      this.changeDevelop(p.id, (q) => ({ ...q, lensChoice: choice, lensPreset }), null);
    }
    const what = choice === null ? 'Lens presets by lens' : choice === NO_LENS_PRESET ? 'No lens preset'
      : this._state.lensPresets.find((p) => p.id === choice)?.name;
    if (!what) return;
    this.update({ message: `${what} for ${!ids ? 'all photos' : photos.length === 1 ? '1 photo' : `${photos.length} photos`}` });
  }

  /** Takes the RawBoy edits off one photo, back to its preset or look. */
  removeEdits = (id: string) => this.changeDevelop(id, (p) => ({ ...p, edits: null }), true);

  /**
   * "Back to Auto" from the RawBoy tab: develops [file]'s photo with [params] in place of its look or preset, Auto's
   * controls back at zero (the edits already hold what they did), as one undo step, and opens it. [id] is the photo the
   * RawBoy tab got it from (Edit in RawBoy); otherwise the photo with the same file, added to the batch if missing.
   * False while exporting.
   */
  receiveEdits(file: File, params: DevelopParams, id: string | null): boolean {
    if (this._state.export) return false;
    const find = () => (id && this.photo(id)?.file === file ? this.photo(id) : this._state.photos.find((p) => fileKey(p.file) === fileKey(file)));
    let p = find();
    if (!p) {
      this.add([file]);
      p = find();
      if (!p) return false;
    }
    this.changeDevelop(p.id, (q) => ({ ...q, edits: params, adjust: NO_ADJUSTMENTS }), true);
    if (p.analysis) this.openDetail(p.id);
    else {
      this.closeDetail();
      this.update({ message: `${p.name} added to Auto with its RawBoy edits` });
    }
    return true;
  }

  /** Takes the preset off one photo, back to its look; the batch preset stays for photos added later. */
  removePhotoPreset = (id: string) => this.changeDevelop(id, (p) => ({ ...p, preset: null }), true);

  /** The presets in a RawBoy preset file (.rawboy.json, as RawBoy exports them, also from Android); null if it isn't one. */
  async readPresetFile(file: File): Promise<Preset[] | null> {
    try {
      const presets = decodePresets(await file.text());
      if (presets.length) return presets;
    } catch {
      // not JSON, or not a preset
    }
    this.update({ message: `${file.name} isn't a RawBoy preset file` });
    return null;
  }

  /** Format, quality, bit depth and size for the next exports. */
  setExportSettings(exportSettings: ExportSettings) {
    this.update({ exportSettings });
    ExportSettingsStore.save(exportSettings, EXPORT_KEY);
  }

  /** Takes photos out of the batch (not while exporting). Nothing is deleted from disk. */
  remove(ids: Set<string>) {
    if (!ids.size || this._state.export) return;
    if (this._state.selected && ids.has(this._state.selected)) this.closeDetail();
    if (this._state.sessionReady && ids.has(this._state.sessionReady)) {
      this.session.close(); // frees the full-resolution image
      this.update({ sessionReady: null });
    }
    for (const p of this._state.photos) {
      if (!ids.has(p.id)) continue;
      if (p.thumbnail) URL.revokeObjectURL(p.thumbnail);
      clearTimeout(this.thumbTimers.get(p.id));
      if (this.saveTimers.has(p.id)) void this.saveSidecar(p.id); // the photo's last change still reaches its sidecar
      this.histories.delete(p.id);
      void this.previews.remove(p.id);
    }
    if (this._state.cachedPreview && ids.has(this._state.cachedPreview.id)) this.update({ cachedPreview: null });
    if (this._state.opening && ids.has(this._state.opening)) this.update({ opening: null });
    for (const [k, t] of this.lookThumbs) {
      if (ids.has(k.split('|')[0])) {
        URL.revokeObjectURL(t.url);
        this.lookThumbs.delete(k);
      }
    }
    this.update({ photos: this._state.photos.filter((p) => !ids.has(p.id)) });
  }

  /**
   * Takes the detail view's photo [id] out of the batch (nothing is deleted from disk) and opens the next analysed
   * photo, or the one before it at the batch's end; back to the grid when it was the last one.
   */
  removeOpened(id: string) {
    const p = this.photo(id);
    if (!p || this._state.export) return;
    const pages = this._state.photos.filter((q) => q.analysis);
    const index = pages.findIndex((q) => q.id === id);
    const next = index < 0 ? undefined : pages[index + 1] ?? pages[index - 1];
    this.remove(new Set([id]));
    if (next) this.openDetail(next.id);
    this.showMessage(`${p.name} removed from the batch`);
  }

  /** Analyses queued photos one at a time (each decode needs the full raw in memory). */
  private async processQueue() {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      for (;;) {
        await this.restoring;
        const next = this.nextQueued();
        if (!next) break;
        this.updatePhoto(next.id, (p) => ({ ...p, status: 'analyzing' }));
        try {
          const analysis = await this.decodeLock.run(() => analyzeFile(next.file, next.name, (preview) => void this.previews.put(next.id, preview), next.plain));
          if (!this.photo(next.id)) void this.previews.remove(next.id); // removed while it was analysed
          const look = suggestLook(analysis.stats, analysis.defaults.temperature);
          const filmLook = suggestFilm(analysis.stats, analysis.defaults.temperature);
          this.updatePhoto(next.id, (p) => ({
            ...p, status: 'ready', analysis, suggested: look, suggestedFilm: filmLook,
            lensPreset: chosenLensPreset(this._state.lensPresets, p.lensChoice, analysis.lens.lensName),
            // A plain photo stays Natural (nothing added); its film suggestion is there if it switches to Film.
            look: p.looksApplied || p.plain ? p.look : look, filmLook: p.looksApplied ? p.filmLook : filmLook,
          }));
          this.refreshThumbnail(next.id, true);
          this.openIfWaiting(next.id);
        } catch (e) {
          // Mark this photo and go on with the rest.
          this.updatePhoto(next.id, (p) => ({ ...p, status: 'failed', error: e instanceof Error ? e.message : String(e) }));
          if (this._state.opening === next.id) this.update({ opening: null });
        }
      }
    } finally {
      this.analyzing = false;
    }
  }

  /** The photo to analyse next: the one clicked to open ([opening]) if it's still waiting, else the first waiting. */
  private nextQueued(): AutoPhoto | undefined {
    const opening = this._state.opening ? this.photo(this._state.opening) : undefined;
    return opening?.status === 'queued' ? opening : this._state.photos.find((p) => p.status === 'queued');
  }

  /** Opens photo [id] now that it's analysed, if it was clicked while waiting and the grid is still showing. */
  private openIfWaiting(id: string) {
    if (this._state.opening !== id) return;
    this.update({ opening: null });
    if (this._state.selected === null) this.openDetail(id);
  }

  // ---- Look and controls ----

  /** Sets the look of the photo's current mode (a film look in Film mode, a LUT look otherwise). */
  setLook = (id: string, look: Look) => this.changeDevelop(id, (p) => (p.mode === 'film' ? { ...p, filmLook: look } : { ...p, look }), true);
  setMode = (id: string, mode: LookMode) => this.changeDevelop(id, (p) => ({ ...p, mode }), true);
  setStrength = (id: string, strength: number) => this.changeDevelop(id, (p) => ({ ...p, strength }));
  /** Sliders (a drag is one undo step); [force] for a button. */
  setAdjust = (id: string, change: Partial<Adjustments>, force = false) =>
    this.changeDevelop(id, (p) => ({ ...p, adjust: { ...p.adjust, ...change } }), force);

  canUndo = (id: string) => this.histories.get(id)?.canUndo ?? false;
  canRedo = (id: string) => this.histories.get(id)?.canRedo ?? false;

  /** Takes photo [id]'s last edit back (not while exporting). */
  undo = (id: string) => this.restore(id, (h, d) => h.undo(d));
  redo = (id: string) => this.restore(id, (h, d) => h.redo(d));

  private restore(id: string, step: (h: EditHistory<Develop>, current: Develop) => Develop | null) {
    const p = this.photo(id);
    const h = this.histories.get(id);
    if (!p || !h || this._state.export) return;
    const d = step(h, developOf(p));
    if (d) this.changeDevelop(id, (q) => ({ ...q, ...d }), null);
  }

  /** Turns the analysed photos among [ids] by [quarterTurns] clockwise quarter turns (negative = left); not while exporting. */
  rotate(ids: Set<string>, quarterTurns: number) {
    if (this._state.export) return;
    for (const p of this._state.photos) {
      if (ids.has(p.id) && p.analysis) this.setAdjust(p.id, { rotation: (((p.adjust.rotation + quarterTurns) % 4) + 4) % 4 }, true);
    }
  }

  /**
   * Gives every photo of the batch the look (or preset), strength, warmth, tint, contrast, saturation and grain of [id], including
   * photos still being analysed (they keep it rather than their suggestion); brightness and denoise stay per photo (they follow
   * each photo's exposure and noise). Not while exporting.
   */
  applyLookToAll(id: string) {
    if (this._state.export) return;
    const source = this.photo(id);
    if (!source) return;
    for (const p of this._state.photos) {
      if (p.id !== id) this.changeDevelop(p.id, (q) => withLookOf(q, source), true);
    }
    this.update({ message: `${lookName(source)} applied to all photos` });
  }

  /** The analysed photo before [id] in the batch (the one Backspace goes back to), for "Copy previous". */
  previousPhoto(id: string): AutoPhoto | null {
    const pages = this._state.photos.filter((p) => p.analysis);
    const index = pages.findIndex((p) => p.id === id);
    return index > 0 ? pages[index - 1] : null;
  }

  /**
   * Gives photo [id] what "Apply to all" copies, from the photo before it ([previousPhoto]): look (or preset), strength,
   * brightness, warmth, tint, contrast, saturation and grain, as one undo step (a neighbouring shot of the same scene usually wants its
   * brightness too, unlike Apply to all); denoise and rotation stay. Not while exporting.
   */
  copyPrevious(id: string) {
    if (this._state.export) return;
    const source = this.previousPhoto(id);
    if (!source) return;
    this.changeDevelop(id, (q) => {
      const p = withLookOf(q, source);
      return { ...p, adjust: { ...p.adjust, brightness: source.adjust.brightness } };
    }, true);
    this.update({ message: `Copied from ${source.name}` });
  }

  /**
   * "Auto denoise all", for a batch that's otherwise done: every photo gets the denoise, colour denoise and sharpening
   * the auto develop measured on it, whatever else develops it. The Denoise slider goes back to 0, presets (the batch's
   * too, for photos added later) lose their Denoise & sharpening group, and RawBoy edits take the auto values in place
   * of their own; looks, presets, lens corrections and the other sliders stay. One undo step per photo; RawBoy edits of
   * photos still being analysed are left as they are. [ids] (the grid's selection): only those photos, and the batch
   * preset stays as it is. Not while exporting.
   */
  autoDenoiseAll(ids?: ReadonlySet<string>) {
    if (this._state.export) return;
    const stripped = new Map<Preset, Preset | null>();
    const strip = (preset: Preset | null) => {
      if (!preset) return null;
      if (!stripped.has(preset)) stripped.set(preset, withoutDenoise(preset));
      return stripped.get(preset)!;
    };
    if (this._state.preset && !ids) this.update({ preset: strip(this._state.preset) });
    let count = 0;
    for (const p of this._state.photos) {
      if (ids && !ids.has(p.id)) continue;
      const noise = p.edits && p.analysis ? autoNoiseOf(p.analysis, p.plain) : null;
      const edits = p.edits && noise && DENOISE_FIELDS.some((f) => p.edits![f] !== noise[f as keyof typeof noise]) ? { ...p.edits, ...noise } : p.edits;
      const preset = strip(p.preset);
      if (p.adjust.denoise === 0 && edits === p.edits && preset === p.preset) continue;
      this.changeDevelop(p.id, (q) => ({ ...q, adjust: { ...q.adjust, denoise: 0 }, preset, edits }), true);
      count++;
    }
    const none = !ids ? 'Every photo already has its auto denoise'
      : ids.size === 1 ? 'This photo already has its auto denoise' : 'These photos already have their auto denoise';
    this.update({ message: count === 0 ? none : `Auto denoise on ${count === 1 ? '1 photo' : `${count} photos`}` });
  }

  /** [force]: its own undo step (false: a slider, coalesced; null: Undo or Redo itself, not recorded). */
  private changeDevelop(id: string, change: (p: AutoPhoto) => AutoPhoto, force: boolean | null = false) {
    const before = this.photo(id);
    const paramsBefore = before ? paramsOf(before) : null;
    if (before && force !== null) {
      let h = this.histories.get(id);
      if (!h) this.histories.set(id, (h = new EditHistory<Develop>()));
      h.record(developOf(before), force);
    }
    this.updatePhoto(id, change);
    const p = this.photo(id);
    if (!p) return;
    if (this._state.sessionReady === id) {
      const params = paramsOf(p);
      if (params) this.session.setParams(params);
      // Only a look change (or Strength reaching 0) changes the LUT or stock; slider drags must not reload them.
      const onError = (m: string) => this.update({ message: m });
      if (params?.lut !== paramsBefore?.lut) this.session.selectLut(params?.lut ?? null, onError);
      if (params?.film !== paramsBefore?.film) this.session.selectFilm(params?.film ?? null, onError);
    }
    this.refreshThumbnail(id, false);
    this.scheduleSave(id);
  }

  /** Re-renders the grid thumbnail; slider drags are debounced. */
  private refreshThumbnail(id: string, immediate: boolean) {
    clearTimeout(this.thumbTimers.get(id));
    const run = async () => {
      const p = this.photo(id);
      const params = p && paramsOf(p);
      if (!p || !params) return;
      try {
        const url = await imageUrl(await this.render(p, params, GRID_THUMBNAIL));
        const now = this.photo(id);
        if (!now) return URL.revokeObjectURL(url);
        if (now.thumbnail) URL.revokeObjectURL(now.thumbnail);
        this.updatePhoto(id, (q) => ({ ...q, thumbnail: url }));
      } catch {
        // keep the old thumbnail
      }
    };
    if (immediate) void run();
    else this.thumbTimers.set(id, window.setTimeout(run, 250));
  }

  /** [look] on photo [id] at the default strength with its adjustments, small, for the look strip. */
  async lookThumbnail(id: string, look: Look): Promise<string | null> {
    const p = this.photo(id);
    const a = p?.analysis;
    if (!p || !a) return null;
    const key = thumbKey(id, look);
    const hit = this.lookThumbs.get(key);
    if (hit && sameAdjustments(hit.adjust, p.adjust) && hit.lensPreset === p.lensPreset) return hit.url;
    const params = developAuto(a.autoBase, look, DEFAULT_STRENGTH, p.adjust, a.stats.hasFace, null, p.lensPreset);
    try {
      const url = await imageUrl(await this.render(p, params, LOOK_THUMBNAIL));
      if (hit) URL.revokeObjectURL(hit.url);
      this.lookThumbs.set(key, { adjust: p.adjust, lensPreset: p.lensPreset, url });
      return url;
    } catch {
      return null;
    }
  }

  /** True when the look-strip thumbnail of [look] on [id] matches the photo's current settings. */
  hasCurrentLookThumbnail(id: string, look: Look): boolean {
    const p = this.photo(id);
    const t = this.lookThumbs.get(thumbKey(id, look));
    return !!p && !!t && sameAdjustments(t.adjust, p.adjust) && t.lensPreset === p.lensPreset;
  }

  private async render(p: AutoPhoto, params: DevelopParams, size: number): Promise<ImageData> {
    const a = p.analysis;
    if (!a) throw new Error('not analysed');
    const lut = params.lut ? await loadLutCached(params.lut) : null;
    const film = params.film ? await FilmStocks.load(params.film) : null;
    return renderThumbnail(this.smallShader(a, params, lut, film), a.base, size);
  }

  /**
   * Uniforms for [params] on the analysis's small copies (thumbnails, the cached preview): RawBoy edits' painted masks
   * are rasterised on the 512 px base (once per edit, see brushes) and their lens blur starts from the boosted bloom
   * copy, so a thumbnail shows them as the export will, only coarser.
   */
  private smallShader(a: Analysis, params: DevelopParams, lut: LutData | null, film: FilmData | null): ShaderParams {
    let brushFor: BrushLookup = () => null;
    if (params.masks.some((l) => l.strokes.length)) {
      brushFor = this.brushes.get(params.masks) ?? brushLookup(a.base, params.masks);
      this.brushes.set(params.masks, brushFor);
    }
    return ShaderParams.from(
      params, a.defaults, lut, new LensTransform(a.lens, params), a.base, a.bloom, a.skin, 1, 1, null, brushFor, film, a.bloom.halo,
    );
  }

  // ---- Detail view ----

  /**
   * A photo clicked in the grid: opens it if it's analysed; one still waiting (or being analysed) is analysed next,
   * ahead of the rest, and opens when that's done.
   */
  openFromGrid(id: string) {
    const p = this.photo(id);
    if (!p || this._state.export) return;
    if (p.analysis) this.openDetail(id);
    else if (p.status === 'queued' || p.status === 'analyzing') this.update({ opening: id });
  }

  openDetail(id: string) {
    const p = this.photo(id);
    if (!p?.analysis || this._state.export) return;
    this.update({ selected: id });
    if (this._state.sessionReady === id) return;
    this.released = false;
    this.update({ sessionReady: null });
    if (this._state.cachedPreview?.id !== id) {
      this.update({ cachedPreview: null });
      void this.previews.get(id).then((image) => {
        if (image && this._state.selected === id && this._state.sessionReady !== id) this.update({ cachedPreview: { id, image } });
      });
    }
    // Photos passed (arrow keys, swipes) while an earlier decode ran are skipped: each decode takes seconds.
    void this.decodeLock
      .run(async () => {
        if (this._state.selected !== id) return false;
        await this.session.open(p.file, (d) => (this.photo(id) && paramsOf(this.photo(id)!)) || d);
        return true;
      })
      .then((opened) => {
        if (!opened) return;
        // Handed to the RawBoy tab while decoding: free it again (resume() decodes it once Auto is back).
        if (this.released) return this.session.close();
        if (this._state.selected !== id) return;
        const now = this.photo(id);
        const params = now && paramsOf(now);
        this.session.selectLut(params?.lut ?? null, (m) => this.update({ message: m }));
        this.session.selectFilm(params?.film ?? null, (m) => this.update({ message: m }));
        this.update({ sessionReady: id, cachedPreview: null });
      })
      .catch((e: unknown) => {
        this.update({ message: e instanceof Error ? e.message : `Could not open ${p.name}`, selected: null });
      });
  }

  closeDetail() {
    this.session.exitZoom();
    this.update({ selected: null, cachedPreview: null });
  }

  /**
   * Uniforms for showing [params] on photo [id]'s cached preview: the analysis's small copies, skin mask and lens
   * stand in for the session's (made from the same decode, so the develop matches). Null if it isn't analysed.
   */
  async cachedShaderParams(id: string, params: DevelopParams): Promise<ShaderParams | null> {
    const a = this.photo(id)?.analysis;
    if (!a) return null;
    const lut = params.lut ? await loadLutCached(params.lut).catch(() => null) : null;
    const film = params.film ? await FilmStocks.load(params.film).catch(() => null) : null;
    return this.smallShader(a, params, lut, film);
  }

  /**
   * Hands photo [id] over to the RawBoy tab: its file and current develop settings. Auto's full-resolution image is
   * freed first so the two tabs don't hold two raws in the WASM heap. The photo stays open in Auto ([resume]).
   */
  editInRawBoy(id: string): { file: File; params: DevelopParams } | null {
    const p = this.photo(id);
    const params = p && paramsOf(p);
    if (!p || !params || this._state.export) return null;
    this.session.exitZoom();
    this.session.close();
    this.released = true;
    this.update({ sessionReady: null });
    return { file: p.file, params };
  }

  /**
   * The Auto tab is on screen again: a photo left open when its image was handed to the RawBoy tab is decoded again,
   * so Auto comes back on the photo it showed.
   */
  resume() {
    const id = this._state.selected;
    if (id && this.released) this.openDetail(id);
  }

  // ---- Export ----

  /** Exports the detail view's photo from the already decoded image. */
  async exportSelected(folder: FileSystemDirectoryHandle | null) {
    const id = this._state.sessionReady;
    const p = id ? this.photo(id) : null;
    const a = p?.analysis;
    const params = p && paramsOf(p);
    if (!id || !p || !a || !params || this._state.export) return;
    this.update({ export: { done: 0, total: 1, failed: 0, current: 0 } });
    this.updatePhoto(id, (q) => ({ ...q, status: 'exporting' }));
    let ok = false;
    try {
      const blob = await this.decodeLock.run(() =>
        this.session.export(params, a.defaults, this._state.exportSettings, (f) => this.update({ export: { ...this._state.export!, current: f } })),
      );
      const name = await this.save(p, blob, folder, this._state.exportSettings);
      // On iOS the Save to Photos sheet comes up instead.
      if (folder || !savesToPhotos()) this.update({ message: `Saved ${name}` });
      ok = true;
    } catch (e) {
      this.update({ message: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    this.updatePhoto(id, (q) => ({ ...q, status: ok ? 'exported' : 'ready' }));
    this.update({ export: null });
  }

  /**
   * Exports every analysed photo in turn (only those in [ids] when given: the grid's selection), decoding each again;
   * a failure skips to the next. With a [folder] the files are written there; otherwise they're collected into one
   * ZIP download (on iOS, for Save to Photos).
   */
  async exportAll(folder: FileSystemDirectoryHandle | null, ids?: ReadonlySet<string>) {
    if (this._state.export) return;
    const todo = this._state.photos.filter((p) => p.analysis && (!ids || ids.has(p.id)));
    if (!todo.length) return;
    this.closeDetail();
    // The detail view's full-resolution image would double the memory each export needs.
    this.session.close();
    this.update({ sessionReady: null, export: { done: 0, total: todo.length, failed: 0, current: 0, waiting: new Set(todo.map((p) => p.id)) } });
    let failed = 0;
    const settings = this._state.exportSettings;
    const zipped: { name: string; blob: Blob }[] = [];
    let attempted = 0;
    let stopped = false;
    for (let index = 0; index < todo.length; index++) {
      // Read through a cast: TypeScript keeps the narrowing to null from the guard at the top across the awaits.
      if ((this._state.export as BatchExport | null)?.stopping) {
        stopped = true;
        break;
      }
      const p = this.photo(todo[index].id);
      if (!p) continue; // removed meanwhile
      this.updatePhoto(p.id, (q) => ({ ...q, status: 'exporting' }));
      attempted++;
      let ok = false;
      try {
        const blob = await this.decodeLock.run(() => this.exportOne(p, settings, (f) => this.update({ export: { ...this._state.export!, current: f } })));
        if (folder) await this.save(p, blob, folder, settings);
        else zipped.push({ name: uniqueName(zipped, p.name, EXTENSIONS[settings.format]), blob });
        ok = true;
      } catch (e) {
        failed++;
        this.updatePhoto(p.id, (q) => ({ ...q, error: e instanceof Error ? e.message : String(e) }));
      }
      this.updatePhoto(p.id, (q) => ({ ...q, status: ok ? 'exported' : 'failed' }));
      const waiting = new Set(this._state.export!.waiting);
      waiting.delete(p.id);
      this.update({ export: { ...this._state.export!, done: index + 1, failed, current: 0, waiting } });
    }
    const saved = attempted - failed;
    // Photos finished before Stop are kept: written to the folder already, or still zipped.
    if (!folder) await saveExports(zipped, 'RawBoy Auto.zip');
    const where = folder ? ` to ${folder.name}` : savesToPhotos() ? '' : ' (ZIP)';
    // On iOS the Save to Photos sheet says how many are ready; the toast is left for a stop or failures.
    const quiet = !folder && savesToPhotos() && !stopped && failed === 0;
    this.update({
      export: null,
      message: quiet ? null : `${stopped ? 'Stopped · ' : ''}${folder || !savesToPhotos() ? 'Saved' : 'Exported'} ${saved} ${saved === 1 ? 'photo' : 'photos'}${where}${failed > 0 ? ` · ${failed} failed` : ''}`,
    });
  }

  /** Stops "Export all" after the photo being exported; photos already saved stay. */
  stopExport() {
    const e = this._state.export;
    if (e && e.total > 1 && !e.stopping) this.update({ export: { ...e, stopping: true } });
  }

  private async exportOne(p: AutoPhoto, settings: ExportSettings, onProgress: (f: number) => void): Promise<Blob> {
    const a = p.analysis!;
    const params = paramsOf(p)!;
    const lut = params.lut ? await loadLutCached(params.lut) : null;
    const film = params.film ? await FilmStocks.load(params.film) : null;
    const img = await RawImage.open(p.file);
    try {
      // A photo added As is has no skin mask; RawBoy edits with skin retouch or blemish removal still need one.
      const skin = a.skin ?? (params.skinRetouch > 0 || params.blemishRemoval > 0
        ? await segmentSkin(a.base, img.width, img.height).catch(() => null) : null);
      // A preset's Blemish removal heals the full-resolution image, as the detail view does.
      if (params.blemishRemoval > 0 && skin?.hasSkin) await img.healBlemishes(blemishesToHeal(await img.detectBlemishes(skin), params.blemishRemoval));
      // RawBoy edits' painted masks and lens blur, made from the healed image as the detail view makes them.
      const textures = await editTexturesOf(img, params);
      // The stored 512/128 px copies were made from this same file, so they match.
      const shader = ShaderParams.from(
        params, a.defaults, lut, new LensTransform(img.lens, params), a.base, a.bloom, skin, 1, 1, null, textures.brushFor, film,
        textures.bokehSource,
      );
      return await exportImage(img, shader, settings, onProgress);
    } finally {
      img.close();
    }
  }

  private async save(p: AutoPhoto, blob: Blob, folder: FileSystemDirectoryHandle | null, settings: ExportSettings): Promise<string> {
    const base = baseNameOf(p.name);
    const ext = EXTENSIONS[settings.format];
    if (folder) return writeUnique(folder, (c) => fileName(base, ext, c, NAMING), blob);
    const name = fileName(base, ext, 0, NAMING);
    await saveExports([{ name, blob }], name);
    return name;
  }
}

/** Film stocks share ids with the LUT looks of the same name (portra400...), so their thumbnails get their own keys. */
const thumbKey = (id: string, look: Look) => `${id}|${look.film ? `film:${look.film}` : look.id}`;

/** "<name>-auto.jpg" (or .tif), with -001, -002 ... when two photos in one ZIP share a name. */
function uniqueName(existing: { name: string }[], source: string, ext: string): string {
  const base = baseNameOf(source);
  for (let c = 0; ; c++) {
    const name = fileName(base, ext, c, NAMING);
    if (!existing.some((e) => e.name === name)) return name;
  }
}

export { ALL_FILM_LOOKS, ALL_LOOKS };

/** File types Auto opens besides raws: already processed by the camera, so they give lower-quality results. */
const NON_RAW_EXTENSIONS = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png', 'tif', 'tiff']);

/** The note shown when an import includes non-raw photos, or null. */
export function nonRawNote(names: string[]): string | null {
  const n = names.filter((name) => NON_RAW_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '')).length;
  if (n === 0) return null;
  const which = n === 1 ? "1 photo isn't RAW" : `${n} photos aren't RAW`;
  return `${which}: JPEG, HEIC, PNG and TIFF are already processed by the camera, `
    + 'so results are lower quality than from RAW';
}
