import { describe, expect, it } from 'vitest';
import { MAX_LONG_SIDE, MIN_LONG_SIDE, parseLongSide } from './ExportSettings';

describe('parseLongSide', () => {
  it('takes whole pixels in range', () => {
    expect(parseLongSide('1600')).toBe(1600);
    expect(parseLongSide(' 64 ')).toBe(MIN_LONG_SIDE);
    expect(parseLongSide('20000')).toBe(MAX_LONG_SIDE);
  });
  it('refuses blanks, text, fractions, signs and out-of-range values', () => {
    for (const bad of ['', '  ', 'abc', '63', '20001', '-5', '12.5', '1e3', '٣٠٠٠', '0x40', '1,600']) {
      expect(parseLongSide(bad), bad).toBeNull();
    }
  });
});
