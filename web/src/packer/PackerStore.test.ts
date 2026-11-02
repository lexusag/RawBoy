import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/common/files', () => ({ localFolder: vi.fn(), saveBlob: vi.fn() }));

import { PackerStore } from './PackerStore';
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
});
