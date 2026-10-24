import { autoBase } from '../../engine/auto/AutoAnalysis';
import { applyAuto } from '../../engine/auto/analysis/AutoTone';
import { cropOf, flipped, rotateCrop, withCrop, type CropRect } from '../../engine/develop/CropMath';
import type { EditsSidecar } from '../../engine/browse/XmpSidecar';
import { developParams, type DevelopParams } from '../../engine/develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../../engine/develop/Edits';
import { MAX_LAYERS, SHAPE_NAMES, newBrushLayer, newLinearLayer, newRadialLayer, type BrushStroke, type MaskLayer } from '../../engine/develop/Masks';
import { MAX_LEAKS, newLightLeak, type LeakKind, type LightLeak } from '../../engine/develop/LightLeaks';
import { applyPreset, captureLensPreset, capturePreset, decodePresets, encodePresets, putLensPreset, type Preset, type PresetGroup } from '../../engine/develop/Presets';
import { EXTENSIONS, ExportSettingsStore, baseNameOf, fileName, type ExportSettings } from '../../engine/export/ExportSettings';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import { PhotoSession } from '../../engine/session/PhotoSession';
import { EditHistory } from '../common/EditHistory';
import { saveBlob, saveExports, savesToPhotos } from '../common/files';
import { PresetStore } from './PresetStore';

export interface EditorState {
  loading: boolean;
  exporting: boolean;
  /** The Auto button is working out the auto develop. */
  autoRunning: boolean;
  exportProgress: number;
  fileName: string | null;
  info: string | null;
  params: DevelopParams;
  /** As-shot defaults for the current image (reset target, WB reference). */
  defaults: DevelopParams;
  message: string | null;
  frameColor: number;
  exportSettings: ExportSettings;
  presets: Preset[];
  canUndo: boolean;
  canRedo: boolean;
}

const FRAME_KEY = 'rawboy.frame';
const loadFrame = () => {
  try {
    const i = Number(localStorage.getItem(FRAME_KEY));
    return Number.isInteger(i) && i >= 0 && i < FrameColors.length ? i : 0;
  } catch {
    return 0;
  }
};

/** RawBoy (Pro) editor state and actions (port of app-pro's EditorViewModel.kt). */
export class ProStore {
  private _state: EditorState = {
    loading: false, exporting: false, autoRunning: false, exportProgress: 0, fileName: null, info: null,
    params: developParams(), defaults: developParams(), message: null, frameColor: loadFrame(),
    exportSettings: ExportSettingsStore.load(),
    presets: PresetStore.load(),
    canUndo: false,
    canRedo: false,
  };
  private readonly listeners = new Set<() => void>();
  /** The open photo; the pipeline state comes from it. */
  readonly session = new PhotoSession((m) => this.set({ message: m }));
  private frameWidth = 0;
  /** This photo's edits, for Undo and Redo. */
  private readonly history = new EditHistory<DevelopParams>();
  private openFile: File | null = null;
  /** Where this photo's edits are kept (opened from RawBoy Browser with Edits in sidecars on), else null. */
  private sidecar: EditsSidecar | null = null;
  private sidecarTimer = 0;
  private sidecarDirty = false;

  get state() {
    return this._state;
  }

  get hasImage() {
    return this._state.fileName != null && !this._state.loading;
  }

  /** The open photo's file (for "Back to Auto"), or null. */
  get file() {
    return this.hasImage ? this.openFile : null;
  }

  get busy() {
    return this._state.loading || this._state.exporting || this._state.autoRunning;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<EditorState>) {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l();
  }

  consumeMessage = () => this.set({ message: null });

  showMessage = (message: string) => this.set({ message });

  /**
   * Opens [file]; [params] (e.g. from Auto) replace the usual carry-over as the starting edits. With a [sidecar] the
   * photo starts from the edits saved there, if any, and every edit is saved to it.
   */
  async open(file: File, params?: DevelopParams, sidecar: EditsSidecar | null = null) {
    if (this.busy) return;
    this.set({ loading: true });
    try {
      await this.flushSidecar();
      let saved: string | null = null;
      try {
        saved = sidecar && !params ? await sidecar.read() : null;
      } catch {
        // unreadable: starts as usual, and the first edit rewrites it
      }
      let restored = false;
      const opened = await this.session.open(file, (d) => {
        const fromSidecar = saved != null ? decodeEdits(saved, d) : null;
        restored = fromSidecar != null;
        return params ?? fromSidecar ?? this.carryOverEdits(this._state, d);
      });
      this.history.clear();
      this.openFile = file;
      this.sidecar = sidecar;
      this.set({
        loading: false, fileName: file.name, info: opened.description, params: opened.params, defaults: opened.defaults,
        canUndo: false, canRedo: false, message: restored ? `Edits from ${sidecar!.name}` : this._state.message,
      });
      this.session.selectLut(opened.params.lut, (m) => this.lutFailed(opened.params.lut, m));
      // Film tone mapper (also from Auto's Film mode, or carried over from the previous photo).
      this.session.selectFilm(opened.params.film, (m) => this.filmFailed(opened.params.film, m));
    } catch (e) {
      this.set({ loading: false, message: e instanceof Error ? e.message : 'Could not open file' });
    }
  }

  /** Edits carry over to the next file. White balance only if the user changed it; rotation, flips, crop, masks and light leaks never. */
  private carryOverEdits(previous: EditorState, newDefaults: DevelopParams): DevelopParams {
    if (previous.fileName == null) return newDefaults;
    const p = withCrop(
      {
        ...previous.params,
        rotation: newDefaults.rotation,
        flipHorizontal: newDefaults.flipHorizontal,
        flipVertical: newDefaults.flipVertical,
        straighten: newDefaults.straighten,
        masks: newDefaults.masks,
        leaks: newDefaults.leaks,
      },
      cropOf(newDefaults),
    );
    const wbEdited = p.temperature !== previous.defaults.temperature || p.tint !== previous.defaults.tint;
    return wbEdited ? p : { ...p, temperature: newDefaults.temperature, tint: newDefaults.tint };
  }

  setViewSize(width: number, height: number, frame: number) {
    this.frameWidth = frame;
    this.session.setViewSize(width, height);
  }

  /** Single click in the preview: outside the photo (fit view) cycles the frame colour. Remembered. */
  onPreviewClick(x: number, y: number) {
    if (this.session.state.zoomCenter || !this.session.hasImage) return;
    if (this.session.fitToImage(x, y, this.frameWidth)) return;
    const next = (this._state.frameColor + 1) % FrameColors.length;
    try {
      localStorage.setItem(FRAME_KEY, String(next));
    } catch {
      // not remembered
    }
    this.set({ frameColor: next });
  }

  /** White balance picker: sets temperature and tint so the clicked spot of the preview (fit or 100% view) renders neutral grey. */
  pickWhite = async (x: number, y: number) => {
    const s = this._state;
    if (!this.hasImage || this.busy) return;
    let pick;
    try {
      pick = await this.session.pickWhite(x, y, this.frameWidth, s.defaults);
    } catch {
      return; // the photo was closed meanwhile
    }
    if (!pick || this._state.fileName !== s.fileName) return;
    if (pick.kind === 'white') this.commit({ ...this._state.params, temperature: pick.kelvin, tint: pick.tint }, true);
    else if (pick.kind === 'clipped') this.set({ message: "That spot is blown out: pick a grey that isn't clipped" });
    else this.set({ message: 'No white balance makes that spot grey' });
  };

  /** [extra]: device pixels around the frame in the fit view (the mask tool's margin). */
  toggleZoom = (x: number, y: number, extra = 0) => this.session.toggleZoom(x, y, this.frameWidth + extra);
  pan = (dx: number, dy: number) => this.session.pan(dx, dy);
  zoomBy = (x: number, y: number, factor: number, extra = 0) => this.session.zoomBy(x, y, factor, this.frameWidth + extra);

  /** A slider or drag: quick changes in a row are one undo step. */
  update = (params: DevelopParams) => this.commit(params, false);

  /** Applies [params] as an edit; [force] makes it its own undo step (a button, not a drag). */
  private commit(params: DevelopParams, force: boolean) {
    this.history.record(this._state.params, force);
    this.show(params);
  }

  /** Shows [params], loading a LUT or film stock that changed. */
  private show(params: DevelopParams) {
    const before = this._state.params;
    this.set({ params, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.session.setParams(params);
    this.saveToSidecar();
    if (params.lut !== before.lut) this.session.selectLut(params.lut, (m) => this.lutFailed(params.lut, m));
    if (params.film !== before.film) this.session.selectFilm(params.film, (m) => this.filmFailed(params.film, m));
  }

  /** Saves the edits to the sidecar once they rest for a moment (a slider drag is one write). */
  private saveToSidecar() {
    if (!this.sidecar) return;
    this.sidecarDirty = true;
    clearTimeout(this.sidecarTimer);
    this.sidecarTimer = window.setTimeout(() => void this.flushSidecar(), 800);
  }

  /** Writes edits waiting for the sidecar now. */
  async flushSidecar() {
    clearTimeout(this.sidecarTimer);
    const sidecar = this.sidecar;
    if (!sidecar || !this.sidecarDirty) return;
    this.sidecarDirty = false;
    const { params, defaults } = this._state;
    try {
      await sidecar.write(encodeEdits(params, defaults));
    } catch (e) {
      this.set({ message: `Couldn't save the edits to ${sidecar.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  undo = () => {
    if (this.busy) return;
    this.flushStroke();
    const p = this.history.undo(this._state.params);
    if (p) this.show(p);
  };

  redo = () => {
    if (this.busy) return;
    const p = this.history.redo(this._state.params);
    if (p) this.show(p);
  };

  reset = () => this.commit({ ...this._state.defaults, lut: null, film: null }, true);

  /** The stock last chosen for the Film tone mapper, so switching back to Film brings it back. */
  private lastFilm = 'portra400';

  /** Tone mapper chips: AgX, Filmic or Sigmoid turn the film off; the film's stock is kept for next time. */
  setToneMapper = (toneMapper: DevelopParams['toneMapper']) => {
    const p = this._state.params;
    if (p.film) this.lastFilm = p.film;
    this.commit({ ...p, toneMapper, film: null }, true);
  };

  /** The Film tone mapper with stock [id] (null = off); turning it on starts at full strength. */
  selectFilm = (id: string | null) => {
    const p = this._state.params;
    if (id) this.lastFilm = id;
    this.commit({ ...p, film: id, filmAmount: id && !p.film ? 100 : p.filmAmount }, true);
  };

  /** Film chip: the last stock (Portra 400 at first). */
  useFilm = () => this.selectFilm(this._state.params.film ?? this.lastFilm);

  private filmFailed(id: string | null, message: string) {
    const p = this._state.params;
    this.set({ params: p.film === id ? { ...p, film: null } : p, message });
  }

  /**
   * Auto: RawBoy Auto's develop (exposure, tone, WB, saturation, denoise, sharpening) on the current edit, without a
   * look; the LUT and everything else the user set stay. Faces steer exposure, as in Auto.
   */
  applyAuto = async () => {
    const base = this.session.state.base;
    if (!base || !this.hasImage || this.busy) return;
    this.set({ autoRunning: true });
    try {
      const skin = await this.session.skinMask();
      const noise = await this.session.measureNoise();
      const auto = autoBase(base, skin, this.session.iso, this._state.defaults, this.session.cameraMetered, noise);
      this.set({ autoRunning: false });
      this.commit(applyAuto(this._state.params, auto), true);
    } catch (e) {
      this.set({ autoRunning: false, message: `Auto failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  rotate = (quarterTurns: number) => {
    const p = this._state.params;
    // The crop turns with the picture.
    this.commit(withCrop({ ...p, rotation: (((p.rotation + quarterTurns) % 4) + 4) % 4 }, rotateCrop(cropOf(p), quarterTurns)), true);
  };

  /** Mirrors the picture as shown, left-right or top-bottom ([vertical]); the crop and straighten mirror with it. */
  flip = (vertical: boolean) => this.commit(flipped(this._state.params, vertical), true);

  setCrop = (crop: CropRect) => this.update(withCrop(this._state.params, crop));

  /** Adds a gradient layer (up to MAX_LAYERS); returns its id, or null when full. */
  addLayer = (kind: MaskLayer['shape']['kind']): string | null => {
    const p = this._state.params;
    if (p.masks.length >= MAX_LAYERS) return null;
    const name = `${SHAPE_NAMES[kind]} ${p.masks.filter((l) => l.shape.kind === kind).length + 1}`;
    const layer = kind === 'linear' ? newLinearLayer(name) : kind === 'radial' ? newRadialLayer(name) : newBrushLayer(name);
    this.commit({ ...p, masks: [...p.masks, layer] }, true);
    return layer.id;
  };

  /** A layer's slider or handle drag; [force] for a button (undo stroke, clear). */
  updateLayer = (id: string, change: (l: MaskLayer) => MaskLayer, force = false) => {
    const p = this._state.params;
    this.commit({ ...p, masks: p.masks.map((l) => (l.id === id ? change(l) : l)) }, force);
  };

  removeLayer = (id: string) => {
    const p = this._state.params;
    this.commit({ ...p, masks: p.masks.filter((l) => l.id !== id) }, true);
    this.session.dropBrush(id);
  };

  /** Adds a light leak (up to MAX_LEAKS) at image fractions [cx], [cy]; returns its id, or null when full. */
  addLeak = (kind: LeakKind = 'streak', cx = 0.5, cy = 0.5): string | null => {
    const p = this._state.params;
    if (p.leaks.length >= MAX_LEAKS) return null;
    const leak = newLightLeak(cx, cy, kind);
    this.commit({ ...p, leaks: [...p.leaks, leak] }, true);
    return leak.id;
  };

  /** A leak's slider or drag; [force] for a button (shuffle shape, show/hide). */
  updateLeak = (id: string, change: (l: LightLeak) => LightLeak, force = false) => {
    const p = this._state.params;
    this.commit({ ...p, leaks: p.leaks.map((l) => (l.id === id ? change(l) : l)) }, force);
  };

  removeLeak = (id: string) => {
    const p = this._state.params;
    this.commit({ ...p, leaks: p.leaks.filter((l) => l.id !== id) }, true);
  };

  /** Points of the stroke being painted that haven't reached the params yet (one update per frame). */
  private pendingStroke: { layerId: string; strokeId: string; points: number[] } | null = null;
  private strokeFrame = 0;

  beginStroke = (layerId: string, stroke: BrushStroke) => {
    this.flushStroke();
    this.updateLayer(layerId, (l) => ({ ...l, strokes: [...l.strokes, stroke] }), true);
  };

  extendStroke = (layerId: string, strokeId: string, points: number[]) => {
    const p = this.pendingStroke;
    if (p && (p.layerId !== layerId || p.strokeId !== strokeId)) this.flushStroke();
    if (!this.pendingStroke) this.pendingStroke = { layerId, strokeId, points: [] };
    this.pendingStroke.points.push(...points);
    if (!this.strokeFrame) this.strokeFrame = requestAnimationFrame(() => this.flushStroke());
  };

  endStroke = () => this.flushStroke();

  private flushStroke() {
    cancelAnimationFrame(this.strokeFrame);
    this.strokeFrame = 0;
    const p = this.pendingStroke;
    this.pendingStroke = null;
    if (!p || p.points.length === 0) return;
    // Part of the step beginStroke started, however slow the stroke.
    const params = this._state.params;
    this.show({
      ...params,
      masks: params.masks.map((l) =>
        l.id !== p.layerId ? l : { ...l, strokes: l.strokes.map((s) => (s.id === p.strokeId ? { ...s, points: [...s.points, ...p.points] } : s)) },
      ),
    });
  }

  undoStroke = (layerId: string) => {
    this.flushStroke();
    this.updateLayer(layerId, (l) => ({ ...l, strokes: l.strokes.slice(0, -1) }), true);
  };

  clearBrush = (layerId: string) => this.updateLayer(layerId, (l) => ({ ...l, strokes: [] }), true);

  private setPresets(presets: Preset[]) {
    this.set({ presets });
    if (!PresetStore.save(presets)) this.set({ message: 'Could not save presets in this browser' });
  }

  /** Saves the current edits of groups as a new preset. */
  savePreset = (name: string, groups: PresetGroup[]) =>
    this.setPresets([...this._state.presets, capturePreset(name, this._state.params, groups, this.session.state.lensInfo.lensName)]);

  /**
   * Saves the Lens tab's settings as the lens preset called name for this photo's lens (replacing the one saved for it
   * before; with no lens name, as manual lenses record, the one of that name); the Auto tab applies it to every photo
   * taken with that lens, or to the photos given it by name.
   */
  saveLensPreset = (name = '') => {
    const lensPreset = captureLensPreset(this._state.params, this.session.state.lensInfo.lensName, name);
    this.putLensPresets([lensPreset]);
    this.set({ message: `Saved lens preset ${lensPreset.name}` });
  };

  /** Keeps lens presets in place of those for the same lenses (Auto's lens preset files come here too). */
  putLensPresets = (lensPresets: readonly Preset[]) => this.setPresets(lensPresets.reduce(putLensPreset, this._state.presets));

  /** Overwrites a preset's values with the current edits (same groups). */
  updatePreset = (id: string) =>
    this.setPresets(this._state.presets.map((p) => (p.id === id ? { ...capturePreset(p.name, this._state.params, p.groups, p.lens ?? this.session.state.lensInfo.lensName), id } : p)));

  renamePreset = (id: string, name: string) =>
    this.setPresets(this._state.presets.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));

  deletePreset = (id: string) => this.setPresets(this._state.presets.filter((p) => p.id !== id));

  /** Applies the preset's groups to the current photo; a LUT goes through selectLut (load, error message). */
  applyPreset = (preset: Preset) => {
    this.commit(applyPreset(preset, this._state.params), true);
    this.set({ message: `Applied ${preset.name}` });
  };

  async importPresets(file: File) {
    try {
      const added = decodePresets(await file.text());
      this.setPresets([...this._state.presets, ...added]);
      this.set({ message: added.length === 1 ? `Imported ${added[0].name}` : `Imported ${added.length} presets` });
    } catch {
      this.set({ message: 'Not a RawBoy preset file' });
    }
  }

  /** Downloads presets (one, or all) as a preset file. */
  exportPresets = (presets: Preset[]) => {
    const name = presets.length === 1 ? `${presets[0].name}.rawboy.json` : 'RawBoy presets.rawboy.json';
    saveBlob(name, new Blob([encodePresets(presets)], { type: 'application/json' }));
  };

  /** null = "No LUT". */
  selectLut = (id: string | null) => this.commit({ ...this._state.params, lut: id }, true);

  private lutFailed(id: string | null, message: string) {
    const p = this._state.params;
    this.set({ params: p.lut === id ? { ...p, lut: null } : p, message });
  }

  async export(settings: ExportSettings) {
    if (!this.session.hasImage || this.busy) return;
    const current = this._state;
    ExportSettingsStore.save(settings);
    this.set({ exporting: true, exportProgress: 0, exportSettings: settings });
    try {
      const blob = await this.session.export(current.params, current.defaults, settings, (f) => this.set({ exportProgress: f }));
      const name = fileName(baseNameOf(current.fileName ?? 'image'), EXTENSIONS[settings.format], 0, { suffix: 'rawboy' });
      await saveExports([{ name, blob }], name);
      // On iOS the Save to Photos sheet comes up instead.
      this.set({ exporting: false, message: savesToPhotos() ? null : `Saved ${name}` });
    } catch (e) {
      this.set({ exporting: false, message: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
}
