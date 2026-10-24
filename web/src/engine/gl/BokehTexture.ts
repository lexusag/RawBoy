import DENOISE_VERT from '../../../../shaders/denoise.vert?raw';
import BOKEH_GATHER from '../../../../shaders/bokeh_gather.frag?raw';
import BOKEH_PREP from '../../../../shaders/bokeh_prep.glsl?raw';
import { floatToHalf } from '../util/half';
import { DevelopProgram, FullscreenQuad, Units, createProgram, createTexture } from './GlCommon';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import { Shaders } from './Shaders';

/**
 * The masks' lens blur (port of gl/BokehTexture.kt). Like bloom it works on a small whole-image copy, so the fit view,
 * the 100% view and export tiles all sample the same texture: no tile seams and no spatial margin. Two passes on the
 * GPU, re-run only when the masks, their blur or the source change:
 * 1. bokeh_prep.glsl (after develop.glsl, so the masks are the develop shader's own layerMask): the highlight-boosted
 *    copy at the bokeh size, premultiplied by its fade-in, with each texel's blur radius.
 * 2. bokeh_gather.frag: an exact round disc gather (every texel inside the radius), sharp texels never smeared.
 * The develop shader mixes the result in by the radius at each pixel (main_body.glsl, `uBokeh`).
 */

/** Largest blur radius in bokeh texels: the texture is sized so a layer's strongest blur lands near it. */
export const BOKEH_RADIUS = 16;
/** Bokeh texture long side limits. The source copy is BOKEH_SOURCE_MAX_DIMENSION, so a smaller blur is sharper. */
const BOKEH_MIN_DIMENSION = 128;
export const BOKEH_SOURCE_MAX_DIMENSION = 1536;

/** Bokeh texture size for these params and how its texels relate to the image; null = no lens blur. */
export interface BokehGeometry {
  width: number;
  height: number;
  /** Bokeh texels per full-resolution pixel (`uBokehScale`). */
  scale: number;
  /** Largest radius in texels. */
  maxRadius: number;
}

export function bokehGeometry(p: ShaderParams): BokehGeometry | null {
  const src = p.bokehSource;
  const maxPx = Math.max(0, ...p.layers.blur.subarray(0, p.layers.count));
  if (!src || maxPx <= 0) return null;
  const imageLong = Math.max(src.fullWidth, src.fullHeight);
  const long = Math.min(Math.max(src.width, src.height), Math.max(BOKEH_MIN_DIMENSION, Math.round((BOKEH_RADIUS * imageLong) / maxPx)));
  const scale = long / imageLong;
  return {
    width: Math.max(1, Math.round(src.fullWidth * scale)),
    height: Math.max(1, Math.round(src.fullHeight * scale)),
    scale,
    maxRadius: maxPx * scale,
  };
}

/** Uniforms the develop shader reads the lens blur with; all 0 = off. */
export function bokehUniforms(p: ShaderParams): { scale: number; texelX: number; texelY: number } {
  const g = bokehGeometry(p);
  return g ? { scale: g.scale, texelX: 1 / g.width, texelY: 1 / g.height } : { scale: 0, texelX: 1, texelY: 1 };
}

/** Pass-local unit, past the develop shader's and the denoise pre-pass's. */
const UNIT_PASS = 13;

/** RGB half floats -> RGBA (alpha 1), so the copy can be mipmapped (RGB16F isn't renderable). */
function rgbaHalf(img: PreviewImage): Uint16Array {
  const n = img.width * img.height;
  const out = new Uint16Array(n * 4);
  const one = floatToHalf(1);
  for (let i = 0; i < n; i++) {
    out[i * 4] = img.pixels[i * 3];
    out[i * 4 + 1] = img.pixels[i * 3 + 1];
    out[i * 4 + 2] = img.pixels[i * 3 + 2];
    out[i * 4 + 3] = one;
  }
  return out;
}

export class BokehTexture {
  private readonly prep: DevelopProgram;
  private readonly gather: WebGLProgram;
  private readonly quad: FullscreenQuad;
  private readonly fbo: WebGLFramebuffer;
  private readonly source: WebGLTexture;
  private readonly radii: WebGLTexture;
  /** The result, sampled on Units.BOKEH; 1x1 transparent until the first blur (the develop shader then shows none). */
  private readonly out: WebGLTexture;
  private uploaded: PreviewImage | null = null;
  private width = 0;
  private height = 0;
  /** What [out] holds, so unchanged masks aren't blurred again on every slider move. */
  private key = '';
  private readonly supported: boolean;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.supported = gl.getExtension('EXT_color_buffer_float') != null;
    this.prep = new DevelopProgram(gl, false, Shaders.fragmentWithMain(BOKEH_PREP));
    this.gather = createProgram(gl, DENOISE_VERT, BOKEH_GATHER);
    this.quad = new FullscreenQuad(gl);
    this.fbo = gl.createFramebuffer()!;
    this.source = createTexture(gl, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.radii = createTexture(gl, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0 + Units.BOKEH);
    this.out = createTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(4));
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Brings the blur up to date for [p] and binds it to Units.BOKEH. Call after the brush atlas is bound (the masks
   * read it). Leaves the default framebuffer bound, the viewport as it was and unit 0 active.
   */
  bind(p: ShaderParams) {
    const gl = this.gl;
    const g = this.supported ? bokehGeometry(p) : null;
    if (g && p.bokehSource) this.render(p, p.bokehSource, g);
    gl.activeTexture(gl.TEXTURE0 + Units.BOKEH);
    gl.bindTexture(gl.TEXTURE_2D, this.out);
    gl.activeTexture(gl.TEXTURE0);
  }

  private render(p: ShaderParams, src: PreviewImage, g: BokehGeometry) {
    const gl = this.gl;
    if (src !== this.uploaded) {
      gl.activeTexture(gl.TEXTURE0 + UNIT_PASS);
      gl.bindTexture(gl.TEXTURE_2D, this.source);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, src.width, src.height, 0, gl.RGBA, gl.HALF_FLOAT, rgbaHalf(src));
      gl.generateMipmap(gl.TEXTURE_2D);
      this.uploaded = src;
      this.key = '';
    }
    const l = p.layers;
    const brushVersions = l.brush.map((r) => (r ? `${r.width}x${r.height}@${r.version}` : '-'));
    const key = JSON.stringify([g.width, g.height, l.count, [...l.geom], [...l.shape], [...l.color], [...l.blur], brushVersions]);
    if (key === this.key) return;

    if (g.width !== this.width || g.height !== this.height) {
      for (const t of [this.radii, this.out]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, g.width, g.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      }
      this.width = g.width;
      this.height = g.height;
    }
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, g.width, g.height);
    gl.disable(gl.BLEND);

    // 1. Masks -> radius, premultiplied source.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.radii, 0);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PASS);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    this.prep.bindMasks(p, src.fullWidth, src.fullHeight);
    this.prep.bokehPrep(UNIT_PASS, Math.max(0, Math.log2(Math.max(src.width, src.height) / Math.max(g.width, g.height))), g);
    this.quad.draw();

    // 2. Disc gather.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.out, 0);
    gl.useProgram(this.gather);
    gl.bindTexture(gl.TEXTURE_2D, this.radii);
    gl.uniform1i(gl.getUniformLocation(this.gather, 'uSrc'), UNIT_PASS);
    gl.uniform1i(gl.getUniformLocation(this.gather, 'uMaxRadius'), Math.ceil(g.maxRadius));
    this.quad.draw();

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.key = key;
  }

  release() {
    const gl = this.gl;
    this.prep.release();
    gl.deleteProgram(this.gather);
    this.quad.release();
    gl.deleteFramebuffer(this.fbo);
    for (const t of [this.source, this.radii, this.out]) gl.deleteTexture(t);
  }
}
