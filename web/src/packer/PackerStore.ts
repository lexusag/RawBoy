import { localFolder, saveBlob, type OutputFolder } from '../ui/common/files';
import { fileDate, saveSort, savedSort, sortPhotos, type PhotoSort } from '../engine/auto/PhotoOrder';
import { findCaptureDate } from '../engine/browse/CaptureDate';
import type { PackInfo, PackerRequest } from './protocol';
import { autoFilesAtOnce, outputName, packOptions, settingsSuffix, threadsPerFile, type PackRun, type PackSettings } from './settings';

/** One packer worker (WASM engine with the DNG SDK) and a promise-based call into it. */
class PackerWorker {
  private readonly worker = new Worker(new URL('../worker/packer.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<unknown>;

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'The packer stopped (out of memory?)'));
      this.pending.clear();
    };
    this.ready = this.send({ op: 'init', wasmBase: new URL('wasm/', document.baseURI).href });
  }

  private send<T>(req: PackerRequest, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, req }, transfer);
    });
  }

  async call<T>(req: PackerRequest, transfer: Transferable[] = []): Promise<T> {
    await this.ready;
    return this.send<T>(req, transfer);
  }

  terminate() {
    this.worker.terminate();
  }
}

export type ItemStatus = 'inspecting' | 'ready' | 'waiting' | 'packing' | 'done' | 'error';

export interface PackItem {
  id: number;
  file: File;
  folder?: string;
  /** When it was shot, else the file's date, as an EXIF date (CaptureDate); null if unknown. Orders the queue. */
  date: string | null;
  status: ItemStatus;
  info?: PackInfo;
  /** After packing: the DNG's size, name and what was written. */
  outSize?: number;
  outName?: string;
  result?: PackInfo;
  error?: string;
}

export type PackItemInput = File | { file: File; folder?: string };

export function folderOf(file: File): string | undefined {
  if ('folder' in file && typeof (file as { folder?: unknown }).folder === 'string') {
    return (file as { folder: string }).folder;
  }
  if (file.webkitRelativePath) {
    const idx = file.webkitRelativePath.lastIndexOf('/');
    if (idx > 0) return file.webkitRelativePath.slice(0, idx);
  }
  return undefined;
}

/** The full relative path and file size used to identify duplicates in the queue. */
export function fileKey(file: File, folder?: string): string {
  const path = file.webkitRelativePath || (folder ? `${folder}/${file.name}` : file.name);
  return `${path}/${file.size}`;
}

export interface FolderGroup {
  folder: string | null;
  items: PackItem[];
}

/** Groups queue items by their folder, preserving the order folders first appeared, with items in each folder sorted by [sort]. */
export function groupByFolder(items: PackItem[], sort: PhotoSort = 'date'): FolderGroup[] {
  const groups: FolderGroup[] = [];
  const map = new Map<string | null, FolderGroup>();

  for (const item of items) {
    const key = item.folder ?? null;
    let g = map.get(key);
    if (!g) {
      g = { folder: key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    g.items.push(item);
  }
  for (const g of groups) {
    g.items = sortPhotos(g.items, sort, (it) => it.file.name);
  }
  return groups;
}

/**
 * Orders items by folder (by first appearance), and within each folder by [sort]: 'date' by shoot date
 * (oldest first; those without one after the rest, by file name), then file name; 'name' by file name.
 */
export function sortPackItems(items: readonly PackItem[], sort: PhotoSort = 'date'): PackItem[] {
  return groupByFolder(items as PackItem[], sort).flatMap((g) => g.items);
}

/** Where packed files go: a folder (File System Access API) or the browser's downloads. */
export type Output = { kind: 'folder'; dir: FileSystemDirectoryHandle } | { kind: 'downloads' };

export interface PackerState {
  items: PackItem[];
  running: boolean;
  /** The files in the current run, in order; empty when nothing runs. Drives the pinned progress bar. */
  runIds: number[];
  /** Stop was pressed: the run ends after the files being packed now. */
  stopping: boolean;
  /** The engine failed to load (e.g. a build without the DNG SDK). */
  engineError: string | null;
  /** How queue items are ordered: by shoot date (default) or file name. */
  sort: PhotoSort;
}

export const SORT_KEY = 'rawboy.packer.sort';

/** RawBoy Packer's file list and queue. Files are inspected when added and packed by up to filesAtOnce workers. */
export class PackerStore {
  private state: PackerState = {
    items: [],
    running: false,
    runIds: [],
    stopping: false,
    engineError: null,
    sort: savedSort(SORT_KEY),
  };
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private workers: PackerWorker[] = [];
  private inspector: PackerWorker | null = null;
  private inspecting: Promise<void> = Promise.resolve();
  private cancelled = false;

  readonly subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  readonly getState = () => this.state;

  private set(patch: Partial<PackerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private update(id: number, patch: Partial<PackItem>) {
    this.set({ items: this.state.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  }

  private worker(i: number): PackerWorker {
    while (this.workers.length <= i) this.workers.push(new PackerWorker());
    return this.workers[i];
  }

  /** Adds files (duplicates by full relative path and size skipped) and reads what each is, one after another. */
  add(files: PackItemInput[]) {
    const known = new Set(this.state.items.map((it) => fileKey(it.file, it.folder)));
    const added: PackItem[] = [];
    for (const raw of files) {
      const file = 'file' in raw ? raw.file : raw;
      if (file.name.startsWith('.')) continue;
      const folder = ('folder' in raw && raw.folder != null) ? raw.folder : folderOf(file);
      const key = fileKey(file, folder);
      if (known.has(key)) continue;
      known.add(key);
      added.push({
        id: this.nextId++,
        file,
        folder,
        date: fileDate(file.lastModified),
        status: 'inspecting',
      });
    }
    if (!added.length) return;
    this.set({ items: [...this.state.items, ...added] });
    void this.readDates(added);
    for (const item of added) this.inspect(item.id);
  }

  /**
   * Gives [items] their capture dates (they start with their files' dates) and updates item dates once for all of them.
   */
  private async readDates(items: PackItem[]) {
    const dates = new Map<number, string>();
    for (const it of items) {
      try {
        const date = await findCaptureDate(it.file);
        if (date && date !== it.date) dates.set(it.id, date);
      } catch {
        // keep fileDate
      }
    }
    if (!dates.size) return;
    this.set({
      items: this.state.items.map((it) => (dates.has(it.id) ? { ...it, date: dates.get(it.id)! } : it)),
    });
  }

  /** Orders files by [sort] from now on (remembered in this browser). */
  setSort(sort: PhotoSort) {
    saveSort(SORT_KEY, sort);
    this.set({ sort });
  }

  /**
   * Queues reading what a file is. Packing does not need it (pack() reports the same info), so a file that a run
   * picked up before its turn here is skipped.
   */
  private inspect(id: number) {
    this.inspector ??= this.worker(0);
    this.inspecting = this.inspecting.then(async () => {
      const item = this.state.items.find((it) => it.id === id);
      if (item?.status !== 'inspecting') return;
      try {
        const bytes = await item.file.arrayBuffer();
        const info = await this.inspector!.call<PackInfo>({ op: 'inspect', bytes }, [bytes]);
        const now = this.state.items.find((it) => it.id === id);
        if (now?.status === 'inspecting') this.update(id, { status: 'ready', info });
        else if (now && !now.info) this.update(id, { info });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/DNG SDK|rawboy-full|Failed to fetch|import/i.test(message)) this.set({ engineError: message });
        if (this.state.items.find((it) => it.id === id)?.status === 'inspecting') this.update(id, { status: 'error', error: message });
      }
    });
  }

  remove(id: number) {
    if (this.state.items.find((it) => it.id === id)?.status === 'packing') return;
    this.set({ items: this.state.items.filter((it) => it.id !== id) });
  }

  /** Removes every file in [folder] that is not currently being packed. */
  removeFolder(folder: string | null | undefined) {
    const target = folder ?? undefined;
    this.set({
      items: this.state.items.filter((it) => (it.folder ?? undefined) !== target || it.status === 'packing'),
    });
  }

  /** Drops finished and failed files from the list. */
  clearDone() {
    this.set({ items: this.state.items.filter((it) => it.status !== 'done' && it.status !== 'error') });
  }

  clearAll() {
    if (this.state.running) return;
    this.set({ items: [] });
  }

  /**
   * Packs every file that is ready, still being read, or failed before, writing each DNG as soon as it is done. It does
   * not wait for files to be read: a file not read yet is packed when its turn comes. Resolves with what the run did,
   * or null when nothing was started.
   */
  async start(settings: PackSettings, output: Output): Promise<PackRun | null> {
    if (this.state.running) return null;
    const groups = groupByFolder(this.state.items, this.state.sort);
    const ordered = groups.flatMap((g) => g.items);
    const queue = ordered.filter(
      (it) => it.status === 'inspecting' || it.status === 'ready' || it.status === 'done' || (it.status === 'error' && it.info),
    );
    if (!queue.length) return null;
    for (const it of queue) this.update(it.id, { status: 'waiting', error: undefined, outSize: undefined, outName: undefined });
    this.cancelled = false;
    this.set({ running: true, runIds: queue.map((it) => it.id), stopping: false });
    const folder: OutputFolder | null = output.kind === 'folder' ? localFolder(output.dir) : null;
    const lanes = Math.min(settings.filesAtOnce || autoFilesAtOnce(), queue.length);
    const options = packOptions(settings, threadsPerFile(lanes));
    let next = 0;
    const lane = async (i: number) => {
      const worker = this.worker(i);
      while (!this.cancelled && next < queue.length) {
        const item = queue[next++];
        if (!this.state.items.some((it) => it.id === item.id)) continue;
        this.update(item.id, { status: 'packing' });
        try {
          const bytes = await item.file.arrayBuffer();
          const { dng, info } = await worker.call<{ dng: Uint8Array; info: PackInfo }>({ op: 'pack', bytes, options }, [bytes]);
          const blob = new Blob([dng], { type: 'image/x-adobe-dng' });
          const suffix = settings.nameSuffix ? settingsSuffix(settings) : '';
          let name = outputName(item.file.name, 0, suffix);
          if (folder) name = await folder.write((c) => outputName(item.file.name, c, suffix), blob);
          else saveBlob(name, blob);
          this.update(item.id, { status: 'done', outSize: dng.byteLength, outName: name, result: info, info: this.state.items.find((it) => it.id === item.id)?.info ?? info });
        } catch (e) {
          this.update(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
          // A worker that ran out of memory is unusable: start a fresh one for the next file.
          if (/memory|stopped/i.test(String(e))) {
            this.workers[i]?.terminate();
            this.workers[i] = new PackerWorker();
            if (i === 0) this.inspector = this.workers[0];
          }
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, (_, i) => lane(i)));
    const ids = new Set(queue.map((it) => it.id));
    const run: PackRun = { done: 0, failed: 0, stopped: false, before: 0, after: 0 };
    for (const it of this.state.items) {
      if (!ids.has(it.id)) continue;
      if (it.status === 'done') {
        run.done++;
        run.before += it.file.size;
        run.after += it.outSize ?? 0;
      } else if (it.status === 'error') run.failed++;
      else if (it.status === 'waiting') {
        run.stopped = true;
        if (it.info) this.update(it.id, { status: 'ready' });
        else {
          // Stopped before its turn and never read: read it now, as if just added.
          this.update(it.id, { status: 'inspecting' });
          this.inspect(it.id);
        }
      }
    }
    this.set({ running: false, runIds: [], stopping: false });
    return run;
  }

  /** Stops after the files being packed now. */
  cancel() {
    this.cancelled = true;
    if (this.state.running) this.set({ stopping: true });
  }
}
