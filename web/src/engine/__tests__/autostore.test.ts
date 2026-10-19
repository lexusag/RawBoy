import { describe, expect, it, vi } from 'vitest';

// The store's analysis needs the WASM decoder; these tests only add photos, so it is stubbed out.
vi.mock('../auto/AutoAnalysis', () => ({ analyzeFile: () => new Promise(() => {}) }));

const { AutoStore, nonRawNote } = await import('../../ui/auto/AutoStore');

describe('Auto import mode', () => {
  it('new photos start in the import mode; photos already added keep theirs', () => {
    const store = new AutoStore();
    expect(store.state.importMode).toBe('looks');
    store.add([new File(['a'], 'a.CR2')]);
    store.setImportMode('film');
    store.add([new File(['b'], 'b.CR2')]);
    expect(store.state.photos.map((p) => [p.name, p.mode])).toEqual([['a.CR2', 'looks'], ['b.CR2', 'film']]);
  });

  it('"As is" adds plain photos in Looks mode, with no non-RAW note; they develop as the file, a preset adds only its own', async () => {
    const { lookName, paramsOf } = await import('../../ui/auto/AutoStore');
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const store = new AutoStore();
    store.setImportMode('plain');
    store.add([new File(['t'], 'scan.tif')]);
    expect(store.state.message).toBeNull();
    const [p] = store.state.photos;
    expect([p.mode, p.plain]).toEqual(['looks', true]);
    // A plain analysis's auto develop is the as-shot defaults (AutoAnalysis skips autoDevelop).
    const defaults = developParams({ displaySource: true, temperature: 6504 });
    const analysed = { ...p, analysis: { defaults, autoBase: defaults, stats: { hasFace: false } } } as unknown as typeof p;
    expect(lookName(analysed)).toBe('As is');
    expect(paramsOf(analysed)).toEqual(defaults);
    const grain = capturePreset('Grain', developParams({ grain: 30, contrast: 10 }), ['detail']);
    const withGrain = paramsOf({ ...analysed, preset: grain })!;
    expect(withGrain.grain).toBe(30);
    expect({ ...withGrain, grain: 0 }).toEqual({ ...defaults, grain: 0 });
    expect(lookName({ ...analysed, preset: grain })).toBe('Grain'); // a plain photo's label is the preset alone
  });
});

describe('Non-RAW import note', () => {
  it('shows only when an import includes JPEG, HEIC, PNG or TIFF files', () => {
    expect(nonRawNote(['a.CR2', 'b.dng'])).toBeNull();
    expect(nonRawNote(['a.CR2', 'b.JPG'])).toMatch(/^1 photo isn't RAW: .*lower quality/);
    expect(nonRawNote(['a.heic', 'b.png', 'c.tif'])).toMatch(/^3 photos aren't RAW/);
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2')]);
    expect(store.state.message).toBeNull();
    store.add([new File(['b'], 'b.jpeg')]);
    expect(store.state.message).toMatch(/lower quality/);
  });
});

describe('Pro film tone mapper', () => {
  it('AgX/Filmic/Sigmoid turn the film off; Film brings the last stock back at full strength', async () => {
    const { ProStore } = await import('../../ui/pro/ProStore');
    const store = new ProStore();
    store.selectFilm('vision500t');
    expect(store.state.params).toMatchObject({ film: 'vision500t', filmAmount: 100 });
    store.update({ ...store.state.params, filmAmount: 40 });
    store.setToneMapper('filmic');
    expect(store.state.params).toMatchObject({ film: null, toneMapper: 'filmic' });
    store.useFilm();
    expect(store.state.params).toMatchObject({ film: 'vision500t', filmAmount: 100, toneMapper: 'filmic' });
  });
});

describe('Auto batch rotate', () => {
  it('turns every selected analysed photo, wrapping at four quarter turns', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')]);
    // Analysis is stubbed out, so mark the photos analysed by hand (rotate skips unanalysed ones).
    const { developParams } = await import('../develop/DevelopParams');
    const analysis = { autoBase: developParams(), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p, i) => ({ ...p, analysis: i < 2 ? analysis : null }));
    const ids = new Set(store.state.photos.map((p) => p.id));
    store.rotate(ids, -1);
    store.rotate(new Set([store.state.photos[0].id]), 2);
    expect(store.state.photos.map((p) => p.adjust.rotation)).toEqual([1, 3, 0]);
    vi.unstubAllGlobals();
  });
});

describe('Auto batch preset', () => {
  it('develops every photo, and photos added later, with all the preset holds; removing it brings the looks back', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { paramsOf } = await import('../../ui/auto/AutoStore');
    const edited = developParams({
      exposure: 0.7, contrast: 20, lut: 'asset:luts/x.cube', lutAmount: 60, lensProfile: false, lensDistortion: 25,
      vignetteAmount: 30, vignetteMidpoint: 70, sharpening: 40, temperature: 4000,
    });
    const preset = capturePreset('Street', edited, ['light', 'lut', 'lens', 'detail']);
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2')]);
    const autoBase = developParams({ exposure: 1.2, temperature: 5600, denoise: 20 });
    const analysis = { autoBase, stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis }));
    store.applyPresetToAll(preset);
    store.add([new File(['b'], 'b.CR2')]);
    expect(store.state.photos.map((p) => p.preset?.name)).toEqual(['Street', 'Street']);
    const a = store.state.photos[0];
    expect(paramsOf(a)).toMatchObject({
      exposure: 0.7, contrast: 20, lut: 'asset:luts/x.cube', lutAmount: 60, lensProfile: false, lensDistortion: 25,
      vignetteAmount: 30, vignetteMidpoint: 70,
      temperature: 5600, // white balance wasn't in the preset: the auto develop's stays
      denoise: 20, sharpening: autoBase.sharpening, // noise settings are this photo's, never the preset's
    });
    // Auto's own controls still work on top.
    store.setAdjust(a.id, { brightness: 100, grain: 10 });
    expect(paramsOf(store.state.photos[0])).toMatchObject({ exposure: 3.7, grain: edited.grain + 10 });
    store.removePreset();
    expect(store.state.preset).toBeNull();
    expect(paramsOf(store.state.photos[0])?.lut).not.toBe('asset:luts/x.cube');
    vi.unstubAllGlobals();
  });
});

describe('Auto partial preset', () => {
  it('a preset without Light changes only its groups, on top of the look, a preset or RawBoy edits, and reaches the sidecar', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { applyLook, NO_ADJUSTMENTS } = await import('../auto/looks/LookApplier');
    const { Looks } = await import('../auto/looks/Look');
    const { decodeAuto } = await import('../../ui/auto/AutoSidecar');
    const { lookName, paramsOf } = await import('../../ui/auto/AutoStore');
    const grain = capturePreset('Grain', developParams({ grain: 60, grainSize: 40, sharpening: 33, denoise: 12, contrast: 50 }), ['detail']);
    const scene = capturePreset('Scene A', developParams({ contrast: 30, grain: 5, temperature: 4000 }), ['light', 'whiteBalance', 'detail']);
    const writes: string[] = [];
    const sidecar = { name: 'a.xmp', read: async () => null, write: async (t: string | null) => void writes.push(t!) };
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')], [sidecar, null, null]);
    const autoBase = developParams({ exposure: 0.8, denoise: 40, sharpening: 10 });
    const analysis = { autoBase, defaults: developParams(), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis }));
    const [a, b, c] = store.state.photos;
    store.setLook(a.id, Looks.PORTRA_400);
    store.applyPresetTo(scene, new Set([b.id]));
    store.receiveEdits(c.file, developParams({ exposure: 1.5, contrast: -20 }), c.id);
    store.applyPresetToAll(grain);

    // On a look: the look stays (LUT, contrast, Strength), Detail is all the preset's (its bloom too), denoise and
    // sharpening included.
    const [pa, pb, pc] = store.state.photos;
    const look = applyLook(autoBase, Looks.PORTRA_400, 100, NO_ADJUSTMENTS, false);
    expect(look.bloom).toBeGreaterThan(0);
    expect(paramsOf(pa)).toEqual({ ...look, ...grain.values });
    expect(paramsOf(pa)).toMatchObject({ grain: 60, grainSize: 40, sharpening: 33, denoise: 12, bloom: 0, contrast: look.contrast });
    expect(lookName(pa)).toBe(`${Looks.PORTRA_400.name} + Grain`);
    // On a preset: its Light and white balance stay, its Detail gives way.
    expect(pb.preset?.name).toBe('Scene A + Grain');
    expect(paramsOf(pb)).toMatchObject({ contrast: 30, temperature: 4000, grain: 60, grainSize: 40 });
    // On RawBoy edits: they stay, with the preset's Detail.
    expect(pc.edits).toMatchObject({ exposure: 1.5, contrast: -20, grain: 60, sharpening: 33 });
    expect(paramsOf(pc)).toMatchObject({ exposure: 1.5, contrast: -20, grain: 60 });
    // Auto's own Grain still works on top.
    store.setAdjust(pa.id, { grain: 10 });
    expect(paramsOf(store.state.photos[0])!.grain).toBe(70);

    // The photo with a sidecar keeps the preset there and comes back with the same develop.
    await store.flushSidecars();
    const saved = decodeAuto(writes.at(-1)!)!;
    expect(saved.preset).toMatchObject({ name: 'Grain', groups: ['detail'] });
    expect(saved.look.id).toBe(Looks.PORTRA_400.id);
    const back = { ...store.state.photos[0], ...saved };
    expect(paramsOf(back)).toEqual(paramsOf(store.state.photos[0]));

    // Removing the batch preset takes off the layered one too: photos keep their look, preset and edits.
    store.removePreset();
    expect(store.state.photos.map((p) => p.preset?.name ?? null)).toEqual([null, 'Scene A + Grain', null]);
    expect(paramsOf(store.state.photos[0])!.grain).toBe(look.grain + 10);
    vi.unstubAllGlobals();
  });

  it('joins the batch preset, which photos added later get', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const day = capturePreset('Day', developParams({ contrast: 10 }), ['light']);
    const grain = capturePreset('Grain', developParams({ grain: 60 }), ['detail']);
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2')]);
    store.applyPresetToAll(day);
    store.applyPresetToAll(grain);
    store.add([new File(['b'], 'b.CR2')]);
    expect(store.state.preset?.name).toBe('Day + Grain');
    expect(store.state.photos.map((p) => p.preset?.name)).toEqual(['Day + Grain', 'Day + Grain']);
    expect(store.state.photos[0].preset).toBe(store.state.preset);
    store.removePreset();
    expect(store.state.photos.map((p) => p.preset)).toEqual([null, null]);
    vi.unstubAllGlobals();
  });
});

describe('Auto preset per scene', () => {
  it('a selection gets its own preset; removing the batch preset leaves it alone', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { paramsOf } = await import('../../ui/auto/AutoStore');
    const day = capturePreset('Day', developParams({ contrast: 10, denoise: 0 }), ['light', 'detail']);
    const night = capturePreset('Night', developParams({ contrast: 40, denoise: 5 }), ['light', 'detail']);
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')]);
    const analysis = { autoBase: developParams({ denoise: 55 }), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis }));
    store.applyPresetToAll(day);
    const [, b, c] = store.state.photos;
    store.applyPresetTo(night, new Set([b.id, c.id]));
    expect(store.state.message).toBe('Night applied to 2 photos');
    expect(store.state.photos.map((p) => p.preset?.name)).toEqual(['Day', 'Night', 'Night']);
    expect(paramsOf(store.state.photos[1])).toMatchObject({ contrast: 40, denoise: 55 });
    store.add([new File(['d'], 'd.CR2')]);
    expect(store.state.photos[3].preset?.name).toBe('Day'); // photos added later get the batch preset
    store.removePreset();
    expect(store.state.photos.map((p) => p.preset?.name ?? null)).toEqual([null, 'Night', 'Night', null]);
    vi.unstubAllGlobals();
  });
});

describe('Auto apply to all', () => {
  it('gives every photo the look, including photos not analysed yet, which then keep it', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const { developParams } = await import('../develop/DevelopParams');
    const { ALL_LOOKS } = await import('../auto/looks/Look');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')]);
    const analysis = { autoBase: developParams(), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p, i) => ({ ...p, analysis: i === 0 ? analysis : null }));
    const source = store.state.photos[0];
    const look = ALL_LOOKS[ALL_LOOKS.length - 1];
    store.setLook(source.id, look);
    store.setStrength(source.id, 40);
    store.applyLookToAll(source.id);
    for (const p of store.state.photos.slice(1)) {
      expect(p).toMatchObject({ look, strength: 40, looksApplied: true, analysis: null });
    }
    vi.unstubAllGlobals();
  });
});

describe('Auto: opening a waiting photo', () => {
  it('analyses a clicked waiting photo next, ahead of the rest, then opens it', async () => {
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')]);
    const [a, b, c] = store.state.photos;
    await new Promise((r) => setTimeout(r, 0));
    // a is being analysed (the stubbed analysis never ends); a click on c makes it next instead of b.
    expect(store.state.photos.map((p) => p.status)).toEqual(['analyzing', 'queued', 'queued']);
    const s = store as unknown as { nextQueued: () => { id: string } | undefined; openIfWaiting: (id: string) => void };
    expect(s.nextQueued()?.id).toBe(b.id);
    store.openFromGrid(c.id);
    expect(store.state.opening).toBe(c.id);
    expect(s.nextQueued()?.id).toBe(c.id);
    const opened: string[] = [];
    store.openDetail = (id: string) => void opened.push(id);
    s.openIfWaiting(a.id); // another photo finishing doesn't open anything
    expect([opened, store.state.opening]).toEqual([[], c.id]);
    s.openIfWaiting(c.id);
    expect([opened, store.state.opening]).toEqual([[c.id], null]);
    // Removed while waiting: nothing is waiting to open any more.
    store.openFromGrid(c.id);
    store.remove(new Set([c.id]));
    expect(store.state.opening).toBeNull();
  });
});
