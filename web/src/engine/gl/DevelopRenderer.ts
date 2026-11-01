import { DevelopInputs, DevelopProgram, FullscreenQuad, SampleGeometry, createTexture, uploadHalfRgb } from './GlCommon';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import { WaveletDenoise } from './WaveletDenoise';
import { ZoomMath, contains, rect, type DetailTile } from './Zoom';

/** Frame colours around the photo, cycled by clicking outside it. Levels are display-encoded (sRGB). */
/**
 * While edits stream in (a slider drag, the wheel over a slider), the photo is drawn into a smaller buffer and stretched
 * to the canvas whenever the GPU falls behind, then once more at full size when the edits rest. The develop shader
 * samples its inputs by texture coordinates, so a smaller target only means fewer output pixels, never a different
 * look. Large high-DPI screens (a 14" tablet: ~4 M device pixels of photo) asked several times the phone's work per
 * frame, and every slider step queued another full-size frame behind the last.
 */
export const LiveRender = {
  /** Edits closer together than this (ms) are a stream; this long after the last one the full-size frame is drawn. */
  SETTLE_MS: 160,
  /** A frame that had to wait this long (ms) for the GPU to finish the one before: draw fewer pixels. */
  SLOW_MS: 30,
  /** ...and one this quick means it keeps up: try a few more. */
  FAST_MS: 12,
  /** Longest a frame waits for the GPU to finish the one before (a fence that never signals can't stall drawing). */
  MAX_WAIT_MS: 250,
  /** Fewest device pixels drawn while editing (about 1100 x 730). */
  MIN_PIXELS: 800_000,
  /** Budget steps: down fast when behind, back up slowly. */
  DOWN: 0.6,
  UP: 1.15,
} as const;

export const FrameColors = [
  { name: 'grey', level: 0.46 }, // perceptual middle grey (~18% reflectance)
  { name: 'white', level: 1 },
  { name: 'black', level: 0 },
] as const;

/**
 * Renders the developed image into a canvas (port of gl/DevelopRenderer.kt): either the whole downscaled preview
 * (aspect-fit) or, when zoomed, a window into a full-resolution tile (1:1, or any scale with the web's wheel zoom). Draws on the next animation frame
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
  /** Where this frame draws: the canvas, or the smaller live buffer stretched onto it ([scale] < 1). */
  private target: { fbo: WebGLFramebuffer | null; width: number; height: number; scale: number } = { fbo: null, width: 1, height: 1, scale: 1 };
  private live: { fbo: WebGLFramebuffer; rb: WebGLRenderbuffer; width: number; height: number } | null = null;
  /** Live drawing: edits are streaming in (see [LiveRender]). */
  private streaming = false;
  private lastEdit = -Infinity;
  private settleTimer = 0;
  /** When the pending frame was first asked for (ms), to tell whether the GPU keeps up. */
  private requestedAt = 0;
  /** The pending frame waited for the GPU to finish the last one. */
  private behind = false;
  /** Signals when the GPU has finished the last frame drawn. */
  private inFlight: WebGLSync | null = null;
  /**
   * Device pixels a live frame may draw, learnt from how long frames wait while editing (kept across drags, so a
   * slow GPU starts the next drag light). Infinity = the whole canvas, as on any GPU that keeps up.
   */
  private livePixels = Infinity;

  params: ShaderParams | null = null;
  /** Frame around the photo in the fit and zoomed views: width in device pixels and its grey level. */
  frameWidth = 0;
  /**
   * Output size (or aspect) of the photo about to show, while there is nothing to develop yet (e.g. switching photos):
   * the frame is drawn around where it will sit, so it doesn't blink out. Null draws nothing until then.
   */
  placeholderSize: [number, number] | null = null;
  /** Extra empty space around the frame in the fit view, device pixels (room for the mask handles). */
  margin = 0;
  frameGrey: number = FrameColors[0].level;
  /** Paints clipped highlights red and crushed shadows blue (Pro's histogram, clipWarning in develop.glsl). */
  clipWarning = false;
  /** Centre of the zoomed view in full-resolution pixels, or null for fit-to-view. */
  zoomCenter: [number, number] | null = null;
  /** Device pixels per full-resolution pixel while zoomed (1 = 100%). */
  zoomScale = 1;
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

  /**
   * The develop parameters changed by an edit (not a new photo). Edits in quick succession draw live, lighter frames
   * if the GPU can't keep up at full size, and a full-size frame once they rest.
   */
  edited() {
    const now = performance.now();
    const streaming = now - this.lastEdit < LiveRender.SETTLE_MS;
    this.lastEdit = now;
    if (!streaming) return;
    this.streaming = true;
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.streaming = false;
      this.invalidate();
    }, LiveRender.SETTLE_MS);
  }

  /** Schedules a redraw on the next animation frame. */
  invalidate() {
    if (this.frameRequest) return;
    this.requestedAt = performance.now();
    this.behind = false;
    this.frameRequest = requestAnimationFrame(this.onFrame);
  }

  /**
   * Draws, unless the GPU is still on the last frame: then waits for it (up to [LiveRender.MAX_WAIT_MS]), so the
   * newest edit is drawn next instead of a queue of stale frames building up behind the slider.
   */
  private readonly onFrame = () => {
    this.frameRequest = 0;
    const gl = this.gl;
    const fence = this.inFlight;
    if (fence) {
      const done = gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED;
      if (!done && performance.now() - this.requestedAt < LiveRender.MAX_WAIT_MS) {
        this.behind = true;
        this.frameRequest = requestAnimationFrame(this.onFrame);
        return;
      }
      gl.deleteSync(fence);
      this.inFlight = null;
    }
    this.draw();
    this.inFlight = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  };

  /** Scale of this frame: 1 at rest; while streaming, the learnt budget over the canvas's pixels. */
  private frameScale(): number {
    const pixels = this.viewWidth * this.viewHeight;
    if (!this.streaming) return 1;
    const waited = performance.now() - this.requestedAt;
    const budget = Math.min(this.livePixels, pixels);
    if (this.behind && waited > LiveRender.SLOW_MS) this.livePixels = Math.max(LiveRender.MIN_PIXELS, budget * LiveRender.DOWN);
    else if (!this.behind && waited < LiveRender.FAST_MS && this.livePixels < pixels) this.livePixels = budget * LiveRender.UP;
    if (this.livePixels >= pixels) {
      this.livePixels = Infinity;
      return 1;
    }
    return Math.sqrt(this.livePixels / pixels);
  }

  /** Points this frame's drawing at the canvas, or at the live buffer of [scale] its size. */
  private aim(scale: number) {
    const gl = this.gl;
    if (scale >= 1) {
      this.target = { fbo: null, width: this.viewWidth, height: this.viewHeight, scale: 1 };
      return;
    }
    const width = Math.max(1, Math.round(this.viewWidth * scale));
    const height = Math.max(1, Math.round(this.viewHeight * scale));
    let live = this.live;
    if (!live) {
      live = { fbo: gl.createFramebuffer()!, rb: gl.createRenderbuffer()!, width: 0, height: 0 };
      this.live = live;
    }
    if (live.width !== width || live.height !== height) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, live.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, live.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, live.rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      live.width = width;
      live.height = height;
    }
    this.target = { fbo: live.fbo, width, height, scale: width / this.viewWidth };
  }

  /** Binds this frame's target and its viewport (again after passes that render elsewhere). */
  private bindTarget() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, this.target.width, this.target.height);
  }

  /** Scissor box in canvas device pixels (GL's bottom-left origin), scaled to the target. */
  private scissor(x: number, y: number, width: number, height: number) {
    const s = this.target.scale;
    const x0 = Math.round(x * s);
    const y0 = Math.round(y * s);
    this.gl.scissor(x0, y0, Math.max(0, Math.round((x + width) * s) - x0), Math.max(0, Math.round((y + height) * s) - y0));
  }

  /** Stretches the live buffer onto the canvas. */
  private present() {
    const t = this.target;
    if (!t.fbo) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, this.viewWidth, this.viewHeight, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

    const p = this.params;
    // Inputs first: the lens blur's passes render elsewhere and leave the canvas bound.
    if (p && img) this.inputs.bind(p);
    this.aim(p && img ? this.frameScale() : 1);
    this.bindTarget();
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!p || !img) {
      this.drawPlaceholder();
      this.present();
      return;
    }

    gl.activeTexture(gl.TEXTURE0);
    const center = this.zoomCenter;
    const tile = this.uploadedDetail;
    if (center) this.drawZoomed(p, img, tile, center, this.zoomScale);
    else this.drawFit(p, img);
    this.program.setClipWarning(this.clipWarning);
    this.program.setDenoisePre(this.denoisedInput);
    this.quad.draw();
    this.present();
  }

  private drawFit(p: ShaderParams, img: PreviewImage) {
    const gl = this.gl;
    const outW = p.lens.outputWidth;
    const outH = p.lens.outputHeight;
    const frame = this.frameWidth;
    const r = ZoomMath.fitRect(this.viewWidth, this.viewHeight, outW, outH, frame + this.margin);
    const input = this.denoised(p, this.previewTexture, `p${this.previewVersion}`, img.width, img.height, img.width / img.fullWidth);

    this.clearFrame(r[0], r[1], r[2], r[3]);
    gl.bindTexture(gl.TEXTURE_2D, input);
    const geometry = new SampleGeometry(img.width, img.height, rect(0, 0, img.fullWidth, img.fullHeight), rect(0, 0, outW, outH), img.fullWidth, img.fullHeight);
    this.program.bind(p, geometry, r[2] / this.viewWidth, r[3] / this.viewHeight, true);
  }

  private drawZoomed(p: ShaderParams, img: PreviewImage, tile: DetailTile | null, center: [number, number], scale: number) {
    const gl = this.gl;
    // Output = what's on screen; input = the loaded full-resolution tile. If the lens moves pixels outside the
    // tile while a new one loads, edges smear briefly. Between fit and 100% (wheel zoom) the preview may be
    // enough, and it stands in while a tile for a new region or scale loads.
    const view = ZoomMath.viewRect(center[0], center[1], this.viewWidth, this.viewHeight, p.lens.outputWidth, p.lens.outputHeight, scale, this.frameWidth);
    // The frame stays while zoomed: the photo shows inside it, like in the fit view.
    const w = view.width * scale;
    const h = view.height * scale;
    this.clearFrame((this.viewWidth - w) / 2, (this.viewHeight - h) / 2, w, h);
    const useTile = tile != null && !ZoomMath.previewSuffices(scale, img.width, img.fullWidth) &&
      (scale === 1 || contains(tile.rect, p.lens.sourceBounds(view, 0)));
    let geometry: SampleGeometry;
    if (useTile) {
      const input = this.denoised(p, this.detailTexture, `d${this.detailVersion}`, tile.rect.width, tile.rect.height, 1);
      gl.bindTexture(gl.TEXTURE_2D, input);
      if (input === this.detailTexture) {
        // Pixels stay crisp from 100% up; below it, smooth. (The denoise output, shared with the fit view, stays linear.)
        const filter = scale >= 1 ? gl.NEAREST : gl.LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      }
      geometry = new SampleGeometry(tile.rect.width, tile.rect.height, tile.rect, view, img.fullWidth, img.fullHeight);
    } else {
      const input = this.denoised(p, this.previewTexture, `p${this.previewVersion}`, img.width, img.height, img.width / img.fullWidth);
      gl.bindTexture(gl.TEXTURE_2D, input);
      geometry = new SampleGeometry(img.width, img.height, rect(0, 0, img.fullWidth, img.fullHeight), view, img.fullWidth, img.fullHeight);
    }
    this.program.bind(p, geometry, (view.width * scale) / this.viewWidth, (view.height * scale) / this.viewHeight, true);
  }

  /** The frame alone, around an empty photo area of [placeholderSize] (the app draws a thumbnail over it). */
  private drawPlaceholder() {
    const size = this.placeholderSize;
    if (!size || this.frameWidth <= 0) return;
    const gl = this.gl;
    const r = ZoomMath.fitRect(this.viewWidth, this.viewHeight, size[0], size[1], this.frameWidth + this.margin);
    this.clearFrame(r[0], r[1], r[2], r[3]);
    gl.enable(gl.SCISSOR_TEST);
    this.scissor(Math.trunc(r[0]), Math.trunc(this.viewHeight - (r[1] + r[3])), Math.trunc(r[2]), Math.trunc(r[3]));
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  /**
   * Frame: a band of neutral grey / white / black around the photo at ([left], [top], [width], [height]) (device
   * pixels, top-left origin), for judging exposure.
   */
  private clearFrame(left: number, top: number, width: number, height: number) {
    const frame = this.frameWidth;
    if (frame <= 0) return;
    const gl = this.gl;
    const g = this.frameGrey;
    gl.enable(gl.SCISSOR_TEST);
    this.scissor(
      Math.trunc(left - frame), Math.trunc(this.viewHeight - (top + height + frame)), // GL origin is bottom-left
      Math.trunc(width + 2 * frame), Math.trunc(height + 2 * frame),
    );
    gl.clearColor(g, g, g, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** [texture], or its copy through the wavelet denoise pre-pass when denoise is on (see WaveletDenoise). */
  private denoised(p: ShaderParams, texture: WebGLTexture, key: string, width: number, height: number, pixelScale: number): WebGLTexture {
    this.denoisedInput = this.denoiser.active(p.denoise, p.colorDenoise);
    if (!this.denoisedInput) return texture;
    const out = this.denoiser.apply(texture, key, width, height, pixelScale, p.denoise, p.colorDenoise);
    this.bindTarget();
    return out;
  }

  release() {
    cancelAnimationFrame(this.frameRequest);
    clearTimeout(this.settleTimer);
    const gl = this.gl;
    if (this.inFlight) gl.deleteSync(this.inFlight);
    this.inFlight = null;
    if (this.live) {
      gl.deleteFramebuffer(this.live.fbo);
      gl.deleteRenderbuffer(this.live.rb);
      this.live = null;
    }
    gl.deleteTexture(this.previewTexture);
    gl.deleteTexture(this.detailTexture);
    this.denoiser.release();
    this.inputs.release();
    this.quad.release();
    this.program.release();
  }
}
