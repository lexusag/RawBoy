import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import {
  FILM_LEAK_TYPES,
  MAX_FILM_LEAKS,
  newVariation,
  packFilmLeaks,
  parseFilmLeaks,
  randomFilmLeak,
  randomFilmRoll,
  sideMove,
} from '../develop/FilmLeaks';
import {
  applyPreset,
  capturePreset,
  decodePresets,
  DEFAULT_PRESET_GROUPS,
  encodePresets,
  replacesLook,
} from '../develop/Presets';
import { ProStore } from '../../ui/pro/ProStore';
import { decodeAuto, encodeAuto } from '../../ui/auto/AutoSidecar';
import { Looks } from '../auto/looks/Look';
import { FilmLooks } from '../auto/looks/FilmLooks';
import { NO_ADJUSTMENTS } from '../auto/looks/LookApplier';

describe('film leaks (generated)', () => {
  it('generates deterministic layers for a seed across all types', () => {
    const a = randomFilmRoll(1.5, 0.42);
    const b = randomFilmRoll(1.5, 0.42);
    expect(a.map(({ id: _, ...r }) => r)).toEqual(b.map(({ id: _, ...r }) => r));
    for (const t of FILM_LEAK_TYPES) {
      const l = randomFilmLeak(t, 1.5, 0.25);
      expect(l.type).toBe(t);
      expect(l.w).toBeGreaterThan(0);
      expect(l.h).toBeGreaterThan(0);
    }
    const varied = newVariation(a[0], 0.99);
    expect(varied.type).toBe(a[0].type);
    expect(varied.seed).toBe(0.99);
    const moved = sideMove(randomFilmLeak('edge', 1.5, 0.1), 2);
    expect(moved.turn).toBe(2);
    expect(moved.cx).toBeGreaterThan(0.5);
  });

  it('packs active layers into image-pixel boxes and skips disabled or zero-effect ones', () => {
    const l = randomFilmLeak('edge', 1.5, 0.5, false);
    const off = { ...l, enabled: false };
    const zero = { ...l, intensity: 0, warmth: 0, tint: 0, fade: 0, contrast: 0 };
    const u = packFilmLeaks([off, l, zero], 4000, 3000);
    expect(u.count).toBe(1);
    expect(u.box[0]).toBeCloseTo(l.cx * 4000, 3);
    expect(u.box[1]).toBeCloseTo(l.cy * 3000, 3);
    expect(u.box[2]).toBeCloseTo(2 / (l.w * 4000), 6);
    expect(u.box[3]).toBeCloseTo(2 / (l.h * 3000), 6);
  });

  it('parses untrusted JSON with clamped ranges', () => {
    const raw = Array.from({ length: 6 }, () => ({
      type: 'sprocket',
      palette: 'cool',
      cx: 0.5,
      cy: 0.5,
      w: 0.3,
      h: 1.0,
      turn: 5,
      intensity: 200,
      warmth: -300,
    }));
    const parsed = parseFilmLeaks([{ cx: 'bad' }, ...raw]);
    expect(parsed.length).toBe(MAX_FILM_LEAKS);
    expect(parsed[0].type).toBe('sprocket');
    expect(parsed[0].palette).toBe('cool');
    expect(parsed[0].turn).toBe(1);
    expect(parsed[0].intensity).toBe(100);
    expect(parsed[0].warmth).toBe(-100);
  });

  it('round-trips through edits and the opt-in leaks preset group without replacing Auto looks', () => {
    const defaults = developParams();
    const leak = randomFilmLeak('tear', 1.5, 0.33);
    const edited = developParams({ filmLeaks: [leak] });
    const back = decodeEdits(encodeEdits(edited, defaults)!, defaults)!;
    expect(back.filmLeaks.length).toBe(1);
    const { id: _a, ...was } = leak;
    const { id: _b, ...now } = back.filmLeaks[0];
    expect(now).toEqual(was);

    expect(DEFAULT_PRESET_GROUPS.includes('leaks')).toBe(false);
    const defaultPreset = capturePreset('Default', edited, DEFAULT_PRESET_GROUPS);
    expect('filmLeaks' in defaultPreset.values).toBe(false);

    const leakPreset = capturePreset('Torn edge', edited, ['leaks']);
    expect(replacesLook(leakPreset)).toBe(false);
    const [decoded] = decodePresets(encodePresets([leakPreset]));
    const applied = applyPreset(decoded, defaults);
    expect(applied.filmLeaks.length).toBe(1);
    const { id: _c, ...fromPreset } = applied.filmLeaks[0];
    expect(fromPreset).toEqual(was);
  });

  it('shares the MAX_LEAKS budget with hand-made leaks in ProStore and round-trips in AutoSidecar', () => {
    const store = new ProStore();
    store.addLeak('streak');
    store.addLeak('glow');
    const id = store.rollFilmLeaks('any', 1.5, null, 0.7);
    expect(id).not.toBeNull();
    expect(store.state.params.leaks.length + store.state.params.filmLeaks.length).toBeLessThanOrEqual(4);

    const autoSaved = encodeAuto({
      mode: 'looks',
      look: Looks.PORTRA_400,
      filmLook: FilmLooks.PORTRA_400,
      strength: 100,
      adjust: NO_ADJUSTMENTS,
      preset: null,
      edits: null,
      lensChoice: null,
      lensPreset: null,
      plain: false,
      autoDenoise: false,
      filmLeaks: [leakFromSeed(0.5)],
    });
    const autoRestored = decodeAuto(autoSaved)!;
    expect(autoRestored.filmLeaks?.length).toBe(1);
    expect(autoRestored.filmLeaks?.[0].type).toBe(leakFromSeed(0.5).type);
  });

  it('places sprocket holes on long sides only by default, and allows short sides when enabled', () => {
    const landscapeLong = new Set<number>();
    const portraitLong = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const s = (i + 0.5) / 100;
      landscapeLong.add(randomFilmLeak('sprocket', 1.5, s).turn);
      portraitLong.add(randomFilmLeak('sprocket', 0.667, s).turn);
    }
    expect([...landscapeLong].every((t) => t === 1 || t === 3)).toBe(true);
    expect([...portraitLong].every((t) => t === 0 || t === 2)).toBe(true);

    const landscapeAll = new Set<number>();
    for (let i = 0; i < 100; i++) {
      landscapeAll.add(randomFilmLeak('sprocket', 1.5, (i + 0.5) / 100, true, true).turn);
    }
    expect(landscapeAll.has(0) || landscapeAll.has(2)).toBe(true);
    expect(landscapeAll.has(1) || landscapeAll.has(3)).toBe(true);
  });
});

const leakFromSeed = (s: number) => randomFilmLeak('edge', 1.5, s);
