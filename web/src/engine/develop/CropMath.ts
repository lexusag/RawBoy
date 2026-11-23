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

/** How far a crop may reach past each edge of the frame (fraction of that side); the canvas there is filled. */
export const MAX_EXTEND = 0.3;

export const isFullCrop = (r: CropRect): boolean => r.left === 0 && r.top === 0 && r.right === 1 && r.bottom === 1;

/** True when r reaches past the frame, so part of the output is canvas to fill. */
export const extendsFrame = (r: CropRect): boolean => r.left < 0 || r.top < 0 || r.right > 1 || r.bottom > 1;

export const cropOf = (p: DevelopParams): CropRect => ({ left: p.cropLeft, top: p.cropTop, right: p.cropRight, bottom: p.cropBottom });

export const withCrop = (p: DevelopParams, r: CropRect): DevelopParams => ({
  ...p,
  cropLeft: r.left,
  cropTop: r.top,
  cropRight: r.right,
  cropBottom: r.bottom,
});

/** Which edges of the frame the crop may reach past (Extend canvas, chosen per side). */
export interface ExtendSides {
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
}

export const NO_SIDES: Readonly<ExtendSides> = Object.freeze({ left: false, top: false, right: false, bottom: false });
export const ALL_SIDES: Readonly<ExtendSides> = Object.freeze({ left: true, top: true, right: true, bottom: true });

export const anySide = (s: ExtendSides): boolean => s.left || s.top || s.right || s.bottom;

/** The sides r reaches past the frame. */
export const sidesOf = (r: CropRect): ExtendSides => ({ left: r.left < 0, top: r.top < 0, right: r.right > 1, bottom: r.bottom > 1 });

export const unionSides = (a: ExtendSides, b: ExtendSides): ExtendSides => ({
  left: a.left || b.left,
  top: a.top || b.top,
  right: a.right || b.right,
  bottom: a.bottom || b.bottom,
});

export const sameSides = (a: ExtendSides, b: ExtendSides): boolean => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/**
 * The canvas the crop tool shows while extending: the frame plus MAX_EXTEND past each chosen edge, as a crop of the
 * frame. [cropToView] / [cropFromView] map a crop to and from fractions of that canvas, so the tool's frame, grid and
 * drags work as on the plain frame, and a side that is not extended ends at the photo's edge.
 */
export const extendedView = (s: ExtendSides): CropRect => ({
  left: s.left ? -MAX_EXTEND : 0,
  top: s.top ? -MAX_EXTEND : 0,
  right: 1 + (s.right ? MAX_EXTEND : 0),
  bottom: 1 + (s.bottom ? MAX_EXTEND : 0),
});
export const cropToView = (r: CropRect, s: ExtendSides = ALL_SIDES): CropRect => {
  const v = extendedView(s);
  const w = v.right - v.left;
  const h = v.bottom - v.top;
  return { left: (r.left - v.left) / w, top: (r.top - v.top) / h, right: (r.right - v.left) / w, bottom: (r.bottom - v.top) / h };
};
export const cropFromView = (c: CropRect, s: ExtendSides = ALL_SIDES): CropRect => {
  const v = extendedView(s);
  const w = v.right - v.left;
  const h = v.bottom - v.top;
  return { left: c.left * w + v.left, top: c.top * h + v.top, right: c.right * w + v.left, bottom: c.bottom * h + v.top };
};

/** r with each edge held to the canvas of [s]: the frame, plus MAX_EXTEND past the chosen sides (turning a side off). */
export const cropWithin = (r: CropRect, s: ExtendSides): CropRect => {
  const v = extendedView(s);
  return {
    left: Math.max(v.left, Math.min(v.right, r.left)),
    top: Math.max(v.top, Math.min(v.bottom, r.top)),
    right: Math.max(v.left, Math.min(v.right, r.right)),
    bottom: Math.max(v.top, Math.min(v.bottom, r.bottom)),
  };
};

/** r pulled back inside the frame (turning Extend off). */
export const cropInsideFrame = (r: CropRect): CropRect => cropWithin(r, NO_SIDES);

/** The same edit on the whole frame: what the Crop & rotate tool shows while it is open. */
export const withoutCrop = (p: DevelopParams): DevelopParams => withCrop(p, FULL_CROP);

/** Crop aspect ratios offered by the tool, as long side : short side (orientation is chosen separately). */
export type CropAspect = 'free' | 'original' | '1:1' | '5:4' | '4:3' | '3:2' | '16:9' | '2:1' | '2.39:1';

export const CROP_ASPECTS: readonly CropAspect[] = ['free', 'original', '1:1', '5:4', '4:3', '3:2', '16:9', '2:1', '2.39:1'];

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

function fromPixels(l: number, t: number, r: number, b: number, fw: number, fh: number, sides: ExtendSides = NO_SIDES): CropRect {
  const v = extendedView(sides);
  return { left: clamp(l / fw, v.left, v.right), top: clamp(t / fh, v.top, v.bottom), right: clamp(r / fw, v.left, v.right), bottom: clamp(b / fh, v.top, v.bottom) };
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
  // The keystone mirrors too: a left-right mirror turns the horizontal tilt the other way, top-bottom the vertical one.
  const perspective = vertical
    ? { perspectiveVertical: p.perspectiveVertical === 0 ? 0 : -p.perspectiveVertical }
    : { perspectiveHorizontal: p.perspectiveHorizontal === 0 ? 0 : -p.perspectiveHorizontal };
  return withCrop({ ...f, ...perspective, straighten: p.straighten === 0 ? 0 : -p.straighten }, crop);
}

/**
 * p's perspective sliders after turning the picture by quarterTurns clockwise quarter turns, so the keystone stays on
 * the same edges of the picture: clockwise, the vertical tilt becomes the horizontal one and the horizontal the
 * vertical (exact for one slider; with both set the two tilts apply in the other order, a small difference).
 */
export function rotatePerspective(p: DevelopParams, quarterTurns: number): DevelopParams {
  let v = p.perspectiveVertical;
  let h = p.perspectiveHorizontal;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) [v, h] = [h, v === 0 ? 0 : -v];
  return { ...p, perspectiveVertical: v, perspectiveHorizontal: h };
}

/**
 * r reshaped to ratio (width / height in pixels) with about the same area, around the same centre, inside the
 * frame. Null ratio = free: r unchanged.
 */
export function cropWithAspect(r: CropRect, ratio: number | null, frameWidth: number, frameHeight: number, sides: ExtendSides = NO_SIDES): CropRect {
  if (ratio == null) return r;
  const fw = frameWidth;
  const fh = frameHeight;
  const area = (r.right - r.left) * fw * (r.bottom - r.top) * fh;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const v = extendedView(sides);
  const fit = Math.min(1, ((v.right - v.left) * fw) / w, ((v.bottom - v.top) * fh) / h);
  w *= fit;
  h *= fit;
  const cx = clamp(((r.left + r.right) / 2) * fw, v.left * fw + w / 2, v.right * fw - w / 2);
  const cy = clamp(((r.top + r.bottom) / 2) * fh, v.top * fh + h / 2, v.bottom * fh - h / 2);
  return fromPixels(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, fw, fh, sides);
}

/**
 * How far the crop's edges are drawn to the photo's own edges while dragging (Extend canvas): [photo] is the photo's
 * rectangle in the same fractions as the crop, [tolX] / [tolY] the pull in those fractions (a few screen pixels).
 */
export interface CropSnap {
  photo: CropRect;
  tolX: number;
  tolY: number;
}

/** Screen pixels the crop sticks to a photo edge. */
export const SNAP_PIXELS = 8;

/**
 * start after dragging handle by (dx, dy) in frame fractions, kept inside the frame, at least MIN_CROP_PIXELS
 * wide and high, and at ratio (width / height in pixels) when not null. With snap, an edge that comes within its
 * pull of the photo's edge lands on it (dragging on past the pull lets go).
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  frameWidth: number,
  frameHeight: number,
  extend = false,
  snap: CropSnap | null = null,
): CropRect {
  const fw = frameWidth;
  const fh = frameHeight;
  // Bounds of the canvas the crop may use: the frame, plus MAX_EXTEND past each edge when extending.
  const ex = extend ? MAX_EXTEND : 0;
  const x0 = -ex * fw;
  const x1 = (1 + ex) * fw;
  const y0 = -ex * fh;
  const y1 = (1 + ex) * fh;
  const minW = Math.min(MIN_CROP_PIXELS, fw);
  const minH = Math.min(MIN_CROP_PIXELS, fh);
  const l = start.left * fw;
  const t = start.top * fh;
  const r = start.right * fw;
  const b = start.bottom * fh;
  let mx = dx * fw;
  let my = dy * fh;

  if (snap) {
    const movesAll = handle === 'move';
    const xs: number[] = [];
    const ys: number[] = [];
    if (movesAll || handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft') xs.push(snap.photo.left * fw - l);
    if (movesAll || handle === 'right' || handle === 'topRight' || handle === 'bottomRight') xs.push(snap.photo.right * fw - r);
    if (movesAll || handle === 'top' || handle === 'topLeft' || handle === 'topRight') ys.push(snap.photo.top * fh - t);
    if (movesAll || handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight') ys.push(snap.photo.bottom * fh - b);
    // The offset that would put an edge on the photo's edge, when the drag is within the pull of one.
    const pull = (want: number, offsets: number[], tol: number) => {
      let best = want;
      let gap = tol;
      for (const o of offsets) {
        if (Math.abs(o - want) <= gap) {
          best = o;
          gap = Math.abs(o - want);
        }
      }
      return best;
    };
    mx = pull(mx, xs, snap.tolX * fw);
    my = pull(my, ys, snap.tolY * fh);
  }

  if (handle === 'move') {
    const ox = clamp(mx, x0 - l, x1 - r);
    const oy = clamp(my, y0 - t, y1 - b);
    return fromPixels(l + ox, t + oy, r + ox, b + oy, fw, fh, extend ? ALL_SIDES : NO_SIDES);
  }

  const movesLeft = handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft';
  const movesRight = handle === 'right' || handle === 'topRight' || handle === 'bottomRight';
  const movesTop = handle === 'top' || handle === 'topLeft' || handle === 'topRight';
  const movesBottom = handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight';

  if (ratio == null) {
    const nl = movesLeft ? clamp(l + mx, x0, r - minW) : l;
    const nr = movesRight ? clamp(r + mx, l + minW, x1) : r;
    const nt = movesTop ? clamp(t + my, y0, b - minH) : t;
    const nb = movesBottom ? clamp(b + my, t + minH, y1) : b;
    return fromPixels(nl, nt, nr, nb, fw, fh, extend ? ALL_SIDES : NO_SIDES);
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
  const roomW = movesLeft ? ax - x0 : movesRight ? x1 - ax : 2 * Math.min(ax - x0, x1 - ax);
  const roomH = movesTop ? ay - y0 : movesBottom ? y1 - ay : 2 * Math.min(ay - y0, y1 - ay);
  const room = Math.min(roomW, roomH * ratio);
  w = Math.min(Math.max(Math.min(w, room), minW, minH * ratio), room);
  const h = w / ratio;
  const nl = movesLeft ? ax - w : movesRight ? ax : ax - w / 2;
  const nt = movesTop ? ay - h : movesBottom ? ay : ay - h / 2;
  return fromPixels(nl, nt, nl + w, nt + h, fw, fh, extend ? ALL_SIDES : NO_SIDES);
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
