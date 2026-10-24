import { DevelopInputs, DevelopProgram, FullscreenQuad, SampleGeometry, createTexture, uploadHalfRgb } from './GlCommon';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import { WaveletDenoise } from './WaveletDenoise';
import { ZoomMath, rect, type DetailTile } from './Zoom';

/** Frame colours around the photo, cycled by clicking outside it. Levels are display-encoded (sRGB). */
export const FrameColors = [
  { name: 'grey', level: 0.46 }, // perceptual middle grey (~18% reflectance)
  { name: 'white', level: 1 },
  { name: 'black', level: 0 },
] as const;

/**
 * Renders the developed image into a canvas (port of gl/DevelopRenderer.kt): either the whole downscaled preview
 * (aspect-fit) or, when zoomed, a 1:1 window into a full-resolution tile. Draws on the next animation frame
 * after any change.
 */
export class DevelopRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: DevelopProgram;
  private readonly quad: FullscreenQuad;
  private readonly inputs: DevelopInputs;
  private readonly previewTexture: WebGLTexture;
  private readonly detailTexture: WebGLTexture;
  private image: PreviewImage | null = null;
  private uploadedImage: PreviewImage | null = null;
  private detail: DetailTile | null = null;
  private uploadedDetail: DetailTile | null = null;
  private frameRequest = 0;
  private readonly denoiser: WaveletDenoise;
  /** Upload counters: the denoise pre-pass caches by them. */
  private previewVersion = 0;
  private detailVersion = 0;
  private denoisedInput = false;

  params: ShaderParams | null = null;
  /** Frame around the photo in the fit view: width in device pixels and its grey level. */
  frameWidth = 0;
  /** Extra empty space around the frame in the fit view, device pixels (room for the mask handles). */
  margin = 0;
  frameGrey: number = FrameColors[0].level;
  /** Paints clipped highlights red and crushed shadows blue (Pro's histogram, clipWarning in develop.glsl). */
  clipWarning = false;
  /** Centre of the 100% view in full-resolution pixels, or null for fit-to-view. */
  zoomCenter: [number, number] | null = null;
  viewWidth = 1;
  viewHeight = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.program = new DevelopProgram(gl, false);
    this.quad = new FullscreenQuad(gl);
    this.inputs = new DevelopInputs(gl);
    this.previewTexture = createTexture(gl, gl.LINEAR);
    this.detailTexture = createTexture(gl, gl.NEAREST); // 1:1, keep pixels crisp
    this.denoiser = new WaveletDenoise(gl, this.quad);
  }

  setImage(image: PreviewImage | null) {
    this.image = image;
    this.invalidate();
  }

  setDetail(tile: DetailTile | null) {
    this.detail = tile;
    this.invalidate();
  }

  setViewSize(width: number, height: number) {
    this.viewWidth = Math.max(1, Math.round(width));
    this.viewHeight = Math.max(1, Math.round(height));
    this.canvas.width = this.viewWidth;
    this.canvas.height = this.viewHeight;
    this.invalidate();
  }

  /** Schedules a redraw on the next animation frame. */
  invalidate() {
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.draw();
    });
  }

  private draw() {
    const gl = this.gl;
    const img = this.image;
    if (img && img !== this.uploadedImage) {
      gl.bindTexture(gl.TEXTURE_2D, this.previewTexture);
      uploadHalfRgb(gl, img.width, img.height, img.pixels);
      this.uploadedImage = img;
      this.previewVersion++;
    }
    if (this.detail !== this.uploadedDetail) {
      const t = this.detail;
      if (t) {
        gl.bindTexture(gl.TEXTURE_2D, this.detailTexture);
        uploadHalfRgb(gl, t.rect.width, t.rect.height, t.pixels);
        this.detailVersion++;
      }
      this.uploadedDetail = t;
    }

    gl.viewport(0, 0, this.viewWidth, this.viewHeight);
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.params;
    if (!p || !img) return;

    this.inputs.bind(p);
    gl.activeTexture(gl.TEXTURE0);
    const center = this.zoomCenter;
    const tile = this.uploadedDetail;
    if (center && tile) this.drawZoomed(p, img, tile, center);
    else this.drawFit(p, img);
    this.program.setClipWarning(this.clipWarning);
    this.program.setDenoisePre(this.denoisedInput);
    this.quad.draw();
  }

  private drawFit(p: ShaderParams, img: PreviewImage) {
    const gl = this.gl;
    const outW = p.lens.outputWidth;
    const outH = p.lens.outputHeight;
    const frame = this.frameWidth;
    const r = ZoomMath.fitRect(this.viewWidth, this.viewHeight, outW, outH, frame + this.margin);
    const input = this.denoised(p, this.previewTexture, `p${this.previewVersion}`, img.width, img.height, img.width / img.fullWidth);

    // Frame: a band of neutral grey / white / black around the photo, for judging exposure.
    if (frame > 0) {
      const g = this.frameGrey;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.trunc(r[0] - frame), Math.trunc(this.viewHeight - (r[1] + r[3] + frame)), // GL origin is bottom-left
        Math.trunc(r[2] + 2 * frame), Math.trunc(r[3] + 2 * frame),
      );
      gl.clearColor(g, g, g, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.bindTexture(gl.TEXTURE_2D, input);
    const geometry = new SampleGeometry(img.width, img.height, rect(0, 0, img.fullWidth, img.fullHeight), rect(0, 0, outW, outH), img.fullWidth, img.fullHeight);
    this.program.bind(p, geometry, r[2] / this.viewWidth, r[3] / this.viewHeight, true);
  }

  private drawZoomed(p: ShaderParams, img: PreviewImage, tile: DetailTile, center: [number, number]) {
    const gl = this.gl;
    // Output = what's on screen; input = the loaded full-resolution tile. If the lens moves pixels outside the
    // tile while a new one loads, edges smear briefly.
    const view = ZoomMath.viewRect(center[0], center[1], this.viewWidth, this.viewHeight, p.lens.outputWidth, p.lens.outputHeight);
    const input = this.denoised(p, this.detailTexture, `d${this.detailVersion}`, tile.rect.width, tile.rect.height, 1);
    gl.bindTexture(gl.TEXTURE_2D, input);
    const geometry = new SampleGeometry(tile.rect.width, tile.rect.height, tile.rect, view, img.fullWidth, img.fullHeight);
    this.program.bind(p, geometry, view.width / this.viewWidth, view.height / this.viewHeight, true);
  }

  /** [texture], or its copy through the wavelet denoise pre-pass when denoise is on (see WaveletDenoise). */
  private denoised(p: ShaderParams, texture: WebGLTexture, key: string, width: number, height: number, pixelScale: number): WebGLTexture {
    this.denoisedInput = this.denoiser.active(p.denoise, p.colorDenoise);
    if (!this.denoisedInput) return texture;
    const out = this.denoiser.apply(texture, key, width, height, pixelScale, p.denoise, p.colorDenoise);
    this.gl.viewport(0, 0, this.viewWidth, this.viewHeight);
    return out;
  }

  release() {
    cancelAnimationFrame(this.frameRequest);
    const gl = this.gl;
    gl.deleteTexture(this.previewTexture);
    gl.deleteTexture(this.detailTexture);
    this.denoiser.release();
    this.inputs.release();
    this.quad.release();
    this.program.release();
  }
}
