import type { DevelopParams } from '../../develop/DevelopParams';

/**
 * Warms or cools a white balance so it still looks natural (port of Warmth.kt): the temperature moves by a factor
 * in Kelvin, and tint follows. Each mired of warming adds a little magenta; cooling adds a little green.
 * Tint follows Lightroom: + makes the image more magenta.
 */
const MAGENTA_PER_MIRED = 0.25;

export const Warmth = {
  /** Wider than Pro's slider (2000..12000 K): Warmth on top of the default can put daylight well above 12000 K. */
  MIN_KELVIN: 2000,
  MAX_KELVIN: 25000,

  /** [p] with its temperature multiplied by [factor] (> 1 = warmer) and the matching tint. */
  shift(p: DevelopParams, factor: number): DevelopParams {
    if (factor === 1) return p;
    const kelvin = Math.min(Warmth.MAX_KELVIN, Math.max(Warmth.MIN_KELVIN, p.temperature * factor));
    const warmingMired = 1e6 / p.temperature - 1e6 / kelvin;
    return { ...p, temperature: kelvin, tint: Math.min(100, Math.max(-100, p.tint + warmingMired * MAGENTA_PER_MIRED)) };
  },
};
