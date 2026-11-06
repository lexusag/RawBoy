import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/common/files', () => ({ localFolder: vi.fn(), saveBlob: vi.fn() }));

import { folderOf, groupByFolder, PackerStore } from './PackerStore';
import { DEFAULT_SETTINGS } from './settings';

const info = (format: string) => ({ make: 'Fuji', model: 'X', format }) as unknown;

const ops: { op: string; content?: string }[] = [];

/** Answers one message at a time, like the real worker; reading a file is slow, packing quick. */
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private busy: Promise<void> = Promise.resolve();
  postMessage({ id, req }: { id: number; req: { op: string; bytes?: ArrayBuffer } }) {
    this.busy = this.busy.then(async () => {
      const content = req.bytes ? new TextDecoder().decode(req.bytes) : undefined;
      ops.push({ op: req.op, content });
      await new Promise((r) => setTimeout(r, req.op === 'inspect' ? 30 : 1));
      const result = req.op === 'init' ? null : req.op === 'inspect' ? info('inspected') : { dng: new Uint8Array(10), info: info('packed') };
      this.onmessage?.({ data: { id, ok: true, result } } as MessageEvent);
    });
  }
  terminate() {}
}

const file = (name: string, content = name, lastModified = Date.now()) =>
  new File([new TextEncoder().encode(content)], name, { lastModified });

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
    expect(ops.filter((o) => o.op === 'inspect')).toHaveLength(1);
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

  it('packs items in folder group order following first appearance', async () => {
    const store = new PackerStore();
    // Trip added first, loose file second, Trip file third, loose file fourth
    store.add([
      { file: file('trip1.raf', 'trip1'), folder: 'Trip' },
      { file: file('loose1.raf', 'loose1') },
      { file: file('trip2.raf', 'trip2'), folder: 'Trip' },
      { file: file('loose2.raf', 'loose2') },
    ]);
    await new Promise((r) => setTimeout(r, 5));

    const run = await store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    expect(run?.done).toBe(4);

    // With filesAtOnce: 1, pack calls arrive at the worker in folder group order.
    // Trip appeared first, so all Trip items pack first, followed by all loose items.
    const packed = ops.filter((o) => o.op === 'pack').map((o) => o.content);
    expect(packed).toEqual(['trip1', 'trip2', 'loose1', 'loose2']);
  });

  it('does not merge or deduplicate files from different folders with the same name', () => {
    const store = new PackerStore();
    const f1 = file('DSC001.ARW');
    Object.defineProperty(f1, 'webkitRelativePath', { value: 'A/DCIM/DSC001.ARW' });
    const f2 = file('DSC001.ARW');
    Object.defineProperty(f2, 'webkitRelativePath', { value: 'B/DCIM/DSC001.ARW' });

    store.add([f1, f2]);
    const items = store.getState().items;
    expect(items).toHaveLength(2);
    expect(items[0].folder).toBe('A/DCIM');
    expect(items[1].folder).toBe('B/DCIM');

    const groups = groupByFolder(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].folder).toBe('A/DCIM');
    expect(groups[1].folder).toBe('B/DCIM');
  });

  it('defaults to sort by shoot date, with option to sort by name', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    });

    const store = new PackerStore();
    expect(store.getState().sort).toBe('date');

    store.setSort('name');
    expect(store.getState().sort).toBe('name');
    expect(storage.get('rawboy.packer.sort')).toBe('name');

    store.setSort('date');
    expect(store.getState().sort).toBe('date');
    expect(storage.get('rawboy.packer.sort')).toBe('date');
  });

  it('sorts files by shoot date by default and by name when chosen', async () => {
    const store = new PackerStore();
    const d1 = new Date(2026, 9, 1, 10, 0, 0).getTime();
    const d2 = new Date(2026, 9, 1, 12, 0, 0).getTime();
    const d3 = new Date(2026, 9, 1, 8, 0, 0).getTime();

    const f1 = file('IMG_10.CR3', 'content10', d2); // 12:00
    const f2 = file('IMG_2.CR3', 'content2', d1);   // 10:00
    const f3 = file('IMG_1.CR3', 'content1', d3);   // 08:00

    store.add([f1, f2, f3]);

    // By default, sorted by shoot date (08:00, 10:00, 12:00 -> IMG_1, IMG_2, IMG_10)
    let groups = groupByFolder(store.getState().items, store.getState().sort);
    expect(groups[0].items.map((i) => i.file.name)).toEqual(['IMG_1.CR3', 'IMG_2.CR3', 'IMG_10.CR3']);

    // Packing proceeds in shoot date order
    const run = await store.start({ ...DEFAULT_SETTINGS, filesAtOnce: 1 }, { kind: 'downloads' });
    expect(run?.done).toBe(3);
    const packed = ops.filter((o) => o.op === 'pack').map((o) => o.content);
    expect(packed).toEqual(['content1', 'content2', 'content10']);

    // Test with file names where name order differs from shoot date order
    const store2 = new PackerStore();
    const a = file('A.CR3', 'contentA', d2); // 12:00
    const z = file('Z.CR3', 'contentZ', d3); // 08:00
    store2.add([a, z]);

    // Default 'date': Z (08:00) before A (12:00)
    expect(groupByFolder(store2.getState().items, store2.getState().sort)[0].items.map((i) => i.file.name)).toEqual(['Z.CR3', 'A.CR3']);

    // Switched to 'name': A before Z
    store2.setSort('name');
    expect(groupByFolder(store2.getState().items, store2.getState().sort)[0].items.map((i) => i.file.name)).toEqual(['A.CR3', 'Z.CR3']);
  });

  it('updates item dates and reorders when EXIF capture date is read', async () => {
    const text = (s: string) => new TextEncoder().encode(s);
    const le16 = (v: number) => [v & 255, (v >> 8) & 255];
    const le32 = (v: number) => [...le16(v & 0xffff), ...le16(v >>> 16)];

    const tiffBytes = (ifd0Date: string, exifDate?: string): Uint8Array => {
      const d0 = [...text(ifd0Date), 0];
      const d1 = exifDate ? [...text(exifDate), 0] : [];
      const n0 = exifDate ? 2 : 1;
      const ifd0At = 8;
      const exifAt = ifd0At + 2 + n0 * 12 + 4;
      const exifSize = exifDate ? 2 + 12 + 4 : 0;
      const d0At = exifAt + exifSize;
      const d1At = d0At + d0.length;
      const out = [0x49, 0x49, 42, 0, ...le32(ifd0At), ...le16(n0), ...le16(0x0132), ...le16(2), ...le32(d0.length), ...le32(d0At)];
      if (exifDate) out.push(...le16(0x8769), ...le16(4), ...le32(1), ...le32(exifAt));
      out.push(...le32(0));
      if (exifDate) out.push(...le16(1), ...le16(0x9003), ...le16(2), ...le32(d1.length), ...le32(d1At), ...le32(0));
      out.push(...d0, ...d1);
      return new Uint8Array(out);
    };

    const store = new PackerStore();
    // f1 was modified later (12:00) but shot earlier in EXIF (07:00)
    const f1Bytes = tiffBytes('2026:10:01 12:00:00', '2026:10:01 07:00:00');
    const f1 = new File([f1Bytes], 'B.dng', { lastModified: new Date(2026, 9, 1, 12, 0, 0).getTime() });

    // f2 was modified earlier (10:00) and shot at 10:00 in EXIF
    const f2Bytes = tiffBytes('2026:10:01 10:00:00', '2026:10:01 10:00:00');
    const f2 = new File([f2Bytes], 'A.dng', { lastModified: new Date(2026, 9, 1, 10, 0, 0).getTime() });

    store.add([f1, f2]);

    // Give readDates a moment to complete
    await new Promise((r) => setTimeout(r, 20));

    // f1 (07:00:00) should now be before f2 (10:00:00) despite f2 having an earlier lastModified and earlier name
    const groups = groupByFolder(store.getState().items, store.getState().sort);
    expect(groups[0].items.map((i) => i.file.name)).toEqual(['B.dng', 'A.dng']);
    expect(groups[0].items[0].date).toBe('2026:10:01 07:00:00');
    expect(groups[0].items[1].date).toBe('2026:10:01 10:00:00');
  });
});
