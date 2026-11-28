import CENSOR_FRAG from '../../../../shaders/censor.frag?raw';
import DENOISE_VERT from '../../../../shaders/denoise.vert?raw';
import { Mat3 } from '../color/Mat3';
import {
  activeCensorLayers,
  CENSOR_EFFECT_ID,
  MAX_CENSOR_LAYERS,
  MOSAIC_SHAPE_ID,
  type CensorLayer,
} from '../develop/Censor';
import type { CensorRaster } from '../develop/CensorRaster';
import { floatToHalf } from '../util/half';
import { createProgram, createTexture, FullscreenQuad } from './GlCommon';
import type { PreviewImage } from './PreviewImage';

/** Which painted coverage belongs to a censor layer (the session's cache); none by default (tests). */
export type CensorLookup = (layer: CensorLayer) => CensorRaster | null;

/** The censor layers packed for censor.frag (null in ShaderParams = nothing to censor). */
export interface CensorUniforms {
  count: number;
  kind: Float32Array; // MAX x vec4: effect, edge, mosaic shape, seed
  param: Float32Array; // MAX x vec4: size px, strength, has ellipse, 0
  ellipse: Float32Array; // MAX x vec4: centre px, 1 / radii px
  turn: Float32Array; // MAX x vec4: cos, sin, soft edge, 0
  extra: Float32Array; // MAX x vec4: glass colour, contrast, keep colour (0..1), 0
  rasters: (CensorRaster | null)[];
  /** Whole-image copy the effects average (the session preview). */
  source: PreviewImage;
  invWhiteBalance: Float32Array; // column-major 3x3
  exposure: number;
  contrast: number;
  /** Changes whenever the uniforms do (rasters have their own versions). */
  key: string;
}

/**
 * The active layers of [layers] for an image [width] x [height] (full resolution), or null when none censors anything
 * or there is no [source] copy yet. [whiteBalance] (column-major), [exposure], [contrast]: the develop's, to turn picked
 * colours into scene light.
 */
export function packCensor(
  layers: readonly CensorLayer[],
  width: number,
  height: number,
  rasterFor: CensorLookup,
  source: PreviewImage | null,
  whiteBalance: Float32Array,
  exposure: number,
  contrast: number,
): CensorUniforms | null {
  const used = activeCensorLayers(layers);
  if (!used.length || !source) return null;
  const long = Math.max(width, height);
  const u: CensorUniforms = {
    count: used.length,
    kind: new Float32Array(MAX_CENSOR_LAYERS * 4),
    param: new Float32Array(MAX_CENSOR_LAYERS * 4),
    ellipse: new Float32Array(MAX_CENSOR_LAYERS * 4),
    turn: new Float32Array(MAX_CENSOR_LAYERS * 4),
    extra: new Float32Array(MAX_CENSOR_LAYERS * 4),
    rasters: [],
    source,
    invWhiteBalance: invertColumnMajor(whiteBalance),
    exposure,
    contrast,
    key: '',
  };
  used.forEach((l, i) => {
    const o = i * 4;
    u.kind.set([CENSOR_EFFECT_ID[l.effect], 0, MOSAIC_SHAPE_ID[l.mosaicShape], l.seed], o);
    u.extra.set([(l.glassColour ?? 0) / 100, (l.contrast ?? 50) / 100, (l.keepColour ?? 60) / 100, 0], o);
    u.param.set([Math.max(2, l.size * long), l.strength / 100, l.ellipse ? 1 : 0, 0], o);
    if (l.ellipse) {
      const e = l.ellipse;
      const rx = Math.max(1, e.rx * long);
      const ry = Math.max(1, e.ry * long);
      const a = (e.angle * Math.PI) / 180;
      u.ellipse.set([e.cx * width, e.cy * height, 1 / rx, 1 / ry], o);
      // Soft edge: 15% of the radius, at least 2 px.
      u.turn.set([Math.cos(a), Math.sin(a), Math.min(0.9, Math.max(0.15, 2 / Math.min(rx, ry))), 0], o);
    }
    u.rasters.push(l.strokes.length ? rasterFor(l) : null);
  });
  u.key = [
    width, height, exposure, contrast, Array.from(u.invWhiteBalance).join(','),
    Array.from(u.kind).join(','), Array.from(u.param).join(','), Array.from(u.ellipse).join(','), Array.from(u.turn).join(','), Array.from(u.extra).join(','),
  ].join('|');
  return u;
}

function invertColumnMajor(m: Float32Array): Float32Array {
  const row = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  let inv: number[];
  try {
    inv = Mat3.inverse(row);
  } catch {
    inv = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  return Float32Array.from([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
}

/** Where an input texture sits in the full-resolution image: its texel (0, 0) corner and full-res px per texel. */
export interface InputPlacement {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

const keys = new WeakMap<object, number>();
let nextKey = 1;
/** A key for a CPU image's contents (images are never changed in place). */
export function imageKey(img: object): string {
  let k = keys.get(img);
  if (k == null) {
    k = nextKey++;
    keys.set(img, k);
  }
  return `i${k}`;
}

/** Where a whole-image copy sits: all of the photo, [fullWidth / width] full-res px per texel. */
export const placementOf = (img: PreviewImage): InputPlacement => ({ x: 0, y: 0, scaleX: img.fullWidth / img.width, scaleY: img.fullHeight / img.height });

const UNIT_INPUT = 10;
const UNIT_SOURCE = 11;
// Units 8 and 9 hold the film LUTs on their 3D targets; the pass borrows only their 2D targets and unbinds them.
const UNIT_MASK = 8;
const UNIT_COLOUR = 9;

interface Output {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** What it holds: input + uniforms, and the raster versions drawn. */
  key: string;
  versions: number[];
  rasters: (CensorRaster | null)[];
}

/**
 * The censor pre-pass (shaders/censor.frag): a copy of an image texture with the censor layers' areas replaced by
 * their effect, rendered before the develop shader reads it, like the wavelet denoise pre-pass. One output per role
 * (the preview, a tile, the base and bloom copies, an export tile), cached by its input and the uniforms; while a
 * stroke grows only the part of the image the stroke changed is drawn again (scissored).
 *
 * Needs float render targets (EXT_color_buffer_float); without them [supported] is false and nothing is censored, which
 * the Censor panel says.
 */
export class CensorPass {
  private readonly program: WebGLProgram;
  private readonly fbo: WebGLFramebuffer;
  private readonly quad: FullscreenQuad;
  private readonly loc = new Map<string, WebGLUniformLocation | null>();
  private readonly source: WebGLTexture;
  private uploadedSource: PreviewImage | null = null;
  private readonly mask: WebGLTexture;
  private readonly colour: WebGLTexture;
  private slotW = 0;
  private slotH = 0;
  private readonly slots: { raster: CensorRaster | null; version: number }[] = Array.from({ length: MAX_CENSOR_LAYERS }, () => ({ raster: null, version: -1 }));
  private readonly outputs = new Map<string, Output>();
  readonly supported: boolean;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.supported = gl.getExtension('EXT_color_buffer_float') != null;
    this.program = createProgram(gl, DENOISE_VERT, CENSOR_FRAG);
    this.fbo = gl.createFramebuffer()!;
    this.quad = new FullscreenQuad(gl);
    this.source = createTexture(gl, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(4));
    this.mask = createTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 128, 128]));
    this.colour = createTexture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Whether [apply] changes anything for these uniforms. */
  active(c: CensorUniforms | null): c is CensorUniforms {
    return this.supported && c != null && c.count > 0;
  }

  /**
   * [input] ([width] x [height] texels at [at] in the full-resolution image) with the layers applied, or [input]
   * itself when nothing is censored. [role] names the cached output ('preview', 'tile', 'base'...), [inputKey]
   * identifies the input's contents. Leaves the default framebuffer bound and unit 0 active; the caller binds its
   * target and viewport again.
   */
  apply(c: CensorUniforms | null, role: string, input: WebGLTexture, inputKey: string, width: number, height: number, at: InputPlacement, mipmapped = false): WebGLTexture {
    if (!this.active(c)) return input;
    const gl = this.gl;
    this.uploadSource(c.source);
    this.uploadRasters(c.rasters);
    let out = this.outputs.get(role);
    if (!out || out.width !== width || out.height !== height) {
      if (out) gl.deleteTexture(out.texture);
      const texture = createTexture(gl, gl.LINEAR);
      const levels = mipmapped ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
      if (mipmapped) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, width, height);
      out = { texture, width, height, key: '', versions: [], rasters: [] };
      this.outputs.set(role, out);
    }
    const key = [inputKey, width, height, at.x, at.y, at.scaleX, at.scaleY, c.key].join('|');
    const versions = c.rasters.map((r) => r?.version ?? -1);
    let scissor: [number, number, number, number] | null = null;
    if (out.key === key) {
      if (versions.every((v, i) => v === out!.versions[i] && c.rasters[i] === out!.rasters[i])) return out.texture;
      scissor = this.changedTexels(c, out, at, width, height);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    if (scissor) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3]);
    }
    gl.useProgram(this.program);
    const bind = (unit: number, t: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(this.u(name), unit);
    };
    bind(UNIT_INPUT, input, 'uInput');
    bind(UNIT_SOURCE, this.source, 'uCensorSource');
    bind(UNIT_MASK, this.mask, 'uCensorMask');
    bind(UNIT_COLOUR, this.colour, 'uCensorColour');
    const slots = new Float32Array(MAX_CENSOR_LAYERS * 4);
    c.rasters.forEach((r, i) => {
      if (!r || r.width !== this.slotW || r.height !== this.slotH) return;
      slots.set([(i % 2) * 0.5, Math.floor(i / 2) * 0.5, 0.5, 0.5], i * 4);
    });
    gl.uniform2f(this.u('uCensorTexel'), 1 / Math.max(1, 2 * this.slotW), 1 / Math.max(1, 2 * this.slotH));
    gl.uniform4f(this.u('uInputRect'), at.x, at.y, at.scaleX, at.scaleY);
    gl.uniform2f(this.u('uImageSize'), c.source.fullWidth, c.source.fullHeight);
    gl.uniform2f(this.u('uSourceSize'), c.source.width, c.source.height);
    gl.uniform1i(this.u('uCensorCount'), c.count);
    gl.uniform4fv(this.u('uCensorSlot'), slots);
    gl.uniform4fv(this.u('uCensorKind'), c.kind);
    gl.uniform4fv(this.u('uCensorParam'), c.param);
    gl.uniform4fv(this.u('uCensorEllipse'), c.ellipse);
    gl.uniform4fv(this.u('uCensorTurn'), c.turn);
    gl.uniform4fv(this.u('uCensorExtra'), c.extra);
    gl.uniformMatrix3fv(this.u('uInvWhiteBalance'), false, c.invWhiteBalance);
    gl.uniform1f(this.u('uExposure'), c.exposure);
    gl.uniform1f(this.u('uContrast'), c.contrast);
    this.quad.draw();
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    if (mipmapped) {
      gl.bindTexture(gl.TEXTURE_2D, out.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    for (const unit of [UNIT_INPUT, UNIT_SOURCE, UNIT_MASK, UNIT_COLOUR]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    out.key = key;
    out.versions = versions;
    out.rasters = [...c.rasters];
    return out.texture;
  }

  /** The input texels (GL scissor box) the rasters changed since [out] was drawn, or null for everything. */
  private changedTexels(c: CensorUniforms, out: Output, at: InputPlacement, width: number, height: number): [number, number, number, number] | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < c.rasters.length; i++) {
      const r = c.rasters[i];
      if (!r) {
        if (out.rasters[i]) return null; // a layer lost its strokes
        continue;
      }
      if (out.rasters[i] !== r) return null;
      const pending = r.pendingRect(out.versions[i]);
      if (pending == null) continue;
      if (pending === 'all') return null;
      // Raster px -> full-res px -> input texels, plus a margin for the smoothing taps and dab reach.
      const fx = c.source.fullWidth / r.width;
      const fy = c.source.fullHeight / r.height;
      x0 = Math.min(x0, (pending.x * fx - at.x) / at.scaleX);
      y0 = Math.min(y0, (pending.y * fy - at.y) / at.scaleY);
      x1 = Math.max(x1, ((pending.x + pending.width) * fx - at.x) / at.scaleX);
      y1 = Math.max(y1, ((pending.y + pending.height) * fy - at.y) / at.scaleY);
    }
    if (!Number.isFinite(x0)) return [0, 0, 0, 0];
    // Paint dabs reach up to ~2 cells from where their direction is read: widen by the largest effect size.
    let reach = 0;
    for (let i = 0; i < c.count; i++) reach = Math.max(reach, c.param[i * 4] * 2.5);
    const mx = reach / at.scaleX + 3;
    const my = reach / at.scaleY + 3;
    const ax = Math.max(0, Math.floor(x0 - mx));
    const ay = Math.max(0, Math.floor(y0 - my));
    const bx = Math.min(width, Math.ceil(x1 + mx));
    const by = Math.min(height, Math.ceil(y1 + my));
    if (bx <= ax || by <= ay) return [0, 0, 0, 0];
    // Texel rows are image rows (row 0 = top), which is also the framebuffer's row 0.
    return [ax, ay, bx - ax, by - ay];
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.program, name));
    return this.loc.get(name)!;
  }

  private uploadSource(img: PreviewImage) {
    if (img === this.uploadedSource) return;
    const gl = this.gl;
    const n = img.width * img.height;
    const rgba = new Uint16Array(n * 4);
    const one = floatToHalf(1);
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = img.pixels[i * 3];
      rgba[i * 4 + 1] = img.pixels[i * 3 + 1];
      rgba[i * 4 + 2] = img.pixels[i * 3 + 2];
      rgba[i * 4 + 3] = one;
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT_SOURCE);
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.HALF_FLOAT, rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    this.uploadedSource = img;
    // Outputs made from the old copy are stale.
    for (const o of this.outputs.values()) o.key = '';
  }

  /** The layers' rasters into the two 2x2 atlases (only what changed). */
  private uploadRasters(rasters: readonly (CensorRaster | null)[]) {
    const gl = this.gl;
    const any = rasters.find((r) => r != null);
    if (!any) return;
    if (2 * Math.max(any.width, any.height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
      console.warn('Censor layers need a larger texture than this GPU allows');
      return;
    }
    if (any.width !== this.slotW || any.height !== this.slotH) {
      this.slotW = any.width;
      this.slotH = any.height;
      for (const t of [this.mask, this.colour]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2 * any.width, 2 * any.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      for (const s of this.slots) s.raster = null;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    rasters.forEach((r, i) => {
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
      for (const [t, data] of [[this.mask, r.mask], [this.colour, r.colour]] as const) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, (i % 2) * this.slotW + x, Math.floor(i / 2) * this.slotH + y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      }
      slot.raster = r;
      slot.version = r.version;
    });
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  release() {
    const gl = this.gl;
    for (const o of this.outputs.values()) gl.deleteTexture(o.texture);
    this.outputs.clear();
    for (const t of [this.source, this.mask, this.colour]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.program);
    this.quad.release();
  }
}
