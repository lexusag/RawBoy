import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { effectiveParams, sectionHasEdits, withSectionsEnabled } from '../develop/EditSections';

const defaults = { ...DEFAULT_PARAMS, temperature: 4800 };

describe('edit sections', () => {
  it('a switched-off section renders the defaults and keeps its values', () => {
    const p = withSectionsEnabled({ ...defaults, exposure: 1.5, saturation: 30 }, ['light'], false);
    const eff = effectiveParams(p, defaults);
    expect(eff.exposure).toBe(0);
    expect(eff.saturation).toBe(30);
    expect(p.exposure).toBe(1.5);
  });

  it('nothing off is the same object', () => {
    const p = { ...defaults, contrast: 10 };
    expect(effectiveParams(p, defaults)).toBe(p);
  });

  it('LUT off drops the LUT and Colour off returns to the as-shot white balance', () => {
    const p = withSectionsEnabled({ ...defaults, lut: 'x', temperature: 6500 }, ['lut', 'colour'], false);
    const eff = effectiveParams(p, defaults);
    expect(eff.lut).toBeNull();
    expect(eff.temperature).toBe(4800);
  });

  it('a switched-off section keeps its switch even without edits, and turning it on clears it', () => {
    const off = withSectionsEnabled(defaults, ['lens'], false);
    expect(sectionHasEdits(off, defaults, 'lens')).toBe(true);
    expect(withSectionsEnabled(off, ['lens'], true).disabledSections).toEqual([]);
  });

  it('round-trips through the edits file, and writes nothing when none are off', () => {
    const p = withSectionsEnabled({ ...defaults, exposure: 1 }, ['light', 'lens'], false);
    const text = encodeEdits(p, defaults)!;
    expect(decodeEdits(text, defaults)?.disabledSections).toEqual(['light', 'lens']);
    expect(encodeEdits(defaults, defaults)).toBeNull();
  });
});
