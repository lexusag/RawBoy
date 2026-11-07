import DENOISE_VERT from '../../../../shaders/denoise.vert?raw';
import SCAN_FRAG from '../../../../shaders/scan.frag?raw';
import { createProgram, createTexture, type FullscreenQuad } from './GlCommon';
import { SCAN_SHARPEN } from './ScanScale';

/**
 * The film scan export's upscale pre-pass (port of gl/ScanUpscaler.kt): renders a larger copy of the image texture
 * that the develop shader reads in place of the image, with `uPixelScale` = the scale. Steps in shaders/scan.frag:
 * bicubic start, four rounds of iterative back projection, then an unsharp mask on the luma. Needs float render
 * targets (EXT_color_buffer_float); without them [supported] is false and the develop shader samples the source
 * bilinearly (a plain enlargement: the finer grain still applies).
 */
const UNIT_A = 10;
const UNIT_B = 11;
const ROUNDS = 4;

export class ScanUpscaler {
  private readonly program: WebGLProgram;
  private readonly fbo: WebGLFramebuffer;
  private width = 0;
  private height = 0;
  private srcWidth = 0;
  private srcHeight = 0;
  private hr: WebGLTexture[] = [];
  private residual: WebGLTexture | null = null;
  private luma: WebGLTexture | null = null;
  private blur: WebGLTexture | null = null;
  private out: WebGLTexture | null = null;
  readonly supported: boolean;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly quad: FullscreenQuad) {
    this.supported = gl.getExtension('EXT_color_buffer_float') != null;
    this.program = createProgram(gl, DENOISE_VERT, SCAN_FRAG);
    this.fbo = gl.createFramebuffer()!;
  }

  private ensure(srcW: number, srcH: number, w: number, h: number) {
    if (w === this.width && h === this.height && srcW === this.srcWidth && srcH === this.srcHeight && this.out) return;
    this.releaseTextures();
    const gl = this.gl;
    const make = (format: number, filter: number, tw: number, th: number) => {
      const t = createTexture(gl, filter);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, tw, th);
      return t;
    };
    this.hr = [make(gl.RGBA32F, gl.NEAREST, w, h), make(gl.RGBA32F, gl.NEAREST, w, h)];
    this.residual = make(gl.RGBA16F, gl.LINEAR, srcW, srcH);
    this.luma = make(gl.RGBA32F, gl.NEAREST, w, h);
    this.blur = make(gl.RGBA32F, gl.NEAREST, w, h);
    this.out = make(gl.RGBA16F, gl.LINEAR, w, h);
    this.width = w;
    this.height = h;
    this.srcWidth = srcW;
    this.srcHeight = srcH;
  }

  /**
   * Upscales [src] (linear RGB, [srcW] x [srcH]) to [w] x [h] and returns the texture holding the result (RGBA16F,
   * linearly filtered). [denoise]: the 0..1 Denoise slider, which raises the unsharp mask's noise threshold as the
   * develop's Sharpen does. Leaves the default framebuffer bound and unit 0 active; the caller sets its viewport.
   */
  apply(src: WebGLTexture, srcW: number, srcH: number, w: number, h: number, denoise: number): WebGLTexture {
    const gl = this.gl;
    this.ensure(srcW, srcH, w, h);
    const prog = this.program;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), UNIT_A);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), UNIT_B);
    gl.uniform2f(gl.getUniformLocation(prog, 'uScale'), w / srcW, h / srcH);
    gl.uniform2i(gl.getUniformLocation(prog, 'uSrcSize'), srcW, srcH);
    gl.uniform2i(gl.getUniformLocation(prog, 'uHrSize'), w, h);
    gl.uniform1f(gl.getUniformLocation(prog, 'uAmount'), SCAN_SHARPEN);
    gl.uniform1f(gl.getUniformLocation(prog, 'uThreshold'), 0.008 + denoise * 0.04); // as the develop's sharpenGain
    const run = (pass: number, a: WebGLTexture, b: WebGLTexture | null, target: WebGLTexture, tw: number, th: number) => {
      gl.uniform1i(gl.getUniformLocation(prog, 'uPass'), pass);
      gl.activeTexture(gl.TEXTURE0 + UNIT_A);
      gl.bindTexture(gl.TEXTURE_2D, a);
      gl.activeTexture(gl.TEXTURE0 + UNIT_B);
      gl.bindTexture(gl.TEXTURE_2D, b);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, tw, th);
      this.quad.draw();
    };
    let cur = 0;
    run(0, src, null, this.hr[0], w, h);
    for (let i = 0; i < ROUNDS; i++) {
      run(1, this.hr[cur], src, this.residual!, srcW, srcH);
      run(2, this.hr[cur], this.residual!, this.hr[1 - cur], w, h);
      cur = 1 - cur;
    }
    run(3, this.hr[cur], null, this.luma!, w, h);
    run(4, this.luma!, null, this.blur!, w, h);
    run(5, this.hr[cur], this.blur!, this.out!, w, h);
    // Unbind the pass textures so none stays attached and sampled at once later.
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT_A);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    return this.out!;
  }

  private releaseTextures() {
    const gl = this.gl;
    for (const t of [...this.hr, this.residual, this.luma, this.blur, this.out]) if (t) gl.deleteTexture(t);
    this.hr = [];
    this.residual = this.luma = this.blur = this.out = null;
    this.width = this.height = this.srcWidth = this.srcHeight = 0;
  }

  release() {
    this.releaseTextures();
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteProgram(this.program);
  }
}
