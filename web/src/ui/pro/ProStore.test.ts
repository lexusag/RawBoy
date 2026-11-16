import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { developParams, type DevelopParams } from '../../engine/develop/DevelopParams';
import { newLightLeak } from '../../engine/develop/LightLeaks';
import { ProStore } from './ProStore';

beforeEach(() => {
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

function setupStore() {
  const store = new ProStore();
  let defaults = developParams({ temperature: 5500, tint: 10 });
  vi.spyOn(store.session, 'open').mockImplementation(async (file, initial) => {
    const params = initial(defaults);
    const name = 'name' in file ? file.name : 'photo';
    return { description: `${name} · 100 ISO`, params, defaults };
  });
  vi.spyOn(store.session, 'setParams').mockImplementation(() => {});
  vi.spyOn(store.session, 'selectLut').mockImplementation(() => {});
  vi.spyOn(store.session, 'selectFilm').mockImplementation(() => {});
  return {
    store,
    setNextDefaults: (d: Partial<DevelopParams>) => {
      defaults = developParams(d);
    },
  };
}

describe('ProStore.copyPreviousEdits', () => {
  it('is a no-op before a second photo is opened', async () => {
    const { store } = setupStore();
    store.copyPreviousEdits();
    expect(store.state.previousFileName).toBeNull();

    await store.open(new File([], 'first.dng'));
    expect(store.state.previousFileName).toBeNull();
    store.update({ ...store.state.params, exposure: 1.5 });
    store.copyPreviousEdits();
    expect(store.state.params.exposure).toBe(1.5);
  });

  it('copies edits from the previous photo as one undo step, keeping the current photo geometry and local tools', async () => {
    const { store, setNextDefaults } = setupStore();
    await store.open(new File([], 'first.dng'));
    store.update({ ...store.state.params, exposure: 1.25, contrast: 20, film: 'portra400' });

    setNextDefaults({ temperature: 6500, tint: -5 });
    const leak = newLightLeak(0.5, 0.5, 'glow');
    const secondParams = developParams({
      temperature: 6500,
      tint: -5,
      exposure: -0.5,
      rotation: 1,
      cropLeft: 0.1,
      cropTop: 0.1,
      cropRight: 0.9,
      cropBottom: 0.9,
      leaks: [leak],
    });
    await store.open(new File([], 'second.dng'), secondParams);

    expect(store.state.previousFileName).toBe('first.dng');
    expect(store.state.params.exposure).toBe(-0.5);

    store.copyPreviousEdits();

    expect(store.state.params.exposure).toBe(1.25);
    expect(store.state.params.contrast).toBe(20);
    expect(store.state.params.film).toBe('portra400');
    // White balance was not edited on first.dng, so second.dng keeps its own as-shot WB.
    expect(store.state.params.temperature).toBe(6500);
    expect(store.state.params.tint).toBe(-5);
    // Geometry and local tools on second.dng are preserved.
    expect(store.state.params.rotation).toBe(1);
    expect(store.state.params.cropLeft).toBe(0.1);
    expect(store.state.params.leaks).toEqual([leak]);
    expect(store.state.message).toBe('Copied edits from first.dng');
    expect(store.state.canUndo).toBe(true);

    store.undo();
    expect(store.state.params.exposure).toBe(-0.5);
  });

  it('copies white balance when the user changed it on the previous photo', async () => {
    const { store, setNextDefaults } = setupStore();
    await store.open(new File([], 'first.dng'));
    store.update({ ...store.state.params, temperature: 4800, tint: 18 });

    setNextDefaults({ temperature: 6500, tint: -5 });
    await store.open(new File([], 'second.dng'), developParams({ temperature: 6500, tint: -5 }));
    store.copyPreviousEdits();

    expect(store.state.params.temperature).toBe(4800);
    expect(store.state.params.tint).toBe(18);
  });

  it('keeps the previous photo when the current photo is reopened', async () => {
    const { store } = setupStore();
    await store.open(new File([], 'first.dng'));
    store.update({ ...store.state.params, exposure: 1.5 });

    await store.open(new File([], 'second.dng'), developParams({ exposure: 0 }));
    expect(store.state.previousFileName).toBe('first.dng');

    // Reopening second.dng (e.g. from Auto) should not overwrite first.dng as the previous photo.
    await store.open(new File([], 'second.dng'), developParams({ exposure: -0.75 }));
    expect(store.state.previousFileName).toBe('first.dng');

    store.copyPreviousEdits();
    expect(store.state.params.exposure).toBe(1.5);
  });
});
