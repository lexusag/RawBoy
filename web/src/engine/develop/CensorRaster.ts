import { rect, type PixelRect } from '../gl/Zoom';
import { CENSOR_RADIUS_MAX, parseColour, type CensorStroke } from './Censor';

/** Changes remembered for partial texture uploads. */
const HISTORY = 16;
/** Spline pieces at most this fraction of the stroke's smallest radius long, so a curve never shows as facets. */
const PIECE = 0.25;
/** At most this many pieces per span (a huge jump between two samples). */
const MAX_PIECES = 64;
/** Fewest raster pixels of soft edge, so even a hard brush has an anti-aliased rim. */
const MIN_SOFT = 1.5;
/** Radius factor floor for pen widths. */
const MIN_WIDTH = 0.05;

type Box = [number, number, number, number]; // x0, y0, x1, y1 (exclusive), raster px

/** Work buffers for the stroke being drawn, shared by every raster of one size (one stroke is drawn at a time). */
interface Scratch {
  /** The stroke's own coverage (max of its capsules) and its direction there (axial cos 2a, sin 2a; bytes). */
  cov: Float32Array;
  dir: Uint8Array;
  /** The layer as it was before the stroke began, for the pixels the stroke reached so far ([snapBox]). */
  snapMask: Uint8Array;
  snapColour: Uint8Array;
}
const scratches = new Map<string, Scratch>();
function scratchFor(w: number, h: number): Scratch {
  const key = `${w}x${h}`;
  let s = scratches.get(key);
  if (!s) {
    // One size at a time: a new photo's preview size replaces the last.
    scratches.clear();
    const n = w * h;
    s = { cov: new Float32Array(n), dir: new Uint8Array(n * 2), snapMask: new Uint8Array(n * 4), snapColour: new Uint8Array(n * 4) };
    scratches.set(key, s);
  }
  return s;
}

/** A spline span's capsules: points (raster px) with their radii, and the box they touch (radius included). */
interface Span {
  pts: number[]; // x, y, r per point
  box: Box;
}

const unionBox = (a: Box | null, b: Box): Box => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : [...b]);

/**
 * One censor layer's painted coverage at the session preview's size (display orientation, row 0 = top), as two RGBA8
 * images the GPU reads (CensorPass's atlas):
 * - [mask]: R paint (strokes' coverage), G erase (how much strokes took from the layer's ellipse), B/A the strokes'
 *   direction as an axial vector (cos 2a, sin 2a) mapped to 0..255 (Paint and Smear follow the hand);
 * - [colour]: the strokes' colour (display sRGB) and its weight.
 *
 * A stroke is a centripetal Catmull-Rom spline through its points, cut into pieces at most a quarter radius long and
 * drawn as capsules (exact distance to each piece, the radius interpolated along it: pen pressure tapers smoothly).
 * Within a stroke coverage is the max of its capsules, so it never beads where the pointer slowed or the stroke crosses
 * itself; strokes combine in order (paint: a + b - ab; erase takes away). While a stroke grows only the spans that
 * changed are redrawn: the last span is provisional until the next point bends it.
 * [pendingRect] says what changed since an uploaded version (partial texture uploads).
 */
export class CensorRaster {
  readonly mask: Uint8Array;
  readonly colour: Uint8Array;
  version = 0;
  private history: { version: number; rect: PixelRect }[] = [];
  /** Strokes drawn so far (by id) and how many points of the last one. */
  private drawn: string[] = [];
  private drawnPoints = 0;
  /** The growing stroke's spans and where its snapshot reaches. */
  private spans: Span[] = [];
  private snapBox: Box | null = null;
  private dirty: Box | null = null;

  constructor(readonly width: number, readonly height: number) {
    const n = width * height;
    this.mask = new Uint8Array(n * 4);
    this.colour = new Uint8Array(n * 4);
    this.clearArrays();
  }

  private clearArrays() {
    this.mask.fill(0);
    for (let i = 0; i < this.mask.length; i += 4) {
      this.mask[i + 2] = 128;
      this.mask[i + 3] = 128;
    }
    this.colour.fill(0);
  }

  /** Brings the raster up to [strokes]: only the changed spans while the last stroke grows, a full redraw otherwise. */
  sync(strokes: readonly CensorStroke[]) {
    const d = this.drawn;
    const extends_ =
      strokes.length >= d.length &&
      d.every((id, i) => strokes[i].id === id) &&
      (d.length === 0 || strokes[d.length - 1].points.length >= this.drawnPoints);
    if (!extends_) {
      this.clearArrays();
      this.drawn = [];
      this.drawnPoints = 0;
      this.spans = [];
      this.snapBox = null;
      this.dirty = [0, 0, this.width, this.height];
    }
    const start = this.drawn.length === 0 ? 0 : this.drawn.length - 1;
    for (let i = start; i < strokes.length; i++) {
      const s = strokes[i];
      const resuming = i === this.drawn.length - 1;
      if (resuming && s.points.length === this.drawnPoints) continue;
      if (!resuming) {
        // A new stroke: forget the last one's spans and snapshot.
        this.spans = [];
        this.snapBox = null;
      }
      this.drawStroke(s, resuming ? this.drawnPoints / 2 : 0);
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

  /** The stroke's points [from] point index on (0 = a new stroke) are drawn: spans that changed are redone. */
  private drawStroke(s: CensorStroke, from: number) {
    const W = this.width;
    const H = this.height;
    const long = Math.max(W, H);
    const n = s.points.length / 2;
    if (n === 0) return;
    const baseR = Math.max(0.75, Math.min(s.radius, CENSOR_RADIUS_MAX) * long);
    const px = (i: number): [number, number, number] => {
      const k = Math.min(n - 1, Math.max(0, i));
      const w = s.widths ? Math.max(MIN_WIDTH, s.widths[k] ?? 1) : 1;
      return [s.points[k * 2] * W, s.points[k * 2 + 1] * H, baseR * w];
    };
    // Spans: a single point is one dot; else span i joins points i and i + 1. Span i depends on points i - 1..i + 2,
    // so the spans from (from - 2) on change when points [from, n) arrive.
    const spanCount = Math.max(1, n - 1);
    const firstChanged = from === 0 ? 0 : Math.max(0, from - 2);
    let box: Box | null = null;
    for (let i = firstChanged; i < this.spans.length; i++) box = unionBox(box, this.spans[i].box);
    this.spans.length = Math.min(this.spans.length, firstChanged);
    for (let i = firstChanged; i < spanCount; i++) {
      const span = n === 1 ? dotSpan(px(0)) : splineSpan(px(i - 1), px(i), px(i + 1), px(i + 2));
      this.spans.push(span);
      box = unionBox(box, span.box);
    }
    if (!box) return;
    const clip: Box = [Math.max(0, Math.floor(box[0])), Math.max(0, Math.floor(box[1])), Math.min(W, Math.ceil(box[2])), Math.min(H, Math.ceil(box[3]))];
    if (clip[0] >= clip[2] || clip[1] >= clip[3]) return;
    const sc = scratchFor(W, H);
    this.snapshot(sc, clip);
    // The stroke's coverage inside the box, from every span that reaches it (earlier ones too: a turn back).
    for (let y = clip[1]; y < clip[3]; y++) {
      sc.cov.fill(0, y * W + clip[0], y * W + clip[2]);
      for (let x = clip[0]; x < clip[2]; x++) {
        sc.dir[(y * W + x) * 2] = 128;
        sc.dir[(y * W + x) * 2 + 1] = 128;
      }
    }
    const hardness = Math.min(1, Math.max(0, s.hardness / 100));
    for (const span of this.spans) {
      const b = span.box;
      if (b[2] <= clip[0] || b[0] >= clip[2] || b[3] <= clip[1] || b[1] >= clip[3]) continue;
      this.capsules(sc, span, hardness, clip);
    }
    this.composite(sc, s, clip);
    this.dirty = unionBox(this.dirty, clip);
  }

  /** Copies the layer's pixels in [box] not yet in the stroke's snapshot. */
  private snapshot(sc: Scratch, box: Box) {
    const W = this.width;
    const old = this.snapBox;
    const copy = (y: number, x0: number, x1: number) => {
      if (x1 <= x0) return;
      const a = (y * W + x0) * 4;
      const b = (y * W + x1) * 4;
      sc.snapMask.set(this.mask.subarray(a, b), a);
      sc.snapColour.set(this.colour.subarray(a, b), a);
    };
    for (let y = box[1]; y < box[3]; y++) {
      if (!old || y < old[1] || y >= old[3]) copy(y, box[0], box[2]);
      else {
        copy(y, box[0], Math.min(box[2], old[0]));
        copy(y, Math.max(box[0], old[2]), box[2]);
      }
    }
    this.snapBox = unionBox(old, box);
  }

  /** The span's capsules into the stroke's coverage, within [clip]. */
  private capsules(sc: Scratch, span: Span, hardness: number, clip: Box) {
    const W = this.width;
    const p = span.pts;
    const count = p.length / 3;
    for (let k = 0; k < Math.max(1, count - 1); k++) {
      const ax = p[k * 3];
      const ay = p[k * 3 + 1];
      const ar = p[k * 3 + 2];
      const j = count > 1 ? k + 1 : k;
      const bx = p[j * 3];
      const by = p[j * 3 + 1];
      const br = p[j * 3 + 2];
      const rMax = Math.max(ar, br);
      const x0 = Math.max(clip[0], Math.floor(Math.min(ax, bx) - rMax));
      const y0 = Math.max(clip[1], Math.floor(Math.min(ay, by) - rMax));
      const x1 = Math.min(clip[2], Math.ceil(Math.max(ax, bx) + rMax));
      const y1 = Math.min(clip[3], Math.ceil(Math.max(ay, by) + rMax));
      if (x0 >= x1 || y0 >= y1) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const len = Math.sqrt(len2);
      // Axial direction of the piece (cos 2a, sin 2a), 0 for a dot.
      const c2 = len > 0 ? (dx * dx - dy * dy) / len2 : 0;
      const s2 = len > 0 ? (2 * dx * dy) / len2 : 0;
      const dirX = Math.round(127.5 + c2 * 127.5);
      const dirY = Math.round(127.5 + s2 * 127.5);
      for (let y = y0; y < y1; y++) {
        const py = y + 0.5 - ay;
        for (let x = x0; x < x1; x++) {
          const pxx = x + 0.5 - ax;
          const t = len2 > 0 ? Math.min(1, Math.max(0, (pxx * dx + py * dy) / len2)) : 0;
          const ex = pxx - dx * t;
          const ey = py - dy * t;
          const d = Math.sqrt(ex * ex + ey * ey);
          const r = ar + (br - ar) * t;
          if (d >= r) continue;
          const soft = Math.max(MIN_SOFT, r * (1 - hardness * 0.95));
          const u = Math.min(1, (r - d) / soft);
          const c = u * u * (3 - 2 * u);
          const i = y * W + x;
          if (c > sc.cov[i]) {
            sc.cov[i] = c;
            if (len > 0) {
              sc.dir[i * 2] = dirX;
              sc.dir[i * 2 + 1] = dirY;
            }
          }
        }
      }
    }
  }

  /** The layer inside [clip] = its snapshot with the stroke's coverage laid over it. */
  private composite(sc: Scratch, s: CensorStroke, clip: Box) {
    const W = this.width;
    const col = s.erase ? null : parseColour(s.colour);
    const mix = col ? Math.min(1, Math.max(0, (s.colourMix ?? 100) / 100)) : 0;
    const m = this.mask;
    const cl = this.colour;
    const sm = sc.snapMask;
    const scl = sc.snapColour;
    for (let y = clip[1]; y < clip[3]; y++) {
      for (let x = clip[0]; x < clip[2]; x++) {
        const i = y * W + x;
        const o = i * 4;
        const c = sc.cov[i];
        if (c <= 0) {
          for (let k = 0; k < 4; k++) {
            m[o + k] = sm[o + k];
            cl[o + k] = scl[o + k];
          }
          continue;
        }
        const paint = sm[o] / 255;
        const erase = sm[o + 1] / 255;
        const a = scl[o + 3] / 255;
        if (s.erase) {
          m[o] = Math.round(paint * (1 - c) * 255);
          m[o + 1] = Math.round((1 - (1 - erase) * (1 - c)) * 255);
          m[o + 2] = sm[o + 2];
          m[o + 3] = sm[o + 3];
          cl[o] = scl[o];
          cl[o + 1] = scl[o + 1];
          cl[o + 2] = scl[o + 2];
          cl[o + 3] = Math.round(a * (1 - c) * 255);
          continue;
        }
        m[o] = Math.round((1 - (1 - paint) * (1 - c)) * 255);
        m[o + 1] = Math.round(erase * (1 - c) * 255);
        // Direction: the stroke's over the layer's, by coverage (pixels where it was a dot keep the layer's).
        const sd = sc.dir[i * 2] !== 128 || sc.dir[i * 2 + 1] !== 128;
        m[o + 2] = sd ? Math.round(sm[o + 2] + (sc.dir[i * 2] - sm[o + 2]) * c) : sm[o + 2];
        m[o + 3] = sd ? Math.round(sm[o + 3] + (sc.dir[i * 2 + 1] - sm[o + 3]) * c) : sm[o + 3];
        if (col) {
          // Colour laid over (premultiplied over), so strokes in different colours sit side by side like paint.
          const w = c * mix;
          const na = w + a * (1 - w);
          const f = na > 0 ? 1 / na : 0;
          cl[o] = Math.round(((col[0] * w + (scl[o] / 255) * a * (1 - w)) * f) * 255);
          cl[o + 1] = Math.round(((col[1] * w + (scl[o + 1] / 255) * a * (1 - w)) * f) * 255);
          cl[o + 2] = Math.round(((col[2] * w + (scl[o + 2] / 255) * a * (1 - w)) * f) * 255);
          cl[o + 3] = Math.round(na * 255);
        } else {
          // An Auto stroke paints the area's own colours back over a picked colour.
          cl[o] = scl[o];
          cl[o + 1] = scl[o + 1];
          cl[o + 2] = scl[o + 2];
          cl[o + 3] = Math.round(a * (1 - c) * 255);
        }
      }
    }
  }

  /** Records what changed as a new version. */
  private commit() {
    const r = this.dirty;
    if (!r) return;
    this.dirty = null;
    this.version++;
    const whole = r[0] === 0 && r[1] === 0 && r[2] === this.width && r[3] === this.height;
    // A full redraw can't be patched onto an older upload: forget the history so it uploads everything.
    if (whole) this.history = [];
    this.history.push({ version: this.version, rect: rect(r[0], r[1], r[2] - r[0], r[3] - r[1]) });
    if (this.history.length > HISTORY) this.history.shift();
  }
}

/** One dot (a click). */
function dotSpan(p: [number, number, number]): Span {
  return { pts: [p[0], p[1], p[2]], box: [p[0] - p[2] - 1, p[1] - p[2] - 1, p[0] + p[2] + 1, p[1] + p[2] + 1] };
}

/**
 * The centripetal Catmull-Rom span from p1 to p2 (p0 and p3 its neighbours; equal to p1/p2 at the stroke's ends), as
 * points at most [PIECE] of the smallest radius apart. Radii are interpolated linearly along the span.
 */
function splineSpan(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number]): Span {
  const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const rMin = Math.max(0.75, Math.min(p1[2], p2[2]));
  const pieces = Math.min(MAX_PIECES, Math.max(1, Math.ceil((chord * 1.2) / (rMin * PIECE))));
  // Knot spacing: sqrt of the distance (centripetal), never zero.
  const knot = (a: number[], b: number[]) => Math.max(1e-3, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const pts: number[] = [];
  let box: Box | null = null;
  for (let k = 0; k <= pieces; k++) {
    const t = t1 + ((t2 - t1) * k) / pieces;
    const xy = [0, 1].map((c) => {
      const a1 = ((t1 - t) / t1) * p0[c] + (t / t1) * p1[c];
      const a2 = ((t2 - t) / (t2 - t1)) * p1[c] + ((t - t1) / (t2 - t1)) * p2[c];
      const a3 = ((t3 - t) / (t3 - t2)) * p2[c] + ((t - t2) / (t3 - t2)) * p3[c];
      const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2;
      const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
      return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
    });
    const r = p1[2] + ((p2[2] - p1[2]) * k) / pieces;
    pts.push(xy[0], xy[1], r);
    box = unionBox(box, [xy[0] - r - 1, xy[1] - r - 1, xy[0] + r + 1, xy[1] + r + 1]);
  }
  return { pts, box: box! };
}
