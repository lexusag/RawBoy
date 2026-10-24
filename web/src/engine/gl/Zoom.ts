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
/** The view's size less a frame on both sides. */
const inner = (size: number, frame: number) => Math.max(1, size - 2 * frame);

/**
 * Geometry of the zoomed view, centred on (cx, cy): [scale] device pixels per full-resolution pixel, 1 = the 100% view
 * (the only one the apps have; the web's mouse-wheel zoom on desktop uses other scales).
 */
export const ZoomMath = {
  /** Wheel zoom's limits, device pixels per full-resolution pixel (out past the fit view goes back to it). */
  MAX_SCALE: 4,
  /** Margin kept around the visible region so denoise has real neighbours. */
  HALO: 16,
  MIN_TILE: 2048,
  TILE_SLACK: 512,

  /**
   * Keeps the visible region inside the image. [frame]: the band the zoomed view keeps around the photo on every
   * side, device pixels, so the photo shows inside the view minus the frame.
   */
  clampCenter(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number, scale = 1, frame = 0): [number, number] {
    const halfW = Math.min(inner(viewW, frame) / scale, imgW) / 2;
    const halfH = Math.min(inner(viewH, frame) / scale, imgH) / 2;
    return [clamp(cx, halfW, imgW - halfW), clamp(cy, halfH, imgH - halfH)];
  },

  /** The full-resolution region visible on screen (inside the [frame], as for [clampCenter]). */
  viewRect(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number, scale = 1, frame = 0): PixelRect {
    viewW = inner(viewW, frame);
    viewH = inner(viewH, frame);
    if (scale !== 1) {
      // Fractional pixels: whole ones would make panning jump [scale] device pixels at a time.
      const w = Math.min(viewW / scale, imgW);
      const h = Math.min(viewH / scale, imgH);
      return rect(coerceIn(cx - w / 2, 0, imgW - w), coerceIn(cy - h / 2, 0, imgH - h), w, h);
    }
    const w = Math.min(viewW, imgW);
    const h = Math.min(viewH, imgH);
    const x = coerceIn(Math.round(cx - w / 2), 0, imgW - w);
    const y = coerceIn(Math.round(cy - h / 2), 0, imgH - h);
    return rect(x, y, w, h);
  },

  /**
   * Where the whole output image sits in the zoomed view ([scale] device pixels per image pixel), as [left, top,
   * width, height] in device pixels: the visible region is centred like DevelopRenderer.drawZoomed's quad.
   */
  zoomedRect(cx: number, cy: number, viewW: number, viewH: number, imgW: number, imgH: number, scale = 1, frame = 0): number[] {
    const v = ZoomMath.viewRect(cx, cy, viewW, viewH, imgW, imgH, scale, frame);
    return [(viewW - v.width * scale) / 2 - v.x * scale, (viewH - v.height * scale) / 2 - v.y * scale, imgW * scale, imgH * scale];
  },

  /** The fit view's scale: device pixels per full-resolution pixel. */
  fitScale(viewW: number, viewH: number, imgW: number, imgH: number, frame: number): number {
    return ZoomMath.fitRect(viewW, viewH, imgW, imgH, frame)[2] / imgW;
  },

  /**
   * Whether the downscaled preview is sharp enough at [scale] (a wheel zoom between fit and 100%): at most a quarter
   * upsampled. Above it the view needs a full-resolution tile.
   */
  previewSuffices(scale: number, previewWidth: number, fullWidth: number): boolean {
    return scale <= (1.25 * previewWidth) / fullWidth;
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
