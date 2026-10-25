import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { LEAK_DEFAULTS, LEAK_HUE, MAX_LEAKS, glowReach, leakColor, leakEdge, leakOuterColor, newLightLeak, packLeaks, parseLeaks, withLeakKind } from '../develop/LightLeaks';
import { applyPreset, capturePreset, PRESET_GROUPS } from '../develop/Presets';

describe('light leaks', () => {
  it('packs shown leaks into image pixels and skips hidden or transparent ones', () => {
    const a = { ...newLightLeak(0.25, 0.5, 'glow'), rx: 0.1, ry: 0.05, angle: 90, softness: 40, glow: 50, bend: 50, warp: 20, taper: -30, intensity: 80, hue: 0, seed: 0.3 };
    const hidden = { ...newLightLeak(), enabled: false };
    const clear = { ...newLightLeak(), intensity: 0 };
    const u = packLeaks([hidden, a, clear], 4000, 3000);
    expect(u.count).toBe(1);
    expect(Array.from(u.geom.slice(0, 4))).toEqual([1000, 1500, 1 / 400, 1 / 200].map(Math.fround));
    expect(u.shape[0]).toBeCloseTo(0, 6);
    expect(u.shape[1]).toBeCloseTo(1, 6);
    expect(u.shape[2]).toBeCloseTo(0.4, 6);
    expect(u.shape[3]).toBeCloseTo(glowReach(50), 6);
    expect(u.color[3]).toBeCloseTo(0.8, 6);
    expect(u.outer[3]).toBeCloseTo(0.3, 6);
    expect(u.form[0]).toBe(0); // glow
    expect(u.form[1]).toBeCloseTo(0.5 / 400, 9); // bend 50: the ends move half a length radius over 400 px
    expect(u.form[2]).toBeCloseTo(0.2, 6);
    expect(u.form[3]).toBeCloseTo(-0.3, 6);
    expect(packLeaks([], 4000, 3000).count).toBe(0);
  });

  it('numbers the kinds and starts a streak as a long thin beam', () => {
    const s = newLightLeak(0.5, 0.5);
    expect(s.kind).toBe('streak');
    expect(s.rx / s.ry).toBeGreaterThan(5);
    expect(packLeaks([s], 4000, 3000).form[0]).toBe(1);
    expect(packLeaks([newLightLeak(0.5, 0.5, 'triangle')], 4000, 3000).form[0]).toBe(2);
    const g = withLeakKind({ ...s, bend: 30, hue: 0 }, 'glow');
    expect(g).toMatchObject({ kind: 'glow', ...LEAK_DEFAULTS.glow, bend: 30, hue: 0, cx: 0.5 });
  });

  it('measures edges in shape radii: glow, streak and triangle', () => {
    expect(leakEdge('glow', 0, 0)).toBe(-1);
    expect(leakEdge('glow', 0.6, 0.8)).toBeCloseTo(0, 9);
    expect(leakEdge('streak', 5, 1)).toBe(0); // any length: a streak's ends fade separately
    expect(leakEdge('triangle', 1, 0)).toBeCloseTo(0, 9); // apex
    expect(leakEdge('triangle', -1, 1)).toBeCloseTo(0, 9); // base corner
    expect(leakEdge('triangle', 0, 0)).toBeLessThan(0);
    expect(leakEdge('triangle', 0, 0.6)).toBeGreaterThan(0);
  });

  it('makes Photoshop\'s colours: orange glow inside a red one', () => {
    const [r, g, b] = leakColor(LEAK_HUE); // (255, 156, 0)
    expect(r).toBe(1);
    expect(g).toBeCloseTo(156 / 255, 1);
    expect(b).toBeCloseTo(0, 6);
    const [r2, g2, b2] = leakOuterColor(LEAK_HUE); // (255, 5, 5)
    expect(r2).toBe(1);
    expect(g2).toBeLessThan(0.05);
    expect(b2).toBeLessThan(0.05);
    expect(leakColor(-40)[2]).toBeGreaterThan(0.5); // magenta-red: some blue
  });

  it('parses untrusted JSON with clamped ranges', () => {
    const many = Array.from({ length: 6 }, () => ({ cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, intensity: 300, hue: 500 }));
    const parsed = parseLeaks([{ cx: 'x' }, 'nope', ...many]);
    expect(parsed.length).toBe(MAX_LEAKS);
    expect(parsed[0].intensity).toBe(100);
    expect(parsed[0].hue).toBe(60);
    expect(parsed[0].enabled).toBe(true);
    expect(parsed[0].kind).toBe('glow'); // saved before streaks
    expect(parsed[0]).toMatchObject({ bend: 0, taper: 0, warp: 0, glow: LEAK_DEFAULTS.glow.glow }); // saved before bending
    expect(parseLeaks([{ ...many[0], kind: 'streak' }])[0].kind).toBe('streak');
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
