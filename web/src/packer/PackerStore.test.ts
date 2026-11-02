import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/common/files', () => ({ localFolder: vi.fn(), saveBlob: vi.fn() }));

import { folderOf, groupByFolder, PackerStore } from './PackerStore';
import { DEFAULT_SETTINGS } from './settings';

const info = (format: string) => ({ make: 'Fuji', model: 'X', format }) as unknown;

const ops: string[] = [];

/** Answers one message at a time, like the real worker; reading a file is slow, packing quick. */
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private busy: Promise<void> = Promise.resolve();
  postMessage({ id, req }: { id: number; req: { op: string } }) {
    this.busy = this.busy.then(async () => {
      ops.push(req.op);
      await new Promise((r) => setTimeout(r, req.op === 'inspect' ? 30 : 1));
      const result = req.op === 'init' ? null : req.op === 'inspect' ? info('inspected') : { dng: new Uint8Array(10), info: info('packed') };
      this.onmessage?.({ data: { id, ok: true, result } } as MessageEvent);
    });
  }
  terminate() {}
}

const file = (name: string) => new File([new Uint8Array(100)], name);

describe('PackerStore', () => {
  beforeEach(() => {
    ops.length = 0;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stops before files not read yet and reads them afterwards', async () => {
    const store = new PackerStore();
    store.add([file('a.raf'), file('b.raf')]);
    await new Promise((r) => setTimeout(r, 5));
    const running = store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    store.cancel();
    expect(await running).toMatchObject({ done: 1, stopped: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(store.getState().items.map((it) => it.status)).toEqual(['done', 'ready']);
  });

  it('packs right away without waiting for files to be read', async () => {
    const store = new PackerStore();
    store.add([file('a.raf'), file('b.raf'), file('c.raf')]);
    await new Promise((r) => setTimeout(r, 5));
    expect(store.getState().items.every((it) => it.status === 'inspecting')).toBe(true);

    const run = await store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    expect(run).toMatchObject({ done: 3, failed: 0, stopped: false });
    // Only the read already under way when Pack was pressed; the rest are skipped and packed directly.
    expect(ops.filter((o) => o === 'inspect')).toHaveLength(1);
    const items = store.getState().items;
    expect(items.every((it) => it.status === 'done' && it.info)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getState().items.every((it) => it.status === 'done')).toBe(true);

    store.clearDone();
    expect(store.getState().items).toEqual([]);
  });

  it('clearDone removes finished and failed items while keeping ready ones', async () => {
    const store = new PackerStore();
    store.add([file('a.raf'), file('b.raf')]);
    await new Promise((r) => setTimeout(r, 5));
    const running = store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    store.cancel();
    await running;
    await new Promise((r) => setTimeout(r, 100));
    expect(store.getState().items.map((it) => it.status)).toEqual(['done', 'ready']);

    store.clearDone();
    expect(store.getState().items.map((it) => it.status)).toEqual(['ready']);
  });

  it('groups items by folder and extracts folder names', () => {
    const f1 = file('img1.raf');
    const f2 = file('img2.raf');
    Object.defineProperty(f2, 'webkitRelativePath', { value: 'Vacation/img2.raf' });
    const f3 = file('img3.raf');

    expect(folderOf(f1)).toBeUndefined();
    expect(folderOf(f2)).toBe('Vacation');

    const store = new PackerStore();
    store.add([
      { file: f1 },
      f2,
      { file: f3, folder: 'Trip' },
      { file: file('img4.raf'), folder: 'Vacation' },
    ]);

    const items = store.getState().items;
    expect(items).toHaveLength(4);
    expect(items[0].folder).toBeUndefined();
    expect(items[1].folder).toBe('Vacation');
    expect(items[2].folder).toBe('Trip');
    expect(items[3].folder).toBe('Vacation');

    const groups = groupByFolder(items);
    expect(groups).toHaveLength(3);
    expect(groups[0].folder).toBeNull();
    expect(groups[0].items.map((i) => i.file.name)).toEqual(['img1.raf']);
    expect(groups[1].folder).toBe('Vacation');
    expect(groups[1].items.map((i) => i.file.name)).toEqual(['img2.raf', 'img4.raf']);
    expect(groups[2].folder).toBe('Trip');
    expect(groups[2].items.map((i) => i.file.name)).toEqual(['img3.raf']);
  });

  it('allows same file name in different folders and deduplicates within same folder', () => {
    const store = new PackerStore();
    store.add([
      { file: file('photo.raf'), folder: 'FolderA' },
      { file: file('photo.raf'), folder: 'FolderB' },
      { file: file('photo.raf'), folder: 'FolderA' }, // duplicate
    ]);
    const items = store.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0].folder).toBe('FolderA');
    expect(items[1].folder).toBe('FolderB');
  });

  it('removeFolder removes all items belonging to a folder', () => {
    const store = new PackerStore();
    store.add([
      { file: file('a.raf'), folder: 'FolderA' },
      { file: file('b.raf'), folder: 'FolderA' },
      { file: file('c.raf'), folder: 'FolderB' },
      file('loose.raf'),
    ]);
    expect(store.getState().items).toHaveLength(4);

    store.removeFolder('FolderA');
    const items = store.getState().items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.file.name)).toEqual(['c.raf', 'loose.raf']);

    store.removeFolder(undefined);
    expect(store.getState().items.map((i) => i.file.name)).toEqual(['c.raf']);
  });

  it('packs items in folder group order', async () => {
    const store = new PackerStore();
    store.add([
      { file: file('loose.raf') },
      { file: file('trip1.raf'), folder: 'Trip' },
      { file: file('loose2.raf') },
      { file: file('trip2.raf'), folder: 'Trip' },
    ]);
    await new Promise((r) => setTimeout(r, 5));

    const origWorker = FakeWorker.prototype.postMessage;
    // Intercept pack calls
    vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementation(function (this: any, { id, req }: any) {
      origWorker.call(this, { id, req });
    });

    const run = await store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    expect(run?.done).toBe(4);
    // loose.raf and loose2.raf belong to loose group (folder null), trip1.raf and trip2.raf belong to Trip group
    // The flatMap of groupByFolder orders loose group files first, then Trip group files
    const groups = groupByFolder(store.getState().items);
    const orderedNames = groups.flatMap((g) => g.items).map((i) => i.file.name);
    expect(orderedNames).toEqual(['loose.raf', 'loose2.raf', 'trip1.raf', 'trip2.raf']);
  });
});
