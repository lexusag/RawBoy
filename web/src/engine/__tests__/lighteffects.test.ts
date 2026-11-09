import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import {
  FX_CHUNK, FX_KINDS, FX_ROW, MAX_EFFECTS, MAX_SEGMENTS, fxColor, fxRandom, fxSegments, generateFx, newLightEffect, packEffects, parseEffects, thicknessFactor, withFxKind,
} from '../develop/LightEffects';
import { PRESET_GROUPS, capturePreset } from '../develop/Presets';

describe('light effects', () => {
  it('generates the same pattern for the same seed and another for a new one', () => {
    for (const kind of FX_KINDS) {
      const a = fxSegments({ kind, seed: 0.123, amount: 50 });
      const b = generateFx(kind, 0.123, 50);
      expect(a).toEqual(b);
      expect(fxSegments({ kind, seed: 0.456, amount: 50 })).not.toEqual(a);
    }
  });

  it('keeps every kind within its box and the segment budget, more with a higher amount', () => {
    for (const kind of FX_KINDS) {
      for (let s = 0; s < 20; ++s) {
        const seed = fxRandom(s / 20 + 0.01)();
        const segs = fxSegments({ kind, seed, amount: 100 });
        expect(segs.length).toBeGreaterThan(10);
        expect(segs.length).toBeLessThanOrEqual(MAX_SEGMENTS);
        for (const g of segs) {
          for (const v of [g.x0, g.y0, g.x1, g.y1]) expect(Math.abs(v)).toBeLessThan(1.6);
          expect(g.b).toBeGreaterThan(0);
          expect(g.w0).toBeGreaterThan(0);
        }
      }
      const few = fxSegments({ kind, seed: 0.3, amount: 0 }).length;
      const many = fxSegments({ kind, seed: 0.3, amount: 100 }).length;
      expect(many).toBeGreaterThanOrEqual(few);
    }
  });

  it('packs shown effects into image pixels and chunk rows, skipping hidden ones', () => {
    const a = { ...newLightEffect('lightning', 0.25, 0.5), rx: 0.2, ry: 0.1, angle: 90, intensity: 80, hue: 180, spread: 50, thickness: 50 };
    const hidden = { ...newLightEffect('sparks'), enabled: false };
    const b = newLightEffect('swirl');
    const u = packEffects([hidden, a, b], 4000, 3000);
    expect(u.count).toBe(2);
    expect(Array.from(u.geom.slice(0, 4))).toEqual([1000, 1500, 800, 400]);
    expect(u.shape[0]).toBeCloseTo(0, 6);
    expect(u.shape[1]).toBeCloseTo(1, 6);
    expect(u.shape[2]).toBeCloseTo(Math.sqrt(800 * 400) * thicknessFactor(50), 3);
    expect(u.color[0]).toBeCloseTo(0.5, 6);
    expect(u.color[1]).toBeCloseTo(0.5, 6);
    expect(u.color[2]).toBeCloseTo(0.8, 6);
    const rowsA = Math.ceil(fxSegments(a).length / FX_CHUNK);
    expect(Array.from(u.range.slice(0, 2))).toEqual([0, rowsA]);
    expect(u.range[4]).toBe(rowsA);
    expect(u.data!.rows).toBe(rowsA + Math.ceil(fxSegments(b).length / FX_CHUNK));
    expect(u.data!.data.length).toBe(u.data!.rows * FX_ROW * 4);
    // A chunk's bounding box holds its segments.
    const d = u.data!.data;
    const s0 = fxSegments(a)[0];
    expect(d[0]).toBeLessThanOrEqual(Math.fround(Math.min(s0.x0, s0.x1)));
    expect(d[4 + 6]).toBeCloseTo(s0.b, 6);
    expect(packEffects([], 4000, 3000).count).toBe(0);
  });

  it('reuses the data texture while only placement or colour change', () => {
    const e = newLightEffect('sparks');
    const first = packEffects([e], 4000, 3000).data;
    expect(packEffects([{ ...e, cx: 0.1, rx: 0.4, hue: 20, angle: 33 }], 4000, 3000).data).toBe(first);
    expect(packEffects([{ ...e, seed: e.seed === 0.5 ? 0.6 : 0.5 }], 4000, 3000).data).not.toBe(first);
  });

  it('switches kind with that kind’s look, keeping place and seed', () => {
    const e = { ...newLightEffect('lightning', 0.2, 0.7), seed: 0.42 };
    expect(withFxKind(e, 'trails')).toMatchObject({ kind: 'trails', cx: 0.2, cy: 0.7, seed: 0.42 });
  });

  it('colours hues as light neon', () => {
    fxColor(0).forEach((v, i) => expect(v).toBeCloseTo([1, 0.2, 0.2][i], 9));
    const blue = fxColor(240);
    expect(blue[2]).toBe(1);
    expect(blue[0]).toBeCloseTo(0.2, 6);
  });

  it('round-trips through edits, drops bad entries and stays out of presets', () => {
    const defaults = developParams();
    const fx = [{ ...newLightEffect('trails', 0.3, 0.6), seed: 0.77, amount: 70 }];
    const text = encodeEdits({ ...defaults, fx }, defaults)!;
    const back = decodeEdits(text, defaults)!;
    expect(back.fx).toHaveLength(1);
    const { id: _a, ...want } = fx[0];
    const { id: _b, ...got } = back.fx[0];
    expect(got).toEqual(want);
    expect(parseEffects([{ kind: 'nope', cx: 0, cy: 0, rx: 1, ry: 1 }, { kind: 'swirl', cx: 0.5 }, 3])).toEqual([]);
    expect(parseEffects(Array.from({ length: 9 }, () => ({ kind: 'sparks', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 })))).toHaveLength(MAX_EFFECTS);
    const preset = capturePreset('All', { ...defaults, fx }, PRESET_GROUPS.map((g) => g.key));
    expect('fx' in preset.values).toBe(false);
  });
});

