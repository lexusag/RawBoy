import { floatToHalf, halfToFloat } from '../util/half';
import type { PreviewImage } from './PreviewImage';

/**
 * What the anamorphic flare (shaders/develop.glsl, `anamorphicFlare`) scatters light from, made once per photo from
 * the highlight-boosted 1536 px copy (`FLARE_SOURCE_MAX_DIMENSION`, the same as the lens blur's). Port of FlareSource.kt.
 *
 * Three bands stacked top to bottom, each `width` texels across (the copy's width / 3: one texel is a halo texel, so the
 * streak reaches as far as it always did):
 * - band 0, `rows` rows: the copy's own rows. A bright light is thin here: the needle.
 * - band 1, `ceil(rows / 3)` rows: the same, three rows to one, so a texel is square. The wing and the bar.
 * - band 2, as band 1: its luminance blurred into tall ovals (sigma 4 across, 10 down), for the ghosts.
 *
 * Bands 0 and 1 are the boosted light multiplied by two gates, so the shader's knee does the rest:
 * - size: how much of the neighbourhood (a Gaussian of 2.5% of the long edge, then the largest value within 0.3 of that)
 *   is bright. A lamp covers little of it, a window or a sign nearly all (`SIZE_LO`..`SIZE_HI`): big lights don't flare.
 * - brightness: lights that don't fill a texel with clipped light (small windows, reflections) drop out
 *   (`BRIGHT_LO`..`BRIGHT_HI`, boosted units: 7 is a clipped texel).
 * The same maths (and constants) as the Kotlin and Swift ports; tools can mirror it in numpy.
 */
export const FLARE_SOURCE_MAX_DIMENSION = 1536;

/** The size gate's reach: tight enough that a small light beside a big bright area (a lamp by a lit ceiling) still flares. */
const SIZE_SIGMA = 0.025;
const SIZE_DILATE = 0.3;
const SIZE_LO = 0.05;
const SIZE_HI = 0.14;
const BRIGHT_LO = 4.5;
const BRIGHT_HI = 6.8;
/** Where "bright" starts for the size gate's blown-out measure, boosted units. */
const BLOWN_LO = 1.5;
const BLOWN_HI = 4.0;

const LUMA = [0.2627, 0.678, 0.0593];

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Mean of a window of 2r+1 along rows or columns, edges repeated. [a] is w x h, one channel. */
function boxPass(a: Float32Array, w: number, h: number, r: number, alongX: boolean): Float32Array {
  const out = new Float32Array(a.length);
  const n = alongX ? w : h;
  const lines = alongX ? h : w;
  const window = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (alongX ? l * w + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * w + l);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += a[at(i)];
    for (let i = 0; i < n; i++) {
      out[alongX ? l * w + i : i * w + l] = sum / window;
      sum += a[at(i + r + 1)] - a[at(i - r)];
    }
  }
  return out;
}

/** A Gaussian of sigma [sy] down and [sx] across, as three box passes each way. */
function gauss3(a: Float32Array, w: number, h: number, sy: number, sx: number): Float32Array {
  const radius = (s: number) => Math.max(1, Math.round((Math.sqrt(4 * s * s + 1) - 1) / 2));
  let out = a;
  for (const [alongX, s] of [[false, sy], [true, sx]] as const) {
    const r = radius(s);
    for (let k = 0; k < 3; k++) out = boxPass(out, w, h, r, alongX);
  }
  return out;
}

/** The largest value in a square window of 2r+1, edges repeated. */
function maxFilter(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (src: Float32Array, alongX: boolean) => {
    const out = new Float32Array(src.length);
    const n = alongX ? w : h;
    const lines = alongX ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < n; i++) {
        let m = -Infinity;
        for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) m = Math.max(m, src[alongX ? l * w + j : j * w + l]);
        out[alongX ? l * w + i : i * w + l] = m;
      }
    }
    return out;
  };
  return pass(pass(a, true), false);
}

/** Rows of band 1 (and 2) for a copy of [rows] rows. */
export const flareCoarseRows = (rows: number) => Math.ceil(rows / 3);

/** The flare source for [src] (the highlight-boosted ~1536 px copy). */
export function makeFlareSource(src: PreviewImage): PreviewImage {
  const { width: w, height: h } = src;
  const wf = Math.ceil(w / 3);
  const rc = flareCoarseRows(h);
  const px = Float32Array.from(src.pixels, halfToFloat);

  // The copy three to one across.
  const fine = new Float32Array(wf * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < wf; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += px[(y * w + Math.min(w - 1, 3 * x + k)) * 3 + c];
        fine[(y * wf + x) * 3 + c] = sum / 3;
      }
    }
  }

  // How much of the neighbourhood is blown out, per row of band 1.
  const blown = new Float32Array(wf * rc);
  for (let yc = 0; yc < rc; yc++) {
    for (let x = 0; x < wf; x++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const o = (Math.min(h - 1, 3 * yc + k) * wf + x) * 3;
        sum += Math.min(1, Math.max(0, (Math.max(fine[o], fine[o + 1], fine[o + 2]) - BLOWN_LO) / (BLOWN_HI - BLOWN_LO)));
      }
      blown[yc * wf + x] = sum / 3;
    }
  }
  const sigma = SIZE_SIGMA * Math.max(wf, rc);
  const area = maxFilter(gauss3(blown, wf, rc, sigma, sigma), wf, rc, Math.round(SIZE_DILATE * sigma));

  // Bands 0 and 1: the light times both gates.
  const gated = new Float32Array(wf * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < wf; x++) {
      const o = (y * wf + x) * 3;
      const gate = (1 - smoothstep(SIZE_LO, SIZE_HI, area[Math.floor(y / 3) * wf + x])) * smoothstep(BRIGHT_LO, BRIGHT_HI, Math.max(fine[o], fine[o + 1], fine[o + 2]));
      gated[o] = fine[o] * gate;
      gated[o + 1] = fine[o + 1] * gate;
      gated[o + 2] = fine[o + 2] * gate;
    }
  }
  const coarse = new Float32Array(wf * rc * 3);
  for (let yc = 0; yc < rc; yc++) {
    for (let x = 0; x < wf; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += gated[(Math.min(h - 1, 3 * yc + k) * wf + x) * 3 + c];
        coarse[(yc * wf + x) * 3 + c] = sum / 3;
      }
    }
  }

  // Band 2: the lights' luminance as tall ovals.
  const lum = new Float32Array(wf * rc);
  for (let i = 0; i < lum.length; i++) lum[i] = coarse[i * 3] * LUMA[0] + coarse[i * 3 + 1] * LUMA[1] + coarse[i * 3 + 2] * LUMA[2];
  const ghost = gauss3(lum, wf, rc, 10, 4);

  const out = new Uint16Array(wf * (h + 2 * rc) * 3);
  let o = 0;
  for (let i = 0; i < gated.length; i++) out[o++] = floatToHalf(gated[i]);
  for (let i = 0; i < coarse.length; i++) out[o++] = floatToHalf(coarse[i]);
  for (let i = 0; i < ghost.length; i++) {
    const v = floatToHalf(ghost[i]);
    out[o++] = v;
    out[o++] = v;
    out[o++] = v;
  }
  return { width: wf, height: h + 2 * rc, pixels: out, fullWidth: src.fullWidth, fullHeight: src.fullHeight };
}

/** Rows of band 0 for a flare source (what [makeFlareSource] kept of the copy's rows). */
export function flareRows(source: PreviewImage): number {
  // height = rows + 2 * ceil(rows / 3)
  let rows = Math.floor((source.height * 3) / 5);
  while (rows + 2 * flareCoarseRows(rows) < source.height) rows++;
  while (rows + 2 * flareCoarseRows(rows) > source.height) rows--;
  return rows;
}
