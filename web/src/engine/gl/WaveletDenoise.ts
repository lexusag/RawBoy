import DENOISE_VERT from '../../../../shaders/denoise.vert?raw';
import DENOISE_SPLIT from '../../../../shaders/denoise_split.frag?raw';
import DENOISE_LEVEL from '../../../../shaders/denoise_level.frag?raw';
import DENOISE_SHRINK from '../../../../shaders/denoise_shrink.frag?raw';
import DENOISE_MERGE from '../../../../shaders/denoise_merge.frag?raw';
import { createProgram, createTexture, type FullscreenQuad } from './GlCommon';

/**
 * Multi-scale denoise pre-pass (port of gl/WaveletDenoise.kt): renders a denoised copy of the image texture that the
 * develop shader reads in place of the image, with `uDenoisePre` 1 so it only adds its fine chroma stage.
 *
 * Method (the published a trous wavelet shrinkage, our own implementation; shaders/denoise_*.frag): in the
 * sqrt(x + c) domain split into luma L = mean and ratio chroma (c - L) / (L + k); decompose with the B3-spline a trous
 * transform (5-tap kernel at strides 1, 2, 4, ...); shrink every band against that band's noise; add the bands back.
 * Band noise follows a profile measured on flat patches of camera raws (GFX 50R, A7 III, ISO 1000-6400): demosaicing
 * correlates the noise, so the coarse bands hold 1.5x (luma) to 3x (chroma) what white noise would. The bilateral
 * alone only reached the finest band and left that coarse noise as blotchy mottle on flat surfaces once the exposure
 * went up. Fine chroma (full-res bands 0-1) is left to the develop shader's ratio-chroma bilateral: shrunk here, the
 * dim channels' structure under strongly coloured light (what a mono LUT shows there) was wiped out.
 *
 * Scales are in full-resolution pixels: on a downscaled texture (pixel scale p < 1) texture band j is full-res band
 * j + log2(1/p), and fewer levels cover the same reach. Needs float render targets (EXT_color_buffer_float);
 * without them [supported] is false and the develop shader denoises alone.
 */

/** Luma noise per band relative to band 0, measured on flat raw patches (sqrt domain). */
const LUMA_PROFILE = [1.0, 0.32, 0.14, 0.065, 0.03, 0.015];
/** Chroma noise per band, relative to luma band 0. */
const CHROMA_PROFILE = [0.76, 0.48, 0.28, 0.14, 0.06, 0.03];
/**
 * Threshold per band in noise sigmas: firm everywhere, so flat areas lose each band's noise consistently (a threshold
 * near 1 sigma kills some patches and not others, and the leftover read as mottle again)...
 */
const LUMA_K = [1.3, 1.4, 1.8, 2.2, 2.5, 2.5];
const CHROMA_K = [1.5, 2.0, 2.5, 3.0, 3.0, 3.0];
/**
 * ...then a constant fraction of each band's original is added back, about the same at every scale, so what is left
 * looks like the camera's own noise at a lower level (a cleaner sensor), not plastic. The bilateral kept 39% of the
 * finest band but 83-88% of the coarse ones (measured on a flat wall): its leftover was all low frequency, the
 * blotchy mottle. Picked by the owner in the web's comparison (0.3 / 0.25 / 0.2 x 1.75).
 */
const LUMA_KEEP = [0.525, 0.525, 0.4375, 0.35, 0.35, 0.35];
/** Coarse chroma kept: invisible as colour, but grain for a mono LUT under coloured light. */
const CHROMA_KEEP = 0.175;
/** Full-res bands below this are the develop shader's fine chroma stage, not shrunk here. */
const FINE_CHROMA_BANDS = 1.5;
/** Full-resolution levels: reach 2 * (1 + 2 + 4 + 8 + 16) = 62 px (WAVELET_DENOISE_MARGIN). */
const LEVELS = 5;
/** Ratio chroma offset in the sqrt domain: keeps the ratio finite where luma is near black. */
export const RATIO_K = 0.02;
/**
 * The transform is sqrt(x + c), not sqrt(x): near black read noise dominates, which sqrt(x) blows up (it is steepest
 * at 0). A yellow wall at ISO 1000 (blue mean 0.002, 1% clipped at zero) turned into deep dark dots once the rest was
 * smooth; c >= 0.003 removed most, 0.01 all. c follows the slider's noise level, c = (OFFSET_K sigma)^2: 0.003 for that
 * wall (sigma 0.0045), 0.0002 at base ISO, where read noise doesn't matter. The thresholds are scaled by the
 * transform's flatter slope near black (denoise_shrink.frag). (A per-image fit of variance = a x + b was tried: on
 * demosaiced pixels it underestimated b and was unstable across files.)
 */
const OFFSET_K = 12;

/** Source pixels the pre-pass reads around a pixel (5 levels of a 5-tap kernel, strides 1..16). */
export const WAVELET_DENOISE_MARGIN = 64;

/** Value of a per-band table at fractional band b (log-linear between entries, halving past the end). */
function profileAt(table: number[], b: number): number {
  const last = table.length - 1;
  if (b >= last) return table[last] * 0.5 ** (b - last);
  const i = Math.floor(b);
  const f = b - i;
  return Math.exp(Math.log(table[i]) * (1 - f) + Math.log(table[i + 1]) * f);
}

function linearAt(table: number[], b: number): number {
  const i = Math.min(Math.floor(b), table.length - 1);
  const j = Math.min(i + 1, table.length - 1);
  const f = Math.min(1, b - i);
  return table[i] * (1 - f) + table[j] * f;
}

/** One level's uniforms. */
export interface DenoiseLevel {
  stride: number;
  lumaThreshold: number;
  chromaThreshold: number;
  lumaKeep: number;
  chromaKeep: number;
}

/**
 * The levels for a texture of [pixelScale] texels per full-res pixel; [sigmaL]/[sigmaC]: the sliders' noise std in
 * the sqrt domain (full resolution).
 */
export function denoiseLevels(pixelScale: number, sigmaL: number, sigmaC: number): DenoiseLevel[] {
  const shift = Math.max(0, Math.log2(1 / pixelScale));
  const count = Math.max(1, Math.min(LEVELS, Math.round(LEVELS - shift)));
  const levels: DenoiseLevel[] = [];
  for (let j = 0; j < count; j++) {
    const band = j + shift; // the full-resolution band this texture band stands for
    const fineChroma = band < FINE_CHROMA_BANDS;
    levels.push({
      stride: 1 << j,
      lumaThreshold: sigmaL * profileAt(LUMA_PROFILE, band) * linearAt(LUMA_K, band),
      chromaThreshold: fineChroma ? 0 : sigmaC * profileAt(CHROMA_PROFILE, band) * linearAt(CHROMA_K, band),
      lumaKeep: linearAt(LUMA_KEEP, band),
      chromaKeep: fineChroma ? 1 : CHROMA_KEEP,
    });
  }
  return levels;
}

/** c of the sqrt(x + c) transform for the sliders' sigmas. */
export const denoiseOffset = (sigmaL: number, sigmaC: number) => (OFFSET_K * Math.max(sigmaL, sigmaC * 0.5)) ** 2;

const UNIT_A = 10;
const UNIT_B = 11;

export class WaveletDenoise {
  private readonly split: WebGLProgram;
  private readonly level: WebGLProgram;
  private readonly shrink: WebGLProgram;
  private readonly merge: WebGLProgram;
  private readonly fbo: WebGLFramebuffer;
  private low: WebGLTexture[] = [];
  private acc: WebGLTexture[] = [];
  private detail: WebGLTexture | null = null;
  private out: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  /** What [out] holds, so an unchanged image and strength aren't denoised again on every slider move. */
  private key = '';
  readonly supported: boolean;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly quad: FullscreenQuad) {
    this.supported = gl.getExtension('EXT_color_buffer_float') != null;
    this.split = createProgram(gl, DENOISE_VERT, DENOISE_SPLIT);
    this.level = createProgram(gl, DENOISE_VERT, DENOISE_LEVEL);
    this.shrink = createProgram(gl, DENOISE_VERT, DENOISE_SHRINK);
    this.merge = createProgram(gl, DENOISE_VERT, DENOISE_MERGE);
    this.fbo = gl.createFramebuffer()!;
  }

  /** Whether [apply] runs for these strengths (0..1 sliders, as ShaderParams.denoise / colorDenoise). */
  active(denoise: number, colorDenoise: number): boolean {
    return this.supported && (denoise > 0 || colorDenoise > 0);
  }

  private ensure(width: number, height: number) {
    if (width === this.width && height === this.height && this.out) return;
    this.releaseTextures();
    const gl = this.gl;
    const make = (format: number, filter: number) => {
      const t = createTexture(gl, filter);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
      return t;
    };
    this.low = [make(gl.RGBA32F, gl.NEAREST), make(gl.RGBA32F, gl.NEAREST)];
    this.acc = [make(gl.RGBA32F, gl.NEAREST), make(gl.RGBA32F, gl.NEAREST)];
    this.detail = make(gl.RGBA32F, gl.NEAREST);
    this.out = make(gl.RGBA16F, gl.LINEAR);
    this.width = width;
    this.height = height;
    this.key = '';
  }

  /**
   * Denoises [src] (linear RGB, [width] x [height] texels, [pixelScale] texels per full-resolution pixel) and returns
   * the texture holding the result. [denoise]/[colorDenoise]: the 0..1 sliders. [srcKey] identifies the texture's
   * contents for caching. Leaves the default framebuffer bound and unit 0 active; the caller sets its viewport again.
   */
  apply(src: WebGLTexture, srcKey: string, width: number, height: number, pixelScale: number, denoise: number, colorDenoise: number): WebGLTexture {
    const gl = this.gl;
    this.ensure(width, height);
    const key = [srcKey, width, height, pixelScale, denoise, colorDenoise].join('|');
    if (key === this.key) return this.out!;
    // The sliders' sigma, as the develop shader's (0.03 at full strength, ~ISO 6400 on a typical sensor).
    const sigmaL = denoise * 0.03;
    const sigmaC = colorDenoise * 0.03;
    const offset = denoiseOffset(sigmaL, sigmaC);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);

    gl.useProgram(this.split);
    gl.activeTexture(gl.TEXTURE0 + UNIT_A);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(this.split, 'uSrc'), UNIT_A);
    gl.uniform1f(gl.getUniformLocation(this.split, 'uK'), RATIO_K);
    gl.uniform1f(gl.getUniformLocation(this.split, 'uOffset'), offset);
    this.target(this.low[0]);
    this.quad.draw();

    let cur = 0;
    let acc = 0;
    denoiseLevels(pixelScale, sigmaL, sigmaC).forEach((lv, j) => {
      gl.useProgram(this.level);
      gl.uniform1i(gl.getUniformLocation(this.level, 'uLow'), UNIT_A);
      gl.uniform1i(gl.getUniformLocation(this.level, 'uStride'), lv.stride);
      gl.activeTexture(gl.TEXTURE0 + UNIT_A);
      gl.bindTexture(gl.TEXTURE_2D, this.low[cur]);
      this.target(this.low[1 - cur], this.detail);
      this.quad.draw();
      cur = 1 - cur;

      gl.useProgram(this.shrink);
      gl.uniform1i(gl.getUniformLocation(this.shrink, 'uDetail'), UNIT_A);
      gl.uniform1i(gl.getUniformLocation(this.shrink, 'uAcc'), UNIT_B);
      // Energy window at about the band's own spacing.
      gl.uniform1i(gl.getUniformLocation(this.shrink, 'uStride'), Math.max(1, lv.stride >> 1));
      gl.uniform1i(gl.getUniformLocation(this.shrink, 'uFirst'), j === 0 ? 1 : 0);
      gl.uniform3f(gl.getUniformLocation(this.shrink, 'uThr'), lv.lumaThreshold, lv.chromaThreshold, RATIO_K);
      gl.uniform1f(gl.getUniformLocation(this.shrink, 'uOffset'), offset);
      gl.uniform1f(gl.getUniformLocation(this.shrink, 'uKeep'), lv.lumaKeep);
      gl.uniform1f(gl.getUniformLocation(this.shrink, 'uKeepC'), lv.chromaKeep);
      gl.bindTexture(gl.TEXTURE_2D, this.detail);
      gl.activeTexture(gl.TEXTURE0 + UNIT_B);
      gl.bindTexture(gl.TEXTURE_2D, this.acc[acc]);
      this.target(this.acc[1 - acc]);
      this.quad.draw();
      acc = 1 - acc;
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0 + UNIT_A);
      gl.bindTexture(gl.TEXTURE_2D, null);
    });

    gl.useProgram(this.merge);
    gl.activeTexture(gl.TEXTURE0 + UNIT_A);
    gl.bindTexture(gl.TEXTURE_2D, this.low[cur]);
    gl.activeTexture(gl.TEXTURE0 + UNIT_B);
    gl.bindTexture(gl.TEXTURE_2D, this.acc[acc]);
    gl.uniform1i(gl.getUniformLocation(this.merge, 'uLow'), UNIT_A);
    gl.uniform1i(gl.getUniformLocation(this.merge, 'uAcc'), UNIT_B);
    gl.uniform1f(gl.getUniformLocation(this.merge, 'uK'), RATIO_K);
    gl.uniform1f(gl.getUniformLocation(this.merge, 'uOffset'), offset);
    this.target(this.out!);
    this.quad.draw();

    // Unbind the pass textures so none stays attached and sampled at once later.
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT_A);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    this.key = key;
    return this.out!;
  }

  private target(t0: WebGLTexture, t1: WebGLTexture | null = null) {
    const gl = this.gl;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0);
    gl.drawBuffers(t1 ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
  }

  private releaseTextures() {
    const gl = this.gl;
    for (const t of [...this.low, ...this.acc, this.detail, this.out]) if (t) gl.deleteTexture(t);
    this.low = [];
    this.acc = [];
    this.detail = null;
    this.out = null;
  }

  release() {
    this.releaseTextures();
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.split);
    gl.deleteProgram(this.level);
    gl.deleteProgram(this.shrink);
    gl.deleteProgram(this.merge);
  }
}
