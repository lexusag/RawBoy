import { DevelopInputs, DevelopProgram, FullscreenQuad, SampleGeometry, createTexture, uploadHalfRgb } from './GlCommon';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import { rect, type PixelRect } from './Zoom';

/**
 * Develops off screen into a 16-bit integer target and reads the result back (port of gl/OffscreenDeveloper.kt):
 * full-resolution export tiles, and small whole-photo renders (thumbnails).
 */
export class OffscreenDeveloper {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: DevelopProgram;
  private readonly quad: FullscreenQuad;
  private readonly inputs: DevelopInputs;
  private readonly inputTexture: WebGLTexture;
  private readonly outputTexture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  imageWidth = 1;
  imageHeight = 1;
  /** Smallest grain cell for [render] (see SampleGeometry.minGrainPx). */
  minGrainPx = 1;

  constructor() {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.program = new DevelopProgram(gl, true);
    this.quad = new FullscreenQuad(gl);
    this.inputs = new DevelopInputs(gl);
    this.inputTexture = createTexture(gl, gl.LINEAR);
    this.outputTexture = createTexture(gl, gl.NEAREST);
    this.framebuffer = gl.createFramebuffer()!;
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  setImageSize(width: number, height: number) {
    this.imageWidth = width;
    this.imageHeight = height;
  }

  /**
   * Develops the full-resolution region [out] from [input] (RGB half floats for [inRect], which must contain every
   * source pixel [out] needs). Returns out.width*out.height RGBA values in 0..65535.
   */
  render(params: ShaderParams, input: Uint16Array, inRect: PixelRect, out: PixelRect): Uint16Array | Uint32Array {
    const gl = this.gl;
    this.inputs.bind(params);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    uploadHalfRgb(gl, inRect.width, inRect.height, input);
    const geometry = new SampleGeometry(inRect.width, inRect.height, inRect, out, this.imageWidth, this.imageHeight, this.minGrainPx);
    return this.draw(params, geometry, out.width, out.height);
  }

  /** Develops the whole photo from its downscaled [preview] into a [width] x [height] image, as the fit view does. */
  renderPreview(params: ShaderParams, preview: PreviewImage, width: number, height: number): Uint16Array | Uint32Array {
    const gl = this.gl;
    this.inputs.bind(params);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    uploadHalfRgb(gl, preview.width, preview.height, preview.pixels);
    const geometry = new SampleGeometry(
      preview.width, preview.height, rect(0, 0, preview.fullWidth, preview.fullHeight),
      rect(0, 0, params.lens.outputWidth, params.lens.outputHeight), preview.fullWidth, preview.fullHeight,
    );
    return this.draw(params, geometry, width, height);
  }

  private draw(params: ShaderParams, geometry: SampleGeometry, width: number, height: number): Uint16Array | Uint32Array {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);

    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    this.program.bind(params, geometry, 1, 1, false); // framebuffer row 0 = output row 0
    this.quad.draw();

    // RGBA_INTEGER + UNSIGNED_INT is always readable from an unsigned integer target. Never try UNSIGNED_SHORT,
    // even when IMPLEMENTATION_COLOR_READ_TYPE advertises it: Chrome on Mali (Pixel 9 Pro) rejects it in ANGLE's
    // RGBA16 readPixels workaround, and on Chrome 155 that loses the WebGL context (every canvas on the page).
    let error = gl.getError();
    let out: Uint32Array | null = null;
    if (error === gl.NO_ERROR) {
      out = new Uint32Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
      error = gl.getError();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (error !== gl.NO_ERROR || !out) throw new Error(`GL error 0x${error.toString(16)} during develop`);
    return out;
  }

  release() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.inputTexture);
    gl.deleteTexture(this.outputTexture);
    this.quad.release();
    this.inputs.release();
    this.program.release();
  }
}
