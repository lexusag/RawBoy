import { Mat3, type M3 } from './Mat3';

/**
 * A colour filter for black and white (RawBoy Film's B&W mode; port of color/BwFilter.kt): like a glass filter on the
 * lens, it passes its own colour and holds back the others. Gains on linear Rec.2020 after white balance (rough
 * Wratten 8 / 21 / 25 / 11 transmissions), divided by their luminance so middle grey keeps its exposure.
 */
export type BwFilter = 'none' | 'yellow' | 'orange' | 'red' | 'green';

export const BW_FILTERS: readonly { key: BwFilter; label: string; gains: readonly [number, number, number] }[] = [
  { key: 'none', label: 'None', gains: [1, 1, 1] },
  { key: 'yellow', label: 'Yellow', gains: [1, 0.92, 0.35] },
  { key: 'orange', label: 'Orange', gains: [1, 0.6, 0.12] },
  { key: 'red', label: 'Red', gains: [1, 0.18, 0.03] },
  { key: 'green', label: 'Green', gains: [0.4, 1, 0.35] },
];

/** Row-major diagonal gains, luminance-normalised (Rec.2020, as LUMA_REC2020); identity for 'none' or unknown keys. */
export function bwFilterMatrix(f: BwFilter | undefined): M3 {
  const [r, g, b] = BW_FILTERS.find((x) => x.key === f)?.gains ?? [1, 1, 1];
  const y = 0.2627 * r + 0.678 * g + 0.0593 * b;
  return Mat3.diagonal(r / y, g / y, b / y);
}
