import type { PhotoMetadata } from '../../worker/protocol';

/** One decimal, without a trailing ".0". */
const trim = (v: number) => {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};

/** 1/60 s below a second (rounded to a whole denominator), 2.5 s / 30 s above. */
export const formatShutter = (t: number) => (t >= 0.95 ? `${trim(t)} s` : `1/${Math.round(1 / t)} s`);

const known = (v: number) => Number.isFinite(v) && v > 0;

/**
 * The editor's info line, e.g. "GFX 50R · ISO 6400 · 1/60 s · f/2.8 · 63 mm (50 mm eq.)" (port of raw/ShotInfo.kt);
 * unknown values are left out.
 */
export function shotInfoLine(camera: string, m: PhotoMetadata): string {
  const parts: string[] = [];
  if (camera.trim()) parts.push(camera.trim());
  if (m.iso > 0) parts.push(`ISO ${Math.round(m.iso)}`);
  if (known(m.exposureTime)) parts.push(formatShutter(m.exposureTime));
  if (known(m.fNumber)) parts.push(`f/${trim(m.fNumber)}`);
  if (known(m.focalLength)) {
    const eq = known(m.focalLength35mm) && Math.abs(m.focalLength35mm - m.focalLength) >= 1 ? ` (${Math.round(m.focalLength35mm)} mm eq.)` : '';
    parts.push(`${Math.round(m.focalLength)} mm${eq}`);
  }
  return parts.join(' · ');
}
