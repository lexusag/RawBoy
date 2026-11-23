import type { PreviewImage } from '../gl/PreviewImage';
import type { DepthMapData } from '../../worker/protocol';
import { toDisplayImage } from './DisplayImage';

/**
 * Portrait blur's depth map for photos without one (port of RawBoy Camera's depth/AiDepth.kt): Depth Anything V2
 * Small (Apache 2.0; onnx-community's export with 4-bit weights, the same file Camera bundles) run by ONNX Runtime
 * Web (WASM) in its own worker (worker/depth.worker.ts), from the session's 512 px copy. A few seconds of CPU; the
 * model (19 MB) and runtime are fetched the first time Portrait blur is raised on such a photo.
 *
 * The model gives relative inverse depth. It sees through glasses, so inside the person mask (the skin segmentation's
 * not-background) nothing reads farther than a little behind the person, and with a person the focus is on them.
 */
const MODEL = 'models/depth_anything_v2_small_q4f16.onnx';
const INPUT_LONG = 518;
const PATCH = 14;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
/** How far behind the person's median depth their own pixels may read (0..1 depth units). */
const PERSON_SLACK = 0.08;
/** A person covering at least this share of the frame is the subject. */
const PERSON_AREA = 0.015;

type Ort = typeof import('onnxruntime-web/wasm');
let ort: Promise<Ort> | null = null;
let session: Promise<import('onnxruntime-web/wasm').InferenceSession> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let assetBase = typeof document !== 'undefined' ? document.baseURI : '';
const assetUrl = (path: string) => new URL(path, assetBase).href;

function getSession() {
  return (session ??= (ort ??= import('onnxruntime-web/wasm')).then((o) => {
    // The runtime's own WASM is bundled by Vite (same origin, as cross-origin isolation needs).
    o.env.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    return o.InferenceSession.create(assetUrl(MODEL), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }));
}

/** [base]: the small linear Rec.2020 copy; [person]: its person mask (same size) or null. Runs in the depth worker. */
export function estimateDepth(base: PreviewImage, person: Float32Array | null): Promise<DepthMapData> {
  const worker = depthWorker();
  if (worker) return worker.estimate(base, person);
  return estimateHere(base, person);
}

/** Estimates on this thread (the depth worker's, or the page's without workers); [baseUrl]: the assets' URL. */
export function estimateHere(base: PreviewImage, person: Float32Array | null, baseUrl?: string): Promise<DepthMapData> {
  if (baseUrl) assetBase = baseUrl;
  const run = queue.then(() => estimate(base, person));
  queue = run.catch(() => undefined);
  return run;
}

async function estimate(base: PreviewImage, person: Float32Array | null): Promise<DepthMapData> {
  const t0 = performance.now();
  const o = await (ort ??= import('onnxruntime-web/wasm'));
  const s = await getSession();
  const t1 = performance.now();
  const scale = INPUT_LONG / Math.max(base.width, base.height);
  const w = Math.max(PATCH, Math.round((base.width * scale) / PATCH) * PATCH);
  const h = Math.max(PATCH, Math.round((base.height * scale) / PATCH) * PATCH);
  const rgba = resizeRgba(toDisplayImage(base).bitmap.data, base.width, base.height, w, h);
  const chw = new Float32Array(3 * w * h);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) chw[c * w * h + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const input = new o.Tensor('float32', chw, [1, 3, h, w]);
  const out = (await s.run({ [s.inputNames[0]]: input }))[s.outputNames[0]];
  const dims = out.dims;
  const ow = dims[dims.length - 1];
  const oh = dims[dims.length - 2];
  const depth = toDepth(out.data as Float32Array);
  out.dispose();
  input.dispose();
  const mask = person ? resample(person, base.width, base.height, ow, oh) : null;
  const [subject, focus] = mask ? applyPerson(depth, mask) : [false, depth[(oh >> 1) * ow + (ow >> 1)]];
  console.debug(`AI depth ${ow}x${oh}: load ${Math.round(t1 - t0)} ms, model ${Math.round(performance.now() - t1)} ms, person ${subject}, focus ${focus.toFixed(2)}`);
  const data = new Uint8Array(depth.length);
  for (let i = 0; i < depth.length; i++) data[i] = Math.round(depth[i] * 255);
  return { width: ow, height: oh, hardware: false, subjectDetected: subject, focusDepth: focus, data };
}

/** Inverse depth (nearer = larger) → 0..1 depth (0 near, 1 far) over its 2nd..98th percentiles. */
export function toDepth(inverse: Float32Array): Float32Array {
  const sorted = Float32Array.from(inverse).sort();
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];
  const lo = at(0.02);
  const range = Math.max(at(0.98) - lo, 1e-6);
  return inverse.map((v) => 1 - Math.min(1, Math.max(0, (v - lo) / range)));
}

/**
 * Pulls see-through parts of the person (glasses) to their depth: nothing under the mask reads farther than their
 * median + PERSON_SLACK, blended by the mask. Returns whether a person is the subject and the focus depth (their
 * median, or the middle of the frame without one).
 */
export function applyPerson(depth: Float32Array, person: Float32Array): [boolean, number] {
  const inside: number[] = [];
  for (let i = 0; i < depth.length; i++) if (person[i] > 0.5) inside.push(depth[i]);
  if (inside.length < depth.length * PERSON_AREA) return [false, depth[depth.length >> 1]];
  inside.sort((a, b) => a - b);
  const median = inside[inside.length >> 1];
  const cap = median + PERSON_SLACK;
  for (let i = 0; i < depth.length; i++) {
    const m = person[i];
    if (m > 0 && depth[i] > cap) depth[i] = depth[i] * (1 - m) + cap * m;
  }
  return [true, median];
}

function resample(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))];
  }
  return out;
}

/** Bilinear RGBA resize (no canvas: this runs in a worker too). */
function resizeRgba(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * sw + x0) * 4 + c] * (1 - tx) + src[(y0 * sw + x1) * 4 + c] * tx;
        const bottom = src[(y1 * sw + x0) * 4 + c] * (1 - tx) + src[(y1 * sw + x1) * 4 + c] * tx;
        out[(y * dw + x) * 4 + c] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return out;
}

/** The depth worker and a promise-based call into it. */
class DepthWorker {
  private readonly worker = new Worker(new URL('../../worker/depth.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: DepthMapData) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; depth?: DepthMapData; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.depth) p.resolve(ev.data.depth);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = () => {
      broken = true;
      for (const p of this.pending.values()) p.reject(new Error('depth worker failed'));
      this.pending.clear();
    };
  }

  estimate(base: PreviewImage, person: Float32Array | null): Promise<DepthMapData> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, base, person, baseUrl: document.baseURI });
    });
  }
}

let worker: DepthWorker | null = null;
let broken = false;
function depthWorker(): DepthWorker | null {
  if (broken || typeof Worker === 'undefined') return null;
  try {
    return (worker ??= new DepthWorker());
  } catch {
    broken = true;
    return null;
  }
}
