/** A full-resolution region in pixels (port of gl/Zoom.kt's PixelRect). */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rect = (x: number, y: number, width: number, height: number): PixelRect => ({ x, y, width, height });
export const right = (r: PixelRect) => r.x + r.width;
export const bottom = (r: PixelRect) => r.y + r.height;
export const contains = (r: PixelRect, o: PixelRect) =>
  o.x >= r.x && o.y >= r.y && right(o) <= right(r) && bottom(o) <= bottom(r);

/** A full-resolution region (RGB half floats) used for the 100% view. */
export interface DetailTile {
  rect: PixelRect;
  pixels: Uint16Array;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Kotlin's coerceIn: lo wins when lo > hi, so the result never passes it. */
const coerceIn = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Geometry of the 100% view: one full-resolution pixel per screen pixel, centred on (cx, cy). */
export const ZoomMath = {
  /** Margin kept around the visible region so denoise has real neighbours. */
  HALO: 16,
  MIN_TILE: 2048,
  TILE_SLACK: 512,

  /** Keeps the visible region inside the image. */
  clampCenter(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number): [number, number] {
    const halfW = Math.min(viewW, imgW) / 2;
    const halfH = Math.min(viewH, imgH) / 2;
    return [clamp(cx, halfW, imgW - halfW), clamp(cy, halfH, imgH - halfH)];
  },

  /** The full-resolution region visible on screen. */
  viewRect(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number): PixelRect {
    const w = Math.min(viewW, imgW);
    const h = Math.min(viewH, imgH);
    const x = coerceIn(Math.round(cx - w / 2), 0, imgW - w);
    const y = coerceIn(Math.round(cy - h / 2), 0, imgH - h);
    return rect(x, y, w, h);
  },

  /**
   * Where the whole output image sits in the 100% view (one image pixel per device pixel), as [left, top, width,
   * height] in device pixels: the visible region is centred like DevelopRenderer.drawZoomed's quad.
   */
  zoomedRect(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number): number[] {
    const v = ZoomMath.viewRect(cx, cy, viewW, viewH, imgW, imgH);
    return [(viewW - v.width) / 2 - v.x, (viewH - v.height) / 2 - v.y, imgW, imgH];
  },

  /** A tile around [needed] (source pixels), large enough that panning rarely reloads. */
  tileAround(needed: PixelRect, imgW: number, imgH: number): PixelRect {
    const w = Math.min(imgW, Math.max(ZoomMath.MIN_TILE, needed.width + ZoomMath.TILE_SLACK));
    const h = Math.min(imgH, Math.max(ZoomMath.MIN_TILE, needed.height + ZoomMath.TILE_SLACK));
    const x = coerceIn(needed.x + Math.trunc(needed.width / 2) - Math.trunc(w / 2), 0, imgW - w);
    const y = coerceIn(needed.y + Math.trunc(needed.height / 2) - Math.trunc(h / 2), 0, imgH - h);
    return rect(x, y, w, h);
  },

  /** Aspect-fit inside the view minus a [frame] on every side, centred: [left, top, width, height]. */
  fitRect(viewW: number, viewH: number, imgW: number, imgH: number, frame: number): number[] {
    const availW = Math.max(1, viewW - 2 * frame);
    const availH = Math.max(1, viewH - 2 * frame);
    const scale = Math.min(availW / imgW, availH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return [(viewW - w) / 2, (viewH - h) / 2, w, h];
  },

  /** Maps a point in the fit view to full-resolution coordinates, or null if outside the photo. */
  fitToImage(px: number, py: number, viewW: number, viewH: number, imgW: number, imgH: number, frame: number): [number, number] | null {
    const r = ZoomMath.fitRect(viewW, viewH, imgW, imgH, frame);
    const x = ((px - r[0]) / r[2]) * imgW;
    const y = ((py - r[1]) / r[3]) * imgH;
    return x >= 0 && x <= imgW && y >= 0 && y <= imgH ? [x, y] : null;
  },
};
