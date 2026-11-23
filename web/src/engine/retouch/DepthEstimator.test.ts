import { describe, expect, it } from 'vitest';
import { applyPerson, toDepth } from './DepthEstimator';

describe('DepthEstimator', () => {
  it('turns inverse depth into 0 near .. 1 far over the 2nd..98th percentiles', () => {
    const inv = Float32Array.from({ length: 100 }, (_, i) => i);
    const d = toDepth(inv);
    expect(d[99]).toBe(0); // nearest
    expect(d[0]).toBe(1); // farthest
    expect(d[50]).toBeCloseTo(1 - (50 - 2) / (98 - 2), 5);
  });

  it('pulls see-through parts of a person to their depth and focuses on them', () => {
    // 10x10: a person (left half) at 0.2, the wall at 0.9; one "glasses" pixel inside the person reads the wall.
    const depth = new Float32Array(100).fill(0.9);
    const person = new Float32Array(100);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) { depth[y * 10 + x] = 0.2; person[y * 10 + x] = 1; }
    depth[22] = 0.9;
    const [subject, focus] = applyPerson(depth, person);
    expect(subject).toBe(true);
    expect(focus).toBeCloseTo(0.2, 5);
    expect(depth[22]).toBeCloseTo(0.28, 5);
    expect(depth[7]).toBeCloseTo(0.9, 5); // the wall stays
  });

  it('without a person, focuses on the middle', () => {
    const depth = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const [subject, focus] = applyPerson(depth, new Float32Array(100));
    expect(subject).toBe(false);
    expect(focus).toBeCloseTo(0.5, 5);
  });
});
