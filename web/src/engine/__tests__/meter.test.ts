import { describe, expect, it } from 'vitest';
import { meterBox, meterCentre, meterSpot, meterTurned } from '../auto/analysis/MeterArea';

// The same cases as MeterAreaTest.kt.
describe('Camera metering boxes', () => {
  it('centre is the middle half', () => {
    expect(meterBox(meterCentre(0.5), 512, 384)).toEqual([128, 384, 96, 288]);
  });

  it('spot is a square of the short side around the tap', () => {
    expect(meterBox(meterSpot(0.5, 0.25), 512, 384)).toEqual([226, 287, 66, 127]);
  });

  it('spot near an edge moves inside at full size', () => {
    expect(meterBox(meterSpot(0, 1), 512, 384)).toEqual([0, 61, 323, 384]);
    expect(meterBox(meterSpot(1.2, -0.1), 512, 384)).toEqual([451, 512, 0, 61]);
  });

  it('spot turns with the device', () => {
    const tap = meterSpot(0.2, 0.1);
    const at = (d: number) => {
      const a = meterTurned(tap, d);
      return a.kind === 'spot' ? [a.x, a.y] : [];
    };
    expect(at(0)).toEqual([0.2, 0.1]);
    expect(at(90)[0]).toBeCloseTo(0.9);
    expect(at(90)[1]).toBeCloseTo(0.2);
    expect(at(180)[0]).toBeCloseTo(0.8);
    expect(at(180)[1]).toBeCloseTo(0.9);
    expect(at(270)[0]).toBeCloseTo(0.1);
    expect(at(270)[1]).toBeCloseTo(0.8);
  });
});
