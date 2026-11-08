import { FilmStocks } from '../engine/film/FilmStocks';
import { LutRepository, loadLutCached } from '../engine/lut/LutRepository';
import { VideoRenderer, type VideoGrade } from './render';
import type { ExportMessage, ExportRequest } from './exportWorker';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>RawBoy Video</h1>
  <div class="layout">
    <div>
      <div class="stage"><canvas id="cv"></canvas><div class="empty" id="empty">Tap to choose a video clip<br>(or drop one here)</div></div>
      <div class="bar"><button id="play" disabled style="width:auto">Play</button><input id="seek" type="range" min="0" max="1000" value="0" disabled /><span id="time">0:00</span></div>
    </div>
    <div class="panel">
      <button id="open">Open clip…</button>
      <input id="file" type="file" accept="video/*" hidden />
      <label>Clip is recorded as
        <select id="input">
          <option value="1" selected>Flat clip from RawBoy Camera (Apple Log)</option>
          <option value="0">Normal video (Rec.709)</option>
          <option value="2">HLG (HDR phone video)</option>
        </select>
      </label>
      <label>Type
        <select id="kind"><option value="2">Film stock</option><option value="1">Look</option><option value="0">Original</option></select>
      </label>
      <label>Choice <select id="choice"></select></label>
      <label>Strength <input id="strength" type="range" min="0" max="100" value="100" /></label>
      <label id="offsetRow">Exposure raise in the clip (undone) <span id="offsetVal"></span><input id="offset" type="range" min="0" max="40" value="0" /></label>
      <label>Exposure <input id="ev" type="range" min="-30" max="30" value="0" /></label>
      <label>Contrast <input id="contrast" type="range" min="60" max="160" value="100" /></label>
      <label>Grain <input id="grain" type="range" min="0" max="100" value="30" /></label>
      <button id="fast" class="primary" disabled>Export graded clip (fast, background)</button>
      <progress id="prog" max="100" value="0" hidden style="width:100%"></progress>
      <button id="cancel" hidden>Cancel export</button>
      <button id="export" disabled>Export in real time (records the preview)</button>
      <div class="note" id="status">Runs in your browser; the clip is not uploaded. Fast export runs in the background; the real-time one records the preview, with sound.</div>
    </div>
  </div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cv');
let renderer: VideoRenderer;
try {
  renderer = new VideoRenderer(canvas);
} catch (e) {
  app.innerHTML = `<h1>RawBoy Video</h1><p>${(e as Error).message}</p>`;
  throw e;
}

const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
video.crossOrigin = 'anonymous';

const grade: VideoGrade = { mode: 2, input: 1, exposureEv: 0, contrast: 1, strength: 1, grain: 0.3, look: null, film: null, print: null, densityMin: [0, 0, 0], densityMax: [1, 1, 1] };
let frame = 0;
let loadToken = 0;

/** Exposure the Camera raised a flat clip by (EV), taken from its name: VID_<date>_<time>-flat+1.0ev.mp4. Older -flat.mp4 clips: 0. */
export function offsetFromName(name: string): number {
  const m = /-flat([+-]\d+(?:\.\d+)?)ev/i.exec(name);
  return m ? Number(m[1]) : 0;
}
/** The graded file keeps the clip's own name plus a suffix: VID_x-flat+1.0ev.mp4 -> VID_x-flat+1.0ev-rawboyvideo.mp4. */
function outputName(ext: string): string {
  const base = (source?.name ?? 'video').replace(/\.[^./\\]+$/, '');
  return `${base}-rawboyvideo.${ext}`;
}
let offsetEv = 0;
/** Light is brought back down by the recorded raise (linear light, before the look), then the user's own exposure. */
function applyExposure() {
  grade.exposureEv = Number($<HTMLInputElement>('ev').value) / 10 - (grade.input === 1 ? offsetEv : 0);
  $('offsetVal').textContent = `${offsetEv > 0 ? '+' : ''}${offsetEv.toFixed(1)} EV`;
  $('offsetRow').style.display = grade.input === 1 ? '' : 'none';
}
function setOffset(ev: number) {
  offsetEv = ev;
  $<HTMLInputElement>('offset').value = String(Math.round(ev * 10));
  applyExposure();
}

const status = (s: string) => ($('status').textContent = s);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function fillChoices() {
  const kind = Number($<HTMLSelectElement>('kind').value);
  const sel = $<HTMLSelectElement>('choice');
  sel.innerHTML = '';
  sel.disabled = kind === 0;
  if (kind === 2) for (const s of FilmStocks.all()) sel.add(new Option(s.name, s.id));
  if (kind === 1) for (const l of LutRepository.library().bundled) sel.add(new Option(l.name, l.id));
  void applyChoice();
}

async function applyChoice() {
  const token = ++loadToken;
  const kind = Number($<HTMLSelectElement>('kind').value) as 0 | 1 | 2;
  const id = $<HTMLSelectElement>('choice').value;
  try {
    if (kind === 2 && id) {
      status('Loading film stock…');
      const d = await FilmStocks.load(id);
      if (token !== loadToken) return;
      Object.assign(grade, { film: d.film, print: d.print, densityMin: d.stock.densityMin, densityMax: d.stock.densityMax });
    } else if (kind === 1 && id) {
      status('Loading look…');
      const l = await loadLutCached(id);
      if (token !== loadToken) return;
      grade.look = l;
    }
    grade.mode = kind;
    status('Runs in your browser; the clip is not uploaded. Fast export runs in the background; the real-time one records the preview, with sound.');
    redraw();
  } catch (e) {
    status(`Could not load: ${(e as Error).message}`);
  }
}

function redraw() {
  if (video.readyState >= 2) renderer.draw(video, video.videoWidth, video.videoHeight, grade, frame);
}

function loop() {
  frame++;
  redraw();
  $('time').textContent = `${fmt(video.currentTime)} / ${fmt(video.duration || 0)}`;
  if (!seeking && video.duration) $<HTMLInputElement>('seek').value = String((video.currentTime / video.duration) * 1000);
  schedule();
}
function schedule() {
  if (video.paused || video.ended) return;
  if ('requestVideoFrameCallback' in video) (video as HTMLVideoElement).requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

let seeking = false;
async function openFile(file: File) {
  source = file;
  setOffset(offsetFromName(file.name));
  video.pause();
  video.src = URL.createObjectURL(file);
  video.load();
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error('This browser cannot play that clip.'));
  }).catch((e: Error) => status(e.message));
  $('empty').style.display = 'none';
  for (const id of ['play', 'seek', 'export', 'fast']) $<HTMLButtonElement>(id).disabled = false;
  video.currentTime = 0;
  redraw();
}

$('open').onclick = () => $<HTMLInputElement>('file').click();
$('empty').onclick = () => $<HTMLInputElement>('file').click();
$<HTMLInputElement>('file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openFile(f);
};
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});

$('play').onclick = () => {
  if (video.paused) void video.play();
  else video.pause();
};
video.onplay = () => { $('play').textContent = 'Pause'; schedule(); };
video.onpause = () => { $('play').textContent = 'Play'; redraw(); };
video.onseeked = redraw;
$('seek').oninput = () => { seeking = true; video.currentTime = (Number($<HTMLInputElement>('seek').value) / 1000) * video.duration; };
$('seek').onchange = () => (seeking = false);

$('kind').onchange = fillChoices;
$('choice').onchange = () => void applyChoice();
$('input').onchange = () => { grade.input = Number($<HTMLSelectElement>('input').value) as 0 | 1 | 2; applyExposure(); redraw(); };
$('offset').oninput = () => { offsetEv = Number($<HTMLInputElement>('offset').value) / 10; applyExposure(); redraw(); };
$('strength').oninput = () => { grade.strength = Number($<HTMLInputElement>('strength').value) / 100; redraw(); };
$('ev').oninput = () => { applyExposure(); redraw(); };
$('contrast').oninput = () => { grade.contrast = Number($<HTMLInputElement>('contrast').value) / 100; redraw(); };
$('grain').oninput = () => { grade.grain = Number($<HTMLInputElement>('grain').value) / 100; redraw(); };

// Fast export: a worker decodes, grades and encodes the clip faster than real time, without drawing a preview.
let source: File | null = null;
const fastOk = typeof Worker !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window && typeof OffscreenCanvas !== 'undefined';
if (!fastOk) $('fast').style.display = 'none';
$('fast').onclick = () => {
  if (!source) return;
  const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  const prog = $<HTMLProgressElement>('prog');
  const cancel = $<HTMLButtonElement>('cancel');
  const busy = (on: boolean) => {
    for (const id of ['fast', 'export', 'open']) $<HTMLButtonElement>(id).disabled = on;
    prog.hidden = cancel.hidden = !on;
    prog.value = 0;
  };
  video.pause();
  busy(true);
  status('Exporting in the background…');
  const finish = (msg: string) => { busy(false); worker.terminate(); status(msg); };
  worker.onmessage = (e: MessageEvent<ExportMessage>) => {
    const m = e.data;
    if (m.type === 'progress') {
      prog.value = Math.round(m.progress * 100);
      status(`Exporting in the background… ${prog.value} %`);
    } else if (m.type === 'done') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([m.buffer], { type: 'video/mp4' }));
      a.download = outputName('mp4');
      a.click();
      finish(`Saved ${a.download} (${((performance.now() - t0) / 1000).toFixed(1)} s).`);
    } else if (m.type === 'canceled') finish('Export canceled.');
    else finish(`Export failed: ${m.message}. Try the real-time export.`);
  };
  worker.onerror = (e) => finish(`Export failed: ${e.message}. Try the real-time export.`);
  cancel.onclick = () => worker.postMessage({ cancel: true });
  const request: ExportRequest = { file: source, grade: { ...grade } };
  worker.postMessage(request);
};

// Real-time export: plays the clip once from the start while recording the canvas (and the clip's sound).
$('export').onclick = async () => {
  const btn = $<HTMLButtonElement>('export');
  btn.disabled = true;
  video.pause();
  video.currentTime = 0;
  await new Promise((r) => (video.onseeked = () => r(null)));
  video.onseeked = redraw;
  const stream = canvas.captureStream(30);
  const v = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  v.captureStream?.().getAudioTracks().forEach((t) => stream.addTrack(t));
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(1000);
  const tick = setInterval(() => status(`Exporting… ${Math.round((video.currentTime / video.duration) * 100)} %`), 300);
  await video.play();
  await new Promise((r) => video.addEventListener('ended', r, { once: true }));
  clearInterval(tick);
  rec.stop();
  await done;
  const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
  a.download = outputName(ext);
  a.click();
  status(`Saved ${a.download}`);
  btn.disabled = false;
};

applyExposure();
fillChoices();
