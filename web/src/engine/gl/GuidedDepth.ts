import type { DepthMapData } from '../../worker/protocol';
import { halfToFloat } from '../util/half';
import type { PreviewImage } from './PreviewImage';

/**
 * 3-channel colour Guided Image Filter (He, Sun, Tang 2013) for upsampling the low-resolution (~518 px) portrait
 * depth map along the photo's full-resolution edges.
 *
 * Fits a local linear model `depth ≈ a · sqrt(guide) + b` over a `(2r + 1) × (2r + 1)` window at each depth texel
 * using the ~512 px linear RGB base copy as the guide, then box-averages `(a, b)`. Uploaded to `uDepthMap` as
 * `RGBA16F` (`rgb = mean_a`, `a = mean_b`) so the develop and bokeh shaders evaluate `clamp(dot(ab.rgb, sqrt(rgb)) + ab.a, 0, 1)`
 * with a single bilinear lookup. When no base copy is available, fills `(0, 0, 0, d)` so the same shader formula
 * degrades to plain bilinear depth.
 *
 * Ports: GuidedDepth.kt, GuidedDepth.swift.
 */

/** Box window radius in depth-map texels (9x9 window at ~518 px). */
export const GUIDED_DEPTH_RADIUS = 4;

/** Regularization epsilon from edge softness `0..1` (0 = crispest edge lock, 1 = softest). */
export function guidedDepthEps(edge: number): number {
  const e = Math.min(1, Math.max(0, edge));
  return 3e-4 * Math.pow(100, e);
}

/** Separable O(1)-per-pixel box mean into `dst` (using `tmp` scratch and `prefix` double buffer to avoid cancellation). */
function boxMean(src: Float32Array, dst: Float32Array, tmp: Float32Array, prefix: Float64Array, w: number, h: number, r: number) {
  // Horizontal pass: src -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    prefix[0] = 0;
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + src[row + x];
    for (let x = 0; x < w; x++) {
      const x0 = x > r ? x - r : 0;
      const x1 = x + r < w ? x + r : w - 1;
      tmp[row + x] = (prefix[x1 + 1] - prefix[x0]) / (x1 - x0 + 1);
    }
  }
  // Vertical pass: tmp -> dst
  for (let x = 0; x < w; x++) {
    prefix[0] = 0;
    for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const y0 = y > r ? y - r : 0;
      const y1 = y + r < h ? y + r : h - 1;
      dst[y * w + x] = (prefix[y1 + 1] - prefix[y0]) / (y1 - y0 + 1);
    }
  }
}

/**
 * Computes the RGBA float32 `(mean_a.r, mean_a.g, mean_a.b, mean_b)` texture data for `depth` guided by `base`.
 * Returns `depth.width * depth.height * 4` floats ready to upload to `RGBA16F`.
 */
export function computeGuidedDepth(depth: DepthMapData, base: PreviewImage | null, edge: number): Float32Array {
  const w = depth.width;
  const h = depth.height;
  const n = w * h;
  const out = new Float32Array(n * 4);
  if (n === 0) return out;

  // Fallback without a usable base guide: (0, 0, 0, d) so dot(a, g) + b == d.
  if (!base || base.width < 2 || base.height < 2) {
    for (let i = 0; i < n; i++) out[i * 4 + 3] = depth.data[i] / 255;
    return out;
  }

  const r = Math.min(GUIDED_DEPTH_RADIUS, Math.max(1, Math.min(w, h) - 1));
  const eps = guidedDepthEps(edge);

  // Sample `base` bilinearly at each depth texel centre into the perceptual sqrt domain (matching the shader).
  const ir = new Float32Array(n);
  const ig = new Float32Array(n);
  const ib = new Float32Array(n);
  const p = new Float32Array(n);
  const bw = base.width;
  const bh = base.height;
  const bp = base.pixels;
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) / h) * bh - 0.5;
    const y0 = Math.max(0, Math.min(bh - 1, Math.floor(fy)));
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    const wy0 = 1 - ty;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) / w) * bw - 0.5;
      const x0 = Math.max(0, Math.min(bw - 1, Math.floor(fx)));
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      const wx0 = 1 - tx;
      const i00 = (y0 * bw + x0) * 3;
      const i10 = (y0 * bw + x1) * 3;
      const i01 = (y1 * bw + x0) * 3;
      const i11 = (y1 * bw + x1) * 3;
      const w00 = wx0 * wy0;
      const w10 = tx * wy0;
      const w01 = wx0 * ty;
      const w11 = tx * ty;
      const cr = w00 * halfToFloat(bp[i00]) + w10 * halfToFloat(bp[i10]) + w01 * halfToFloat(bp[i01]) + w11 * halfToFloat(bp[i11]);
      const cg = w00 * halfToFloat(bp[i00 + 1]) + w10 * halfToFloat(bp[i10 + 1]) + w01 * halfToFloat(bp[i01 + 1]) + w11 * halfToFloat(bp[i11 + 1]);
      const cb = w00 * halfToFloat(bp[i00 + 2]) + w10 * halfToFloat(bp[i10 + 2]) + w01 * halfToFloat(bp[i01 + 2]) + w11 * halfToFloat(bp[i11 + 2]);
      const idx = y * w + x;
      ir[idx] = cr > 0 ? Math.sqrt(cr) : 0;
      ig[idx] = cg > 0 ? Math.sqrt(cg) : 0;
      ib[idx] = cb > 0 ? Math.sqrt(cb) : 0;
      p[idx] = depth.data[idx] / 255;
    }
  }

  const tmp = new Float32Array(n);
  const prefix = new Float64Array(Math.max(w, h) + 1);
  const prod = new Float32Array(n);

  const mr = new Float32Array(n);
  const mg = new Float32Array(n);
  const mb = new Float32Array(n);
  const mp = new Float32Array(n);
  boxMean(ir, mr, tmp, prefix, w, h, r);
  boxMean(ig, mg, tmp, prefix, w, h, r);
  boxMean(ib, mb, tmp, prefix, w, h, r);
  boxMean(p, mp, tmp, prefix, w, h, r);

  // Covariances cov(I, p)
  const covR = new Float32Array(n);
  const covG = new Float32Array(n);
  const covB = new Float32Array(n);
  for (let i = 0; i < n; i++) prod[i] = ir[i] * p[i];
  boxMean(prod, covR, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) covR[i] -= mr[i] * mp[i];

  for (let i = 0; i < n; i++) prod[i] = ig[i] * p[i];
  boxMean(prod, covG, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) covG[i] -= mg[i] * mp[i];

  for (let i = 0; i < n; i++) prod[i] = ib[i] * p[i];
  boxMean(prod, covB, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) covB[i] -= mb[i] * mp[i];

  // Symmetric 3x3 guide covariance Sigma + eps * I
  const vrr = new Float32Array(n);
  const vrg = new Float32Array(n);
  const vrb = new Float32Array(n);
  const vgg = new Float32Array(n);
  const vgb = new Float32Array(n);
  const vbb = new Float32Array(n);

  for (let i = 0; i < n; i++) prod[i] = ir[i] * ir[i];
  boxMean(prod, vrr, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vrr[i] = Math.max(0, vrr[i] - mr[i] * mr[i]) + eps;

  for (let i = 0; i < n; i++) prod[i] = ir[i] * ig[i];
  boxMean(prod, vrg, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vrg[i] -= mr[i] * mg[i];

  for (let i = 0; i < n; i++) prod[i] = ir[i] * ib[i];
  boxMean(prod, vrb, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vrb[i] -= mr[i] * mb[i];

  for (let i = 0; i < n; i++) prod[i] = ig[i] * ig[i];
  boxMean(prod, vgg, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vgg[i] = Math.max(0, vgg[i] - mg[i] * mg[i]) + eps;

  for (let i = 0; i < n; i++) prod[i] = ig[i] * ib[i];
  boxMean(prod, vgb, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vgb[i] -= mg[i] * mb[i];

  for (let i = 0; i < n; i++) prod[i] = ib[i] * ib[i];
  boxMean(prod, vbb, tmp, prefix, w, h, r);
  for (let i = 0; i < n; i++) vbb[i] = Math.max(0, vbb[i] - mb[i] * mb[i]) + eps;

  // Solve 3x3 SPD system (Sigma + eps*I) * a = cov(I, p) via cofactors; reuse ir/ig/ib/p for a_r, a_g, a_b, b.
  const ar = ir;
  const ag = ig;
  const ab = ib;
  const b = p;
  for (let i = 0; i < n; i++) {
    const rr = vrr[i], rg = vrg[i], rb = vrb[i];
    const gg = vgg[i], gb = vgb[i], bb = vbb[i];
    const crr = gg * bb - gb * gb;
    const crg = gb * rb - rg * bb;
    const crb = rg * gb - gg * rb;
    const cgg = rr * bb - rb * rb;
    const cgb = rg * rb - rr * gb;
    const cbb = rr * gg - rg * rg;
    const det = rr * crr + rg * crg + rb * crb;
    const inv = det > 1e-20 ? 1 / det : 0;
    const crp = covR[i], cgp = covG[i], cbp = covB[i];
    const xr = (crr * crp + crg * cgp + crb * cbp) * inv;
    const xg = (crg * crp + cgg * cgp + cgb * cbp) * inv;
    const xb = (crb * crp + cgb * cgp + cbb * cbp) * inv;
    ar[i] = xr;
    ag[i] = xg;
    ab[i] = xb;
    b[i] = mp[i] - xr * mr[i] - xg * mg[i] - xb * mb[i];
  }

  // Average (a, b) over all windows containing each texel; reuse mr/mg/mb/mp as output planes.
  boxMean(ar, mr, tmp, prefix, w, h, r);
  boxMean(ag, mg, tmp, prefix, w, h, r);
  boxMean(ab, mb, tmp, prefix, w, h, r);
  boxMean(b, mp, tmp, prefix, w, h, r);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = mr[i];
    out[o + 1] = mg[i];
    out[o + 2] = mb[i];
    out[o + 3] = mp[i];
  }
  return out;
}
