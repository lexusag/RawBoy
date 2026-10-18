import { isRated, NO_RATING, readXmp, writeXmp, type Flag, type Rating } from '../../engine/browse/XmpSidecar';
import { zipFiles } from '../common/files';
import { groupPhotos, isPhotoName, stemOf, withSuffix, type PhotoGroup } from './PhotoGroups';
import { thumbnailOf, viewImageOf, type ViewImage } from './Previews';

/** The subfolder rejects are moved into: nothing is ever deleted, and Restore brings them back. */
export const BIN = '_bin';

export interface BrowsePhoto extends PhotoGroup {
  /** The main file's name (unique in the folder). */
  id: string;
  rating: Rating;
  /** Object URL of the grid thumbnail. */
  thumbnail: string | null;
  status: 'queued' | 'ready' | 'failed';
  error: string | null;
}

export type Filter = 'all' | 'picks' | 'unflagged' | 'rejects';

export interface BrowserState {
  /** The open folder; [writable] when the browser lets RawBoy write to it (sidecars, bin). */
  folder: { name: string; writable: boolean } | null;
  photos: BrowsePhoto[];
  filter: Filter;
  /** Shows only photos with at least this many stars (0 = any). */
  minStars: number;
  /** The photo the keyboard acts on (highlighted in the grid, shown in the viewer). */
  current: string | null;
  viewing: boolean;
  /** Photos in the bin folder. */
  binCount: number;
  /** After a rating, the viewer goes on to the next photo (remembered in this browser). */
  autoAdvance: boolean;
  canUndo: boolean;
  busy: boolean;
  message: string | null;
}

const AUTO_ADVANCE_KEY = 'rawboy.browser.autoAdvance';
const THUMBNAIL = 400;
/** Thumbnails made at once: each decodes a full embedded JPEG. */
const THUMB_WORKERS = 3;

type Undo = { kind: 'rating'; id: string; rating: Rating } | { kind: 'bin'; moves: { from: string; to: string }[] };

/** True when [photo] passes the grid's filter. */
export function visible(photo: BrowsePhoto, filter: Filter, minStars: number): boolean {
  const f = photo.rating.flag;
  const flagOk = filter === 'all' || (filter === 'picks' && f === 'pick') || (filter === 'rejects' && f === 'reject') || (filter === 'unflagged' && f == null);
  return flagOk && photo.rating.stars >= minStars;
}

/**
 * Which photos Send to Auto takes: the picks, those with [stars] stars ([exact]) or at least that many (rejects left
 * out, though they keep their stars), or what the grid shows now.
 */
export type SendCriteria = { kind: 'picks' } | { kind: 'stars'; stars: number; exact: boolean } | { kind: 'shown' };

/** The photos [criteria] takes, in grid order. */
export function photosToSend(photos: BrowsePhoto[], criteria: SendCriteria, filter: Filter, minStars: number): BrowsePhoto[] {
  switch (criteria.kind) {
    case 'picks':
      return photos.filter((p) => p.rating.flag === 'pick');
    case 'stars':
      return photos.filter((p) => p.rating.flag !== 'reject'
        && (criteria.exact ? p.rating.stars === criteria.stars : p.rating.stars >= criteria.stars));
    case 'shown':
      return photos.filter((p) => visible(p, filter, minStars));
  }
}

function savedAutoAdvance(): boolean {
  try {
    return localStorage.getItem(AUTO_ADVANCE_KEY) !== '0';
  } catch {
    return true;
  }
}

const values = (dir: FileSystemDirectoryHandle) =>
  (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves [name] from [from] to [to] as [target]: FileSystemHandle.move where the browser has it, else a copy that is
 * checked before the original is removed.
 */
async function moveFile(from: FileSystemDirectoryHandle, name: string, to: FileSystemDirectoryHandle, target: string) {
  const handle = await from.getFileHandle(name);
  const move = (handle as unknown as { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }).move;
  if (move) {
    try {
      await move.call(handle, to, target);
      return;
    } catch {
      // not supported for this folder: copy instead
    }
  }
  const file = await handle.getFile();
  const out = await to.getFileHandle(target, { create: true });
  await file.stream().pipeTo(await out.createWritable());
  if ((await out.getFile()).size !== file.size) {
    await to.removeEntry(target);
    throw new Error(`Could not copy ${name}`);
  }
  await from.removeEntry(name);
}

/**
 * RawBoy Browser: a folder of photos to cull. Thumbnails come from the raws' embedded previews; ratings, picks and
 * rejects are written to XMP sidecars as they change; rejects move into [BIN] on request.
 * Without folder access (Safari, Firefox) photos are picked as files: rating works, sidecars are downloaded instead.
 */
export class BrowserStore {
  private _state: BrowserState = {
    folder: null, photos: [], filter: 'all', minStars: 0, current: null, viewing: false, binCount: 0,
    autoAdvance: savedAutoAdvance(), canUndo: false, busy: false, message: null,
  };
  private readonly listeners = new Set<() => void>();
  private dir: FileSystemDirectoryHandle | null = null;
  /** Picked files by name (no folder access). */
  private files = new Map<string, File>();
  private readonly views = new Map<string, Promise<ViewImage>>();
  private readonly undoStack: Undo[] = [];
  private readonly writeTimers = new Map<string, number>();
  private writes: Promise<unknown> = Promise.resolve();
  /** Bumped on every open, so work for an earlier folder is dropped. */
  private generation = 0;
  private thumbQueue: string[] = [];
  private thumbWorkers = 0;

  get state() {
    return this._state;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private update(patch: Partial<BrowserState>) {
    this._state = { ...this._state, ...patch };
    for (const l of this.listeners) l();
  }

  private photo(id: string | null) {
    return id == null ? undefined : this._state.photos.find((p) => p.id === id);
  }

  private updatePhoto(id: string, change: (p: BrowsePhoto) => BrowsePhoto) {
    this.update({ photos: this._state.photos.map((p) => (p.id === id ? change(p) : p)) });
  }

  consumeMessage() {
    this.update({ message: null });
  }

  showMessage(message: string) {
    this.update({ message });
  }

  // ---- Opening ----

  /** Opens a folder the browser can write to (File System Access API). */
  async openFolder(dir: FileSystemDirectoryHandle) {
    await this.flushWrites();
    this.reset();
    this.dir = dir;
    this.update({ folder: { name: dir.name, writable: true }, busy: true });
    try {
      await this.scan();
    } catch (e) {
      this.update({ message: `Couldn't read ${dir.name}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      this.update({ busy: false });
    }
  }

  /** Adds picked or dropped files (no folder access): photos and any .xmp sidecars among them. */
  async addFiles(files: File[]) {
    if (this.dir) {
      await this.flushWrites();
      this.reset();
    }
    for (const f of files) this.files.set(f.name, f);
    const groups = groupPhotos([...this.files.keys()]);
    const known = new Map(this._state.photos.map((p) => [p.id, p]));
    const photos: BrowsePhoto[] = [];
    for (const g of groups) {
      const old = known.get(g.main);
      photos.push(old ? { ...old, ...g } : await this.newPhoto(g));
    }
    this.update({ folder: { name: 'Picked photos', writable: false }, photos });
    this.queueThumbnails(photos.filter((p) => !known.has(p.id)).map((p) => p.id));
  }

  private reset() {
    this.generation++;
    for (const p of this._state.photos) if (p.thumbnail) URL.revokeObjectURL(p.thumbnail);
    this.dir = null;
    this.files = new Map();
    this.views.clear();
    this.undoStack.length = 0;
    this.thumbQueue = [];
    this.update({ folder: null, photos: [], current: null, viewing: false, binCount: 0, canUndo: false });
  }

  /** (Re)reads the folder: photos, sidecar ratings and the bin's size; thumbnails already made are kept. */
  private async scan() {
    const dir = this.dir!;
    const generation = this.generation;
    const names: string[] = [];
    let bin: FileSystemDirectoryHandle | null = null;
    for await (const h of values(dir)) {
      if (h.kind === 'file') names.push(h.name);
      else if (h.name === BIN) bin = h as FileSystemDirectoryHandle;
    }
    let binCount = 0;
    if (bin) for await (const h of values(bin)) if (h.kind === 'file' && isPhotoName(h.name)) binCount++;
    const known = new Map(this._state.photos.map((p) => [p.id, p]));
    const photos: BrowsePhoto[] = [];
    for (const g of groupPhotos(names)) {
      const old = known.get(g.main);
      photos.push(old ? { ...old, ...g, rating: await this.readRating(g) } : await this.newPhoto(g));
      if (generation !== this.generation) return;
    }
    for (const [id, p] of known) if (p.thumbnail && !photos.some((q) => q.id === id)) URL.revokeObjectURL(p.thumbnail);
    const current = photos.some((p) => p.id === this._state.current) ? this._state.current : null;
    this.update({ photos, binCount, current, viewing: this._state.viewing && current != null });
    this.queueThumbnails(photos.filter((p) => !p.thumbnail).map((p) => p.id));
  }

  private async newPhoto(g: PhotoGroup): Promise<BrowsePhoto> {
    return { ...g, id: g.main, rating: await this.readRating(g), thumbnail: null, status: 'queued', error: null };
  }

  /** The rating in the photo's first sidecar that has one. */
  private async readRating(g: PhotoGroup): Promise<Rating> {
    for (const name of g.sidecars) {
      try {
        const text = await (await this.fileOf(name)).text();
        if (/xmp:Rating|rawboy:Pick/.test(text)) return readXmp(text);
      } catch {
        // unreadable sidecar: ignored
      }
    }
    return NO_RATING;
  }

  private async fileOf(name: string): Promise<File> {
    if (this.dir) return (await this.dir.getFileHandle(name)).getFile();
    const f = this.files.get(name);
    if (!f) throw new Error(`${name} is gone`);
    return f;
  }

  /** The main file of photo [id], e.g. for opening it in RawBoy or Auto. */
  file(id: string): Promise<File> {
    return this.fileOf(id);
  }

  // ---- Thumbnails and the viewer's image ----

  /** What the viewer shows for [id]; kept, so going back and forth is instant. */
  viewImage(id: string): Promise<ViewImage> {
    let v = this.views.get(id);
    if (!v) {
      v = this.fileOf(id).then(viewImageOf);
      v.catch(() => this.views.delete(id));
      this.views.set(id, v);
    }
    return v;
  }

  /** Makes [ids]' thumbnails next (the viewer's neighbours, photos scrolled into view). */
  prioritize(ids: string[]) {
    const wanted = ids.filter((id) => this.thumbQueue.includes(id));
    if (!wanted.length) return;
    this.thumbQueue = [...wanted, ...this.thumbQueue.filter((id) => !wanted.includes(id))];
  }

  private queueThumbnails(ids: string[]) {
    this.thumbQueue.push(...ids);
    while (this.thumbWorkers < THUMB_WORKERS && this.thumbQueue.length) {
      this.thumbWorkers++;
      void this.thumbWorker(this.generation).finally(() => this.thumbWorkers--);
    }
  }

  private async thumbWorker(generation: number) {
    while (this.thumbQueue.length && generation === this.generation) {
      const id = this.thumbQueue.shift()!;
      try {
        const blob = await thumbnailOf(await this.viewImage(id), THUMBNAIL);
        if (generation !== this.generation) return;
        const url = URL.createObjectURL(blob);
        this.updatePhoto(id, (p) => ({ ...p, thumbnail: url, status: 'ready', error: null }));
      } catch (e) {
        if (generation !== this.generation) return;
        const error = e instanceof Error ? e.message : String(e);
        this.updatePhoto(id, (p) => ({ ...p, status: 'failed', error: /HEIC/i.test(id) ? 'HEIC needs Safari' : error }));
      }
    }
  }

  // ---- Rating ----

  setStars(id: string, stars: number) {
    const p = this.photo(id);
    if (!p) return;
    // Stars on a reject take it out of the rejects, as in Lightroom.
    this.rate(id, { stars: p.rating.stars === stars ? 0 : stars, flag: p.rating.flag === 'reject' ? null : p.rating.flag });
  }

  /** Sets [flag], or clears it when the photo already has it. */
  toggleFlag(id: string, flag: Exclude<Flag, null>) {
    const p = this.photo(id);
    if (p) this.rate(id, { ...p.rating, flag: p.rating.flag === flag ? null : flag });
  }

  clearFlag(id: string) {
    const p = this.photo(id);
    if (p) this.rate(id, { ...p.rating, flag: null });
  }

  private rate(id: string, rating: Rating, undoable = true) {
    const p = this.photo(id);
    if (!p || (p.rating.stars === rating.stars && p.rating.flag === rating.flag)) return;
    if (undoable) this.pushUndo({ kind: 'rating', id, rating: p.rating });
    this.updatePhoto(id, (q) => ({ ...q, rating }));
    this.scheduleWrite(id);
  }

  private pushUndo(u: Undo) {
    this.undoStack.push(u);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.update({ canUndo: true });
  }

  /** Undoes the last rating change or move to the bin. */
  async undo() {
    const u = this.undoStack.pop();
    this.update({ canUndo: this.undoStack.length > 0 });
    if (!u) return;
    if (u.kind === 'rating') {
      this.rate(u.id, u.rating, false);
      this.update({ current: u.id });
      return;
    }
    await this.moveBack(u.moves);
  }

  private scheduleWrite(id: string) {
    if (!this.dir) return;
    clearTimeout(this.writeTimers.get(id));
    this.writeTimers.set(id, window.setTimeout(() => this.write(id), 400));
  }

  private write(id: string) {
    this.writeTimers.delete(id);
    const dir = this.dir;
    if (!dir) return;
    this.writes = this.writes.then(async () => {
      const p = this.photo(id);
      if (!p || this.dir !== dir) return;
      try {
        const names = p.sidecars.length ? p.sidecars : [`${p.stem}.xmp`];
        for (const name of names) {
          const text = (await exists(dir, name)) ? await (await (await dir.getFileHandle(name)).getFile()).text() : null;
          if (text == null && !isRated(p.rating)) continue;
          await writeText(dir, name, writeXmp(text, p.rating));
        }
        if (!p.sidecars.length && isRated(p.rating)) this.updatePhoto(id, (q) => ({ ...q, sidecars: names }));
      } catch (e) {
        this.update({ message: `Couldn't save the rating of ${p.main}: ${e instanceof Error ? e.message : String(e)}` });
      }
    });
  }

  /** Writes every pending sidecar now. */
  private async flushWrites() {
    for (const [id, t] of this.writeTimers) {
      clearTimeout(t);
      this.write(id);
    }
    await this.writes;
  }

  /** The ratings as sidecars in one ZIP (no folder access): copy them next to the raws for other apps to read. */
  async downloadSidecars(): Promise<Blob | null> {
    const rated = this._state.photos.filter((p) => isRated(p.rating));
    if (!rated.length) return null;
    const files: { name: string; blob: Blob }[] = [];
    for (const p of rated) {
      const existing = p.sidecars[0];
      const text = existing ? await (await this.fileOf(existing)).text() : null;
      files.push({ name: existing ?? `${p.stem}.xmp`, blob: new Blob([writeXmp(text, p.rating)], { type: 'application/rdf+xml' }) });
    }
    return zipFiles(files);
  }

  // ---- Bin ----

  /** Moves every reject (its raw, companions and sidecars) into the bin folder; undoable. */
  async moveRejectsToBin() {
    const dir = this.dir;
    if (!dir || this._state.busy) return;
    this.update({ busy: true });
    // After the pending writes: a reject's sidecar may only just have been created.
    await this.flushWrites();
    const rejects = this._state.photos.filter((p) => p.rating.flag === 'reject');
    const moves: { from: string; to: string }[] = [];
    let failed = 0;
    try {
      const bin = await dir.getDirectoryHandle(BIN, { create: true });
      for (const p of rejects) {
        const names = [p.main, ...p.companions, ...p.sidecars];
        // One suffix for the whole photo, so its sidecars keep matching it in the bin.
        let suffix = '';
        for (let k = 1; (await Promise.all(names.map((n) => exists(bin, withSuffix(n, p.stem, suffix))))).some(Boolean); k++) suffix = `-${k}`;
        try {
          for (const name of names) {
            const to = withSuffix(name, p.stem, suffix);
            await moveFile(dir, name, bin, to);
            moves.push({ from: name, to });
          }
        } catch {
          failed++;
        }
      }
    } catch (e) {
      this.update({ message: `Couldn't create the ${BIN} folder: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (moves.length) this.pushUndo({ kind: 'bin', moves });
    const moved = rejects.length - failed;
    await this.scan();
    this.update({
      busy: false,
      message: failed ? `Moved ${moved} to ${BIN}; ${failed} couldn't be moved` : `Moved ${moved} reject${moved === 1 ? '' : 's'} to ${BIN}`,
    });
  }

  /** Moves everything in the bin back into the folder. */
  async restoreBin() {
    const dir = this.dir;
    if (!dir || this._state.busy) return;
    let bin: FileSystemDirectoryHandle;
    try {
      bin = await dir.getDirectoryHandle(BIN);
    } catch {
      return;
    }
    const moves: { from: string; to: string }[] = [];
    for await (const h of values(bin)) if (h.kind === 'file') moves.push({ from: h.name, to: h.name });
    await this.moveBack(moves);
  }

  /** Moves bin files [moves].to back to [moves].from (another name if that is taken now), then rereads the folder. */
  private async moveBack(moves: { from: string; to: string }[]) {
    const dir = this.dir;
    if (!dir || !moves.length) return;
    this.update({ busy: true });
    let failed = 0;
    try {
      const bin = await dir.getDirectoryHandle(BIN);
      for (const m of moves) {
        try {
          let target = m.from;
          for (let k = 1; await exists(dir, target); k++) target = withSuffix(m.from, stemOf(m.from), `-${k}`);
          await moveFile(bin, m.to, dir, target);
        } catch {
          failed++;
        }
      }
    } catch {
      failed = moves.length;
    }
    await this.scan();
    const back = moves.filter((m) => isPhotoName(m.from)).length;
    this.update({ busy: false, message: failed ? `${failed} file${failed === 1 ? '' : 's'} couldn't be moved back` : `${back} photo${back === 1 ? '' : 's'} back from ${BIN}` });
  }

  // ---- Navigation ----

  setFilter(filter: Filter) {
    this.update({ filter });
  }

  setMinStars(minStars: number) {
    this.update({ minStars });
  }

  setAutoAdvance(autoAdvance: boolean) {
    this.update({ autoAdvance });
    try {
      localStorage.setItem(AUTO_ADVANCE_KEY, autoAdvance ? '1' : '0');
    } catch {
      // not remembered
    }
  }

  /** Photos passing the filter, in folder order. */
  shown(): BrowsePhoto[] {
    const { photos, filter, minStars } = this._state;
    return photos.filter((p) => visible(p, filter, minStars));
  }

  select(id: string | null) {
    this.update({ current: id });
  }

  open(id: string) {
    this.update({ current: id, viewing: true });
  }

  closeViewer() {
    this.update({ viewing: false });
  }

  /**
   * Moves [delta] photos through the filtered list. The current photo may have just left it (rated out of the
   * filter): then the step starts from its place in the folder.
   */
  step(delta: number) {
    const { photos, current, filter, minStars } = this._state;
    if (!photos.length) return;
    const shown = this.shown();
    if (!shown.length) return;
    const at = photos.findIndex((p) => p.id === current);
    if (at < 0) return this.select(shown[0].id);
    const dir = Math.sign(delta);
    let left = Math.abs(delta);
    let i = at;
    let last = visible(photos[at], filter, minStars) ? at : -1;
    while (left > 0) {
      i += dir;
      if (i < 0 || i >= photos.length) break;
      if (visible(photos[i], filter, minStars)) {
        last = i;
        left--;
      }
    }
    if (last >= 0) this.select(photos[last].id);
  }

  /** After a rating in the viewer: on to the next photo when auto-advance is on. */
  advance() {
    if (this._state.autoAdvance && this._state.viewing) this.step(1);
  }
}
