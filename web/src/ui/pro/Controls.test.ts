import { describe, expect, it } from 'vitest';
import { accumulateWheelSteps } from './Controls';

describe('accumulateWheelSteps', () => {
  it('steps immediately on a single mouse wheel notch', () => {
    // Wheel scrolled down: notches < 0 (delta > 0) -> step forward +1
    const down = accumulateWheelSteps(0, -1);
    expect(down.steps).toBe(1);
    expect(down.newAcc).toBe(0);

    // Wheel scrolled up: notches > 0 (delta < 0) -> step backward -1
    const up = accumulateWheelSteps(0, 1);
    expect(up.steps).toBe(-1);
    expect(up.newAcc).toBe(0);
  });

  it('steps multiple increments for rapid mouse wheel turns', () => {
    const fast = accumulateWheelSteps(0, -3);
    expect(fast.steps).toBe(3);
    expect(fast.newAcc).toBe(0);
  });

  it('accumulates fractional trackpad events until a full step is reached', () => {
    // First small trackpad move down (notches = -0.4)
    const step1 = accumulateWheelSteps(0, -0.4);
    expect(step1.steps).toBe(0);
    expect(step1.newAcc).toBeCloseTo(0.4);

    // Second small move down (notches = -0.7)
    const step2 = accumulateWheelSteps(step1.newAcc, -0.7);
    expect(step2.steps).toBe(1);
    expect(step2.newAcc).toBeCloseTo(0.1);
  });

  it('resets accumulator when changing scroll direction', () => {
    // Scrolling down slightly
    const down = accumulateWheelSteps(0, -0.6);
    expect(down.steps).toBe(0);
    expect(down.newAcc).toBeCloseTo(0.6);

    // Reverse direction: scroll up slightly
    const up = accumulateWheelSteps(down.newAcc, 0.3);
    expect(up.steps).toBe(0);
    expect(up.newAcc).toBeCloseTo(-0.3);
  });

  it('ignores 0 notches', () => {
    const res = accumulateWheelSteps(0.5, 0);
    expect(res.steps).toBe(0);
    expect(res.newAcc).toBe(0.5);
  });
});
