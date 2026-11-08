import { FilmStocks, type FilmData } from '../engine/film/FilmStocks';
import type { LutData } from '../engine/lut/LutData';

/**
 * RawBoy Looks: plays a flat clip from RawBoy Camera (Settings > Flat video for grading: Apple Log codes) through a film
 * stock's two baked LUTs, the same chain as shaders/film_form.glsl's applyFilm without grain: exposure and contrast on the
 * decoded linear light, Apple Log encode, film LUT (code -> normalised density), print LUT (density -> sRGB). The film
 * LUT's output is already the print LUT's input (the density wire cancels), so the two LUTs are chained directly.
 */

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D uVideo;
uniform sampler3D uFilm;
uniform sampler3D uPrint;
uniform float uFilmSize;
uniform float uPrintSize;
uniform float uGain;
uniform float uContrast;
in vec2 vUv;
out vec4 fragColor;
const float R0 = -0.05641088, RT = 0.01, C = 47.28711236, B = 0.00964052, G = 0.08550479, D = 0.69336945;
vec3 decode(vec3 p) {
    float pt = C * (RT - R0) * (RT - R0);
    vec3 lo = sqrt(max(p, 0.0) / C) + R0;
    vec3 hi = exp2((p - D) / G) - B;
    return mix(lo, hi, step(vec3(pt), p));
}
vec3 encode(vec3 x) {
    vec3 lo = C * (x - R0) * (x - R0);
    vec3 hi = G * log2(max(x, RT) + B) + D;
    return mix(mix(vec3(0.0), lo, step(vec3(R0), x)), hi, step(vec3(RT), x));
}
vec3 nodes(sampler3D lut, float size, vec3 c) {
    return texture(lut, clamp(c, 0.0, 1.0) * ((size - 1.0) / size) + 0.5 / size).rgb;
}
void main() {
    vec3 code = texture(uVideo, vUv).rgb;
    vec3 lin = decode(code) * uGain;
    float y = max(dot(lin, vec3(0.2627, 0.6780, 0.0593)), 1e-8);
    lin *= pow(y / 0.18, uContrast - 1.0);
    vec3 n = nodes(uFilm, uFilmSize, encode(lin));
    fragColor = vec4(nodes(uPrint, uPrintSize, n), 1.0);
}`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const fileInput = $<HTMLInputElement>('file');
const stockSelect = $<HTMLSelectElement>('stock');
const status = $('status');
const video = document.createElement('video');
video.loop = true;
video.playsInline = true;
video.muted = false;

const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
if (!gl) status.textContent = 'WebGL 2 is not available.';

function shader(type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}
const program = gl.createProgram()!;
gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
gl.useProgram(program);
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const u = (name: string) => gl.getUniformLocation(program, name);

function lutTexture(unit: number, lut: LutData): WebGLTexture {
  const t = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_3D, t);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
  // RGB16F filters everywhere in WebGL 2 (RGB32F needs an extension); the float upload converts.
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
  return t;
}

const videoTexture = gl.createTexture()!;
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, videoTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.uniform1i(u('uVideo'), 0);
gl.uniform1i(u('uFilm'), 1);
gl.uniform1i(u('uPrint'), 2);

let film: FilmData | null = null;
let filmTex: WebGLTexture | null = null;
let printTex: WebGLTexture | null = null;

async function selectStock(id: string): Promise<void> {
  status.textContent = 'Loading the stock…';
  try {
    const data = await FilmStocks.load(id);
    if (filmTex) gl.deleteTexture(filmTex);
    if (printTex) gl.deleteTexture(printTex);
    filmTex = lutTexture(1, data.film);
    printTex = lutTexture(2, data.print);
    gl.uniform1f(u('uFilmSize'), data.film.size);
    gl.uniform1f(u('uPrintSize'), data.print.size);
    film = data;
    status.textContent = '';
  } catch (e) {
    status.textContent = `Could not load the stock: ${(e as Error).message}`;
  }
  draw();
}

function draw(): void {
  if (!film || video.readyState < 2) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.uniform1f(u('uGain'), 2 ** Number($<HTMLInputElement>('ev').value));
  gl.uniform1f(u('uContrast'), Number($<HTMLInputElement>('contrast').value));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function loop(): void {
  draw();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}
loop();

for (const s of FilmStocks.all()) stockSelect.add(new Option(s.name, s.id));
stockSelect.onchange = () => void selectStock(stockSelect.value);
void selectStock(stockSelect.value);

fileInput.onchange = () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  video.src = URL.createObjectURL(f);
  void video.play();
  loop();
};
$('play').onclick = () => (video.paused ? void video.play() : video.pause());
$<HTMLInputElement>('ev').oninput = () => {
  $('evv').textContent = `${Number($<HTMLInputElement>('ev').value).toFixed(1)} EV`;
  draw();
};
$<HTMLInputElement>('contrast').oninput = () => {
  $('cv').textContent = Number($<HTMLInputElement>('contrast').value).toFixed(2);
  draw();
};

// Records the graded canvas (and the clip's sound) while it plays once from the start.
$('record').onclick = () => {
  if (!video.src) return;
  const stream = canvas.captureStream(30);
  const audio = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.().getAudioTracks() ?? [];
  audio.forEach((t) => stream.addTrack(t));
  const mime = ['video/mp4;codecs=hvc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 20_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    video.loop = true;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
    a.download = `graded-${film?.stock.id ?? 'look'}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    status.textContent = 'Saved.';
  };
  video.loop = false;
  video.onended = () => rec.stop();
  video.currentTime = 0;
  rec.start();
  void video.play();
  status.textContent = 'Recording while the clip plays…';
};
