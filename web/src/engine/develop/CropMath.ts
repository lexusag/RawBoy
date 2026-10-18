import type { DevelopParams } from './DevelopParams';

/**
 * User crop (port of develop/CropMath.kt): edges as fractions (0..1) of the rotated + straightened frame, i.e.
 * the whole picture the Crop & rotate tool shows. The crop is the last geometry step and never changes lens
 * correction or the straighten auto crop, which always work on the full frame.
 */
export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const FULL_CROP: Readonly<CropRect> = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });

/** Smallest crop side in frame pixels. */
export const MIN_CROP_PIXELS = 64;

export const isFullCrop = (r: CropRect): boolean => r.left <= 0 && r.top <= 0 && r.right >= 1 && r.bottom >= 1;

export const cropOf = (p: DevelopParams): CropRect => ({ left: p.cropLeft, top: p.cropTop, right: p.cropRight, bottom: p.cropBottom });

export const withCrop = (p: DevelopParams, r: CropRect): DevelopParams => ({
  ...p,
  cropLeft: r.left,
  cropTop: r.top,
  cropRight: r.right,
  cropBottom: r.bottom,
});

/** The same edit on the whole frame: what the Crop & rotate tool shows while it is open. */
export const withoutCrop = (p: DevelopParams): DevelopParams => withCrop(p, FULL_CROP);

/** Crop aspect ratios offered by the tool, as long side : short side (orientation is chosen separately). */
export type CropAspect = 'free' | 'original' | '1:1' | '5:4' | '4:3' | '3:2' | '16:9';

export const CROP_ASPECTS: readonly CropAspect[] = ['free', 'original', '1:1', '5:4', '4:3', '3:2', '16:9'];

export function cropAspectLabel(a: CropAspect, portrait: boolean): string {
  if (a === 'free') return 'Free';
  if (a === 'original') return 'Original';
  if (a === '1:1') return a;
  const [long, short] = a.split(':');
  return portrait ? `${short}:${long}` : `${long}:${short}`;
}

/** Width / height in pixels, or null for free. */
export function cropAspectRatio(a: CropAspect, frameWidth: number, frameHeight: number, portrait: boolean): number | null {
  if (a === 'free') return null;
  if (a === 'original') {
    const r = frameWidth / frameHeight;
    return portrait ? Math.min(r, 1 / r) : Math.max(r, 1 / r);
  }
  const [long, short] = a.split(':').map(Number);
  return portrait ? short / long : long / short;
}

export type CropHandle = 'move' | 'left' | 'top' | 'right' | 'bottom' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function fromPixels(l: number, t: number, r: number, b: number, fw: number, fh: number): CropRect {
  return { left: clamp(l / fw, 0, 1), top: clamp(t / fh, 0, 1), right: clamp(r / fw, 0, 1), bottom: clamp(b / fh, 0, 1) };
}

/** The crop after turning the picture by quarterTurns clockwise quarter turns. */
export function rotateCrop(r: CropRect, quarterTurns: number): CropRect {
  let c = r;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    // Clockwise: frame point (x, y) moves to (1 - y, x).
    c = { left: 1 - c.bottom, top: c.left, right: 1 - c.top, bottom: c.right };
  }
  return c;
}

/**
 * p with the picture as shown mirrored left-right ([vertical] false) or top-bottom. The flips are stored on the
 * unturned photo, so a sideways turn swaps the axis; the straighten angle and the crop mirror with the picture.
 */
export function flipped(p: DevelopParams, vertical: boolean): DevelopParams {
  const f = vertical !== (p.rotation % 2 === 1) ? { ...p, flipVertical: !p.flipVertical } : { ...p, flipHorizontal: !p.flipHorizontal };
  const r = cropOf(p);
  const crop = vertical ? { ...r, top: 1 - r.bottom, bottom: 1 - r.top } : { ...r, left: 1 - r.right, right: 1 - r.left };
  return withCrop({ ...f, straighten: p.straighten === 0 ? 0 : -p.straighten }, crop);
}

/**
 * r reshaped to ratio (width / height in pixels) with about the same area, around the same centre, inside the
 * frame. Null ratio = free: r unchanged.
 */
export function cropWithAspect(r: CropRect, ratio: number | null, frameWidth: number, frameHeight: number): CropRect {
  if (ratio == null) return r;
  const fw = frameWidth;
  const fh = frameHeight;
  const area = (r.right - r.left) * fw * (r.bottom - r.top) * fh;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const fit = Math.min(1, fw / w, fh / h);
  w *= fit;
  h *= fit;
  const cx = clamp(((r.left + r.right) / 2) * fw, w / 2, fw - w / 2);
  const cy = clamp(((r.top + r.bottom) / 2) * fh, h / 2, fh - h / 2);
  return fromPixels(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, fw, fh);
}

/**
 * start after dragging handle by (dx, dy) in frame fractions, kept inside the frame, at least MIN_CROP_PIXELS
 * wide and high, and at ratio (width / height in pixels) when not null.
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  frameWidth: number,
  frameHeight: number,
): CropRect {
  const fw = frameWidth;
  const fh = frameHeight;
  const minW = Math.min(MIN_CROP_PIXELS, fw);
  const minH = Math.min(MIN_CROP_PIXELS, fh);
  const l = start.left * fw;
  const t = start.top * fh;
  const r = start.right * fw;
  const b = start.bottom * fh;
  const mx = dx * fw;
  const my = dy * fh;

  if (handle === 'move') {
    const ox = clamp(mx, -l, fw - r);
    const oy = clamp(my, -t, fh - b);
    return fromPixels(l + ox, t + oy, r + ox, b + oy, fw, fh);
  }

  const movesLeft = handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft';
  const movesRight = handle === 'right' || handle === 'topRight' || handle === 'bottomRight';
  const movesTop = handle === 'top' || handle === 'topLeft' || handle === 'topRight';
  const movesBottom = handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight';

  if (ratio == null) {
    const nl = movesLeft ? clamp(l + mx, 0, r - minW) : l;
    const nr = movesRight ? clamp(r + mx, l + minW, fw) : r;
    const nt = movesTop ? clamp(t + my, 0, b - minH) : t;
    const nb = movesBottom ? clamp(b + my, t + minH, fh) : b;
    return fromPixels(nl, nt, nr, nb, fw, fh);
  }

  const horizontal = movesLeft || movesRight;
  const vertical = movesTop || movesBottom;
  // Anchor: the opposite edge (or corner); a single edge keeps the other axis centred.
  const ax = movesLeft ? r : movesRight ? l : (l + r) / 2;
  const ay = movesTop ? b : movesBottom ? t : (t + b) / 2;
  const wantW = horizontal ? Math.abs((movesLeft ? l + mx : r + mx) - ax) : 0;
  const wantH = vertical ? Math.abs((movesTop ? t + my : b + my) - ay) : 0;
  let w = Math.max(wantW, wantH * ratio);
  // Room around the anchor, per axis (both halves when that axis stays centred).
  const roomW = movesLeft ? ax : movesRight ? fw - ax : 2 * Math.min(ax, fw - ax);
  const roomH = movesTop ? ay : movesBottom ? fh - ay : 2 * Math.min(ay, fh - ay);
  const room = Math.min(roomW, roomH * ratio);
  w = Math.min(Math.max(Math.min(w, room), minW, minH * ratio), room);
  const h = w / ratio;
  const nl = movesLeft ? ax - w : movesRight ? ax : ax - w / 2;
  const nt = movesTop ? ay - h : movesBottom ? ay : ay - h / 2;
  return fromPixels(nl, nt, nl + w, nt + h, fw, fh);
}

/**
 * The handle under frame point (x, y) (fractions), with grab distances tolX, tolY in fractions: corners first,
 * then edges, then inside = move. Null outside the crop.
 */
export function cropHandleAt(r: CropRect, x: number, y: number, tolX: number, tolY: number): CropHandle | null {
  const nearL = Math.abs(x - r.left) <= tolX;
  const nearR = Math.abs(x - r.right) <= tolX;
  const nearT = Math.abs(y - r.top) <= tolY;
  const nearB = Math.abs(y - r.bottom) <= tolY;
  const inX = x >= r.left - tolX && x <= r.right + tolX;
  const inY = y >= r.top - tolY && y <= r.bottom + tolY;
  if (!inX || !inY) return null;
  if (nearT && nearL) return 'topLeft';
  if (nearT && nearR) return 'topRight';
  if (nearB && nearL) return 'bottomLeft';
  if (nearB && nearR) return 'bottomRight';
  if (nearL) return 'left';
  if (nearR) return 'right';
  if (nearT) return 'top';
  if (nearB) return 'bottom';
  return 'move';
}
