import {
  DEFAULT_GENERIC, FISHEYE_TYPES, fisheyeFov, genericCalibration, lensfunCorrection, matchCamera, matchLens,
  type GenericLens, type LensfunCamera, type LensfunIndex, type LensfunLens,
} from '../../engine/lens/Lensfun';
import { LensfunData } from '../../engine/lens/LensfunData';
import type { PhotoSession } from '../../engine/session/PhotoSession';
import type { PhotoMetadata } from '../../worker/protocol';

/** Where the lens comes from: matched from the photo's EXIF, picked from the database, or described by hand. */
export type LensfunMode = 'auto' | 'manual' | 'generic';

export interface LensfunState {
  /** The Lens tab's Lensfun switch (remembered). */
  enabled: boolean;
  mode: LensfunMode;
  /** The database is being fetched. */
  loading: boolean;
  error: string | null;
  /** Cameras and lenses for the pickers, once loaded. */
  db: LensfunIndex | null;
  /** The sensor: the matched or picked camera (a manual lens with no camera uses the photo's 35 mm equivalent, else the lens's own crop). */
  camera: LensfunCamera | null;
  lens: LensfunLens | null;
  /** Auto mode found no lens for the photo's EXIF. */
  noMatch: boolean;
  /** The photo's own lens and camera names, for the "not found" note. */
  exifLens: string;
  exifCamera: string;
  /** Focal length (mm) and aperture the profile is worked out for; the photo's own when it records them. */
  focal: number;
  aperture: number;
  generic: GenericLens;
  /** What the applied profile contains ("distortion, vignetting"), '' = the lens has none, null = nothing applied. */
  applied: string | null;
  /** The crop factor in use, and the diagonal field of view of a fisheye lens (0 = not a fisheye). */
  crop: number;
  fisheyeFov: number;
}

const KEY = 'rawboy.pro.lensfun';

interface Saved {
  enabled: boolean;
  mode: LensfunMode;
  generic: GenericLens;
  camera: string;
}

const load = (): Saved => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return {
      enabled: s.enabled === true,
      mode: s.mode === 'manual' || s.mode === 'generic' ? s.mode : 'auto',
      generic: { ...DEFAULT_GENERIC, ...s.generic },
      camera: typeof s.camera === 'string' ? s.camera : '',
    };
  } catch {
    return { enabled: false, mode: 'auto', generic: DEFAULT_GENERIC, camera: '' };
  }
};

const cameraKey = (c: LensfunCamera) => `${c.maker}|${c.model}|${c.variant}`;

/**
 * Pro's Lensfun lens corrections: keeps the choices, works the profile out for the open photo and hands it to the
 * session (which uses it in place of the file's own distortion/CA and vignette data). Nothing is fetched until it is
 * switched on.
 */
export class LensfunStore {
  private saved = load();
  private meta: PhotoMetadata | null = null;
  private run = 0;
  private seedGeneric = true;
  private readonly listeners = new Set<() => void>();
  private _state: LensfunState = {
    enabled: this.saved.enabled, mode: this.saved.mode, loading: false, error: null, db: null, camera: null, lens: null,
    noMatch: false, exifLens: '', exifCamera: '', focal: 0, aperture: 0, generic: this.saved.generic, applied: null, crop: 1, fisheyeFov: 0,
  };

  constructor(private readonly session: PhotoSession) {}

  get state() {
    return this._state;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<LensfunState>) {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l();
  }

  private persist() {
    const s = this._state;
    this.saved = { enabled: s.enabled, mode: s.mode, generic: s.generic, camera: s.camera ? cameraKey(s.camera) : this.saved.camera };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.saved));
    } catch {
      // not remembered
    }
  }

  /** A new photo is open: starts again from its EXIF. */
  photoOpened(meta: PhotoMetadata) {
    this.meta = meta;
    this.seedGeneric = true;
    const manual = this._state.mode === 'manual';
    const focal = Number.isFinite(meta.focalLength) && meta.focalLength > 0 ? meta.focalLength : 0;
    const aperture = Number.isFinite(meta.fNumber) && meta.fNumber > 0 ? meta.fNumber : 0;
    this.set({
      focal, aperture, applied: null, noMatch: false, exifLens: meta.lensModel.trim(), exifCamera: `${meta.make} ${meta.model}`.trim(),
      // A manual pick (camera and lens) stays for the next photo; auto matches again.
      camera: manual ? this._state.camera : null,
      lens: manual ? this._state.lens : null,
    });
    void this.refresh();
  }

  setEnabled = (enabled: boolean) => {
    this.set({ enabled });
    this.persist();
    void this.refresh();
  };

  setMode = (mode: LensfunMode) => {
    this.set({ mode, camera: mode === 'manual' ? this._state.camera : null, lens: mode === 'manual' ? this._state.lens : null });
    this.persist();
    void this.refresh();
  };

  pickCamera = (camera: LensfunCamera | null) => {
    this.set({ camera });
    this.persist();
    void this.refresh();
  };

  pickLens = (lens: LensfunLens | null) => {
    this.set({ lens });
    void this.refresh();
  };

  setFocal = (focal: number) => {
    this.set({ focal });
    void this.refresh();
  };

  setAperture = (aperture: number) => {
    this.set({ aperture });
    void this.refresh();
  };

  setGeneric = (patch: Partial<GenericLens>) => {
    this.set({ generic: { ...this._state.generic, ...patch } });
    this.persist();
    void this.refresh();
  };

  /** Works the profile out again for the current choices and applies (or removes) it. */
  private async refresh() {
    const run = ++this.run;
    const s = this._state;
    const meta = this.meta;
    if (!s.enabled || !meta || !this.session.hasImage) {
      this.session.setLensfun(null);
      this.set({ applied: null, loading: false, error: null, fisheyeFov: 0 });
      return;
    }
    try {
      let db = s.db;
      if (!db) {
        this.set({ loading: true, error: null });
        db = await LensfunData.index();
        if (run !== this.run) return;
        this.set({ db, loading: false });
      }
      const sensorCrop = (() => {
        // The photo's own 35 mm equivalent focal length gives its crop factor when the camera isn't known.
        const eq = meta.focalLength35mm / meta.focalLength;
        return Number.isFinite(eq) && eq > 0.5 && eq < 10 ? eq : 0;
      })();
      let camera = s.camera;
      let lens = s.lens;
      let focal = s.focal;
      let aperture = s.aperture;
      let sets;
      let shotCrop: number;
      let label: string;
      let type = lens?.type ?? 'rectilinear';
      if (s.mode === 'generic') {
        let g = s.generic;
        if (this.seedGeneric) {
          // The photo's recorded focal length, aperture and sensor are the starting values for each new photo; a manual lens records none.
          this.seedGeneric = false;
          const cam = matchCamera(db, meta.make, meta.model);
          g = { ...g, ...(focal > 0 ? { focal } : {}), ...(aperture > 0 ? { aperture } : {}), ...(cam ? { crop: cam.crop } : sensorCrop ? { crop: Math.round(sensorCrop * 100) / 100 } : {}) };
          this.set({ generic: g });
          this.persist();
        }
        sets = genericCalibration(g);
        shotCrop = g.crop;
        focal = g.focal;
        aperture = g.aperture;
        type = g.type;
        label = 'generic lens';
        lens = null;
      } else {
        if (s.mode === 'manual' && !camera) camera = this.rememberedCamera(db);
        if (s.mode === 'auto') {
          camera = matchCamera(db, meta.make, meta.model);
          lens = matchLens(db, meta.lensMake, meta.lensModel, camera, s.focal);
          this.set({ camera, lens, noMatch: lens == null });
        }
        if (s.mode === 'manual' && camera !== s.camera) this.set({ camera });
        if (!lens) {
          this.session.setLensfun(null);
          this.set({ applied: null, loading: false, crop: camera?.crop ?? (sensorCrop || 1), fisheyeFov: 0 });
          return;
        }
        shotCrop = camera?.crop ?? (sensorCrop || lens.crop);
        if (!(focal > 0)) focal = lens.minFocal || 50;
        if (!(aperture > 0)) aperture = lens.minAperture || 4;
        sets = await LensfunData.calibrations(db, lens);
        if (run !== this.run) return;
        label = `${lens.maker} ${lens.model}`;
        type = lens.type;
      }
      const correction = lensfunCorrection(sets, { crop: shotCrop, focal, aperture, distance: 1000 }, lens ?? undefined);
      this.session.setLensfun(correction.warp || correction.vignette ? { warp: correction.warp, vignette: correction.vignette, label } : null);
      this.set({
        applied: correction.summary, crop: shotCrop, focal, aperture,
        fisheyeFov: FISHEYE_TYPES.includes(type) ? fisheyeFov(type, correction.realFocal || focal, shotCrop) : 0,
        loading: false, error: null,
      });
    } catch (e) {
      if (run !== this.run) return;
      this.session.setLensfun(null);
      this.set({ loading: false, applied: null, error: e instanceof Error ? e.message : 'Could not load the Lensfun database' });
    }
  }

  /** The remembered camera (manual mode), once the database is in. */
  rememberedCamera(db: LensfunIndex): LensfunCamera | null {
    return db.cameras.find((c) => cameraKey(c) === this.saved.camera) ?? null;
  }
}
