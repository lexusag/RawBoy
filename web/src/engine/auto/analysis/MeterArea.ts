/**
 * Where analyzeScene meters exposure, in fractions of the upright image (x right, y down). Port of MeterArea.kt
 * (the web has no camera; kept in step with the native ports).
 */
export type MeterArea =
  /** The centred box this fraction of the width and height (0.5 = middle half each way). */
  | { kind: 'centre'; fraction: number }
  /** A square `size` of the short side around (x, y), moved inside the frame near an edge. */
  | { kind: 'spot'; x: number; y: number; size: number };

/** Tap metering: 16% of the short side (about the size of the focus ring). */
export const SPOT_SIZE = 0.16;

export const meterCentre = (fraction: number): MeterArea => ({ kind: 'centre', fraction });
export const meterSpot = (x: number, y: number, size = SPOT_SIZE): MeterArea => ({ kind: 'spot', x, y, size });

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Pixel box [x0, x1) × [y0, y1) in a width × height image: never empty, always inside it. */
export function meterBox(area: MeterArea, width: number, height: number): [number, number, number, number] {
  if (area.kind === 'centre') {
    const x0 = Math.trunc(((1 - area.fraction) / 2) * width);
    const y0 = Math.trunc(((1 - area.fraction) / 2) * height);
    return [x0, Math.max(x0 + 1, width - x0), y0, Math.max(y0 + 1, height - y0)];
  }
  const short = Math.min(width, height);
  const side = clamp(Math.round(area.size * short), 1, short);
  const x0 = clamp(Math.round(area.x * width - side / 2), 0, width - side);
  const y0 = clamp(Math.round(area.y * height - side / 2), 0, height - side);
  return [x0, x0 + side, y0, y0 + side];
}

/** The same area in a photo taken with the device turned `deviceDegrees` clockwise from portrait. */
export function meterTurned(area: MeterArea, deviceDegrees: number): MeterArea {
  if (area.kind !== 'spot') return area;
  const { x, y } = area;
  switch (((deviceDegrees % 360) + 360) % 360) {
    case 90: return { ...area, x: 1 - y, y: x };
    case 180: return { ...area, x: 1 - x, y: 1 - y };
    case 270: return { ...area, x: y, y: 1 - x };
    default: return area;
  }
}
