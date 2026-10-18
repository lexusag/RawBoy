import type { DevelopParams } from '../develop/DevelopParams';
import { Mat3, type M3 } from './Mat3';
import { Primaries } from './Primaries';

/** The RGB primaries sliders, for [PrimariesTrack]. */
export type PrimariesSlider = 'redHue' | 'redPurity' | 'greenHue' | 'greenPurity' | 'blueHue' | 'bluePurity' | 'tintHue' | 'tintPurity';

// Linear sRGB <-> Rec.2020 (row-major).
const SRGB_TO_REC2020: M3 = [
  0.627404, 0.329282, 0.0433136,
  0.069097, 0.91954, 0.0113612,
  0.0163916, 0.0880132, 0.895595,
];
const REC2020_TO_SRGB: M3 = [
  1.660491, -0.5876411, -0.0728499,
  -0.1245505, 1.1328999, -0.0083494,
  -0.0181508, -0.1005789, 1.1187297,
];

/** Samples in linear Rec.2020: (1, 0.18, 0.18) in linear sRGB and its permutations; grey. */
const SAMPLE_OTHER = 0.18;
const RED = Mat3.apply(SRGB_TO_REC2020, [1, SAMPLE_OTHER, SAMPLE_OTHER]);
const GREEN = Mat3.apply(SRGB_TO_REC2020, [SAMPLE_OTHER, 1, SAMPLE_OTHER]);
const BLUE = Mat3.apply(SRGB_TO_REC2020, [SAMPLE_OTHER, SAMPLE_OTHER, 1]);
const GREY = [1, 1, 1];

/** Linear sRGB -> normalised, clipped, sRGB-encoded. */
function encode(rgb: number[]): number[] {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
  return rgb.map((v) => {
    const c = Math.min(1, Math.max(0, v / peak));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  });
}

/**
 * Track colours for the RGB primaries sliders (port of color/PrimariesTrack.kt): what a sample patch turns into at
 * each slider position, through the same [Primaries.fromParams] the develop uses, with the other primaries sliders at
 * their current values. Red, green and blue take a fairly saturated colour of their own hue as their sample (a pure
 * sRGB primary would clip, so more purity wouldn't show), the tint sliders neutral grey. Brightness is normalised
 * (max channel = 1) so only hue and purity show.
 *
 * Exception: the Tint hue track is drawn at full Tint purity, since at 0 it would be plain grey.
 */
export const PrimariesTrack = {
  /** [steps] sRGB-encoded colours (0..1) across min..max, left to right. */
  colors(p: DevelopParams, slider: PrimariesSlider, min: number, max: number, steps = 13): number[][] {
    const sample = slider.startsWith('red') ? RED : slider.startsWith('green') ? GREEN : slider.startsWith('blue') ? BLUE : GREY;
    return Array.from({ length: steps }, (_, i) => {
      const v = min + ((max - min) * i) / (steps - 1);
      const q = slider === 'tintHue' ? { ...p, tintHue: v, tintPurity: 100 } : { ...p, [slider]: v };
      return encode(Mat3.apply(REC2020_TO_SRGB, Mat3.apply(Primaries.fromParams(q), sample)));
    });
  },
};
