import { describe, expect, it } from 'vitest';
import { autoExposure } from '../auto/analysis/AutoTone';
import { SceneStats } from '../auto/analysis/SceneAnalyzer';

describe('auto exposure', () => {
  // A face 3.2% of the frame with dark skin.
  const withFace = new SceneStats(0.0286, -8, -7, -5, -1.5, -1.3, 0, 0.1, 0, 0, 0.032, 0.0173, 183, new Int32Array(1));

  it('keeps a camera-metered raw at its own exposure, whatever the skin says', () => {
    expect(autoExposure(withFace, true)).toBe(0);
    expect(autoExposure(withFace, false)).not.toBe(0); // any other raw is steered by the skin
  });
});
