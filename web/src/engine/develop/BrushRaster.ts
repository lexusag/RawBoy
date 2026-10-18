import { rect, type PixelRect } from '../gl/Zoom';
import type { PreviewImage } from '../gl/PreviewImage';
import { box } from '../retouch/SkinSegmenter';
import { halfToFloat } from '../util/half';
import { MAX_BRUSH_RADIUS, type BrushStroke } from './Masks';

/** Dab spacing as a fraction of the radius. */
const SPACING = 0.15;
/** Auto mask tolerances: luminance in EV, chroma in log2 ratios. */
const SIGMA_L = 0.6;
const SIGMA_C = 0.25;
/**
 * Linear offsets (1.0 = sensor clip): the luminance floor keeps deep-shadow noise from reading as big EV steps,
 * the chroma one keeps near-black noise from reading as strong colour.
 */
const LUM_FLOOR = 0.002;
const CHROMA_EPS = 0.01;
/** Box blur radius of the guide (raster pixels), against sensor noise. */
const GUIDE_BLUR = 2;
/** Changes remembered for partial texture uploads. */
const HISTORY = 16;

/**
 * Auto mask guide: per-pixel features of the photo at the raster size (log2 luminance and two exposure-independent
 * chroma terms), lightly blurred so sensor noise doesn't break strokes up.
 */
export interface BrushGuide {
  lum: Float32Array;
  red: Float32Array;
  blue: Float32Array;
}

export function makeGuide(image: PreviewImage): BrushGuide {
  const n = image.width * image.height;
  const lum = new Float32Array(n);
  const red = new Float32Array(n);
  const blue = new Float32Array(n);
  const px = image.pixels;
  for (let i = 0; i < n; i++) {
    const r = Math.max(halfToFloat(px[i * 3]), 0);
    const g = Math.max(halfToFloat(px[i * 3 + 1]), 0);
    const b = Math.max(halfToFloat(px[i * 3 + 2]), 0);
    const y = 0.2627 * r + 0.678 * g + 0.0593 * b; // Rec.2020 luma
    lum[i] = Math.log2(y + LUM_FLOOR);
    red[i] = Math.log2((r + CHROMA_EPS) / (y + CHROMA_EPS));
    blue[i] = Math.log2((b + CHROMA_EPS) / (y + CHROMA_EPS));
  }
  const w = image.width;
  const h = image.height;
  return { lum: box(lum, w, h, GUIDE_BLUR), red: box(red, w, h, GUIDE_BLUR), blue: box(blue, w, h, GUIDE_BLUR) };
}

/**
 * One layer's painted mask over the whole image (display orientation, row 0 = top), at the size of the preview copy.
 * Two channels, applied stroke by stroke in order:
 * - paint: what strokes added (the shader takes the max of this and the gradient);
 * - erase: how much of the layer's gradient strokes took away.
 * A brush dab of weight w: paint += (1 - paint) w, erase *= 1 - w; an erase dab the other way round.
 * [rg] is the RG8 copy the GPU gets; [pendingRect] says what changed since an uploaded version.
 */
export class BrushRaster {
  readonly paint: Float32Array;
  readonly erase: Float32Array;
  readonly rg: Uint8Array;
  version = 0;
  private history: { version: number; rect: PixelRect }[] = [];
  /** Strokes drawn so far (by id) and how many points of the last one. */
  private drawn: string[] = [];
  private drawnPoints = 0;
  /** Walk state of the last stroke: last point (raster px) and distance since its last dab. */
  private walk = { x: 0, y: 0, since: 0 };
  private dirty: number[] | null = null; // x0, y0, x1, y1

  constructor(readonly width: number, readonly height: number, private readonly guide: () => BrushGuide) {
    const n = width * height;
    this.paint = new Float32Array(n);
    this.erase = new Float32Array(n);
    this.rg = new Uint8Array(n * 2);
  }

  /** Brings the raster up to [strokes]: only new dabs when the list grew, a full redraw otherwise. */
  sync(strokes: readonly BrushStroke[]) {
    const d = this.drawn;
    const extends_ =
      strokes.length >= d.length &&
      d.every((id, i) => strokes[i].id === id) &&
      (d.length === 0 || strokes[d.length - 1].points.length >= this.drawnPoints);
    if (!extends_) this.clear();
    const start = this.drawn.length === 0 ? 0 : this.drawn.length - 1;
    for (let i = start; i < strokes.length; i++) {
      const s = strokes[i];
      const resume = i === this.drawn.length - 1 ? this.drawnPoints : 0;
      this.drawStroke(s, resume);
      if (i >= this.drawn.length) this.drawn.push(s.id);
      this.drawnPoints = s.points.length;
    }
    this.commit();
  }

  /** What changed after [uploaded]: a rectangle, 'all' (too far back, or a redraw) or null (nothing). */
  pendingRect(uploaded: number): PixelRect | 'all' | null {
    if (uploaded === this.version) return null;
    const since = this.history.filter((h) => h.version > uploaded);
    if (since.length === 0 || since[0].version !== uploaded + 1) return 'all';
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const { rect: r } of since) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width);
      y1 = Math.max(y1, r.y + r.height);
    }
    return rect(x0, y0, x1 - x0, y1 - y0);
  }

  private clear() {
    this.paint.fill(0);
    this.erase.fill(0);
    this.drawn = [];
    this.drawnPoints = 0;
    this.dirty = [0, 0, this.width, this.height];
  }

  /** Dabs of [s] from point index [from] (0 = from its start). */
  private drawStroke(s: BrushStroke, from: number) {
    const long = Math.max(this.width, this.height);
    const radius = Math.max(0.75, Math.min(s.radius, MAX_BRUSH_RADIUS) * long);
    const spacing = Math.max(1, radius * SPACING);
    const pts = s.points;
    let i = from;
    if (i === 0 && pts.length >= 2) {
      const x = pts[0] * this.width;
      const y = pts[1] * this.height;
      this.dab(s, x, y, radius);
      this.walk = { x, y, since: 0 };
      i = 2;
    }
    for (; i + 1 < pts.length; i += 2) {
      const x = pts[i] * this.width;
      const y = pts[i + 1] * this.height;
      const w = this.walk;
      const len = Math.hypot(x - w.x, y - w.y);
      let t = spacing - w.since;
      while (t <= len) {
        const f = t / len;
        this.dab(s, w.x + (x - w.x) * f, w.y + (y - w.y) * f, radius);
        t += spacing;
      }
      this.walk = { x, y, since: len - (t - spacing) };
    }
  }

  private dab(s: BrushStroke, cx: number, cy: number, radius: number) {
    const W = this.width;
    const H = this.height;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y1 = Math.min(H - 1, Math.ceil(cy + radius));
    if (x0 > x1 || y0 > y1) return;
    const inner = radius * (s.hardness / 100) * 0.95;
    const flow = Math.min(1, Math.max(0.01, s.flow / 100));
    const guide = s.auto ? this.guide() : null;
    let cl = 0;
    let cr = 0;
    let cb = 0;
    if (guide) {
      // Colour under the centre, averaged over 3x3.
      let n = 0;
      const ix = Math.min(W - 1, Math.max(0, Math.round(cx)));
      const iy = Math.min(H - 1, Math.max(0, Math.round(cy)));
      for (let y = Math.max(0, iy - 1); y <= Math.min(H - 1, iy + 1); y++) {
        for (let x = Math.max(0, ix - 1); x <= Math.min(W - 1, ix + 1); x++) {
          const k = y * W + x;
          cl += guide.lum[k];
          cr += guide.red[k];
          cb += guide.blue[k];
          n++;
        }
      }
      cl /= n;
      cr /= n;
      cb /= n;
    }
    const paint = this.paint;
    const erase = this.erase;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= radius) continue;
        let w = flow;
        if (d > inner) {
          const t = (radius - d) / (radius - inner);
          w *= t * t * (3 - 2 * t);
        }
        const k = y * W + x;
        if (guide) {
          const dl = guide.lum[k] - cl;
          const dr = guide.red[k] - cr;
          const db = guide.blue[k] - cb;
          w *= Math.exp(-((dl * dl) / (SIGMA_L * SIGMA_L) + (dr * dr + db * db) / (SIGMA_C * SIGMA_C)));
        }
        if (w <= 0) continue;
        if (s.erase) {
          paint[k] *= 1 - w;
          erase[k] += (1 - erase[k]) * w;
        } else {
          paint[k] += (1 - paint[k]) * w;
          erase[k] *= 1 - w;
        }
      }
    }
    const r = this.dirty;
    this.dirty = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1 + 1), Math.max(r[3], y1 + 1)] : [x0, y0, x1 + 1, y1 + 1];
  }

  /** Copies the changed area into [rg] and records it as a new version. */
  private commit() {
    const r = this.dirty;
    if (!r) return;
    this.dirty = null;
    const W = this.width;
    for (let y = r[1]; y < r[3]; y++) {
      for (let x = r[0]; x < r[2]; x++) {
        const k = y * W + x;
        this.rg[k * 2] = Math.round(this.paint[k] * 255);
        this.rg[k * 2 + 1] = Math.round(this.erase[k] * 255);
      }
    }
    this.version++;
    const whole = r[0] === 0 && r[1] === 0 && r[2] === W && r[3] === this.height;
    // A full redraw can't be patched onto an older upload: forget the history so it uploads everything.
    if (whole) this.history = [];
    this.history.push({ version: this.version, rect: rect(r[0], r[1], r[2] - r[0], r[3] - r[1]) });
    if (this.history.length > HISTORY) this.history.shift();
  }
}
