import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { HEAL_RADIUS_MAX, HEAL_RADIUS_MIN, MAX_HEAL_SPOTS, healKey, healStrokes, newHealSpot, parseHealSpots } from '../develop/HealSpots';
import { capturePreset, PRESET_GROUPS } from '../develop/Presets';

describe('healing brush spots', () => {
  it('hands the engine pixel positions, a radius of at least 2 px and -1 for no source', () => {
    const auto = newHealSpot(0.25, 0.5, 0.01, null, 40);
    const chosen = newHealSpot(0.5, 0.5, 0.0001, [0.75, 0.25], 100);
    const s = healStrokes([auto, chosen], 4000, 3000);
    expect(Array.from(s.slice(0, 6))).toEqual([1000, 1500, 40, -1, 0, 0.4].map(Math.fround));
    expect(Array.from(s.slice(6, 12))).toEqual([2000, 1500, 2, 3000, 750, 1].map(Math.fround));
  });

  it('cuts a stroke into disks a third of a radius apart, each with the stroke source offset', () => {
    // 3000 x 2000: radius 0.01 = 30 px, so disks every 10 px along a 100 px drag, plus the start and the end.
    const stroke = { ...newHealSpot(0.1, 0.5, 0.01, [0.2, 0.6], 80), path: [0.1 + 100 / 3000, 0.5] };
    const s = healStrokes([stroke], 3000, 2000);
    expect(s.length / 6).toBe(12);
    const xs = Array.from({ length: 12 }, (_, i) => s[i * 6]);
    expect(xs[0]).toBeCloseTo(300, 3);
    expect(xs[1]).toBeCloseTo(310, 3);
    expect(xs[10]).toBeCloseTo(400, 3);
    expect(xs[11]).toBeCloseTo(400, 3);
    for (let i = 0; i < 12; i++) {
      expect(s[i * 6 + 3] - s[i * 6]).toBeCloseTo(300, 3); // source = disk + (0.1, 0.1 of the photo)
      expect(s[i * 6 + 4] - s[i * 6 + 1]).toBeCloseTo(200, 3);
    }
  });

  it('keeps edits sidecars lossless and brings untrusted values into range', () => {
    const defaults = developParams();
    const edited = developParams({ healSpots: [{ ...newHealSpot(0.1, 0.2, 0.01, [0.3, 0.4], 25), path: [0.12, 0.21, 0.15, 0.2] }, newHealSpot(0.9, 0.8, 0.02, null)] });
    const back = decodeEdits(encodeEdits(edited, defaults)!, defaults)!;
    expect(back.healSpots.map(({ id: _, ...s }) => s)).toEqual(edited.healSpots.map(({ id: _, ...s }) => s));
    expect(encodeEdits(defaults, defaults)).toBeNull();
    const parsed = parseHealSpots([{ x: 2, y: -1, radius: 5, source: [9, 0.5], feather: 300 }, { x: 'a' }, null, { x: 0.5, y: 0.5, radius: 0, source: [1] }]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ x: 1, y: 0, radius: HEAL_RADIUS_MAX, source: [1, 0.5], feather: 100 });
    expect(parsed[1]).toMatchObject({ radius: HEAL_RADIUS_MIN, source: null, feather: 80, path: [] });
    expect(parseHealSpots(Array.from({ length: MAX_HEAL_SPOTS + 9 }, () => ({ x: 0.5, y: 0.5, radius: 0.01 })))).toHaveLength(MAX_HEAL_SPOTS);
    expect(parseHealSpots('nope')).toEqual([]);
    expect(parseHealSpots([{ x: 0.5, y: 0.5, radius: 0.01, path: [0.1, 0.2, 'a', 3, 0.4] }])[0].path).toEqual([0.1, 0.2, 0, 1]);
  });

  it('is in no preset group, and its key ignores ids but not positions', () => {
    const p = developParams({ healSpots: [newHealSpot(0.1, 0.2, 0.01, null)] });
    for (const g of PRESET_GROUPS) expect(g.fields as readonly string[]).not.toContain('healSpots');
    expect(capturePreset('x', p, PRESET_GROUPS.map((g) => g.key)).values).not.toHaveProperty('healSpots');
    const a = newHealSpot(0.1, 0.2, 0.01, null);
    expect(healKey([a])).toBe(healKey([{ ...a, id: 'other' }]));
    expect(healKey([a])).not.toBe(healKey([{ ...a, x: 0.11 }]));
    expect(healKey([a])).not.toBe(healKey([{ ...a, source: [0.1, 0.2] }]));
    expect(healKey([a])).not.toBe(healKey([{ ...a, path: [0.2, 0.2] }]));
    expect(healKey([])).toBe('');
  });
});
