import { describe, expect, it } from 'vitest';
import { Mat3 } from '../color/Mat3';
import { BW_FILTERS, bwFilterMatrix, type BwFilter } from '../color/BwFilter';

// The same cases as BwFilterTest.kt.
describe('B&W colour filters', () => {
  const luma = (c: number[]) => 0.2627 * c[0] + 0.678 * c[1] + 0.0593 * c[2];
  const filtered = (f: BwFilter, rgb: number[]) => luma(Mat3.apply(bwFilterMatrix(f), rgb));

  it('keeps grey at its brightness through every filter', () => {
    for (const f of BW_FILTERS) expect(filtered(f.key, [0.18, 0.18, 0.18])).toBeCloseTo(0.18, 9);
  });

  it('is the identity for none', () => {
    expect(bwFilterMatrix('none')).toEqual(Mat3.diagonal(1, 1, 1));
  });

  it('lightens its own colour and darkens the opposite', () => {
    const sky = [0.1, 0.17, 0.35];
    const skin = [0.3, 0.17, 0.11];
    const leaves = [0.12, 0.22, 0.06];
    expect(filtered('red', sky)).toBeLessThan(filtered('orange', sky));
    expect(filtered('orange', sky)).toBeLessThan(filtered('yellow', sky));
    expect(filtered('yellow', sky)).toBeLessThan(filtered('none', sky));
    expect(filtered('red', skin)).toBeGreaterThan(filtered('none', skin));
    expect(filtered('green', skin)).toBeLessThan(filtered('none', skin));
    expect(filtered('green', leaves)).toBeGreaterThan(filtered('none', leaves));
  });
});
