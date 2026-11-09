import type { PreviewImage } from '../gl/PreviewImage';
import { halfToFloat } from '../util/half';
import type { SkinMask } from './SkinMask';

/**
 * Portrait retouch: a natural, high-end skin clean-up modelled on what Reblum's Natural preset does at 40 (measured on
 * the owner's before/after pairs, see the retouch plan). Four corrections, all on skin only and in sizes relative to
 * the face width fw, so they look the same on a headshot and a full-length portrait:
 *  1. spots: dark or red outliers about 0.25-1.2% of fw (spots, small marks, light bumps half) healed to their
 *     surroundings, in brightness and colour; moles (very dark, sharp) and tattoo ink (less red than skin) are kept;
 *  2. under-eyes: dark shading in the band below the lower lids (from the face landmarks) lifted part-way;
 *  3. lines: dark mid-scale lines in the frown, forehead, nasolabial and marionette areas softened;
 *  4. evening: a light reduction of mid-scale unevenness inside the skin, away from its outline, half on the body.
 * Fine texture under ~0.3% of fw (pores, grain) is never touched.
 *
 * The result is a map of per-channel gains (log2, linear Rec.2020) at about the session preview's size, packed with the
 * skin mask into the skin texture (MaskTexture) and multiplied into the image by the develop shader (`uSkinFix`), so
 * the preview, the 100% view and the export all get the same correction.
 */
export interface RetouchMap {
  width: number;
  height: number;
  /** RGBA per pixel: r = the skin mask (as SkinMask.data, resampled), g, b, a = log2 gain of linear R, G, B. */
  data: Float32Array;
  /** The Portrait retouch value (1..100) the map was made for; the shader scales it for others until it is redone. */
  strength: number;
}

/** Tuned at strength 40 on the owner's Reblum Natural 40 pairs (proto/best.json). */
const P40 = {
  evenFace: [0.04, 0.08, 0.06, 0, 0],
  evenBody: [0.02, 0.04, 0.03, 0, 0],
  spotSigma: [0.0025, 0.012],
  spotZ: [3.0, 5.0],
  spotGain: 1.0,
  spotLight: 0.5,
  underEyeBands: [2, 3, 4],
  underEyeGain: 0.6,
  lineBands: [1, 2, 3],
  lineZ: [0.5, 3.0],
  lineGain: 0.7,
  lineLight: 0.6,
  mole: [0.5, 0.85],
  ink: [3.0, 8.0],
  maxEv: 0.45,
};

/** Detail bands: band k lies between Gaussians of these sigmas (fractions of the face width). */
const BANDS = [0.003, 0.006, 0.012, 0.024, 0.048, 0.09];
/** Faces larger than this (work pixels) are retouched on a downscaled copy: the bands are relative anyway. */
const MAX_FACE_PX = 600;

// MediaPipe face mesh: lower lids (outer to inner corner) and the points the line areas hang on.
const RIGHT_LOWER_LID = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const LEFT_LOWER_LID = [263, 249, 390, 373, 374, 380, 381, 382, 362];

/** The slider at [strength] 1..100 (40 = the tuned Natural look): gains scale with it, thresholds loosen above 40. */
function paramsAt(strength: number) {
  const k = strength / 40;
  const g = (x: number) => Math.min(0.95, x * k);
  const shift = 0.5 * Math.log2(Math.max(k, 1e-3));
  return {
    ...P40,
    evenFace: P40.evenFace.map(g),
    evenBody: P40.evenBody.map(g),
    spotGain: g(P40.spotGain),
    underEyeGain: g(P40.underEyeGain),
    lineGain: g(P40.lineGain),
    spotZ: P40.spotZ.map((z) => Math.max(0.8, z - shift)),
    lineZ: P40.lineZ.map((z) => Math.max(0.4, z - shift)),
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The retouch map for [preview] (the session preview, linear Rec.2020) with [skin] (SkinSegmenter's mask, faces and
 * landmarks) at Portrait retouch [strength] 1..100, or null when there's no face to size it by.
 */
export function buildRetouchMap(preview: PreviewImage, skin: SkinMask, strength: number): RetouchMap | null {
  if (strength <= 0 || !skin.hasSkin) return null;
  const faces = skin.faces ?? [];
  let fwPreview = 0;
  for (const f of faces) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < f.length; i += 2) {
      lo = Math.min(lo, f[i]);
      hi = Math.max(hi, f[i]);
    }
    fwPreview = Math.max(fwPreview, (hi - lo) * preview.width);
  }
  // No landmarks (a face seen side on, or only skin): the face-skin area's diameter stands in for the width.
  if (fwPreview <= 0) fwPreview = (skin.faceDiameterPx * preview.width) / preview.fullWidth;
  if (!(fwPreview > 8)) return null;

  const step = Math.max(1, Math.ceil(fwPreview / MAX_FACE_PX));
  const fw = fwPreview / step;
  // Only the skin's bounding box (plus the widest blur's reach) is worked on: the rest of the map stays 0.
  const box = skinBox(skin, preview.width / step, preview.height / step, 0.3 * fw);
  if (!box) return null;
  const [x0, y0, w, h] = box;
  const n = w * h;
  const q = paramsAt(strength);

  // Scene pixels (Rec.2020) at the work size, and an sRGB-primaries linear copy at a skin-friendly exposure for Lab.
  const scene = new Float32Array(n * 3);
  downscale(preview, step, x0, y0, w, h, scene);
  const mask = resizeRegion(skin.data, skin.width, skin.height, preview.width / step, preview.height / step, x0, y0, w, h);
  let logSum = 0;
  let wSum = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2627 * scene[i * 3] + 0.678 * scene[i * 3 + 1] + 0.0593 * scene[i * 3 + 2];
    const m = mask[i] > 0.5 ? 1 : 0;
    logSum += m * Math.log(Math.max(y, 1e-6));
    wSum += m;
  }
  if (wSum < 16) return null;
  // Skin at about sRGB 0.62, where the Lab thresholds were tuned (on developed JPEGs).
  const k = 0.35 / Math.exp(logSum / wSum);
  const lin = new Float32Array(n * 3);
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = scene[i * 3] * k;
    const g = scene[i * 3 + 1] * k;
    const b = scene[i * 3 + 2] * k;
    const lr = Math.max(0, 1.6605 * r - 0.5876 * g - 0.0728 * b);
    const lg = Math.max(0, -0.1246 * r + 1.1329 * g - 0.0083 * b);
    const lb = Math.max(0, -0.0182 * r - 0.1006 * g + 1.1187 * b);
    lin[i * 3] = lr;
    lin[i * 3 + 1] = lg;
    lin[i * 3 + 2] = lb;
    L[i] = Math.log2(0.2126 * lr + 0.7152 * lg + 0.0722 * lb + 1e-3);
    const lab = toLab(lr, lg, lb);
    A[i] = lab[1];
    B[i] = lab[2];
  }

  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) S[i] = smoothstep(0.35, 0.75, mask[i]);
  const Sm = S.map((v) => Math.max(v, 1e-3));
  const blur = new Blur(w, h, Sm);

  const bl = BANDS.map((b) => blur.masked(L, b * fw));
  const d = bl.slice(0, -1).map((v, j) => sub(v, bl[j + 1]));
  const spread = d.map((x, j) => {
    const sq = blur.masked(mul(x, x), 4 * BANDS[j] * fw);
    return sq.map((v) => Math.sqrt(Math.max(0, v)) + 0.012);
  });

  const faceConf = skin.face ? resize(skin.face, skin.width, skin.height, w, h) : S;
  const isFace = gauss(faceConf, w, h, 0.02 * fw).map((v) => Math.min(1, Math.max(0, v)));
  // Evening stays inside the skin, away from its outline (jaw, hairline), where shading is form.
  const solid = S.map((v) => (v > 0.5 ? 1 : 0));
  const inner = gauss(minFilter(solid, w, h, Math.trunc((Math.trunc(0.08 * fw) | 1) / 2)), w, h, 0.03 * fw);

  const underEye = new Float32Array(n);
  const lines = new Float32Array(n);
  const fullW = Math.floor(preview.width / step);
  const fullH = Math.floor(preview.height / step);
  for (const f of faces) {
    const pt = (i: number): [number, number] => [f[i * 2] * fullW - x0, f[i * 2 + 1] * fullH - y0];
    maxInto(underEye, underEyeMask(pt, w, h, fw));
    maxInto(lines, linesMask(pt, w, h, fw));
  }

  // Kept: tattoo ink (clearly less red than the skin around it) and moles (very dark, sharp).
  const aWide = blur.masked(A, 0.06 * fw);
  const aFine = gauss(A, w, h, 0.004 * fw);
  const moleRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) moleRaw[i] = smoothstep(q.mole[0], q.mole[1], -(bl[0][i] - bl[2][i]));
  const mole = gauss(moleRaw, w, h, 0.006 * fw);
  const keep = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ink = smoothstep(q.ink[0], q.ink[1], aWide[i] - aFine[i]);
    keep[i] = (1 - ink) * (1 - Math.min(1, Math.max(0, mole[i] * 2)));
  }

  const dL = new Float32Array(n);
  const dA = new Float32Array(n);
  const dB = new Float32Array(n);
  // 4. evening: only small, texture-like deviations; edges (jaw, nose) keep their shape.
  for (let j = 0; j < d.length; j++) {
    const ef = q.evenFace[j];
    const eb = q.evenBody[j];
    if (ef === 0 && eb === 0) continue;
    for (let i = 0; i < n; i++) {
      const calm = (1 - smoothstep(1.0, 2.2, Math.abs(d[j][i] / spread[j][i]))) * inner[i];
      dL[i] -= d[j][i] * calm * (ef * isFace[i] + eb * (1 - isFace[i]));
    }
  }
  // 1. spots: dark, or red even if not dark (light ones by half), in one blob band.
  const [s0, s1] = [q.spotSigma[0] * fw, q.spotSigma[1] * fw];
  const D = sub(blur.masked(L, s0), blur.masked(L, s1));
  const DA = sub(blur.masked(A, s0), blur.masked(A, s1));
  const DB = sub(blur.masked(B, s0), blur.masked(B, s1));
  const spD = blur.masked(mul(D, D), 0.08 * fw);
  const spA = blur.masked(mul(DA, DA), 0.12 * fw);
  const wRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = D[i] / (Math.sqrt(Math.max(0, spD[i])) + 0.01);
    const zr = DA[i] / (Math.sqrt(Math.max(0, spA[i])) + 0.3);
    wRaw[i] = Math.max(smoothstep(q.spotZ[0], q.spotZ[1], -z), smoothstep(q.spotZ[0], q.spotZ[1], zr)) + q.spotLight * smoothstep(q.spotZ[0], q.spotZ[1], z);
  }
  const spot = gauss(wRaw, w, h, s0);
  for (let i = 0; i < n; i++) {
    // A healed spot takes the surrounding colour as well as its brightness (lifting luma alone turned brown marks orange).
    const wt = Math.min(1, Math.max(0, spot[i] * 1.5)) * q.spotGain;
    dL[i] -= D[i] * wt;
    dA[i] -= DA[i] * wt;
    dB[i] -= DB[i] * wt;
  }
  // 2. under-eyes: dark mid-scale shading lifted.
  for (const j of q.underEyeBands) for (let i = 0; i < n; i++) dL[i] -= Math.min(d[j][i], 0) * underEye[i] * q.underEyeGain;
  // 3. lines: dark ones, light ones in part.
  for (const j of q.lineBands) {
    for (let i = 0; i < n; i++) {
      if (lines[i] <= 0) continue;
      const z = d[j][i] / spread[j][i];
      dL[i] -= d[j][i] * (smoothstep(q.lineZ[0], q.lineZ[1], -z) + q.lineLight * smoothstep(q.lineZ[0], q.lineZ[1], z)) * lines[i] * q.lineGain;
    }
  }

  // Only well inside the skin, and never past ±0.45 EV.
  const core = gauss(minFilter(S, w, h, Math.trunc((Math.max(3, Math.trunc(0.02 * fw)) | 1) / 2)), w, h, 0.01 * fw);
  const mapW = fullW;
  const mapH = fullH;
  const out = new Float32Array(mapW * mapH * 4);
  const fullMask = resize(skin.data, skin.width, skin.height, mapW, mapH);
  for (let i = 0; i < mapW * mapH; i++) out[i * 4] = fullMask[i];
  for (let i = 0; i < n; i++) {
    const o = ((y0 + Math.trunc(i / w)) * mapW + x0 + (i % w)) * 4;
    const c = Math.min(1, Math.max(0, core[i])) * keep[i];
    if (c <= 0) continue;
    const el = Math.min(q.maxEv, Math.max(-q.maxEv, dL[i] * c));
    const ea = dA[i] * c;
    const eb = dB[i] * c;
    if (Math.abs(el) < 1e-4 && Math.abs(ea) < 1e-3 && Math.abs(eb) < 1e-3) continue;
    const gain = 2 ** el;
    const r0 = lin[i * 3];
    const g0 = lin[i * 3 + 1];
    const b0 = lin[i * 3 + 2];
    const lab = toLab(r0 * gain, g0 * gain, b0 * gain);
    const [r1, g1, b1] = fromLab(lab[0], lab[1] + ea, lab[2] + eb);
    // Back to scene Rec.2020: the original pixel times the change, through the sRGB -> Rec.2020 primaries.
    const dr = r1 - r0;
    const dg = g1 - g0;
    const db = b1 - b0;
    const R = scene[i * 3];
    const G = scene[i * 3 + 1];
    const Bc = scene[i * 3 + 2];
    const nr = R + (0.6274 * dr + 0.3293 * dg + 0.0433 * db) / k;
    const ng = G + (0.0691 * dr + 0.9195 * dg + 0.0114 * db) / k;
    const nb = Bc + (0.0164 * dr + 0.088 * dg + 0.8956 * db) / k;
    out[o + 1] = logRatio(nr, R);
    out[o + 2] = logRatio(ng, G);
    out[o + 3] = logRatio(nb, Bc);
  }
  return { width: mapW, height: mapH, data: out, strength };
}

/** log2(to / from), limited to ±1 EV; 0 where the pixel is (near) black. */
function logRatio(to: number, from: number): number {
  if (!(from > 1e-6)) return 0;
  return Math.min(1, Math.max(-1, Math.log2(Math.max(to, from / 2) / from)));
}

// ---- Face regions (work pixels) ----

function underEyeMask(pt: (i: number) => [number, number], w: number, h: number, fw: number): Float32Array {
  const m = new Float32Array(w * h);
  const depth = 0.11;
  for (const lid of [RIGHT_LOWER_LID, LEFT_LOWER_LID]) {
    const pts = lid.map(pt);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    // From just under the lashes to a curve a little wider than the eye, ~0.14 fw down.
    const top = pts.map(([x, y]): [number, number] => [x, y + 0.035 * fw]);
    const bottom = pts.map(([x, y]): [number, number] => [cx + (x - cx) * 1.15, y + (depth + 0.03) * fw]).reverse();
    fillPolygon(m, w, h, [...top, ...bottom]);
  }
  return gauss(m, w, h, 0.02 * fw);
}

function linesMask(pt: (i: number) => [number, number], w: number, h: number, fw: number): Float32Array {
  const m = new Float32Array(w * h);
  const mid = (a: number, b: number): [number, number] => [(pt(a)[0] + pt(b)[0]) / 2, (pt(a)[1] + pt(b)[1]) / 2];
  const toward = (a: number, b: number, t: number): [number, number] => [pt(a)[0] + (pt(b)[0] - pt(a)[0]) * t, pt(a)[1] + (pt(b)[1] - pt(a)[1]) * t];
  fillCircle(m, w, h, mid(9, 8), 0.09 * fw); // glabella (frown lines)
  fillCircle(m, w, h, toward(151, 9, -0.3), 0.18 * fw); // forehead
  fillCircle(m, w, h, mid(205, 216), 0.07 * fw); // nasolabial
  fillCircle(m, w, h, mid(425, 436), 0.07 * fw);
  fillCircle(m, w, h, toward(57, 152, 0.35), 0.06 * fw); // marionette
  fillCircle(m, w, h, toward(287, 152, 0.35), 0.06 * fw);
  return gauss(m, w, h, 0.03 * fw);
}

function fillCircle(m: Float32Array, w: number, h: number, [cx, cy]: [number, number], r: number) {
  const r2 = Math.trunc(r) ** 2;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) m[y * w + x] = 1;
    }
  }
}

/** Even-odd scanline fill of a closed polygon, at pixel centres. */
export function fillPolygon(m: Float32Array, w: number, h: number, pts: [number, number][]) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= py) !== (by <= py)) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[i + 1] - 0.5)); x++) m[y * w + x] = 1;
    }
  }
}

function maxInto(a: Float32Array, b: Float32Array) {
  for (let i = 0; i < a.length; i++) if (b[i] > a[i]) a[i] = b[i];
}

function sub(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

function mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i];
  return out;
}

// ---- Colour ----

const XN = 0.950456;
const ZN = 1.088754;
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const labFInv = (f: number) => (f > 0.206893 ? f * f * f : (f - 16 / 116) / 7.787);

/** Linear sRGB -> CIE Lab (D65), as OpenCV's float RGB2Lab after its gamma step. */
export function toLab(r: number, g: number, b: number): [number, number, number] {
  const x = (0.412453 * r + 0.35758 * g + 0.180423 * b) / XN;
  const y = 0.212671 * r + 0.71516 * g + 0.072169 * b;
  const z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / ZN;
  const fy = labF(y);
  return [y > 0.008856 ? 116 * fy - 16 : 903.3 * y, 500 * (labF(x) - fy), 200 * (fy - labF(z))];
}

/** CIE Lab (D65) -> linear sRGB. */
export function fromLab(l: number, a: number, bb: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const x = labFInv(fy + a / 500) * XN;
  const y = l > 7.9996 ? fy * fy * fy : l / 903.3;
  const z = labFInv(fy - bb / 200) * ZN;
  return [
    3.240479 * x - 1.53715 * y - 0.498535 * z,
    -0.969256 * x + 1.875991 * y + 0.041556 * z,
    0.055648 * x - 0.204043 * y + 1.057311 * z,
  ];
}

// ---- Image helpers ----

/**
 * The work region [x0, y0, w, h] (pixels of a [mapW] x [mapH] map): where [skin] has any skin, grown by [margin], or
 * null without skin.
 */
function skinBox(skin: SkinMask, mapW: number, mapH: number, margin: number): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < skin.height; y++) {
    for (let x = 0; x < skin.width; x++) {
      if (skin.data[y * skin.width + x] < 0.05) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1);
    }
  }
  if (minX > maxX) return null;
  const W = Math.floor(mapW);
  const H = Math.floor(mapH);
  const sx = mapW / skin.width;
  const sy = mapH / skin.height;
  const x0 = Math.max(0, Math.floor(minX * sx - margin));
  const y0 = Math.max(0, Math.floor(minY * sy - margin));
  const x1 = Math.min(W, Math.ceil(maxX * sx + margin));
  const y1 = Math.min(H, Math.ceil(maxY * sy + margin));
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** The [x0, y0, w, h] part of [src] (sw x sh) resized bilinearly to [fullW] x [fullH]. */
function resizeRegion(src: Float32Array, sw: number, sh: number, fullW: number, fullH: number, x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const W = Math.floor(fullW);
  const H = Math.floor(fullH);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y0 + y + 0.5) * sh) / H - 0.5));
    const ya = Math.trunc(fy);
    const yb = Math.min(ya + 1, sh - 1);
    const ty = fy - ya;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x0 + x + 0.5) * sw) / W - 0.5));
      const xa = Math.trunc(fx);
      const xb = Math.min(xa + 1, sw - 1);
      const tx = fx - xa;
      const top = src[ya * sw + xa] * (1 - tx) + src[ya * sw + xb] * tx;
      const bottom = src[yb * sw + xa] * (1 - tx) + src[yb * sw + xb] * tx;
      out[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** [step] x [step] block averages of [image] from (x0, y0) of the downscaled grid into [out] (RGB floats, w x h). */
function downscale(image: PreviewImage, step: number, x0: number, y0: number, w: number, h: number, out: Float32Array) {
  const px = image.pixels;
  const sw = image.width;
  const inv = 1 / (step * step);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < step; j++) {
        for (let i = 0; i < step; i++) {
          const s = (((y0 + y) * step + j) * sw + (x0 + x) * step + i) * 3;
          r += halfToFloat(px[s]);
          g += halfToFloat(px[s + 1]);
          b += halfToFloat(px[s + 2]);
        }
      }
      const o = (y * w + x) * 3;
      out[o] = Math.max(0, r * inv);
      out[o + 1] = Math.max(0, g * inv);
      out[o + 2] = Math.max(0, b * inv);
    }
  }
}

/** Bilinear resize of a single-channel map (pixel centres aligned). */
export function resize(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.trunc(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.trunc(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Gaussian blurs normalised by a weight map (skin only), caching the blurred weights per sigma. */
class Blur {
  private readonly weights = new Map<number, Float32Array>();

  constructor(private readonly w: number, private readonly h: number, private readonly weight: Float32Array) {}

  masked(x: Float32Array, sigma: number): Float32Array {
    let ws = this.weights.get(sigma);
    if (!ws) {
      ws = gauss(this.weight, this.w, this.h, sigma);
      this.weights.set(sigma, ws);
    }
    const num = gauss(mul(x, this.weight), this.w, this.h, sigma);
    for (let i = 0; i < num.length; i++) num[i] /= Math.max(ws[i], 1e-4);
    return num;
  }
}

/**
 * Gaussian blur, edges clamped: an exact kernel for small sigmas, three box passes (each axis) for larger ones,
 * whose cost doesn't grow with the radius. Vertical passes run row by row (all columns at once) to stay in cache.
 */
export function gauss(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const s = Math.max(0.4, sigma);
  if (s >= 6 && w >= 32 && h >= 32) {
    // Wide blurs at half size: the 2x2 averaging and the bilinear way back add about one full-size pixel of blur.
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    return up2(gauss(down2(src, w, h), hw, hh, Math.sqrt(s * s - 1) / 2), hw, hh, w, h);
  }
  const a = new Float32Array(src.length);
  const b = new Float32Array(src.length);
  if (s < 1.6) {
    const r = Math.ceil(3 * s);
    const kernel = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += kernel[i + r] = Math.exp((-0.5 * i * i) / (s * s));
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    convolveH(src, b, w, h, kernel);
    convolveV(b, a, w, h, kernel);
    return a;
  }
  const acc = new Float64Array(w);
  let from = src;
  for (const size of boxSizes(s, 3)) {
    const r = (size - 1) / 2;
    boxH(from, b, w, h, r);
    boxV(b, a, w, h, r, acc);
    from = a;
  }
  return a;
}

/** 2x2 block means (a last odd row or column averages with itself). */
function down2(src: Float32Array, w: number, h: number): Float32Array {
  const hw = Math.ceil(w / 2);
  const hh = Math.ceil(h / 2);
  const out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    const r0 = 2 * y * w;
    const r1 = Math.min(2 * y + 1, h - 1) * w;
    for (let x = 0; x < hw; x++) {
      const c0 = 2 * x;
      const c1 = Math.min(2 * x + 1, w - 1);
      out[y * hw + x] = 0.25 * (src[r0 + c0] + src[r0 + c1] + src[r1 + c0] + src[r1 + c1]);
    }
  }
  return out;
}

/** Bilinear 2x upsampling of [down2]'s grid back to w x h (pixel centres aligned, edges clamped). */
function up2(half: Float32Array, hw: number, hh: number, w: number, h: number): Float32Array {
  const rows = new Float32Array(hh * w);
  for (let y = 0; y < hh; y++) {
    const o = y * hw;
    for (let x = 0; x < w; x++) {
      const i = x >> 1;
      const j = x & 1 ? Math.min(i + 1, hw - 1) : Math.max(i - 1, 0);
      rows[y * w + x] = 0.75 * half[o + i] + 0.25 * half[o + j];
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const i = y >> 1;
    const j = y & 1 ? Math.min(i + 1, hh - 1) : Math.max(i - 1, 0);
    const a = i * w;
    const b = j * w;
    const o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = 0.75 * rows[a + x] + 0.25 * rows[b + x];
  }
  return out;
}

/** Widths of [n] box filters whose sum approximates a Gaussian of [sigma]. */
function boxSizes(sigma: number, n: number): number[] {
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function convolveH(src: Float32Array, dst: Float32Array, w: number, h: number, kernel: Float32Array) {
  const r = (kernel.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (x >= r && x + r < w) {
        for (let k = 0; k < kernel.length; k++) acc += kernel[k] * src[o + x - r + k];
      } else {
        for (let k = 0; k < kernel.length; k++) {
          const i = x - r + k;
          acc += kernel[k] * src[o + (i < 0 ? 0 : i >= w ? w - 1 : i)];
        }
      }
      dst[o + x] = acc;
    }
  }
}

function convolveV(src: Float32Array, dst: Float32Array, w: number, h: number, kernel: Float32Array) {
  const r = (kernel.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) dst[o + x] = 0;
    for (let k = 0; k < kernel.length; k++) {
      const yy = y - r + k;
      const so = (yy < 0 ? 0 : yy >= h ? h - 1 : yy) * w;
      const kv = kernel[k];
      for (let x = 0; x < w; x++) dst[o + x] += kv * src[so + x];
    }
  }
}

/** Running box mean of radius [r] along rows, edges clamped. */
function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let acc = (r + 1) * src[o];
    for (let i = 1; i <= r; i++) acc += src[o + (i > last ? last : i)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc * inv;
      const add = x + r + 1;
      const rem = x - r;
      acc += src[o + (add > last ? last : add)] - src[o + (rem < 0 ? 0 : rem)];
    }
  }
}

/** Running box mean of radius [r] down the columns, all columns at once ([acc]: w doubles of scratch). */
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, acc: Float64Array) {
  const inv = 1 / (2 * r + 1);
  const last = h - 1;
  for (let x = 0; x < w; x++) acc[x] = (r + 1) * src[x];
  for (let j = 1; j <= r; j++) {
    const so = (j > last ? last : j) * w;
    for (let x = 0; x < w; x++) acc[x] += src[so + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const add = (y + r + 1 > last ? last : y + r + 1) * w;
    const rem = (y - r < 0 ? 0 : y - r) * w;
    for (let x = 0; x < w; x++) {
      dst[o + x] = acc[x] * inv;
      acc[x] += src[add + x] - src[rem + x];
    }
  }
}

/** Grey erosion with a (2r+1)^2 square (separable running minimum; outside the image doesn't count). */
export function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return new Float32Array(src);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  minPass(src, tmp, w, h, r, 1, w);
  minPass(tmp, out, h, w, r, w, 1);
  return out;
}

/** van Herk / Gil-Werman running minimum along lines. */
function minPass(src: Float32Array, dst: Float32Array, len: number, lines: number, r: number, step: number, lineStep: number) {
  const k = 2 * r + 1;
  const padded = len + 2 * r;
  const n = Math.ceil(padded / k) * k;
  const v = new Float32Array(n);
  const g = new Float32Array(n);
  const hh = new Float32Array(n);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStep;
    v.fill(Infinity);
    for (let i = 0; i < len; i++) v[i + r] = src[o + i * step];
    for (let s = 0; s < n; s += k) {
      g[s] = v[s];
      for (let i = s + 1; i < s + k; i++) g[i] = Math.min(g[i - 1], v[i]);
      hh[s + k - 1] = v[s + k - 1];
      for (let i = s + k - 2; i >= s; i--) hh[i] = Math.min(hh[i + 1], v[i]);
    }
    // Window [i, i + 2r] in padded coordinates = source pixels i - r .. i + r.
    for (let i = 0; i < len; i++) dst[o + i * step] = Math.min(hh[i], g[i + 2 * r]);
  }
}

// ---- Running it off the page's thread ----

/** One retouch worker; calls run one at a time there. */
class RetouchWorker {
  private readonly worker = new Worker(new URL('../../worker/retouch.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: RetouchMap | null) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; map?: RetouchMap | null; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.error === undefined) p.resolve(ev.data.map ?? null);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = () => {
      broken = true;
      for (const p of this.pending.values()) p.reject(new Error('retouch worker failed'));
      this.pending.clear();
    };
  }

  build(preview: PreviewImage, skin: SkinMask, strength: number): Promise<RetouchMap | null> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, preview, skin, strength });
    });
  }
}

let worker: RetouchWorker | null = null;
let broken = false;

/** buildRetouchMap in a worker (about a second of CPU on a portrait), on this thread where workers can't run. */
export function retouchMap(preview: PreviewImage, skin: SkinMask, strength: number): Promise<RetouchMap | null> {
  if (!broken && typeof Worker !== 'undefined') {
    try {
      worker ??= new RetouchWorker();
      return worker.build(preview, skin, strength).catch(() => buildRetouchMap(preview, skin, strength));
    } catch {
      broken = true;
    }
  }
  return Promise.resolve().then(() => buildRetouchMap(preview, skin, strength));
}

/** The shader's `uSkinFix` for Portrait retouch [strength] 0..100 with [map]: the map scaled until it is redone. */
export function skinFixOf(strength: number, map: RetouchMap | null): number {
  if (!map || strength <= 0 || map.strength <= 0) return 0;
  return Math.min(2.5, strength / map.strength);
}
