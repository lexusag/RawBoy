// The frame overlay (`uFrame`, shaders/develop.glsl `applyFrame`): a plain solid border drawn inside the output picture,
// so the export keeps its size. DevelopParams.frame is its thickness in % of the short side (0 = off),
// DevelopParams.frameColor its colour as `#rrggbb` (display sRGB). Port of Frame.kt.

export const FRAME_MAX = 20;
export const FRAME_DEFAULT_COLOR = '#000000';

/** The colours the pickers offer; any `#rrggbb` in a preset or edit works too. */
export const FRAME_COLORS: readonly { label: string; hex: string }[] = [
  { label: 'Black', hex: '#000000' },
  { label: 'White', hex: '#ffffff' },
  { label: 'Cream', hex: '#f1ead8' },
  { label: 'Grey', hex: '#808080' },
];

/** `#rrggbb` (or `rrggbb`) as 0..1 sRGB, or black for anything else. */
export function frameRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** hex when it is a valid `#rrggbb`, lower case, else null. */
export function normalizeFrameColor(hex: unknown): string | null {
  if (typeof hex !== 'string') return null;
  const h = hex.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null;
}
