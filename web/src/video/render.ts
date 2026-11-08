import type { LutData } from '../engine/lut/LutData';

/** What the shader should do to the clip. */
export interface VideoGrade {
  /** 0 = original, 1 = a look (display LUT), 2 = a film stock (film LUT then print LUT). */
  mode: 0 | 1 | 2;
  /** How the clip is encoded: 0 Rec.709/sRGB, 1 Apple Log (BT.2020), 2 HLG (BT.2020). */
  input: 0 | 1 | 2;
  exposureEv: number;
  /** 1 = unchanged; power of luma/0.18 around middle grey. */
  contrast: number;
  /** 0..1 mix between the original and the graded picture. */
  strength: number;
  grain: number;
  look: LutData | null;
  film: LutData | null;
  print: LutData | null;
  densityMin: number[];
  densityMax: number[];
}

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Apple Log constants and curve as in shaders/film_form.glsl (Apple Log Profile white paper).
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVideo;
uniform sampler3D uLook, uFilm, uPrint;
uniform float uLookSize, uFilmSize, uPrintSize;
uniform int uMode, uInput;
uniform float uContrast, uEv, uStrength, uGrain, uFrame;
uniform vec3 uDMin, uDMax;

const float R0 = -0.05641088, RT = 0.01, C = 47.28711236, B = 0.00964052, G = 0.08550479, BETA = 0.69336945;
vec3 appleLogEncode(vec3 x) {
  vec3 lo = C * (x - R0) * (x - R0);
  vec3 hi = G * log2(max(x, RT) + B) + BETA;
  return mix(mix(vec3(0.0), lo, step(vec3(R0), x)), hi, step(vec3(RT), x));
}
vec3 appleLogDecode(vec3 p) {
  float pt = C * (RT - R0) * (RT - R0);
  vec3 lo = sqrt(max(p, 0.0) / C) + R0;
  vec3 hi = exp2((p - BETA) / G) - B;
  return mix(lo, hi, step(vec3(pt), p));
}
vec3 hlgDecode(vec3 x) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  vec3 lo = x * x / 3.0;
  vec3 hi = (exp((x - c) / a) + b) / 12.0;
  return mix(lo, hi, step(vec3(0.5), x)) * 3.75; // 18 % grey (signal ~0.38) lands on 0.18
}
vec3 srgbDecode(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 srgbEncode(vec3 l) { l = max(l, 0.0); return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l)); }
const mat3 REC709_TO_2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0114, 0.8956);
const mat3 REC2020_TO_709 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
vec3 lut3(sampler3D t, float size, vec3 c) { return texture(t, clamp(c, 0.0, 1.0) * ((size - 1.0) / size) + 0.5 / size).rgb; }
float hash(vec2 p, float s) { vec3 q = fract(vec3(p.xyx) * 0.1031 + s * 0.0137); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

void main() {
  vec3 src = texture(uVideo, vUv).rgb;
  if (uMode == 0) { outColor = vec4(src, 1.0); return; }
  // Scene-linear BT.2020, 0.18 = middle grey.
  vec3 lin;
  if (uInput == 1) lin = appleLogDecode(src);
  else if (uInput == 2) lin = hlgDecode(src);
  else lin = REC709_TO_2020 * srgbDecode(src);
  lin *= exp2(uEv);
  lin *= pow(max(dot(lin, vec3(0.2627, 0.6780, 0.0593)), 1e-8) / 0.18, uContrast - 1.0);
  vec3 graded;
  if (uMode == 2) {
    vec3 span = uDMax - uDMin;
    vec3 d = lut3(uFilm, uFilmSize, appleLogEncode(lin)) * span + uDMin;
    graded = lut3(uPrint, uPrintSize, (d - uDMin) / span);
  } else {
    // Display picture for the look: a plain Rec.709 picture is used as it is, log and HLG get a soft shoulder.
    vec3 disp;
    if (uInput == 0) disp = srgbEncode(srgbDecode(src) * exp2(uEv));
    else { vec3 l = max(REC2020_TO_709 * lin, 0.0); disp = srgbEncode(l * 1.1 / (1.0 + 0.1 * l)); }
    graded = lut3(uLook, uLookSize, disp);
  }
  // Grain: luma noise that moves with the frames, strongest in the midtones.
  float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  float n = hash(gl_FragCoord.xy, uFrame) + hash(gl_FragCoord.xy + 17.0, uFrame) - 1.0;
  graded += n * uGrain * 0.12 * (0.35 + 1.3 * luma * (1.0 - luma));
  outColor = vec4(mix(src, clamp(graded, 0.0, 1.0), uStrength), 1.0);
}`;

/** WebGL2 renderer: draws video frames through the grade into its canvas. */
export class VideoRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private videoTex: WebGLTexture;
  private lutTex: WebGLTexture[] = [];
  private lutIds: (string | null)[] = [null, null, null];
  private uni = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) ?? 'link error');
    gl.useProgram(this.prog);
    this.videoTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_3D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_3D, k, v);
      this.lutTex.push(t);
      // A 2^3 identity-less placeholder so every sampler is complete.
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, new Float32Array(24));
    }
    gl.uniform1i(this.u('uVideo'), 0);
    gl.uniform1i(this.u('uLook'), 1);
    gl.uniform1i(this.u('uFilm'), 2);
    gl.uniform1i(this.u('uPrint'), 3);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private u(name: string) {
    if (!this.uni.has(name)) this.uni.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.uni.get(name)!;
  }

  private uploadLut(slot: number, lut: LutData | null) {
    const id = lut ? lut.id : null;
    if (id === this.lutIds[slot]) return;
    this.lutIds[slot] = id;
    if (!lut) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1 + slot);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex[slot]);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  }

  setSize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(video: HTMLVideoElement, g: VideoGrade, frame: number) {
    const gl = this.gl;
    if (video.videoWidth === 0) return;
    this.setSize(video.videoWidth, video.videoHeight);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.uploadLut(0, g.look);
    this.uploadLut(1, g.film);
    this.uploadLut(2, g.print);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1i(this.u('uMode'), g.mode);
    gl.uniform1i(this.u('uInput'), g.input);
    gl.uniform1f(this.u('uEv'), g.exposureEv);
    gl.uniform1f(this.u('uStrength'), g.strength);
    gl.uniform1f(this.u('uGrain'), g.grain);
    gl.uniform1f(this.u('uContrast'), g.contrast);
    gl.uniform1f(this.u('uFrame'), frame % 4096);
    gl.uniform1f(this.u('uLookSize'), g.look?.size ?? 2);
    gl.uniform1f(this.u('uFilmSize'), g.film?.size ?? 2);
    gl.uniform1f(this.u('uPrintSize'), g.print?.size ?? 2);
    gl.uniform3fv(this.u('uDMin'), g.densityMin);
    gl.uniform3fv(this.u('uDMax'), g.densityMax);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
