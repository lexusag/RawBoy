import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
import type { PreviewImage } from '../gl/PreviewImage';
import { halfToFloat } from '../util/half';
import type { SkinMask } from './SkinMask';

/**
 * Finds skin with MediaPipe's selfie multiclass segmentation model (Apache 2.0), port of retouch/SkinSegmenter.kt:
 * categories 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others. Same models as Android, run by
 * @mediapipe/tasks-vision (WASM, CPU delegate).
 */
const MODEL = 'models/selfie_multiclass_256x256.tflite';
const LANDMARK_MODEL = 'models/face_landmarker.task';
const BODY_SKIN = 2;
const FACE_SKIN = 3;

// MediaPipe face mesh landmark indices for the features that must never be smoothed or "healed".
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_BROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
const LEFT_BROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const NOSTRILS = [64, 98, 97, 2, 326, 327, 294, 240, 460, 75, 305, 79, 309, 166, 392];

/** Feature outlines and how far to grow them (eye corners and tear ducts sit just outside the lid line). */
const FEATURES: [number[], number][] = [
  [RIGHT_EYE, 1.6], [LEFT_EYE, 1.6], [RIGHT_BROW, 1.25], [LEFT_BROW, 1.25], [LIPS, 1.2], [NOSTRILS, 1.35],
];

let fileset: Promise<WasmFileset> | null = null;
let segmenter: Promise<ImageSegmenter> | null = null;
let landmarker: Promise<FaceLandmarker> | null = null;
/** MediaPipe tasks aren't re-entrant: one segment() at a time. */
let queue: Promise<unknown> = Promise.resolve();

const assetUrl = (path: string) => new URL(path, document.baseURI).href;

function vision(): Promise<WasmFileset> {
  return (fileset ??= FilesetResolver.forVisionTasks(assetUrl('mediapipe')));
}

/** Both models stay loaded after first use. */
function getSegmenter(): Promise<ImageSegmenter> {
  return (segmenter ??= vision().then((fs) =>
    ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: assetUrl(MODEL), delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }),
  ));
}

function getLandmarker(): Promise<FaceLandmarker> {
  return (landmarker ??= vision().then((fs) =>
    FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: assetUrl(LANDMARK_MODEL), delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 4,
      minFaceDetectionConfidence: 0.3,
    }),
  ));
}

/** [image]: the small linear Rec.2020 copy of the photo; [fullWidth]/[fullHeight]: full-resolution size. */
export function segmentSkin(image: PreviewImage, fullWidth: number, fullHeight: number): Promise<SkinMask> {
  const run = queue.then(() => segment(image, fullWidth, fullHeight));
  queue = run.catch(() => undefined);
  return run;
}

async function segment(image: PreviewImage, fullWidth: number, fullHeight: number): Promise<SkinMask> {
  const t0 = performance.now();
  const w = image.width;
  const h = image.height;
  const { bitmap, gray } = toDisplayImage(image);

  const skin = new Float32Array(w * h);
  let faceArea = 0;
  let skinArea = 0;
  const result = (await getSegmenter()).segment(bitmap);
  const masks = result.confidenceMasks;
  if (!masks) return empty(w, h);
  const read = (index: number): Float32Array => {
    const mask = masks[index];
    const out = mask.getAsFloat32Array().slice();
    return mask.width === w && mask.height === h ? out : resize(out, mask.width, mask.height, w, h);
  };
  const face = read(FACE_SKIN);
  const body = read(BODY_SKIN);
  result.close();
  for (let i = 0; i < skin.length; i++) {
    skin[i] = Math.min(1, Math.max(0, face[i] + body[i]));
    // Count only confident face pixels: summed, the model's faint confidence everywhere else adds up to a "face" of
    // about 2% of every frame.
    if (face[i] > 0.5) faceArea++;
    skinArea += skin[i];
  }
  const tSeg = performance.now();
  // Snap the low-resolution mask to edges in the photo (hairline, brows, jaw).
  const refined = guidedFilter(gray, skin, w, h, 3, 1e-3);
  const tGuided = performance.now();

  // Cut eyes, brows, lips and nostrils out of the mask: the segmentation model labels them face skin, but they
  // must not be smoothed or healed.
  await excludeFacialFeatures(bitmap, refined, w, h);
  console.debug(`skin: segmentation ${Math.round(tSeg - t0)} ms, guided filter ${Math.round(tGuided - tSeg)} ms, landmarks ${Math.round(performance.now() - tGuided)} ms`);

  // Smoothing scale from the face size: ~1.2% of the face diameter.
  const scale = fullWidth / w;
  const longEdge = Math.max(fullWidth, fullHeight);
  const faceDiameter = faceArea > 4 ? 2 * Math.sqrt(faceArea / Math.PI) * scale : 0;
  const sigma = Math.min(40, Math.max(3, faceArea > 4 ? 0.012 * faceDiameter : 0.002 * longEdge));
  return { width: w, height: h, data: refined, sigmaPx: sigma, hasSkin: skinArea > 0.002 * w * h, faceDiameterPx: faceDiameter };
}

/** Zeroes the mask inside each facial feature (polygon grown around its centre), with a soft edge. */
async function excludeFacialFeatures(image: ImageData, mask: Float32Array, w: number, h: number) {
  const faces = (await getLandmarker()).detect(image).faceLandmarks;
  console.debug(`Face landmarker: ${faces.length} face(s); protecting eyes, brows, lips, nostrils`);
  if (faces.length === 0) return;
  const keep = new Float32Array(w * h).fill(1);
  for (const face of faces) {
    for (const [indices, grow] of FEATURES) {
      const xs = indices.map((i) => face[i].x * w);
      const ys = indices.map((i) => face[i].y * h);
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      for (let i = 0; i < xs.length; i++) {
        xs[i] = cx + (xs[i] - cx) * grow;
        ys[i] = cy + (ys[i] - cy) * grow;
      }
      fillConvexHull(xs, ys, keep, w, h);
    }
  }
  // Soften the cut so smoothing fades out instead of stopping at a hard line.
  const soft = box(keep, w, h, 1);
  for (let i = 0; i < mask.length; i++) mask[i] *= soft[i];
}

/** Sets [keep] to 0 inside the convex hull of the points (monotone chain hull). */
function fillConvexHull(xs: number[], ys: number[], keep: Float32Array, w: number, h: number) {
  const pts = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || ys[a] - ys[b]);
  const cross = (o: number, a: number, b: number) => (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o]);
  const hull: number[] = [];
  for (const p of pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  const lower = hull.length + 1;
  for (const p of [...pts].reverse()) {
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  hull.pop();
  if (hull.length < 3) return;
  const clampI = (v: number, hi: number) => Math.min(hi, Math.max(0, Math.trunc(v)));
  const minX = clampI(Math.min(...hull.map((i) => xs[i])), w - 1);
  const maxX = clampI(Math.max(...hull.map((i) => xs[i])), w - 1);
  const minY = clampI(Math.min(...hull.map((i) => ys[i])), h - 1);
  const maxY = clampI(Math.max(...hull.map((i) => ys[i])), h - 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Inside a convex polygon = on the same side of every edge (either winding).
      let pos = false;
      let neg = false;
      for (let k = 0; k < hull.length; k++) {
        const a = hull[k];
        const b = hull[(k + 1) % hull.length];
        const c = (xs[b] - xs[a]) * (py - ys[a]) - (ys[b] - ys[a]) * (px - xs[a]);
        if (c > 0) pos = true;
        else if (c < 0) neg = true;
      }
      if (!(pos && neg)) keep[y * w + x] = 0;
    }
  }
}

const empty = (w: number, h: number): SkinMask => ({ width: w, height: h, data: new Float32Array(w * h), sigmaPx: 3, hasSkin: false, faceDiameterPx: 0 });

/** Linear Rec.2020 half floats -> an ordinary-looking sRGB image for the model, plus its luminance. */
function toDisplayImage(image: PreviewImage): { bitmap: ImageData; gray: Float32Array } {
  const n = image.width * image.height;
  const px = image.pixels;
  const rgb = new Float32Array(n * 3);
  let logSum = 0;
  for (let i = 0; i < n; i++) {
    const r = halfToFloat(px[i * 3]);
    const g = halfToFloat(px[i * 3 + 1]);
    const b = halfToFloat(px[i * 3 + 2]);
    // Rec.2020 -> Rec.709/sRGB primaries
    rgb[i * 3] = 1.6605 * r - 0.5876 * g - 0.0728 * b;
    rgb[i * 3 + 1] = -0.1246 * r + 1.1329 * g - 0.0083 * b;
    rgb[i * 3 + 2] = -0.0182 * r - 0.1006 * g + 1.1187 * b;
    logSum += Math.log(Math.max(0.2627 * r + 0.678 * g + 0.0593 * b, 1e-5));
  }
  // Auto exposure: put the log-average at middle grey, then a soft shoulder.
  const k = 0.18 / Math.exp(logSum / n);
  const rgba = new Uint8ClampedArray(n * 4);
  const gray = new Float32Array(n);
  const weights = [0.2126, 0.7152, 0.0722];
  for (let i = 0; i < n; i++) {
    let y = 0;
    for (let ch = 0; ch < 3; ch++) {
      const v = Math.max(rgb[i * 3 + ch], 0) * k;
      const t = (v / (1 + v)) * 1.6;
      const e = t <= 0.0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - 0.055;
      const e8 = Math.trunc(Math.min(1, Math.max(0, e)) * 255 + 0.5);
      y += e8 * weights[ch];
      rgba[i * 4 + ch] = e8;
    }
    rgba[i * 4 + 3] = 255;
    gray[i] = y / 255;
  }
  return { bitmap: new ImageData(rgba, image.width, image.height), gray };
}

function resize(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (let y = 0; y < dh; y++) {
    const fy = clamp(((y + 0.5) * sh) / dh - 0.5, 0, sh - 1);
    const y0 = Math.max(0, Math.min(Math.trunc(fy), sh - 2));
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = clamp(((x + 0.5) * sw) / dw - 0.5, 0, sw - 1);
      const x0 = Math.max(0, Math.min(Math.trunc(fx), sw - 2));
      const tx = fx - x0;
      const y1 = Math.min(y0 + 1, sh - 1);
      const x1 = Math.min(x0 + 1, sw - 1);
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Guided filter (He et al.): edge-preserving refinement of [p] using guide [g]. */
function guidedFilter(g: Float32Array, p: Float32Array, w: number, h: number, radius: number, eps: number): Float32Array {
  const n = g.length;
  const gp = new Float32Array(n);
  const gg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gp[i] = g[i] * p[i];
    gg[i] = g[i] * g[i];
  }
  const meanG = box(g, w, h, radius);
  const meanP = box(p, w, h, radius);
  const corrGP = box(gp, w, h, radius);
  const corrGG = box(gg, w, h, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const variance = corrGG[i] - meanG[i] * meanG[i];
    a[i] = (corrGP[i] - meanG[i] * meanP[i]) / (variance + eps);
    b[i] = meanP[i] - a[i] * meanG[i];
  }
  const meanA = box(a, w, h, radius);
  const meanB = box(b, w, h, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, meanA[i] * g[i] + meanB[i]));
  return out;
}

/** Mean over a (2r+1)^2 window via an integral image, clamped at the borders. */
export function box(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
