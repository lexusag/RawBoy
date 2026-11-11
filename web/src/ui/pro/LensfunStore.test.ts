import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoMetadata } from '../../worker/protocol';
import { LensfunStore } from './LensfunStore';

const dir = resolve(__dirname, '../../../public/lensfun');

const meta = (over: Partial<PhotoMetadata>): PhotoMetadata =>
  ({ make: 'FUJIFILM', model: 'X-T3', lensMake: '', lensModel: 'XF18-55mmF2.8-4 R LM OIS', focalLength: 18, focalLength35mm: 27, fNumber: 4, ...over }) as PhotoMetadata;

interface Applied { warp: unknown; vignette: unknown; label: string }
const fakeSession = () => {
  const applied: (Applied | null)[] = [];
  return { applied, session: { hasImage: true, setLensfun: (p: Applied | null) => applied.push(p), state: {} } as never };
};

const settle = async (store: LensfunStore) => {
  for (let i = 0; i < 50 && (store.state.loading || store.state.db == null); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
};

beforeEach(() => {
  vi.stubGlobal('fetch', async (u: string) => {
    const file = new URL(u).pathname.split('/lensfun/')[1];
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(resolve(dir, file), 'utf8')) };
  });
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

describe('LensfunStore', () => {
  it('does nothing until switched on, then matches the photo and applies a profile', async () => {
    const { session, applied } = fakeSession();
    const store = new LensfunStore(session);
    store.photoOpened(meta({}));
    await settle(store);
    expect(store.state.db).toBeNull();
    expect(applied.at(-1)).toBeNull();

    store.setEnabled(true);
    await settle(store);
    expect(store.state.camera?.model).toBe('X-T3');
    expect(store.state.lens?.model).toMatch(/18-55/);
    expect(store.state.applied).toMatch(/distortion/);
    expect(applied.at(-1)?.warp).not.toBeNull();
  });

  it('reports a lens the database does not know, and takes a manual pick', async () => {
    const { session, applied } = fakeSession();
    const store = new LensfunStore(session);
    store.setEnabled(true);
    store.photoOpened(meta({ lensModel: 'Mystery 33mm F1.1' }));
    await settle(store);
    expect(store.state.noMatch).toBe(true);
    expect(applied.at(-1)).toBeNull();

    store.setMode('manual');
    await settle(store);
    store.pickLens(store.state.db!.lenses.find((l) => /18-55mm f\/2\.8-4/i.test(l.model) && l.mounts.includes('Fujifilm X'))!);
    await settle(store);
    expect(applied.at(-1)?.warp).not.toBeNull();
  });

  it('applies a generic lens with coefficients and remembers it', async () => {
    const { session, applied } = fakeSession();
    const store = new LensfunStore(session);
    store.setEnabled(true);
    store.setMode('generic');
    store.photoOpened(meta({ lensModel: '', focalLength: 0, focalLength35mm: 0, fNumber: 0 }));
    await settle(store);
    expect(applied.at(-1)).toBeNull();
    store.setGeneric({ crop: 1.5, focal: 12, aperture: 2, a: 0.01, k1: -0.4 });
    await settle(store);
    expect(applied.at(-1)?.vignette).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('rawboy.pro.lensfun')!).generic.focal).toBe(12);
  });

  it('gives the field of view of a generic fisheye', async () => {
    const { session } = fakeSession();
    const store = new LensfunStore(session);
    store.setEnabled(true);
    store.setMode('generic');
    store.photoOpened(meta({ lensModel: '', focalLength: 0, focalLength35mm: 0, fNumber: 0 }));
    await settle(store);
    store.setGeneric({ crop: 1, focal: 15, type: 'fisheye' });
    await settle(store);
    expect(store.state.fisheyeFov).toBeCloseTo(165, 0);
  });
});
