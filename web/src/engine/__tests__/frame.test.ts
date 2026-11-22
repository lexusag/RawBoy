import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { FRAME_MAX, frameRgb, normalizeFrameColor } from '../develop/Frame';
import { DEFAULT_PRESET_GROUPS, applyPreset, capturePreset, decodePresets, encodePresets } from '../develop/Presets';
import { ShaderParams } from '../gl/ShaderParams';

// The same cases as FrameTest.kt.
describe('frame overlay params', () => {
  it('is off by default', () => {
    expect(DEFAULT_PARAMS.frame).toBe(0);
    expect(DEFAULT_PARAMS.frameColor).toBe('#000000');
    expect(DEFAULT_PARAMS.monoFx).toBe(false);
  });

  it('parses colours', () => {
    expect(frameRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(frameRgb('FFFFFF')).toEqual([1, 1, 1]);
    expect(frameRgb('nonsense')).toEqual([0, 0, 0]);
    expect(normalizeFrameColor(' #F1EAD8 ')).toBe('#f1ead8');
    expect(normalizeFrameColor('#12345')).toBeNull();
    expect(normalizeFrameColor('#gggggg')).toBeNull();
    expect(normalizeFrameColor(null)).toBeNull();
  });

  it('round-trips through presets (not ticked by default) and edits', () => {
    expect(DEFAULT_PRESET_GROUPS).not.toContain('frame');
    const edited = { ...DEFAULT_PARAMS, frame: 4, frameColor: '#ffffff' };
    const preset = decodePresets(encodePresets([capturePreset('Border', edited, ['frame'])]))[0];
    const applied = applyPreset(preset, DEFAULT_PARAMS);
    expect(applied.frame).toBe(4);
    expect(applied.frameColor).toBe('#ffffff');
    // Out-of-range thickness and bad colours from a hand-edited file are tamed or ignored.
    expect(applyPreset({ id: '', name: '', groups: [], values: { frame: 99 } }, DEFAULT_PARAMS).frame).toBe(FRAME_MAX);
    expect(applyPreset({ id: '', name: '', groups: [], values: { frameColor: 'red' } }, DEFAULT_PARAMS).frameColor).toBe('#000000');

    const e = { ...DEFAULT_PARAMS, frame: 6.5, frameColor: '#808080' };
    const back = decodeEdits(encodeEdits(e, DEFAULT_PARAMS)!, DEFAULT_PARAMS)!;
    expect(back.frame).toBe(6.5);
    expect(back.frameColor).toBe('#808080');
    expect(encodeEdits(DEFAULT_PARAMS, DEFAULT_PARAMS)).toBeNull();
  });

  it('calls a picture black and white by the flag or a full-strength mono LUT', () => {
    const mono = 'asset:luts/Yellow Mono 400.cube';
    expect(ShaderParams.isMono(DEFAULT_PARAMS)).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, monoFx: true })).toBe(true);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono })).toBe(true);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono, lutAmount: 60 })).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono, film: 'portra400' })).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: 'asset:luts/Movie Green.cube' })).toBe(false);
  });
});
