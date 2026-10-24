import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { MAX_LEAKS, leakColor, newLightLeak, packLeaks, parseLeaks } from '../develop/LightLeaks';
import { applyPreset, capturePreset, PRESET_GROUPS } from '../develop/Presets';

describe('light leaks', () => {
  it('packs shown leaks into image pixels and skips hidden or transparent ones', () => {
    const a = { ...newLightLeak(0.25, 0.5), rx: 0.1, ry: 0.05, angle: 90, softness: 40, intensity: 80, hue: 0, seed: 0.3 };
    const hidden = { ...newLightLeak(), enabled: false };
    const clear = { ...newLightLeak(), intensity: 0 };
    const u = packLeaks([hidden, a, clear], 4000, 3000);
    expect(u.count).toBe(1);
    expect(Array.from(u.geom.slice(0, 4))).toEqual([1000, 1500, 1 / 400, 1 / 200].map(Math.fround));
    expect(u.shape[0]).toBeCloseTo(0, 6);
    expect(u.shape[1]).toBeCloseTo(1, 6);
    expect(u.shape[2]).toBeCloseTo(0.4, 6);
    expect(u.shape[3]).toBeCloseTo(0.3, 6);
    expect(u.color[3]).toBeCloseTo(0.8, 6);
    expect(packLeaks([], 4000, 3000).count).toBe(0);
  });

  it('makes warm colours: red at 0, orange in between, yellow at the top', () => {
    const [r0, g0, b0] = leakColor(0);
    expect(r0).toBe(1);
    expect(g0).toBeCloseTo(0.08, 6);
    expect(b0).toBeCloseTo(0.08, 6);
    const [r1, g1, b1] = leakColor(30);
    expect(r1).toBe(1);
    expect(g1).toBeGreaterThan(0.4);
    expect(g1).toBeLessThan(0.6);
    expect(b1).toBeCloseTo(0.08, 6);
    expect(leakColor(-40)[2]).toBeGreaterThan(0.5); // magenta-red: some blue
  });

  it('parses untrusted JSON with clamped ranges', () => {
    const many = Array.from({ length: 6 }, () => ({ cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, intensity: 300, hue: 500 }));
    const parsed = parseLeaks([{ cx: 'x' }, 'nope', ...many]);
    expect(parsed.length).toBe(MAX_LEAKS);
    expect(parsed[0].intensity).toBe(100);
    expect(parsed[0].hue).toBe(60);
    expect(parsed[0].enabled).toBe(true);
    expect(parseLeaks('nope')).toEqual([]);
  });

  it('round-trip through the photo edits but never presets', () => {
    const defaults = developParams();
    const leak = newLightLeak(0.3, 0.6);
    const edited = developParams({ exposure: 1, leaks: [leak] });
    const back = decodeEdits(encodeEdits(edited, defaults)!, defaults)!;
    expect(back.leaks.length).toBe(1);
    const { id: _a, ...was } = leak;
    const { id: _b, ...now } = back.leaks[0];
    expect(now).toEqual(was);
    expect(PRESET_GROUPS.some((g) => (g.fields as readonly string[]).includes('leaks'))).toBe(false);
    const preset = capturePreset('All', edited, PRESET_GROUPS.map((g) => g.key));
    expect('leaks' in preset.values).toBe(false);
    expect(applyPreset(preset, defaults).leaks).toEqual([]);
  });
});
