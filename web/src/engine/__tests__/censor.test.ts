import { describe, expect, it } from 'vitest';
import {
  activeCensorLayers,
  CENSOR_DEFAULT_SIZES,
  colourHex,
  MAX_CENSOR_LAYERS,
  newCensorLayer,
  parseCensor,
  parseColour,
  withCensorEffect,
  type CensorLayer,
  type CensorStroke,
} from '../develop/Censor';
import { agxCurve, sceneToDisplay } from '../develop/CensorColour';
import { CensorRaster } from '../develop/CensorRaster';
import { developParams } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { capturePreset, PRESET_GROUPS } from '../develop/Presets';
import { packCensor } from '../gl/CensorPass';

const stroke = (points: number[], extra: Partial<CensorStroke> = {}): CensorStroke => ({
  id: `s${points.join('-')}`,
  erase: false,
  radius: 0.05,
  hardness: 80,
  points,
  ...extra,
});
const at = (r: CensorRaster, x: number, y: number) => {
  const i = (Math.round(y * (r.height - 1)) * r.width + Math.round(x * (r.width - 1))) * 4;
  return Array.from(r.mask.slice(i, i + 4));
};
const IDENTITY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

describe('censor brush raster', () => {
  it('covers along the spline and nowhere far from it', () => {
    const r = new CensorRaster(200, 100);
    r.sync([stroke([0.2, 0.5, 0.5, 0.5, 0.8, 0.5])]);
    expect(at(r, 0.35, 0.5)[0]).toBe(255);
    expect(at(r, 0.8, 0.5)[0]).toBe(255);
    expect(at(r, 0.5, 0.05)[0]).toBe(0);
    expect(at(r, 0.05, 0.5)[0]).toBe(0);
  });

  it('draws the same when a stroke grows point by point as in one go', () => {
    const pts = [0.1, 0.2, 0.25, 0.35, 0.4, 0.3, 0.55, 0.6, 0.7, 0.55, 0.85, 0.8];
    const whole = new CensorRaster(160, 120);
    whole.sync([stroke([0.9, 0.1]), { ...stroke(pts), id: 'grow' }]);
    const grown = new CensorRaster(160, 120);
    for (let n = 2; n <= pts.length; n += 2) grown.sync([stroke([0.9, 0.1]), { ...stroke(pts.slice(0, n)), id: 'grow' }]);
    let diff = 0;
    for (let i = 0; i < whole.mask.length; i++) diff = Math.max(diff, Math.abs(whole.mask[i] - grown.mask[i]));
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('is deterministic and reports what changed', () => {
    const a = new CensorRaster(100, 100);
    const b = new CensorRaster(100, 100);
    const s = [stroke([0.3, 0.3, 0.6, 0.7])];
    a.sync(s);
    b.sync(s);
    expect(a.mask).toEqual(b.mask);
    const v = a.version;
    expect(a.pendingRect(v)).toBeNull();
    a.sync([...s, stroke([0.9, 0.9])]);
    const rect = a.pendingRect(v);
    expect(rect).not.toBeNull();
    if (rect && rect !== 'all') expect(rect.x).toBeGreaterThan(50);
  });

  it('erases what was painted before, not what comes after', () => {
    const r = new CensorRaster(100, 100);
    const paint = stroke([0.5, 0.5], { radius: 0.1 });
    const erase = stroke([0.5, 0.5], { erase: true, radius: 0.04, id: 'e' });
    r.sync([paint, erase]);
    expect(at(r, 0.5, 0.5)[0]).toBe(0);
    expect(at(r, 0.5, 0.5)[1]).toBe(255);
    expect(at(r, 0.56, 0.5)[0]).toBeGreaterThan(200);
    r.sync([paint, erase, { ...stroke([0.5, 0.5], { radius: 0.1 }), id: 'again' }]);
    expect(at(r, 0.5, 0.5)[0]).toBe(255);
  });

  it('keeps a picked colour, and an Auto stroke takes it back', () => {
    const r = new CensorRaster(100, 100);
    r.sync([stroke([0.5, 0.5], { colour: '#ff0000', colourMix: 100 })]);
    const i = (50 * 100 + 50) * 4;
    expect(Array.from(r.colour.slice(i, i + 4))).toEqual([255, 0, 0, 255]);
    r.sync([stroke([0.5, 0.5], { colour: '#ff0000', colourMix: 100 }), stroke([0.5, 0.5], { id: 'auto' })]);
    expect(r.colour[i + 3]).toBe(0);
  });

  it('pen widths thin the stroke', () => {
    const r = new CensorRaster(200, 100);
    r.sync([stroke([0.2, 0.5, 0.8, 0.5], { widths: [1, 0.3] })]);
    // radius 0.05 of 200 px = 10 px at full pressure, 3 px at the light end.
    expect(at(r, 0.2, 0.5 + 8 / 99)[0]).toBeGreaterThan(0);
    expect(at(r, 0.8, 0.5 + 8 / 99)[0]).toBe(0);
  });
});

describe('censor layers', () => {
  const layer = (change: Partial<CensorLayer>): CensorLayer => ({ ...newCensorLayer('mosaic'), strokes: [stroke([0.5, 0.5])], ...change });

  it('round-trips through edits sidecars, never carried in presets', () => {
    const defaults = developParams();
    const l = layer({ ellipse: { cx: 0.4, cy: 0.6, rx: 0.1, ry: 0.05, angle: 30 }, strokes: [stroke([0.123456789, 0.5, 0.6, 0.7], { widths: [0.5, 1], colour: '#AABBCC', colourMix: 40 })] });
    const params = { ...defaults, censor: [l] };
    const text = encodeEdits(params, defaults)!;
    const back = decodeEdits(text, defaults)!.censor;
    expect(back).toHaveLength(1);
    expect(back[0].effect).toBe('mosaic');
    expect(back[0].ellipse).toEqual(l.ellipse);
    expect(back[0].strokes[0].points[0]).toBeCloseTo(0.12346, 6);
    expect(back[0].strokes[0].widths).toEqual([0.5, 1]);
    expect(back[0].strokes[0].colour).toBe('#aabbcc');
    expect(back[0].strokes[0].colourMix).toBe(40);
    const preset = capturePreset('All', params, PRESET_GROUPS.map((g) => g.key));
    expect(JSON.stringify(preset)).not.toContain('censor');
  });

  it('cleans what it parses', () => {
    const parsed = parseCensor([{ effect: 'nope', size: 9, strength: -3, strokes: [{ points: [0.1, 0.2, 0.3], radius: 7, colour: 'red' }] }, 5, null]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].effect).toBe('paint');
    expect(parsed[0].strength).toBe(0);
    expect(parsed[0].strokes[0].points).toEqual([0.1, 0.2]);
    expect(parsed[0].strokes[0].colour).toBeUndefined();
    expect(parseCensor(Array.from({ length: 9 }, () => ({})))).toHaveLength(MAX_CENSOR_LAYERS);
  });

  it('draws only enabled, covering, strong layers', () => {
    const layers = [layer({}), layer({ enabled: false }), layer({ strength: 0 }), layer({ strokes: [] })];
    expect(activeCensorLayers(layers)).toHaveLength(1);
  });

  it('opens retired effects as current ones and switches to an effect with its own size', () => {
    const parsed = parseCensor([{ effect: 'ink', strokes: [] }, { effect: 'heal', strokes: [] }, { effect: 'hatching', contrast: 30, keepColour: 140 }]);
    expect(parsed.map((l) => l.effect)).toEqual(['glass', 'paint', 'hatching']);
    expect(parsed[2].contrast).toBe(30);
    expect(parsed[2].keepColour).toBe(100);
    const oil = withCensorEffect(newCensorLayer('mosaic'), 'paint');
    expect(oil.size).toBe(CENSOR_DEFAULT_SIZES.paint);
    expect(oil.name).toBe('Oil paint');
  });

  it('packs sizes in full-resolution pixels', () => {
    const src = { width: 4, height: 3, pixels: new Uint16Array(36), fullWidth: 4000, fullHeight: 3000 };
    const u = packCensor([layer({ size: 0.02, ellipse: { cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.05, angle: 90 } })], 4000, 3000, () => null, src, IDENTITY, 1, 1)!;
    expect(u.count).toBe(1);
    expect(u.param[0]).toBeCloseTo(80, 4);
    expect(u.ellipse[0]).toBe(2000);
    expect(u.ellipse[2]).toBeCloseTo(1 / 400, 8);
    expect(u.turn[0]).toBeCloseTo(0, 6);
    const glass = packCensor([layer({ glassColour: 40, contrast: 20, keepColour: 80 })], 4000, 3000, () => null, src, IDENTITY, 1, 1)!;
    expect(Array.from(glass.extra.slice(0, 3))).toEqual([0.4, 0.2, 0.8].map(Math.fround));
    expect(packCensor([layer({})], 4000, 3000, () => null, null, IDENTITY, 1, 1)).toBeNull();
  });
});

describe('censor colours', () => {
  it('reads and writes hex', () => {
    expect(parseColour('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(parseColour('ff8000')).toBeNull();
    expect(colourHex([1, 0.5, 0])).toBe('#ff8000');
  });

  it('the eyedropper is the inverse of the shader: grey at middle grey', () => {
    // AgX's pivot: scene 0.18 * 2^-? lands on display ~0.5 on the curve; equal channels stay neutral.
    const d = sceneToDisplay([0.18, 0.18, 0.18], IDENTITY, 1, 1);
    expect(Math.abs(d[0] - d[1])).toBeLessThan(0.01);
    expect(Math.abs(d[1] - d[2])).toBeLessThan(0.01);
    expect(d[0]).toBeGreaterThan(0.2);
    expect(d[0]).toBeLessThan(0.8);
    expect(sceneToDisplay([0.5, 0.5, 0.5], IDENTITY, 1, 1)[0]).toBeGreaterThan(d[0]);
    expect(agxCurve(0)).toBeLessThan(0.01);
    expect(agxCurve(1)).toBeGreaterThan(0.95);
  });
});
