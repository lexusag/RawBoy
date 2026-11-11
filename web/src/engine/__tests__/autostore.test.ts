import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

// The store's analysis needs the WASM decoder; these tests only add photos, so it is stubbed out.
vi.mock('../auto/AutoAnalysis', () => ({ decodeForAnalysis: () => new Promise(() => {}), finishAnalysis: () => new Promise(() => {}) }));

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

  it('stepFilm enables lastFilm on the first notch when off and cycles through stocks clamped at both ends', async () => {
    const { ProStore } = await import('../../ui/pro/ProStore');
    const { FILM_STOCKS } = await import('../auto/looks/FilmLooks');
    const store = new ProStore();
    expect(store.state.params.film).toBeNull();

    // First notch when off turns Film on at the initial stock (Portra 400 = FILM_STOCKS[0])
    store.stepFilm(1);
    expect(store.state.params.film).toBe(FILM_STOCKS[0].id);
    expect(store.state.params.filmAmount).toBe(100);

    // Next notches step forward through stocks
    store.stepFilm(1);
    expect(store.state.params.film).toBe(FILM_STOCKS[1].id);
    store.stepFilm(1);
    expect(store.state.params.film).toBe(FILM_STOCKS[2].id);

    // Stepping backward
    store.stepFilm(-1);
    expect(store.state.params.film).toBe(FILM_STOCKS[1].id);

    // Clamps at start
    store.stepFilm(-10);
    expect(store.state.params.film).toBe(FILM_STOCKS[0].id);

    // Clamps at end
    store.stepFilm(100);
    expect(store.state.params.film).toBe(FILM_STOCKS[FILM_STOCKS.length - 1].id);

    // Turning off with tone mapper remembers the stock; first notch back turns it on at that stock
    store.setToneMapper('agx');
    expect(store.state.params.film).toBeNull();
    store.stepFilm(-1);
    expect(store.state.params.film).toBe(FILM_STOCKS[FILM_STOCKS.length - 1].id);
    store.stepFilm(-1);
    expect(store.state.params.film).toBe(FILM_STOCKS[FILM_STOCKS.length - 2].id);
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
      denoise: 20, sharpening: autoBase.sharpening, // noise settings are this photo's: the preset has no Denoise group
    });
    // Auto's own controls still work on top.
    store.setAdjust(a.id, { brightness: 100, grain: 10 });
    expect(paramsOf(store.state.photos[0])).toMatchObject({ exposure: 3.7, grain: edited.grain + 10 });
    store.removePreset();
    expect(store.state.preset).toBeNull();
    expect(paramsOf(store.state.photos[0])?.lut).not.toBe('asset:luts/x.cube');
    vi.unstubAllGlobals();
  });

  it('applies a preset to a single open photo without changing the rest of the batch', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2')]);
    const analysis = { autoBase: developParams({ exposure: 1.0 }), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis }));
    const [a] = store.state.photos;
    store.openDetail(a.id);
    expect(store.state.selected).toBe(a.id);

    const preset = capturePreset('Portrait Soft', developParams({ contrast: -10 }), ['light']);
    store.applyPresetTo(preset, new Set([a.id]));
    expect(store.state.photos[0].preset?.name).toBe('Portrait Soft');
    expect(store.state.photos[1].preset).toBeNull();
    expect(store.state.message).toBe('Portrait Soft applied to 1 photo');

    store.removePhotoPreset(a.id);
    expect(store.state.photos[0].preset).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('Auto preset denoise', () => {
  it('a preset with Denoise & sharpening sets them in place of the measured ones, Light or not', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { paramsOf } = await import('../../ui/auto/AutoStore');
    const look = developParams({ contrast: 20, denoise: 16, colorDenoise: 80, sharpening: 15 });
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2')]);
    const analysis = { autoBase: developParams({ denoise: 16, colorDenoise: 28, sharpening: 10 }), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { analysis: unknown }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis }));
    const [a, b] = store.state.photos;
    store.applyPresetTo(capturePreset('With', look, ['light', 'detail', 'denoise']), new Set([a.id]));
    store.applyPresetTo(capturePreset('Without', look, ['light', 'detail']), new Set([b.id]));
    expect(paramsOf(store.state.photos[0])).toMatchObject({ contrast: 20, denoise: 16, colorDenoise: 80, sharpening: 15 });
    expect(paramsOf(store.state.photos[1])).toMatchObject({ contrast: 20, denoise: 16, colorDenoise: 28, sharpening: 10 });
    store.setAdjust(a.id, { denoise: 10 });
    // Denoise +10 is mostly colour denoise.
    expect(paramsOf(store.state.photos[0])!.denoise).toBeCloseTo(16.6, 9);
    expect(paramsOf(store.state.photos[0])!.colorDenoise).toBeCloseTo(99, 9);
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
    const grain = capturePreset('Grain', developParams({ grain: 60, grainSize: 40, sharpening: 33, denoise: 12, contrast: 50 }), ['detail', 'denoise']);
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
    expect(saved.preset).toMatchObject({ name: 'Grain', groups: ['detail', 'denoise'] });
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

describe('Auto denoise all', () => {
  it('gives every photo its own auto denoise over the slider, presets and RawBoy edits; the rest stays', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 }); // thumbnails aren't rendered here
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { paramsOf } = await import('../../ui/auto/AutoStore');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2'), new File(['d'], 'd.CR2')]);
    const analysis = (denoise: number) => ({
      defaults: developParams(),
      autoBase: developParams({ denoise, colorDenoise: denoise + 10, sharpening: 12 }),
      stats: { hasFace: false },
    });
    // Look + Grain + Denoise preset (both groups); Denoise-only preset; RawBoy edits; plain slider.
    const mixed = capturePreset('Mixed', developParams({ grain: 40, denoise: 70, colorDenoise: 70, sharpening: 30 }), ['detail', 'denoise']);
    const onlyDenoise = capturePreset('Smooth', developParams({ denoise: 90 }), ['denoise']);
    const edits = developParams({ exposure: 1.5, denoise: 80, colorDenoise: 80, sharpening: 40 });
    const s = store as unknown as { _state: { photos: object[]; preset: unknown } };
    s._state.preset = mixed;
    s._state.photos = s._state.photos.map((p, i) => ({
      ...p,
      analysis: analysis(10 * (i + 1)),
      preset: i === 0 ? mixed : i === 1 ? onlyDenoise : null,
      edits: i === 2 ? edits : null,
      adjust: { ...(p as { adjust: object }).adjust, denoise: 25, grain: 7 },
    }));
    store.autoDenoiseAll();
    const photos = store.state.photos;
    expect(store.state.message).toBe('Auto denoise on 4 photos');
    // Each photo's own measured values (10/20, 20/30, ...), sharpening included.
    expect(photos.map((p) => { const d = paramsOf(p)!; return [d.denoise, d.colorDenoise, d.sharpening]; }))
      .toEqual([[10, 20, 12], [20, 30, 12], [30, 40, 12], [40, 50, 12]]);
    expect(photos.every((p) => p.adjust.denoise === 0 && p.adjust.grain === 7)).toBe(true);
    // The preset keeps its other groups (shared with the batch's, still one object), a denoise-only preset is gone.
    expect(photos[0].preset).toMatchObject({ name: 'Mixed', groups: ['detail'] });
    expect(photos[0].preset!.values).not.toHaveProperty('denoise');
    expect(store.state.preset).toBe(photos[0].preset);
    expect(paramsOf(photos[0])!.grain).toBe(Math.min(100, 40 + 7));
    expect(photos[1].preset).toBeNull();
    expect(photos[2].edits).toMatchObject({ exposure: 1.5, denoise: 30, colorDenoise: 40, sharpening: 12 });
    // Undo takes it back per photo; a second run has nothing left to do.
    store.autoDenoiseAll();
    expect(store.state.message).toBe('Every photo already has its auto denoise');
    store.undo(photos[1].id);
    expect(store.state.photos[1].preset).toBe(onlyDenoise);
  });
});

describe('Auto denoise on a selection', () => {
  it('changes only the selected photos and leaves the batch preset as it is', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2'), new File(['c'], 'c.CR2')]);
    const batch = capturePreset('Smooth', developParams({ grain: 20, denoise: 90 }), ['detail', 'denoise']);
    const analysis = { defaults: developParams(), autoBase: developParams({ denoise: 15 }), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: object[]; preset: unknown } };
    s._state.preset = batch;
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis, preset: batch, adjust: { ...(p as { adjust: object }).adjust, denoise: 30 } }));
    const [a, b, c] = store.state.photos;
    store.autoDenoiseAll(new Set([a.id, c.id]));
    const [a2, b2, c2] = store.state.photos;
    expect(store.state.message).toBe('Auto denoise on 2 photos');
    expect([a2.adjust.denoise, b2.adjust.denoise, c2.adjust.denoise]).toEqual([0, 30, 0]);
    expect(a2.preset!.groups).toEqual(['detail']);
    expect(c2.preset).toBe(a2.preset);
    expect(b2.preset).toBe(batch);
    expect(store.state.preset).toBe(batch);
    store.autoDenoiseAll(new Set([a.id]));
    expect(store.state.message).toBe('This photo already has its auto denoise');
    expect(b.id).toBe(b2.id);
  });
});

describe('Auto denoise on "As is" photos', () => {
  it('gives a plain photo the ISO table\'s denoise under its preset, kept in the sidecar and undoable', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const { capturePreset } = await import('../develop/Presets');
    const { paramsOf } = await import('../../ui/auto/AutoStore');
    const { encodeAuto, decodeAuto } = await import('../../ui/auto/AutoSidecar');
    const store = new AutoStore();
    store.setImportMode('plain');
    store.add([new File(['a'], 'a.RAF')]);
    // A plain analysis: autoBase = the as-shot defaults (no denoise); stats enough for AutoTone's ISO table.
    const defaults = developParams();
    const stats = { hasFace: false, iso: 3200, key: 0.04, p5: -5, p98: -1, dynamicRange: 9, skinLuminance: 0, faceArea: 0, fractionAbove: () => 0 };
    const look = capturePreset('marfilm1', developParams({ contrast: 20, grain: 30 }), ['light', 'detail']);
    const s = store as unknown as { _state: { photos: object[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis: { defaults, autoBase: defaults, stats }, preset: look }));
    expect(paramsOf(store.state.photos[0])!.denoise).toBe(0);
    store.autoDenoiseAll();
    expect(store.state.message).toBe('Auto denoise on 1 photo');
    const p = store.state.photos[0];
    expect(p.autoDenoise).toBe(true);
    // ISO 3200 sits halfway (in stops) between the table's 1600 (20, sharpening 15) and 6400 (45, 10): colour 33; luma
    // is 0.75 of it (the share falls from 1 at ISO 1600 to 0.5 at 6400).
    expect(paramsOf(p)).toMatchObject({ denoise: 25, colorDenoise: 33, sharpening: 13, contrast: 20, grain: 30 });
    expect(decodeAuto(encodeAuto(p))!.autoDenoise).toBe(true);
    store.autoDenoiseAll();
    expect(store.state.message).toBe('Every photo already has its auto denoise');
    store.undo(p.id);
    expect(paramsOf(store.state.photos[0])!.denoise).toBe(0);
  });
});

describe('Auto export', () => {
  it('clears "Saved" (exported) status from previous export when a new export starts', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { developParams } = await import('../develop/DevelopParams');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2'), new File(['b'], 'b.CR2')]);
    const analysis = { defaults: developParams(), autoBase: developParams(), stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { id: string; analysis: unknown; status: string }[] } };
    s._state.photos = s._state.photos.map((p) => ({ ...p, analysis, status: 'exported' }));

    const mockFolder = { name: 'Exports', write: vi.fn().mockResolvedValue('a.jpg') } as unknown as import('../../ui/common/files').OutputFolder;

    let firstExportStatus: string[] = [];
    (store as unknown as { exportOne: () => Promise<Blob> }).exportOne = vi.fn().mockImplementation(async () => {
      if (firstExportStatus.length === 0) {
        firstExportStatus = store.state.photos.map((p) => p.status);
      }
      return new Blob();
    });
    (store as unknown as { save: () => Promise<string> }).save = vi.fn().mockResolvedValue('a.jpg');

    await store.exportAll(mockFolder);
    expect(firstExportStatus).toEqual(['exporting', 'ready']);
    expect(store.state.photos.every((p) => p.status === 'exported')).toBe(true);

    // Selected export clears only the selected photo's badge, keeping others
    const [p1, p2] = store.state.photos;
    s._state.photos = [
      { ...p1, status: 'exported' },
      { ...p2, status: 'exported' },
    ];
    let selectedOtherStatus: string | null = null;
    (store as unknown as { session: { export: () => Promise<Blob> } }).session.export = vi.fn().mockImplementation(async () => {
      selectedOtherStatus = store.state.photos.find((p) => p.id === p1.id)?.status ?? null;
      return new Blob();
    });
    (store as unknown as { _state: { sessionReady: string } })._state.sessionReady = p2.id;
    await store.exportSelected(mockFolder);
    expect(selectedOtherStatus).toBe('exported');
    expect(store.state.photos.find((p) => p.id === p1.id)?.status).toBe('exported');
    expect(store.state.photos.find((p) => p.id === p2.id)?.status).toBe('exported');

    // Exporting a selection of photos clears only the selected photos' badges
    s._state.photos = [
      { ...p1, status: 'exported' },
      { ...p2, status: 'exported' },
    ];
    firstExportStatus = [];
    await store.exportAll(mockFolder, new Set([p1.id]));
    expect(firstExportStatus).toEqual(['exporting', 'exported']);
    expect(store.state.photos.map((p) => p.status)).toEqual(['exported', 'exported']);
  });
});

describe('Auto white balance picker', () => {
  it('whiteBalanceAdjust solves for warmth and tint matching the target kelvin and tint', async () => {
    const { whiteBalanceAdjust, developAuto, NO_ADJUSTMENTS } = await import('../auto/looks/LookApplier');
    const { Looks } = await import('../auto/looks/Look');
    const { developParams } = await import('../develop/DevelopParams');

    const base = developParams({ temperature: 5000, tint: 0 });
    const unadjusted = developAuto(base, Looks.NATURAL, 100, NO_ADJUSTMENTS, false, null, null);

    // Target neutral grey with same WB -> 0 warmth and 0 tint
    expect(whiteBalanceAdjust(unadjusted, 5000, 0)).toEqual({ warmth: 0, tint: 0 });

    // Target warmer temperature (7071K ~ factor 1.414 -> warmth +50)
    const warmer = whiteBalanceAdjust(unadjusted, 7071, 15);
    expect(warmer.warmth).toBe(50);
    // After warming, tint follows mired shift, and tint delta covers the rest
    const developedWarmer = developAuto(base, Looks.NATURAL, 100, { ...NO_ADJUSTMENTS, ...warmer }, false, null, null);
    expect(Math.abs(developedWarmer.temperature - 7071)).toBeLessThan(10);
    expect(Math.abs(developedWarmer.tint - 15)).toBeLessThanOrEqual(1);

    // Clamps to slider limits (-100..100 for warmth, -50..50 for tint)
    expect(whiteBalanceAdjust(unadjusted, 50000, 100)).toEqual({ warmth: 100, tint: 50 });
    expect(whiteBalanceAdjust(unadjusted, 100, -100)).toEqual({ warmth: -100, tint: -50 });
  });

  it('store.pickWhite adjusts warmth and tint on the open photo and records undo', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {} });
    const { developParams } = await import('../develop/DevelopParams');
    const store = new AutoStore();
    store.add([new File(['a'], 'a.CR2')]);
    const [p] = store.state.photos;
    const defaults = developParams({ temperature: 5000, tint: 0 });
    const analysis = { defaults, autoBase: defaults, stats: { hasFace: false } };
    const s = store as unknown as { _state: { photos: { id: string; analysis: unknown }[] } };
    s._state.photos = [{ ...p, analysis }];

    // Mock session.pickWhite
    (store.session as unknown as { pickWhite: () => Promise<unknown> }).pickWhite = vi.fn().mockResolvedValue({
      kind: 'white',
      kelvin: 6000,
      tint: 5,
    });

    await store.pickWhite(p.id, 100, 100);
    const updated = store.state.photos.find((x) => x.id === p.id)!;
    expect(updated.adjust.warmth).not.toBe(0);
    expect(store.canUndo(p.id)).toBe(true);

    store.undo(p.id);
    expect(store.state.photos.find((x) => x.id === p.id)!.adjust.warmth).toBe(0);
    expect(store.state.photos.find((x) => x.id === p.id)!.adjust.tint).toBe(0);

    // Blown out / clipped spot
    (store.session as unknown as { pickWhite: () => Promise<unknown> }).pickWhite = vi.fn().mockResolvedValue({
      kind: 'clipped',
    });
    await store.pickWhite(p.id, 100, 100);
    expect(store.state.message).toBe("That spot is blown out: pick a grey that isn't clipped");

    // Non-neutral spot
    (store.session as unknown as { pickWhite: () => Promise<unknown> }).pickWhite = vi.fn().mockResolvedValue({
      kind: 'notNeutral',
    });
    await store.pickWhite(p.id, 100, 100);
    expect(store.state.message).toBe('No white balance makes that spot grey');
  });
});

describe('Auto grid filter', () => {
  it('filters photos by camera, lens, ISO and shoot date, and provides available options with counts', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { availableFilterOptions, isFilterActive, NO_FILTER, photoCamera, photoDate, photoIso, photoLens } = await import('../../ui/auto/AutoStore');
    const { developParams } = await import('../develop/DevelopParams');
    const { LensInfo } = await import('../lens/LensInfo');

    const store = new AutoStore();
    store.add([
      new File(['1'], 'shot1.CR2', { lastModified: 1700000000000 }),
      new File(['2'], 'shot2.CR2', { lastModified: 1700000000000 }),
      new File(['3'], 'shot3.CR2', { lastModified: 1700000000000 }),
    ]);

    const makeAnalysis = (camera: string, lensName: string, iso: number) => ({
      defaults: developParams(),
      autoBase: developParams(),
      camera,
      lens: new LensInfo(lensName, 6000, 4000, 36, 24, 1, null, null, null, 0),
      stats: { hasFace: false, iso, key: 0.05, p1: -6, p5: -5, p50: -2, p98: 0, p99: 0.5, clipped: 0, chroma: 0.2, greenBlue: 0.1, warm: 0.2, faceArea: 0, skinLuminance: 0 },
      base: {} as unknown,
      bloom: {} as unknown,
      skin: null,
      description: `${camera} · ${lensName} · ISO ${iso}`,
    });

    const s = store as unknown as { _state: { photos: { id: string; date: string | null; analysis: unknown }[] } };
    s._state.photos[0].analysis = makeAnalysis('Fujifilm X-T5', 'XF35mmF1.4 R', 400);
    s._state.photos[0].date = '2024:10:15 10:00:00';

    s._state.photos[1].analysis = makeAnalysis('Fujifilm X-T5', 'XF18-55mmF2.8-4 R LM OIS', 1600);
    s._state.photos[1].date = '2024:10:15 14:30:00';

    s._state.photos[2].analysis = makeAnalysis('Sony ILCE-7M3', 'FE 24-70mm F2.8 GM', 400);
    s._state.photos[2].date = '2024:10:16 09:15:00';

    const p0 = store.state.photos[0];
    const p1 = store.state.photos[1];
    const p2 = store.state.photos[2];

    expect(photoCamera(p0)).toBe('Fujifilm X-T5');
    expect(photoLens(p0)).toBe('XF35mmF1.4 R');
    expect(photoIso(p0)).toBe(400);
    expect(photoDate(p0)).toBe('2024-10-15');
    expect(photoCamera(p1)).toBe('Fujifilm X-T5');
    expect(photoCamera(p2)).toBe('Sony ILCE-7M3');

    // Available options
    const opts = availableFilterOptions(store.state.photos);
    expect(opts.cameras).toEqual([
      { value: 'Fujifilm X-T5', label: 'Fujifilm X-T5', count: 2 },
      { value: 'Sony ILCE-7M3', label: 'Sony ILCE-7M3', count: 1 },
    ]);
    expect(opts.lenses).toEqual([
      { value: 'FE 24-70mm F2.8 GM', label: 'FE 24-70mm F2.8 GM', count: 1 },
      { value: 'XF18-55mmF2.8-4 R LM OIS', label: 'XF18-55mmF2.8-4 R LM OIS', count: 1 },
      { value: 'XF35mmF1.4 R', label: 'XF35mmF1.4 R', count: 1 },
    ]);
    expect(opts.isos).toEqual([
      { value: 400, label: 'ISO 400', count: 2 },
      { value: 1600, label: 'ISO 1600', count: 1 },
    ]);
    expect(opts.dates).toEqual([
      { value: '2024-10-15', label: '2024-10-15', count: 2 },
      { value: '2024-10-16', label: '2024-10-16', count: 1 },
    ]);

    // Initial state: NO_FILTER -> all 3 photos shown
    expect(isFilterActive(store.state.filter)).toBe(false);
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot2.CR2', 'shot3.CR2']);

    // Filter by camera
    store.setFilter({ camera: 'Fujifilm X-T5' });
    expect(isFilterActive(store.state.filter)).toBe(true);
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot2.CR2']);

    // Combine with ISO (backward compatible exact match)
    store.setFilter({ iso: 1600 });
    expect(store.shown.map((p) => p.name)).toEqual(['shot2.CR2']);

    // Filter by ISO range
    store.setFilter({ camera: null, isoMin: 400, isoMax: 1600 });
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot2.CR2', 'shot3.CR2']);

    // ISO minimum bound
    store.setFilter({ isoMin: 1000, isoMax: null });
    expect(store.shown.map((p) => p.name)).toEqual(['shot2.CR2']);

    // ISO maximum bound
    store.setFilter({ isoMin: null, isoMax: 800 });
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot3.CR2']);

    // ISO exact match via min/max
    store.setFilter({ isoMin: 400, isoMax: 400 });
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot3.CR2']);

    // ISO range with no match
    store.setFilter({ isoMin: 800, isoMax: 1200 });
    expect(store.shown).toEqual([]);

    // Conflicting ISO bounds reset the opposing bound
    store.setFilter({ isoMin: 400, isoMax: 800 });
    store.setFilter({ isoMin: 1600 });
    expect(store.state.filter.isoMin).toBe(1600);
    expect(store.state.filter.isoMax).toBeNull();
    expect(store.shown.map((p) => p.name)).toEqual(['shot2.CR2']);

    store.setFilter({ isoMax: 400 });
    expect(store.state.filter.isoMin).toBeNull();
    expect(store.state.filter.isoMax).toBe(400);
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot3.CR2']);

    // Filter by lens
    store.setFilter({ camera: null, iso: null, lens: 'FE 24-70mm F2.8 GM' });
    expect(store.shown.map((p) => p.name)).toEqual(['shot3.CR2']);

    // Filter by date
    store.setFilter({ lens: null, date: '2024-10-15' });
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot2.CR2']);

    // No match
    store.setFilter({ camera: 'Nikon Z8' });
    expect(store.shown).toEqual([]);

    // Clear filter
    store.clearFilter();
    expect(store.state.filter).toEqual(NO_FILTER);
    expect(store.shown.map((p) => p.name)).toEqual(['shot1.CR2', 'shot2.CR2', 'shot3.CR2']);

    // previousPhoto respects active filter
    store.setFilter({ camera: 'Fujifilm X-T5' }); // shot1 and shot2
    expect(store.previousPhoto(p1.id)?.id).toBe(p0.id);
    expect(store.previousPhoto(p0.id)).toBeNull();
  });
});

describe('Auto grid: unedited filter', () => {
  it('shows only photos As is with nothing applied', async () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const { isFilterActive, isUnedited, NO_FILTER } = await import('../../ui/auto/AutoStore');
    const { capturePreset } = await import('../develop/Presets');
    const { developParams } = await import('../develop/DevelopParams');
    const store = new AutoStore();
    store.setImportMode('plain');
    store.add([new File(['a'], 'a.RAF'), new File(['b'], 'b.RAF'), new File(['c'], 'c.RAF'), new File(['d'], 'd.RAF'), new File(['e'], 'e.RAF')]);
    const [a, b, c, d, e] = store.state.photos.map((p) => p.id);
    const s = store as unknown as { _state: { photos: Record<string, unknown>[] } };
    const set = (id: string, patch: Record<string, unknown>) => {
      s._state.photos = s._state.photos.map((p) => (p.id === id ? { ...p, ...patch } : p));
    };
    set(b, { preset: capturePreset('p', developParams({ contrast: 20 }), ['light']) });
    set(c, { adjust: { ...store.state.photos[2].adjust, contrast: 10 } });
    set(d, { plain: false });
    set(e, { autoDenoise: true });
    expect(store.state.photos.map(isUnedited)).toEqual([true, false, false, false, false]);
    expect(isFilterActive(NO_FILTER)).toBe(false);
    store.setFilter({ unedited: true });
    expect(isFilterActive(store.state.filter)).toBe(true);
    expect(store.shown.map((p) => p.id)).toEqual([a]);
    store.clearFilter();
    expect(store.shown).toHaveLength(5);
  });
});
