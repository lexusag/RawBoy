import { localFolder, saveBlob, type OutputFolder } from '../ui/common/files';
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
  status: ItemStatus;
  info?: PackInfo;
  /** After packing: the DNG's size, name and what was written. */
  outSize?: number;
  outName?: string;
  result?: PackInfo;
  error?: string;
}

/** Where packed files go: a folder (File System Access API) or the browser's downloads. */
export type Output = { kind: 'folder'; dir: FileSystemDirectoryHandle } | { kind: 'downloads' };

export interface PackerState {
  items: PackItem[];
  running: boolean;
  /** The engine failed to load (e.g. a build without the DNG SDK). */
  engineError: string | null;
}

/** RawBoy Packer's file list and queue. Files are inspected when added and packed by up to filesAtOnce workers. */
export class PackerStore {
  private state: PackerState = { items: [], running: false, engineError: null };
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

  /** Adds files (duplicates by name and size skipped) and reads what each is, one after another. */
  add(files: File[]) {
    const known = new Set(this.state.items.map((it) => `${it.file.name}/${it.file.size}`));
    const added: PackItem[] = [];
    for (const file of files) {
      const key = `${file.name}/${file.size}`;
      if (known.has(key)) continue;
      known.add(key);
      added.push({ id: this.nextId++, file, status: 'inspecting' });
    }
    if (!added.length) return;
    this.set({ items: [...this.state.items, ...added] });
    for (const item of added) this.inspect(item.id);
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
    const queue = this.state.items.filter(
      (it) => it.status === 'inspecting' || it.status === 'ready' || it.status === 'done' || (it.status === 'error' && it.info),
    );
    if (!queue.length) return null;
    for (const it of queue) this.update(it.id, { status: 'waiting', error: undefined, outSize: undefined, outName: undefined });
    this.cancelled = false;
    this.set({ running: true });
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
    this.set({ running: false });
    return run;
  }

  /** Stops after the files being packed now. */
  cancel() {
    this.cancelled = true;
  }
}
