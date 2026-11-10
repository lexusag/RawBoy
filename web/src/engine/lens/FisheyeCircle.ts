import type { PreviewImage } from '../gl/PreviewImage';
import { halfToFloat } from '../util/half';

/**
 * The picture circle of a circular fisheye, found on the 512 px base copy: centre as a fraction of the width and
 * height away from the frame's centre (-0.5..0.5), radius as a fraction of the frame's half diagonal (what the Image
 * circle size slider calls 100%).
 */
export interface FisheyeCircle {
  offsetX: number;
  offsetY: number;
  radius: number;
}

/** How much smaller than the measured edge the circle is taken: the rim of the circle is vignetted and soft. */
const SHRINK = 0.97;

/**
 * Looks for a bright disc on a dark surround. Null when the corners are not dark (a frame-filling fisheye or any
 * ordinary photo), when the bright area is not round, or when it fills the frame both ways. Port of
 * lens/FisheyeCircle.kt: keep them in step.
 *
 * The corners must be black next to the picture's bright end (1%: the circular fisheyes measured 0.03-0.07%, a dim
 * night photo with a frame-filling fisheye 9%). They give the threshold, columns and rows with a few pixels above it give
 * the disc's four extents (a lone hot pixel doesn't count). A circle taller (or wider) than the frame is sized from
 * its other extent and centred on the frame in that direction.
 */
export function detectFisheyeCircle(base: PreviewImage): FisheyeCircle | null {
  const { width: w, height: h, pixels } = base;
  if (w < 32 || h < 32) return null;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.2126 * halfToFloat(pixels[i * 3]) + 0.7152 * halfToFloat(pixels[i * 3 + 1]) + 0.0722 * halfToFloat(pixels[i * 3 + 2]);
  }
  return detectFisheyeCircleLum(lum, w, h);
}

export function detectFisheyeCircleLum(lum: Float32Array, w: number, h: number): FisheyeCircle | null {
  const s = Math.max(4, Math.round(0.04 * Math.min(w, h)));
  let corner = 0;
  for (const [x0, y0] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) {
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) corner += lum[y * w + x];
  }
  corner /= 4 * s * s;
  const sample: number[] = [];
  for (let i = 0; i < lum.length; i += 7) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  const p98 = sample[Math.floor(sample.length * 0.98)];
  if (!(p98 > 0) || corner > 0.01 * p98) return null;
  const thr = Math.max(corner * 4, 0.02 * p98);

  const cols = new Int32Array(w);
  const rows = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (lum[y * w + x] > thr) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  const MIN = 4;
  const first = (a: Int32Array) => a.findIndex((v) => v >= MIN);
  const last = (a: Int32Array) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] >= MIN) return i;
    return -1;
  };
  const left = first(cols);
  const right = last(cols);
  const top = first(rows);
  const bottom = last(rows);
  if (left < 0 || top < 0 || right <= left || bottom <= top) return null;

  const touchX = left <= 1 && right >= w - 2;
  const touchY = top <= 1 && bottom >= h - 2;
  if (touchX && touchY) return null;
  const dx = right - left + 1;
  const dy = bottom - top + 1;
  let diameter: number;
  if (touchX) diameter = dy;
  else if (touchY) diameter = dx;
  else {
    if (dx / dy < 0.8 || dx / dy > 1.25) return null;
    diameter = (dx + dy) / 2;
  }
  const cx = touchX ? w / 2 : (left + right + 1) / 2;
  const cy = touchY ? h / 2 : (top + bottom + 1) / 2;
  const radius = (diameter / 2 * SHRINK) / Math.hypot(w / 2, h / 2);
  if (radius < 0.15 || radius > 0.98) return null;
  // Outside a real fisheye circle it is black: few pixels in a ring just beyond it may be above the threshold. A dim
  // photo with dark corners (a frame-filling fisheye) has picture there.
  const rPx = radius * Math.hypot(w / 2, h / 2);
  let outside = 0;
  let above = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > rPx * 1.08 && d < rPx * 1.3) {
        outside++;
        if (lum[y * w + x] > thr) above++;
      }
    }
  }
  if (outside > 0 && above / outside > 0.15) return null;
  return { offsetX: (cx - w / 2) / w, offsetY: (cy - h / 2) / h, radius };
}
