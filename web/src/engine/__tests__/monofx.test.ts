import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../develop/DevelopParams';
import { ShaderParams } from '../gl/ShaderParams';

// The same cases as MonoFxTest.kt.
describe('monoFx (B&W greys leaks and effects)', () => {
  it('calls a picture black and white by the flag or a full-strength mono LUT', () => {
    const mono = 'asset:luts/Yellow Mono 400.cube';
    expect(DEFAULT_PARAMS.monoFx).toBe(false);
    expect(ShaderParams.isMono(DEFAULT_PARAMS)).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, monoFx: true })).toBe(true);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono })).toBe(true);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono, lutAmount: 60 })).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: mono, film: 'portra400' })).toBe(false);
    expect(ShaderParams.isMono({ ...DEFAULT_PARAMS, lut: 'asset:luts/Movie Green.cube' })).toBe(false);
  });
});
