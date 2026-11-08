import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { applyPreset, capturePreset, decodePresets, encodePresets, layerPreset, type Preset } from '../develop/Presets';

/** Stacked presets: each later one overrides only what it holds and leaves everything else as it was. */
describe('stacking partial presets', () => {
  const start = developParams({ exposure: 0.5, contrast: 10, temperature: 5000, tint: 3, saturation: 5, grain: 12, lutAmount: 40, localContrast: 8, rotation: 1, cropLeft: 0.1 });
  const color = capturePreset('Color', developParams({ saturation: 30, redHue: 12 }), ['color']);
  const detail = capturePreset('Detail', developParams({ grain: 50, bloom: 20 }), ['detail']);
  const wb = capturePreset('WB', developParams({ temperature: 3200, tint: -4 }), ['whiteBalance']);

  it('applying several in sequence changes only each preset\'s own groups', () => {
    let p = start;
    p = applyPreset(color, p);
    expect(p).toEqual({ ...start, saturation: 30, redHue: 12 });
    p = applyPreset(detail, p);
    // Detail resets its whole group (it holds those fields), but not Color's values.
    expect(p.saturation).toBe(30);
    expect(p.redHue).toBe(12);
    expect(p.grain).toBe(50);
    expect(p.bloom).toBe(20);
    p = applyPreset(wb, p);
    expect([p.temperature, p.tint]).toEqual([3200, -4]);
    expect([p.saturation, p.grain, p.exposure, p.contrast, p.lutAmount, p.rotation, p.cropLeft]).toEqual([30, 50, 0.5, 10, 40, 1, 0.1]);
  });

  it('a later preset overrides an earlier one only on the fields it has', () => {
    const a = capturePreset('A', developParams({ exposure: 1, contrast: 30, saturation: 20 }), ['light', 'color']);
    const b: Preset = { id: 'b', name: 'B', groups: ['light'], values: { exposure: -1 } }; // holds just exposure
    const out = applyPreset(b, applyPreset(a, developParams()));
    expect(out.exposure).toBe(-1);
    expect(out.contrast).toBe(30);
    expect(out.saturation).toBe(20);
  });

  it('a file preset missing some fields of its groups leaves those fields alone', () => {
    const [b] = decodePresets(JSON.stringify({ format: 'rawboy-preset', version: 1, name: 'Sparse', groups: ['color', 'light'], values: { saturation: -20 } }));
    const out = applyPreset(b, developParams({ contrast: 25, redHue: 9, exposure: 1 }));
    expect([out.saturation, out.contrast, out.redHue, out.exposure]).toEqual([-20, 25, 9, 1]);
  });

  it('layerPreset keeps the lower preset\'s values the upper one does not hold', () => {
    const under = capturePreset('Under', developParams({ saturation: 10, redHue: 7, greenHue: 4, grain: 33 }), ['color', 'detail']);
    const over: Preset = { id: 'o', name: 'Over', groups: ['color'], values: { saturation: 50 } }; // a sparse Color preset
    const layered = layerPreset(under, over);
    expect(layered.values.saturation).toBe(50);
    expect(layered.values.redHue).toBe(7);
    expect(layered.values.greenHue).toBe(4);
    expect(layered.values.grain).toBe(33);
    const out = applyPreset(layered, developParams());
    expect([out.saturation, out.redHue, out.greenHue, out.grain]).toEqual([50, 7, 4, 33]);
  });

  it('layerPreset replaces every field a full upper group holds and survives the file format', () => {
    const under = capturePreset('Under', developParams({ saturation: 10, redHue: 7, grain: 33 }), ['color', 'detail']);
    const over = capturePreset('Over', developParams({ saturation: 60, grain: 0 }), ['color']);
    const layered = layerPreset(under, over);
    expect(layered.values.redHue).toBe(0); // Over's Color group holds a red hue of 0, so that wins
    expect(layered.values.grain).toBe(33); // Detail is not in Over
    expect(layered.groups).toEqual(['color', 'detail']);
    const [again] = decodePresets(encodePresets([layered]));
    expect(applyPreset(again, developParams()).grain).toBe(33);
  });
});
