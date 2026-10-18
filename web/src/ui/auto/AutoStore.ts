import { analyzeFile, type Analysis } from '../../engine/auto/AutoAnalysis';
import { ALL_LOOKS, Looks, type Look } from '../../engine/auto/looks/Look';
import { DEFAULT_STRENGTH, NO_ADJUSTMENTS, developAuto, sameAdjustments, type Adjustments } from '../../engine/auto/looks/LookApplier';
import { ALL_FILM_LOOKS, FilmLooks } from '../../engine/auto/looks/FilmLooks';
import { suggestFilm, suggestLook } from '../../engine/auto/looks/LookSuggester';
import type { DevelopParams } from '../../engine/develop/DevelopParams';
import { decodePresets, isLensPreset, lensPresetFor, putLensPreset, type Preset } from '../../engine/develop/Presets';
import { PresetStore } from '../pro/PresetStore';
import { exportImage } from '../../engine/export/Exporter';
import { baseNameOf, EXTENSIONS, ExportSettingsStore, fileName, type ExportSettings, type OutputNaming } from '../../engine/export/ExportSettings';
import { FilmStocks } from '../../engine/film/FilmStocks';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import { ShaderParams } from '../../engine/gl/ShaderParams';
import { renderThumbnail } from '../../engine/gl/ThumbnailRenderer';
import { LensTransform } from '../../engine/lens/LensTransform';
import { loadLutCached } from '../../engine/lut/LutRepository';
import { RawImage } from '../../engine/raw/RawImage';
import type { PreviewImage } from '../../engine/gl/PreviewImage';
import { blemishesToHeal, PhotoSession } from '../../engine/session/PhotoSession';
import { EditHistory } from '../common/EditHistory';
import { imageUrl, saveBlob, writeUnique, zipFiles } from '../common/files';
import { PreviewCache } from './PreviewCache';

/** Where a photo is in the batch. */
export type PhotoStatus = 'queued' | 'analyzing' | 'ready' | 'failed' | 'exporting' | 'exported';

/** Which strip the Look tab shows: the LUT looks or film stocks rendered as negative + print (ALL_FILM_LOOKS). */
export type LookMode = 'looks' | 'film';

/**
 * One photo of the batch (port of AutoPhoto). Only small whole-image copies are kept; the full-resolution raw is
 * decoded again for the detail view and for export.
 */
export interface AutoPhoto {
  id: string;
  file: File;
  name: string;
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
  /** The lens preset for the photo's lens (see lensPresetFor), on top of the look or preset; null = none. */
  lensPreset: Preset | null;
  /** True once "Apply to all" gave the photo its looks: its analysis then keeps them instead of the suggestions. */
  looksApplied: boolean;
  /** Object URL of the grid thumbnail. */
  thumbnail: string | null;
}

/** A photo's edits, as Undo and Redo bring them back. */
type Develop = Pick<AutoPhoto, 'look' | 'mode' | 'filmLook' | 'strength' | 'adjust' | 'preset' | 'looksApplied'>;

const developOf = ({ look, mode, filmLook, strength, adjust, preset, looksApplied }: AutoPhoto): Develop =>
  ({ look, mode, filmLook, strength, adjust, preset, looksApplied });

/**
 * [p] with the look (or preset), strength, warmth, tint, contrast, saturation and grain of [source] ("Apply to all", "Copy previous");
 * brightness, denoise and rotation stay (they follow this photo's exposure, noise and framing).
 */
function withLookOf(p: AutoPhoto, source: AutoPhoto): AutoPhoto {
  const { warmth, tint, contrast, saturation, grain } = source.adjust;
  return {
    ...p, look: source.look, mode: source.mode, filmLook: source.filmLook, strength: source.strength, preset: source.preset,
    looksApplied: true,
    adjust: { ...p.adjust, warmth, tint, contrast, saturation, grain },
  };
}

export const activeLook = (p: AutoPhoto): Look => (p.mode === 'film' ? p.filmLook : p.look);

/** What develops the photo, for labels: the preset's name, else the active look's. */
export const lookName = (p: AutoPhoto): string => p.preset?.name ?? activeLook(p).name;

/** The develop settings for the current look (or preset) and controls (null until analysed). */
export function paramsOf(p: AutoPhoto): DevelopParams | null {
  const a = p.analysis;
  if (!a) return null;
  return developAuto(a.autoBase, activeLook(p), p.strength, p.adjust, a.stats.hasFace, p.preset, p.lensPreset);
}

/** Progress of "Export all". */
export interface BatchExport {
  done: number;
  total: number;
  failed: number;
  current: number;
}

export const NAMING: OutputNaming = { suffix: 'auto' };
export const SETTINGS: ExportSettings = { format: 'jpeg', jpegQuality: 92, tiffBits: 16, maxLongSide: null };
/** Export sizes offered (long side in pixels; null = full resolution). */
export const EXPORT_SIZES: (number | null)[] = [null, 4096, 2048, 1080];
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
  importMode: LookMode;
  /** Format, JPEG quality, TIFF bit depth and size of exports, chosen in the grid (remembered in this browser). */
  exportSettings: ExportSettings;
  /** The RawBoy preset applied to the whole batch, which photos added later get too; null = looks. */
  preset: Preset | null;
  /**
   * Lens presets from the RawBoy tab (isLensPreset): each photo taken with a preset's lens gets its lens corrections on
   * top of its look or preset.
   */
  lensPresets: Preset[];
  /** Frame colour around the photo in the detail view (index into FrameColors, remembered in this browser). */
  frameColor: number;
}

const IMPORT_MODE_KEY = 'rawboy.auto.importMode';
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

function savedImportMode(): LookMode {
  try {
    return localStorage.getItem(IMPORT_MODE_KEY) === 'film' ? 'film' : 'looks';
  } catch {
    return 'looks';
  }
}

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
  private _state: AutoState = { photos: [], export: null, message: null, selected: null, sessionReady: null, cachedPreview: null, importMode: savedImportMode(),
    exportSettings: savedExportSettings(), preset: null, lensPresets: PresetStore.load().filter(isLensPreset), frameColor: savedFrame() };
  /**
   * Keeps lens presets opened from a file with the RawBoy tab's presets (set by the page; null: in this browser's
   * preset store directly); the RawBoy tab then hands the new list back through setLensPresets.
   */
  saveLensPresets: ((presets: Preset[]) => void) | null = null;
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
  /** Each photo's edits, for Undo and Redo in the photo view. */
  private readonly histories = new Map<string, EditHistory<Develop>>();
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

  /** Adds photos; files already listed (same name, size and date) are skipped. Returns how many were added. */
  add(files: File[]): number {
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const known = new Set(this._state.photos.map((p) => key(p.file)));
    const fresh: AutoPhoto[] = [];
    for (const file of files) {
      if (known.has(key(file))) continue;
      known.add(key(file));
      fresh.push({
        id: String(this.nextId++), file, name: file.name, status: 'queued', error: null, analysis: null,
        look: Looks.NATURAL, suggested: Looks.NATURAL, mode: this._state.importMode, filmLook: FilmLooks.PORTRA_400,
        suggestedFilm: FilmLooks.PORTRA_400, strength: DEFAULT_STRENGTH, adjust: NO_ADJUSTMENTS, preset: this._state.preset, lensPreset: null,
        looksApplied: false,
        thumbnail: null,
      });
    }
    if (!fresh.length) return 0;
    const note = nonRawNote(fresh.map((p) => p.name));
    this.update({ photos: [...this._state.photos, ...fresh], ...(note ? { message: note } : {}) });
    void this.processQueue();
    return fresh.length;
  }

  setViewSize(width: number, height: number, frame: number) {
    this.frameWidth = frame;
    this.session.setViewSize(width, height);
  }

  toggleZoom = (x: number, y: number) => this.session.toggleZoom(x, y, this.frameWidth);

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
  setImportMode(importMode: LookMode) {
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
   */
  applyPresetToAll(preset: Preset) {
    if (isLensPreset(preset)) return this.addLensPresets([preset]);
    if (this._state.export) return;
    this.update({ preset });
    for (const p of this._state.photos) this.changeDevelop(p.id, (q) => ({ ...q, preset }), true);
    this.update({ message: `${preset.name} applied to all photos` });
  }

  /**
   * Develops only the photos in [ids] (the grid's selection, e.g. one scene) with [preset], so one batch can hold a
   * preset per scene. The batch preset, which photos added later get, stays as it is.
   */
  applyPresetTo(preset: Preset, ids: ReadonlySet<string>) {
    if (isLensPreset(preset)) return this.addLensPresets([preset]);
    if (this._state.export) return;
    const photos = this._state.photos.filter((p) => ids.has(p.id));
    for (const p of photos) this.changeDevelop(p.id, (q) => ({ ...q, preset }), true);
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
    const save = this.saveLensPresets;
    if (save) save([...presets]);
    else {
      const all = presets.reduce(putLensPreset, PresetStore.load());
      if (!PresetStore.save(all)) this.update({ message: 'Could not save presets in this browser' });
      this.setLensPresets(all.filter(isLensPreset));
    }
    const lenses = new Set(presets.map((p) => p.lens?.trim().toLowerCase()));
    const matched = this._state.photos.filter((p) => p.lensPreset && lenses.has(p.lensPreset.lens?.trim().toLowerCase())).length;
    const name = presets.length === 1 ? `Lens preset ${presets[0].name}` : `${presets.length} lens presets`;
    this.update({
      message: `${name} saved for photos taken with ${presets.length === 1 ? 'that lens' : 'those lenses'} (${matched === 1 ? '1 photo' : `${matched} photos`} here)`,
    });
  }

  /** The lens presets (from the RawBoy tab's presets); each analysed photo takes the one for its lens, if any. */
  setLensPresets(lensPresets: Preset[]) {
    this.update({ lensPresets });
    for (const p of this._state.photos) {
      if (!p.analysis) continue;
      const next = lensPresetFor(lensPresets, p.analysis.lens.lensName);
      if (next !== p.lensPreset) this.changeDevelop(p.id, (q) => ({ ...q, lensPreset: next }), null);
    }
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
      this.histories.delete(p.id);
      void this.previews.remove(p.id);
    }
    if (this._state.cachedPreview && ids.has(this._state.cachedPreview.id)) this.update({ cachedPreview: null });
    for (const [k, t] of this.lookThumbs) {
      if (ids.has(k.split('|')[0])) {
        URL.revokeObjectURL(t.url);
        this.lookThumbs.delete(k);
      }
    }
    this.update({ photos: this._state.photos.filter((p) => !ids.has(p.id)) });
  }

  /** Analyses queued photos one at a time (each decode needs the full raw in memory). */
  private async processQueue() {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      for (;;) {
        const next = this._state.photos.find((p) => p.status === 'queued');
        if (!next) break;
        this.updatePhoto(next.id, (p) => ({ ...p, status: 'analyzing' }));
        try {
          const analysis = await this.decodeLock.run(() => analyzeFile(next.file, next.name, (preview) => void this.previews.put(next.id, preview)));
          if (!this.photo(next.id)) void this.previews.remove(next.id); // removed while it was analysed
          const look = suggestLook(analysis.stats, analysis.defaults.temperature);
          const filmLook = suggestFilm(analysis.stats, analysis.defaults.temperature);
          this.updatePhoto(next.id, (p) => ({
            ...p, status: 'ready', analysis, suggested: look, suggestedFilm: filmLook,
            lensPreset: lensPresetFor(this._state.lensPresets, analysis.lens.lensName),
            look: p.looksApplied ? p.look : look, filmLook: p.looksApplied ? p.filmLook : filmLook,
          }));
          this.refreshThumbnail(next.id, true);
        } catch (e) {
          // Mark this photo and go on with the rest.
          this.updatePhoto(next.id, (p) => ({ ...p, status: 'failed', error: e instanceof Error ? e.message : String(e) }));
        }
      }
    } finally {
      this.analyzing = false;
    }
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
   * warmth, tint, contrast, saturation and grain, as one undo step; brightness, denoise and rotation stay. Not while exporting.
   */
  copyPrevious(id: string) {
    if (this._state.export) return;
    const source = this.previousPhoto(id);
    if (!source) return;
    this.changeDevelop(id, (q) => withLookOf(q, source), true);
    this.update({ message: `Copied from ${source.name}` });
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
    const shader = ShaderParams.from(
      params, a.defaults, lut, new LensTransform(a.lens, params), a.base, a.bloom, a.skin, 1, 1, null, () => null, film,
    );
    return renderThumbnail(shader, a.base, size);
  }

  // ---- Detail view ----

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
    return ShaderParams.from(params, a.defaults, lut, new LensTransform(a.lens, params), a.base, a.bloom, a.skin, 1, 1, null, () => null, film);
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
      this.update({ message: `Saved ${name}` });
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
   * ZIP download.
   */
  async exportAll(folder: FileSystemDirectoryHandle | null, ids?: ReadonlySet<string>) {
    if (this._state.export) return;
    const todo = this._state.photos.filter((p) => p.analysis && (!ids || ids.has(p.id)));
    if (!todo.length) return;
    this.closeDetail();
    // The detail view's full-resolution image would double the memory each export needs.
    this.session.close();
    this.update({ sessionReady: null, export: { done: 0, total: todo.length, failed: 0, current: 0 } });
    let failed = 0;
    const settings = this._state.exportSettings;
    const zipped: { name: string; blob: Blob }[] = [];
    for (let index = 0; index < todo.length; index++) {
      const p = this.photo(todo[index].id);
      if (!p) continue; // removed meanwhile
      this.updatePhoto(p.id, (q) => ({ ...q, status: 'exporting' }));
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
      this.update({ export: { done: index + 1, total: todo.length, failed, current: 0 } });
    }
    const saved = todo.length - failed;
    if (!folder && zipped.length) saveBlob('RawBoy Auto.zip', await zipFiles(zipped));
    this.update({
      export: null,
      message: `Saved ${saved} ${saved === 1 ? 'photo' : 'photos'}${folder ? ` to ${folder.name}` : ' (ZIP)'}${failed > 0 ? ` · ${failed} failed` : ''}`,
    });
  }

  private async exportOne(p: AutoPhoto, settings: ExportSettings, onProgress: (f: number) => void): Promise<Blob> {
    const a = p.analysis!;
    const params = paramsOf(p)!;
    const lut = params.lut ? await loadLutCached(params.lut) : null;
    const film = params.film ? await FilmStocks.load(params.film) : null;
    const img = await RawImage.open(p.file);
    try {
      // A preset's Blemish removal heals the full-resolution image, as the detail view does.
      if (params.blemishRemoval > 0 && a.skin?.hasSkin) await img.healBlemishes(blemishesToHeal(await img.detectBlemishes(a.skin), params.blemishRemoval));
      // The stored 512/128 px copies were made from this same file, so they match.
      const shader = ShaderParams.from(
        params, a.defaults, lut, new LensTransform(img.lens, params), a.base, a.bloom, a.skin, 1, 1, null, () => null, film,
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
    saveBlob(name, blob);
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
