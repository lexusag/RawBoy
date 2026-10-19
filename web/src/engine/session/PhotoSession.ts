import { NO_NOISE, cameraMetered, type NoiseLevel } from '../auto/analysis/AutoTone';
import { WhiteBalance } from '../color/WhiteBalance';
import { WhitePicker, type WhitePick } from '../color/WhitePicker';
import { BrushRaster, makeGuide, type BrushGuide } from '../develop/BrushRaster';
import { developParams, effectiveColorDenoise, type DevelopParams } from '../develop/DevelopParams';
import type { MaskLayer } from '../develop/Masks';
import { exportImage } from '../export/Exporter';
import type { ExportSettings } from '../export/ExportSettings';
import { FilmStocks, type FilmData } from '../film/FilmStocks';
import { scatterBloomTail } from '../gl/BloomTail';
import type { BloomSources, PreviewImage } from '../gl/PreviewImage';
import { ShaderParams, WIDE_DENOISE_MARGIN, wideDenoise } from '../gl/ShaderParams';
import { ZoomMath, contains, rect, type DetailTile } from '../gl/Zoom';
import { LensInfo } from '../lens/LensInfo';
import { LensTransform } from '../lens/LensTransform';
import type { LutData } from '../lut/LutData';
import { loadLutCached } from '../lut/LutRepository';
import { RawImage } from '../raw/RawImage';
import { shotInfoLine } from '../raw/ShotInfo';
import { segmentSkin } from '../retouch/SkinSegmenter';
import type { SkinMask } from '../retouch/SkinMask';
import { halfToFloat } from '../util/half';

/** On-screen preview size; WebGL2 guarantees 2048 px textures. */
export const PREVIEW_MAX_DIMENSION = 2048;
export const BASE_MAX_DIMENSION = 512;
export const BLOOM_TAIL_MAX_DIMENSION = 64;

export type SkinState = { kind: 'notComputed' } | { kind: 'computing' } | { kind: 'ready'; mask: SkinMask } | { kind: 'failed' };

export interface BlemishState {
  working: boolean;
  /** Spots currently healed in the image. */
  healed: number;
  /** Candidates found on this photo. */
  detected: number;
}

export interface SessionState {
  preview: PreviewImage | null;
  /** ~512 px copy of the whole image: the wide blur behind high-pass contrast. */
  base: PreviewImage | null;
  /** Highlight-boosted small copies that bloom scatters light from. */
  bloomSources: BloomSources | null;
  skin: SkinState;
  blemish: BlemishState;
  /** Centre of the 100% view in full-resolution pixels; null = fit to view. */
  zoomCenter: [number, number] | null;
  /** Full-resolution region around the zoom centre, uploaded for the 100% view. */
  detail: DetailTile | null;
  lensInfo: LensInfo;
  /** The loaded LUT for the selected id (null while loading or when none is selected). */
  lutData: LutData | null;
  /** The loaded film stock for the selected id (null while loading or when none is selected). */
  filmData: FilmData | null;
}

/** What [open] found in the file. */
export interface Opened {
  description: string;
  defaults: DevelopParams;
  params: DevelopParams;
}

/** The file's own white balance as slider defaults; everything else untouched. */
export function asShotDefaults(image: RawImage): DevelopParams {
  const [kelvin, tint] = WhiteBalance.tempTintFromXY(image.asShotWhite[0], image.asShotWhite[1]);
  return developParams({ temperature: kelvin, tint, displaySource: image.displayReferred });
}

/** The highlight-boosted halo (512 px) and tail (64 px, already scattered) copies bloom scatters light from. */
export async function bloomSourcesOf(image: RawImage): Promise<BloomSources> {
  return {
    halo: await image.createPreview(BASE_MAX_DIMENSION, true),
    tail: scatterBloomTail(await image.createPreview(BLOOM_TAIL_MAX_DIMENSION, true)),
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One open photo and everything the develop pipeline needs for it (port of session/PhotoSession.kt): the decoded
 * raw, its preview and whole-image textures, skin mask, blemish healing, the 100% view's tiles, LUTs and export.
 * Holds no UI state; apps keep their own and pass the current [DevelopParams] in through [setParams].
 * Observers subscribe to [state] changes.
 */
export class PhotoSession {
  private _state: SessionState = {
    preview: null,
    base: null,
    bloomSources: null,
    skin: { kind: 'notComputed' },
    blemish: { working: false, healed: 0, detected: 0 },
    zoomCenter: null,
    detail: null,
    lensInfo: LensInfo.none(),
    lutData: null,
    filmData: null,
  };
  private readonly listeners = new Set<() => void>();
  private image: RawImage | null = null;
  private params: DevelopParams = developParams();
  /** The skin segmentation in progress or done, so the Auto button can wait for it. */
  private skinJob: Promise<void> | null = null;
  private viewWidth = 0;
  private viewHeight = 0;
  private tileLoading = false;
  private selectedLut: string | null = null;
  private selectedFilm: string | null = null;
  /** (x, y, radius, score) per candidate, most obvious first; detected once per photo. */
  private blemishSpots: Float32Array | null = null;
  /** Painted masks by layer id (see brushRaster). */
  private readonly brushes = new Map<string, BrushRaster>();
  private guide: BrushGuide | null = null;
  private guideSource: PreviewImage | null = null;
  /** Bumped to cancel a pending blemish run. */
  private blemishRun = 0;
  private lensCache: { key: unknown[]; crop: number[]; lens: LensTransform } | null = null;

  /** [onMessage]: soft failures to show the user (e.g. skin detection failing). */
  constructor(private readonly onMessage: (message: string) => void) {}

  get state(): SessionState {
    return this._state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<SessionState>) {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l();
  }

  get hasImage() {
    return this.image != null;
  }

  /** ISO of the open photo, 0 if unknown or nothing is open. */
  get iso() {
    return this.image?.iso ?? 0;
  }

  /** The open photo's measured noise (see RawImage.measureNoise). */
  async measureNoise(): Promise<NoiseLevel> {
    return this.image ? this.image.measureNoise() : NO_NOISE;
  }

  /** Whether the open photo carries the camera's own exposure (see AutoTone's cameraMetered). */
  get cameraMetered() {
    const img = this.image;
    return img != null && cameraMetered(img.metadata.make, img.baselineExposure);
  }

  /** The skin mask, computed now if it hasn't been (for face metering); null if there is none or it failed. */
  async skinMask(): Promise<SkinMask | null> {
    this.ensureSkinMask(true);
    await this.skinJob;
    const s = this._state.skin;
    return s.kind === 'ready' ? s.mask : null;
  }

  get rawImage(): RawImage | null {
    return this.image;
  }

  /**
   * Decodes [file] and swaps it in. [initialParams] maps the file's as-shot defaults to the params to start with
   * (e.g. carrying edits over from the previous photo). Throws on failure; the previous photo stays open then.
   */
  async open(file: Blob, initialParams: (defaults: DevelopParams) => DevelopParams): Promise<Opened> {
    const img = await RawImage.open(file);
    let loaded;
    try {
      loaded = {
        preview: await img.createPreview(PREVIEW_MAX_DIMENSION),
        base: await img.createPreview(BASE_MAX_DIMENSION),
        bloom: await bloomSourcesOf(img),
      };
    } catch (e) {
      img.close();
      throw e;
    }
    this.exitZoom();
    this.image?.close();
    this.image = img;
    this.blemishRun++;
    this.blemishSpots = null;
    this.brushes.clear();
    this.guide = null;
    const defaults = asShotDefaults(img);
    this.update({
      lensInfo: img.lens,
      preview: loaded.preview,
      base: loaded.base,
      bloomSources: loaded.bloom,
      skin: { kind: 'notComputed' },
      blemish: { working: false, healed: 0, detected: 0 },
    });
    this.params = initialParams(defaults);
    this.ensureSkinMask();
    // Camera and exposure (ISO, shutter, aperture, focal length); the decoder's summary if none of it is known.
    return { description: shotInfoLine(img.camera, img.metadata) || img.description, defaults, params: this.params };
  }

  /** Applies new slider values: starts skin detection / blemish healing and keeps the zoom tile valid. */
  setParams(newParams: DevelopParams) {
    const before = this.params;
    this.params = newParams;
    if (newParams.skinRetouch > 0 || newParams.blemishRemoval > 0) this.ensureSkinMask();
    if (newParams.blemishRemoval !== before.blemishRemoval) this.scheduleBlemishes();
    // A 90 degree turn or a new crop changes the output shape, and a flip moves the content, so the zoom position
    // no longer applies.
    const cropChanged =
      newParams.cropLeft !== before.cropLeft || newParams.cropTop !== before.cropTop ||
      newParams.cropRight !== before.cropRight || newParams.cropBottom !== before.cropBottom;
    const flipChanged = newParams.flipHorizontal !== before.flipHorizontal || newParams.flipVertical !== before.flipVertical;
    if (newParams.rotation !== before.rotation || cropChanged || flipChanged) this.exitZoom();
    else this.recheckZoomTile();
  }

  /**
   * The painted mask of [layer] brought up to its strokes (incrementally while a stroke grows), or null without
   * strokes. Rasters are the preview's size and live as long as the photo.
   */
  brushRaster(layer: MaskLayer): BrushRaster | null {
    const preview = this._state.preview;
    if (layer.strokes.length === 0 || !preview) {
      this.brushes.delete(layer.id);
      return null;
    }
    let r = this.brushes.get(layer.id);
    if (!r || r.width !== preview.width || r.height !== preview.height) {
      r = new BrushRaster(preview.width, preview.height, () => this.brushGuide(preview));
      this.brushes.set(layer.id, r);
    }
    r.sync(layer.strokes);
    return r;
  }

  /** Forgets a deleted layer's painted mask. */
  dropBrush(layerId: string) {
    this.brushes.delete(layerId);
  }

  /** Auto mask guide, made from the preview the first time an Auto mask stroke needs it. */
  private brushGuide(preview: PreviewImage): BrushGuide {
    if (!this.guide || this.guideSource !== preview) {
      this.guide = makeGuide(preview);
      this.guideSource = preview;
    }
    return this.guide;
  }

  /** Uniforms for [p] with this photo's current textures. */
  shaderParams(
    p: DevelopParams,
    defaults: DevelopParams,
    lut: LutData | null = this._state.lutData,
    maskView: string | null = null,
    film: FilmData | null = this._state.filmData,
  ): ShaderParams {
    const s = this._state;
    return ShaderParams.from(
      p, defaults, lut, this.lensFor(p), s.base, s.bloomSources, s.skin.kind === 'ready' ? s.skin.mask : null, 1, 1, maskView,
      (l) => this.brushRaster(l), film,
    );
  }

  setViewSize(width: number, height: number) {
    this.viewWidth = width;
    this.viewHeight = height;
    const c = this._state.zoomCenter;
    if (c) this.setZoomCenter(c[0], c[1]);
  }

  /** Fit-view position -> full-resolution output pixel, or null outside the photo. */
  fitToImage(viewX: number, viewY: number, frameWidth: number): [number, number] | null {
    if (!this.image || this.viewWidth <= 0 || this.viewHeight <= 0) return null;
    const lens = this.lensFor(this.params);
    return ZoomMath.fitToImage(viewX, viewY, this.viewWidth, this.viewHeight, lens.outputWidth, lens.outputHeight, frameWidth);
  }

  /**
   * White balance picker at a point of the preview (fit or 100% view; [frameWidth] as for [fitToImage]): the decoded
   * pixels shown there, found through crop, rotation and lens correction, averaged before any develop step.
   * Null when the point is outside the photo or nothing is open.
   */
  async pickWhite(viewX: number, viewY: number, frameWidth: number, defaults: DevelopParams): Promise<WhitePick | null> {
    const img = this.image;
    if (!img || this.viewWidth <= 0 || this.viewHeight <= 0) return null;
    const lens = this.lensFor(this.params);
    const w = lens.outputWidth;
    const h = lens.outputHeight;
    const zoom = this._state.zoomCenter;
    const r = zoom
      ? ZoomMath.zoomedRect(zoom[0], zoom[1], this.viewWidth, this.viewHeight, w, h)
      : ZoomMath.fitRect(this.viewWidth, this.viewHeight, w, h, frameWidth);
    const outX = ((viewX - r[0]) / r[2]) * w;
    const outY = ((viewY - r[1]) / r[3]) * h;
    if (!(outX >= 0 && outX <= w && outY >= 0 && outY <= h)) return null;
    const src = lens.source(outX, outY);
    const [x0, x1, y0, y1] = WhitePicker.box(src[0], src[1], img.width, img.height);
    const halves = await img.copyTile(rect(x0, y0, x1 - x0, y1 - y0));
    const rgb = Float32Array.from(halves, halfToFloat);
    return WhitePicker.pick(rgb, defaults.temperature, defaults.tint);
  }

  /** Double click: zoom to 100% at the clicked point of the fit view, or back out. */
  toggleZoom(viewX: number, viewY: number, frameWidth: number) {
    if (!this.image) return;
    if (this._state.zoomCenter) {
      this.exitZoom();
      return;
    }
    const p = this.fitToImage(viewX, viewY, frameWidth);
    if (p) this.setZoomCenter(p[0], p[1]);
  }

  /** Drag in the 100% view; [dx], [dy] are device pixels = full-resolution pixels. */
  pan(dx: number, dy: number) {
    const c = this._state.zoomCenter;
    if (c) this.setZoomCenter(c[0] - dx, c[1] - dy);
  }

  exitZoom() {
    this.tileLoading = false;
    if (this._state.zoomCenter || this._state.detail) this.update({ zoomCenter: null, detail: null });
  }

  private setZoomCenter(cx: number, cy: number) {
    const img = this.image;
    if (!img) return;
    const lens = this.lensFor(this.params);
    const c = ZoomMath.clampCenter(cx, cy, this.viewWidth, this.viewHeight, lens.outputWidth, lens.outputHeight);
    this.update({ zoomCenter: c });
    this.ensureDetail(img, c);
  }

  /** Loads a new tile only when the visible region leaves the current one. */
  private ensureDetail(img: RawImage, c: [number, number]) {
    if (this.tileLoading) return;
    const lens = this.lensFor(this.params);
    const view = ZoomMath.viewRect(c[0], c[1], this.viewWidth, this.viewHeight, lens.outputWidth, lens.outputHeight);
    // Source pixels the view needs, through rotation and lens geometry, plus the denoise halo.
    const needed = lens.sourceBounds(view, this.spatialMargin(this.params));
    const current = this._state.detail;
    if (current && contains(current.rect, needed)) return;

    const r = ZoomMath.tileAround(needed, img.width, img.height);
    this.tileLoading = true;
    img.createTile(r).then(
      (tile) => {
        if (!this.tileLoading) return; // zoom left meanwhile
        this.tileLoading = false;
        if (this.image !== img || !this._state.zoomCenter) return;
        this.update({ detail: tile });
        // The user may have panned past this tile while it loaded.
        const now = this._state.zoomCenter;
        if (now) this.ensureDetail(img, now);
      },
      () => {
        this.tileLoading = false; // image closed or replaced meanwhile
      },
    );
  }

  /** Lens geometry changes can move the view's source outside the loaded tile. */
  private recheckZoomTile() {
    const img = this.image;
    const c = this._state.zoomCenter;
    if (img && c) this.ensureDetail(img, c);
  }

  /** Runs skin segmentation once per photo, when Skin retouch or Blemish removal is first non-zero (or when [force]d). */
  private ensureSkinMask(force = false) {
    const p = this.params;
    if ((!force && p.skinRetouch <= 0 && p.blemishRemoval <= 0) || this._state.skin.kind !== 'notComputed') return;
    const img = this.image;
    const base = this._state.base;
    if (!img || !base) return;
    this.update({ skin: { kind: 'computing' } });
    this.skinJob = segmentSkin(base, img.width, img.height).then(
      (mask) => {
        if (this.image !== img) return;
        this.update({ skin: { kind: 'ready', mask } });
        this.recheckZoomTile(); // the skin smoothing radius widens the tiles the view needs
        this.scheduleBlemishes();
      },
      (e: unknown) => {
        if (this.image !== img) return;
        // Fail softly, never break the editor.
        this.onMessage(`Skin detection failed: ${e instanceof Error ? e.message : String(e)}`);
        this.update({ skin: { kind: 'failed' } });
      },
    );
  }

  /**
   * Heals the blemishes the slider asks for, ~300 ms after it settles: spots are detected once per photo, then the
   * most obvious ones (by score) are healed in the full-resolution image and the previews rebuilt from it.
   */
  private scheduleBlemishes() {
    const run = ++this.blemishRun;
    void (async () => {
      await delay(300);
      const img = this.image;
      if (run !== this.blemishRun || !img) return;
      const level = this.params.blemishRemoval;
      let wanted: Float32Array;
      if (level <= 0) {
        wanted = new Float32Array(0);
      } else {
        const skin = this._state.skin;
        if (skin.kind !== 'ready' || !skin.mask.hasSkin) return; // runs again when the mask is ready
        if (!this.blemishSpots) {
          this.update({ blemish: { ...this._state.blemish, working: true } });
          const spots = await img.detectBlemishes(skin.mask);
          if (this.image !== img) return;
          this.blemishSpots = spots;
          if (run !== this.blemishRun) return;
        }
        wanted = blemishesToHeal(this.blemishSpots, level);
      }
      const count = wanted.length / 4;
      if (count === this._state.blemish.healed) {
        this.update({ blemish: { ...this._state.blemish, working: false } });
        return;
      }
      this.update({ blemish: { ...this._state.blemish, working: true } });
      // Not cancelled from here on: the full-resolution image and its previews must stay in step.
      await img.healBlemishes(wanted);
      const preview = await img.createPreview(PREVIEW_MAX_DIMENSION);
      const base = await img.createPreview(BASE_MAX_DIMENSION);
      const bloom = await bloomSourcesOf(img);
      if (this.image !== img) return;
      this.update({
        preview,
        base,
        bloomSources: bloom,
        detail: null, // the 100% tile shows old pixels; reload it
        blemish: { working: false, healed: count, detected: (this.blemishSpots?.length ?? 0) / 4 },
      });
      this.recheckZoomTile();
    })().catch((e: unknown) => {
      this.onMessage(`Blemish removal failed: ${e instanceof Error ? e.message : String(e)}`);
      this.update({ blemish: { ...this._state.blemish, working: false } });
    });
  }

  /** Source pixels needed around a region for the spatial effects (see ShaderParams.spatialMargin). */
  private spatialMargin(params: DevelopParams): number {
    const s = this._state.skin;
    const mask = s.kind === 'ready' ? s.mask : null;
    const retouch = params.skinRetouch > 0 && mask?.hasSkin ? Math.trunc(mask.sigmaPx * 2.4) + 4 : 0;
    const wide = wideDenoise(Math.max(params.denoise, effectiveColorDenoise(params))) > 0 ? WIDE_DENOISE_MARGIN : 0;
    return Math.max(ZoomMath.HALO, retouch, wide);
  }

  /** Lens geometry for [params] on the current image; cached while the lens sliders are unchanged. */
  lensFor(params: DevelopParams): LensTransform {
    const info = this._state.lensInfo;
    const key = [info, params.lensProfile, params.lensDistortion, params.vignetteAmount, params.vignetteMidpoint, params.rotation, params.flipHorizontal, params.flipVertical, params.straighten];
    const crop = [params.cropLeft, params.cropTop, params.cropRight, params.cropBottom];
    const c = this.lensCache;
    const sameLens = c != null && c.key.every((v, i) => v === key[i]);
    if (sameLens && c.crop.every((v, i) => v === crop[i])) return c.lens;
    // Only the crop changed: the auto scale is computed on the full frame, so reuse it.
    const lens = new LensTransform(info, params, sameLens ? c.lens.zoom : undefined);
    this.lensCache = { key, crop, lens };
    return lens;
  }

  /** Shows LUT [id] (null = none) once it is loaded. On failure [onError] runs, unless another LUT was picked meanwhile. */
  selectLut(id: string | null, onError: (message: string) => void) {
    if (id === this.selectedLut && (id == null || this._state.lutData?.id === id)) return; // already shown
    this.selectedLut = id;
    if (id == null) return;
    loadLutCached(id).then(
      (data) => {
        if (this.selectedLut === id) this.update({ lutData: data });
      },
      (e: unknown) => {
        if (this.selectedLut === id) onError(`Could not load LUT: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }

  /** Shows film stock [id] (null = none) once both its LUTs are loaded, as [selectLut]. */
  selectFilm(id: string | null, onError: (message: string) => void) {
    if (id === this.selectedFilm && (id == null || this._state.filmData?.stock.id === id)) return;
    this.selectedFilm = id;
    if (id == null) return;
    FilmStocks.load(id).then(
      (data) => {
        if (this.selectedFilm === id) this.update({ filmData: data });
      },
      (e: unknown) => {
        if (this.selectedFilm === id) onError(`Could not load film: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }

  /** Develops the full-resolution photo with [p] and encodes it. */
  async export(p: DevelopParams, defaults: DevelopParams, settings: ExportSettings, onProgress: (f: number) => void): Promise<Blob> {
    const img = this.image;
    if (!img) throw new Error('No photo open');
    const lut = p.lut && p.film == null ? await loadLutCached(p.lut) : null;
    const film = p.film ? await FilmStocks.load(p.film) : null;
    return exportImage(img, this.shaderParams(p, defaults, lut, null, film), settings, onProgress);
  }

  close() {
    this.image?.close();
    this.image = null;
  }
}

/**
 * The detected [spots] (x, y, radius, score; strongest first) that Blemish removal [level] 1..100 heals: those that
 * stand out at least 5 .. 3 standard deviations from the surrounding skin texture (low values: only the most obvious ones).
 */
export function blemishesToHeal(spots: Float32Array, level: number): Float32Array {
  const minScore = 5 - (2 * level) / 100;
  let count = 0;
  for (let i = 0; i < spots.length / 4; i++) if (spots[i * 4 + 3] >= minScore) count++;
  return spots.slice(0, count * 4);
}
