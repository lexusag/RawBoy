import { Mat3 } from '../color/Mat3';
import type { BrushRaster } from '../develop/BrushRaster';
import { FRAME_WIDTH_UM, type FilmData } from '../film/FilmStocks';
import type { LensTransform } from '../lens/LensTransform';
import type { ShadingMap } from '../lens/LensInfo';
import type { LutData } from '../lut/LutData';
import type { SkinMask } from '../retouch/SkinMask';
import type { PreviewImage } from './PreviewImage';
import type { ShaderParams } from './ShaderParams';
import { Shaders } from './Shaders';
import type { PixelRect } from './Zoom';

/** Port of engine/.../gl/GlCommon.kt for WebGL2. Texture units match Android's. */
export const Units = {
  IMAGE: 0, LUT: 1, SHADING: 2, BASE: 3, BLOOM_HALO: 4, BLOOM_TAIL: 5, SKIN: 6, BRUSH: 7, FILM_LUT: 8, PRINT_LUT: 9,
} as const;

/**
 * Where the bound texture ([input], in full-resolution pixels) and the rendered quad ([output]) sit in the
 * full-resolution image. They differ when lens correction moves pixels, and in tiled export.
 */
export class SampleGeometry {
  constructor(
    readonly textureWidth: number,
    readonly textureHeight: number,
    readonly input: PixelRect,
    readonly output: PixelRect,
    /** Full-resolution image size, which sets the grain size. */
    readonly imageWidth: number,
    readonly imageHeight: number,
    /** Smallest grain cell in full-resolution pixels: more than 1 when the export is saved smaller. */
    readonly minGrainPx = 1,
  ) {}

  /** Grain cell in full-resolution pixels: ~1/3200 of the long edge (fine-grain film). */
  get grainSize(): number {
    return Math.max(this.minGrainPx, Math.max(this.imageWidth, this.imageHeight) / 3200);
  }
}

export function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

export function createTexture(gl: WebGL2RenderingContext, filter: number, target: number = gl.TEXTURE_2D): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(target, t);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  return t;
}

/** Uploads tightly packed RGB half floats into the currently bound texture. */
export function uploadHalfRgb(gl: WebGL2RenderingContext, width: number, height: number, pixels: Uint16Array) {
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, width, height, 0, gl.RGB, gl.HALF_FLOAT, pixels);
}

const FULL_UV_RECT = [0, 0, 1, 1];

/** Compiled develop shader plus uniform locations. */
export class DevelopProgram {
  private readonly id: WebGLProgram;
  private readonly u = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, forExport: boolean) {
    this.id = createProgram(gl, Shaders.VERTEX, Shaders.fragment(forExport));
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.u.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.id, name);
      this.u.set(name, l);
    }
    return l;
  }

  private f1(name: string, v: number) {
    this.gl.uniform1f(this.loc(name), v);
  }

  private f2(name: string, a: number, b: number) {
    this.gl.uniform2f(this.loc(name), a, b);
  }

  private i1(name: string, v: number) {
    this.gl.uniform1i(this.loc(name), v);
  }

  private f3(name: string, v: readonly number[], k = 1) {
    this.gl.uniform3f(this.loc(name), v[0] * k, v[1] * k, v[2] * k);
  }

  /** Preview only (the export shader has no warning): after bind, with the program in use. */
  setClipWarning(on: boolean) {
    this.f1('uClipWarn', on ? 1 : 0);
  }

  bind(p: ShaderParams, g: SampleGeometry, scaleX: number, scaleY: number, flipY: boolean, uvRect: number[] = FULL_UV_RECT) {
    const gl = this.gl;
    gl.useProgram(this.id);
    this.i1('uImage', Units.IMAGE);
    this.f2('uScale', scaleX, scaleY);
    this.f1('uFlipY', flipY ? 1 : 0);
    gl.uniform4f(this.loc('uUvRect'), uvRect[0], uvRect[1], uvRect[2], uvRect[3]);
    gl.uniformMatrix3fv(this.loc('uWhiteBalance'), false, p.whiteBalance);
    this.f1('uExposure', p.exposure);
    this.f1('uContrast', p.contrast);
    this.f1('uSaturation', p.saturation);
    this.f1('uGamutSoft', p.gamutSoft);
    this.i1('uToneMapper', p.toneMapper);
    this.f1('uDisplaySource', p.displaySource);
    this.f1('uShadows', p.shadows);
    this.f1('uHighlights', p.highlights);
    this.f1('uBlacks', p.blacks);
    this.f1('uWhites', p.whites);
    this.f1('uDenoise', p.denoise);
    this.f1('uDenoiseWide', p.denoiseWide);
    this.f1('uColorDenoise', p.colorDenoise);
    this.f1('uColorDenoiseWide', p.colorDenoiseWide);
    this.f1('uGrain', p.grain);
    this.f1('uGrainSize', g.grainSize * p.grainSizeScale);
    this.f1('uSharpen', p.sharpening);
    this.f1('uLocalContrast', p.localContrast);
    this.f1('uClarity', p.base != null ? p.highpassContrast : 0);
    this.i1('uBase', Units.BASE);
    const skin = p.skinMask;
    this.f1('uRetouch', skin?.hasSkin ? p.skinRetouch : 0);
    this.i1('uSkinMask', Units.SKIN);
    this.f1('uSkinSigma', skin?.sigmaPx ?? 3);
    const bloomReady = p.bloomHalo != null && p.bloomTail != null;
    this.f1('uBloom', bloomReady ? p.bloom : 0);
    this.i1('uBloomHalo', Units.BLOOM_HALO);
    this.i1('uBloomTail', Units.BLOOM_TAIL);
    this.f2('uBloomHaloTexel', 1 / (p.bloomHalo?.width ?? 1), 1 / (p.bloomHalo?.height ?? 1));
    this.f2('uBloomTailTexel', 1 / (p.bloomTail?.width ?? 1), 1 / (p.bloomTail?.height ?? 1));
    this.f2('uBaseTexel', 1 / (p.base?.width ?? 1), 1 / (p.base?.height ?? 1));
    this.f2('uImageSize', g.imageWidth, g.imageHeight);
    const layers = p.layers;
    this.i1('uLayerCount', layers.count);
    gl.uniform4fv(this.loc('uMaskGeom'), layers.geom);
    gl.uniform4fv(this.loc('uMaskShape'), layers.shape);
    gl.uniform4fv(this.loc('uLayerTone'), layers.tone);
    gl.uniform4fv(this.loc('uLayerColor'), layers.color);
    gl.uniformMatrix3fv(this.loc('uLayerWb'), false, layers.whiteBalance);
    this.i1('uMaskView', layers.view);
    // Painted masks: slot i of the 2x2 brush atlas (see BrushTexture); zero size = no strokes.
    this.i1('uBrushMask', Units.BRUSH);
    const slots = new Float32Array(4 * 4);
    let brushW = 1;
    let brushH = 1;
    layers.brush.forEach((r, i) => {
      if (!r) return;
      slots.set([(i % 2) * 0.5, Math.floor(i / 2) * 0.5, 0.5, 0.5], i * 4);
      brushW = r.width;
      brushH = r.height;
    });
    gl.uniform4fv(this.loc('uBrushSlot'), slots);
    this.f2('uBrushTexel', 1 / (2 * brushW), 1 / (2 * brushH));
    this.i1('uLut', Units.LUT);
    this.f1('uLutSize', p.lut?.size ?? 2);
    this.f1('uLutAmount', p.lut != null ? p.lutAmount : 0);
    this.f1('uCurveOn', p.curve ? 1 : 0);
    if (p.curve) gl.uniform3fv(this.loc('uCurve'), p.curve);
    this.f2('uTexel', 1 / g.textureWidth, 1 / g.textureHeight);
    this.f1('uPixelScale', g.textureWidth / g.input.width);
    this.f2('uInOrigin', g.input.x, g.input.y);
    this.f2('uInSpan', g.input.width, g.input.height);
    this.f2('uOutOrigin', g.output.x, g.output.y);
    this.f2('uOutSpan', g.output.width, g.output.height);
    this.bindLens(p.lens);
    this.bindFilm(p, g);
  }

  /** Film look (shaders/film_form.glsl); everything 0 = off without one. */
  private bindFilm(p: ShaderParams, g: SampleGeometry) {
    this.i1('uFilmLut', Units.FILM_LUT);
    this.i1('uPrintLut', Units.PRINT_LUT);
    const f = p.film;
    const amount = f ? p.filmAmount : 0;
    this.f1('uFilmAmount', amount);
    if (!f) {
      this.f1('uFilmUmPerPx', 0);
      this.f3('uFormHalation', [0, 0, 0]);
      this.f3('uFormScatter', [0, 0, 0]);
      this.f1('uFilmGrain', 0);
      return;
    }
    const s = f.stock;
    this.f1('uFilmLutSize', f.film.size);
    this.f1('uPrintLutSize', f.print.size);
    this.f3('uFilmDMin', s.densityMin);
    this.f3('uFilmDMax', s.densityMax);
    this.f1('uFilmUmPerPx', FRAME_WIDTH_UM / Math.max(g.imageWidth, g.imageHeight));
    // Halation and scatter happen before the film, so Strength fades them with the film render.
    const optics = p.halation * amount;
    const form = s.formation;
    this.f1('uFilmGrain', p.filmGrain);
    this.f3('uFormGrainRms', form.grainRms);
    this.f3('uFormHalation', form.halation, optics);
    this.f1('uFormHaloUm', form.haloRadiusUm);
    this.f3('uFormScatter', form.scatter, Math.min(optics, 1));
    this.f1('uFormScatterUm', form.scatterUm);
  }

  private bindLens(l: LensTransform) {
    const gl = this.gl;
    const info = l.info;
    gl.uniformMatrix3fv(this.loc('uOutToImage'), false, Mat3.toGlColumnMajor(l.outToImage));
    gl.uniformMatrix3fv(this.loc('uToSensor'), false, Mat3.toGlColumnMajor(l.toSensor));
    gl.uniformMatrix3fv(this.loc('uFromSensor'), false, Mat3.toGlColumnMajor(l.fromSensor));
    this.f2('uImageCenter', l.centerX, l.centerY);
    this.f1('uHalfDiagonal', l.halfDiagonal);
    this.f1('uZoom', l.zoom);
    this.f1('uManualK', l.manualK);
    const warp = l.warp;
    this.f1('uWarpOn', warp ? 1 : 0);
    this.f1('uWarpPlanes', l.warpPlanes);
    const k = new Float32Array(18);
    warp?.coefficients.forEach((v, i) => {
      if (i < 18) k[i] = v;
    });
    gl.uniform1fv(this.loc('uWarpK'), k);
    this.f2('uWarpCenter', l.warpCenterX, l.warpCenterY);
    this.f1('uWarpNorm', l.warpNorm);
    const vig = l.vignette;
    this.f1('uVigOn', vig ? 1 : 0);
    gl.uniform1fv(this.loc('uVigK'), new Float32Array([0, 1, 2, 3, 4].map((i) => vig?.k[i] ?? 0)));
    this.f2('uVigCenter', l.vignetteCenterX, l.vignetteCenterY);
    this.f1('uVigNorm', l.vignetteNorm);
    const shading = info.shading;
    this.f1('uShadingUndo', l.undoShading ? 1 : 0);
    this.i1('uShading', Units.SHADING);
    gl.uniform4f(this.loc('uShadingGrid'), shading?.originV ?? 0, shading?.originH ?? 0, shading?.spacingV ?? 1, shading?.spacingH ?? 1);
    this.f2('uShadingPoints', shading?.pointsV ?? 1, shading?.pointsH ?? 1);
    this.f2('uSensorSize', info.sensorWidth, info.sensorHeight);
    this.f1('uManualVig', l.manualVignette);
    this.f1('uManualVigMid', l.manualVignetteMidpoint);
  }

  release() {
    this.gl.deleteProgram(this.id);
  }
}

/** A small whole-image copy (high-pass contrast, bloom) on its own unit; re-uploads when it changes. */
export class ImageTexture {
  private readonly id: WebGLTexture;
  private uploaded: PreviewImage | null = null;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly unit: number) {
    this.id = createTexture(gl, gl.LINEAR);
    // A 1x1 black image so the sampler is always complete.
    uploadHalfRgb(gl, 1, 1, new Uint16Array(3));
  }

  bind(image: PreviewImage | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + this.unit);
    gl.bindTexture(gl.TEXTURE_2D, this.id);
    if (image && image !== this.uploaded) {
      uploadHalfRgb(gl, image.width, image.height, image.pixels);
      this.uploaded = image;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  release() {
    this.gl.deleteTexture(this.id);
  }
}

/** The skin mask (R16F) on its own unit; re-uploads when it changes. */
export class MaskTexture {
  private readonly id: WebGLTexture;
  private uploaded: SkinMask | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.id = createTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
  }

  bind(mask: SkinMask | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + Units.SKIN);
    gl.bindTexture(gl.TEXTURE_2D, this.id);
    if (mask && mask !== this.uploaded) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, mask.width, mask.height, 0, gl.RED, gl.FLOAT, mask.data);
      this.uploaded = mask;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  release() {
    this.gl.deleteTexture(this.id);
  }
}

/**
 * The layers' painted masks (BrushRaster, RG8: paint, erase) in one 2x2 atlas on its own unit, one slot per packed
 * layer. A plain 2D texture rather than an array: programs that never bind it (Android so far) leave the sampler on
 * unit 0 with uImage, and samplers of different types on one unit are an error. Uploads only what changed.
 */
export class BrushTexture {
  private readonly id: WebGLTexture;
  private slotW = 0;
  private slotH = 0;
  private readonly slots: { raster: BrushRaster | null; version: number }[] = Array.from({ length: 4 }, () => ({ raster: null, version: -1 }));

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.id = createTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, new Uint8Array(2));
  }

  bind(brush: readonly (BrushRaster | null)[]) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + Units.BRUSH);
    gl.bindTexture(gl.TEXTURE_2D, this.id);
    const any = brush.find((r) => r != null);
    if (any && 2 * Math.max(any.width, any.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      console.warn('Brush masks need a larger texture than this GPU allows');
      gl.activeTexture(gl.TEXTURE0);
      return;
    }
    if (any && (any.width !== this.slotW || any.height !== this.slotH)) {
      this.slotW = any.width;
      this.slotH = any.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 2 * any.width, 2 * any.height, 0, gl.RG, gl.UNSIGNED_BYTE, null);
      for (const s of this.slots) s.raster = null;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    brush.forEach((r, i) => {
      if (!r || r.width !== this.slotW || r.height !== this.slotH) return;
      const slot = this.slots[i];
      const pending = slot.raster === r ? r.pendingRect(slot.version) : 'all';
      if (pending == null) return;
      const x = pending === 'all' ? 0 : pending.x;
      const y = pending === 'all' ? 0 : pending.y;
      const w = pending === 'all' ? r.width : pending.width;
      const h = pending === 'all' ? r.height : pending.height;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, r.width);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (i % 2) * this.slotW + x, Math.floor(i / 2) * this.slotH + y, w, h, gl.RG, gl.UNSIGNED_BYTE, r.rg);
      slot.raster = r;
      slot.version = r.version;
    });
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0);
  }

  release() {
    this.gl.deleteTexture(this.id);
  }
}

/** The lens shading gain map (R16F) on its own texture unit; re-uploads when the image changes. */
export class ShadingTexture {
  private readonly id: WebGLTexture;
  private uploaded: ShadingMap | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    gl.activeTexture(gl.TEXTURE0 + Units.SHADING);
    this.id = createTexture(gl, gl.LINEAR);
    // A 1x1 neutral map so the sampler is always complete.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1]));
    gl.activeTexture(gl.TEXTURE0);
  }

  bind(map: ShadingMap | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + Units.SHADING);
    gl.bindTexture(gl.TEXTURE_2D, this.id);
    if (map && map !== this.uploaded) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, map.pointsH, map.pointsV, 0, gl.RED, gl.FLOAT, map.gains);
      this.uploaded = map;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  release() {
    this.gl.deleteTexture(this.id);
  }
}

/** A 3D LUT texture on its own texture unit; re-uploads only when the LUT changes. */
export class LutTexture {
  private readonly id: WebGLTexture;
  private uploaded: LutData | null = null;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly unit: number = Units.LUT) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    this.id = createTexture(gl, gl.LINEAR, gl.TEXTURE_3D);
    // An identity 2^3 LUT so the sampler is always complete.
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT,
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]));
    gl.activeTexture(gl.TEXTURE0);
  }

  bind(lut: LutData | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + this.unit);
    gl.bindTexture(gl.TEXTURE_3D, this.id);
    if (lut && lut !== this.uploaded) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
      this.uploaded = lut;
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  release() {
    this.gl.deleteTexture(this.id);
  }
}

export class FullscreenQuad {
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  release() {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.vbo);
  }
}

/** All the textures a develop pass reads besides the image itself. */
export class DevelopInputs {
  readonly base: ImageTexture;
  readonly halo: ImageTexture;
  readonly tail: ImageTexture;
  readonly skin: MaskTexture;
  readonly shading: ShadingTexture;
  readonly lut: LutTexture;
  readonly brush: BrushTexture;
  readonly film: FilmTextures;

  constructor(gl: WebGL2RenderingContext) {
    this.base = new ImageTexture(gl, Units.BASE);
    this.halo = new ImageTexture(gl, Units.BLOOM_HALO);
    this.tail = new ImageTexture(gl, Units.BLOOM_TAIL);
    this.skin = new MaskTexture(gl);
    this.shading = new ShadingTexture(gl);
    this.lut = new LutTexture(gl);
    this.brush = new BrushTexture(gl);
    this.film = new FilmTextures(gl);
  }

  bind(p: ShaderParams) {
    this.lut.bind(p.lut);
    this.shading.bind(p.lens.info.shading);
    this.base.bind(p.base);
    this.halo.bind(p.bloomHalo);
    this.tail.bind(p.bloomTail);
    this.skin.bind(p.skinMask);
    this.brush.bind(p.layers.brush);
    this.film.bind(p.film);
  }

  release() {
    for (const t of [this.base, this.halo, this.tail, this.skin, this.shading, this.lut, this.brush, this.film]) t.release();
  }
}

/** The film and print LUTs of a [FilmData] (shaders/film_form.glsl), each on its own unit. */
export class FilmTextures {
  private readonly film: LutTexture;
  private readonly print: LutTexture;

  constructor(gl: WebGL2RenderingContext) {
    this.film = new LutTexture(gl, Units.FILM_LUT);
    this.print = new LutTexture(gl, Units.PRINT_LUT);
  }

  bind(f: FilmData | null) {
    this.film.bind(f?.film ?? null);
    this.print.bind(f?.print ?? null);
  }

  release() {
    this.film.release();
    this.print.release();
  }
}
