import { FilmStocks } from '../engine/film/FilmStocks';
import { LutRepository, loadLutCached } from '../engine/lut/LutRepository';
import { VideoRenderer, type VideoGrade } from './render';
import { CODECS, QUALITY_PRESETS, codecLabel, encodableCodecs, recorderBitrate, type ExportCodec, type QualityPreset } from './exportOptions';
import { createLeaveGuard } from '../ui/common/leaveGuard';
import type { ExportMessage, ExportRequest } from './exportWorker';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>RawBoy Video</h1>
  <div class="layout">
    <div>
      <div class="stage"><canvas id="cv"></canvas><div class="empty" id="empty">Tap to choose a video clip<br>(or drop one here)</div></div>
      <div class="bar"><button id="play" disabled style="width:auto">Play</button><button id="full" disabled style="width:auto" title="Show this frame at full resolution">Full size</button><input id="seek" type="range" min="0" max="1000" value="0" disabled /><span id="time">0:00</span></div>
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
      <label>Quality
        <select id="quality">${QUALITY_PRESETS.map((q) => `<option value="${q.id}"${q.id === 'optimal' ? ' selected' : ''}>${q.label}</option>`).join('')}</select>
      </label>
      <label>Format
        <select id="codec">${CODECS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
      </label>
      <div class="note" id="codecNote"></div>
      <button id="fast" class="primary" disabled>Export graded clip (fast, background)</button>
      <progress id="prog" max="100" value="0" hidden style="width:100%"></progress>
      <button id="cancel" hidden>Cancel export</button>
      <button id="export" disabled>Export in real time (records the preview)</button>
      <div class="note" id="status">Runs in your browser; the clip is not uploaded. Fast export runs in the background; the real-time one records the preview, with sound.</div>
    </div>
  </div>
  <div id="viewer" class="viewer" hidden>
    <div class="viewerBar"><button id="vfit" style="width:auto">Fit to screen</button><button id="v1" style="width:auto">1:1</button><span id="vsize"></span><button id="vclose" style="width:auto;margin-left:auto">Close</button></div>
    <div class="viewerBody" id="vbody"><canvas id="vcv"></canvas></div>
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
  for (const id of ['play', 'seek', 'export', 'fast', 'full']) $<HTMLButtonElement>(id).disabled = false;
  video.currentTime = 0;
  redraw();
  void refreshCodecs();
}

// Export format: only what this browser can encode at the clip's size is enabled; the other is the fallback.
async function refreshCodecs() {
  const w = video.videoWidth || 1920, h = video.videoHeight || 1080;
  const ok = await encodableCodecs(w, h);
  const sel = $<HTMLSelectElement>('codec');
  for (const o of Array.from(sel.options)) {
    const label = CODECS.find((c) => c.id === o.value)!.label;
    o.disabled = !ok.includes(o.value as ExportCodec);
    o.textContent = o.disabled ? `${label} (not supported here)` : label;
  }
  if (sel.selectedOptions[0]?.disabled && ok[0]) sel.value = ok[0];
  $('codecNote').textContent = ok.length === 0
    ? 'This browser cannot encode H.264 or HEVC; use the real-time export.'
    : ok.length === 1 ? `This browser can only encode ${codecLabel(ok[0])}.` : 'H.264 plays everywhere; HEVC is about 40 % smaller at the same quality.';
}
const wantedCodec = () => $<HTMLSelectElement>('codec').value as ExportCodec;
const wantedQuality = () => $<HTMLSelectElement>('quality').value as QualityPreset;

// Full-size frame: the current graded frame at the clip's own resolution, fit to the screen or 1:1 (scroll to pan).
const viewer = $('viewer');
const vcv = $<HTMLCanvasElement>('vcv');
function setViewerFit(fit: boolean) {
  viewer.classList.toggle('fit', fit);
  $('vfit').classList.toggle('on', fit);
  $('v1').classList.toggle('on', !fit);
}
function openViewer() {
  if (video.readyState < 2) return;
  video.pause();
  renderer.draw(video, video.videoWidth, video.videoHeight, grade, frame);
  vcv.width = canvas.width;
  vcv.height = canvas.height;
  vcv.getContext('2d')!.drawImage(canvas, 0, 0);
  $('vsize').textContent = `${vcv.width} × ${vcv.height} px · ${fmt(video.currentTime)}`;
  viewer.hidden = false;
  setViewerFit(true);
  $<HTMLButtonElement>('vclose').focus();
}
const closeViewer = () => { viewer.hidden = true; };
$('full').onclick = openViewer;
$('vclose').onclick = closeViewer;
$('vfit').onclick = () => setViewerFit(true);
$('v1').onclick = () => setViewerFit(false);
$('vbody').onclick = (e) => { if (e.target === $('vbody')) closeViewer(); };
document.addEventListener('keydown', (e) => {
  if (viewer.hidden) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === '1') setViewerFit(false);
  else if (e.key === 'f' || e.key === 'F') setViewerFit(true);
});

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

// The browser asks before the tab goes away while a clip is being exported.
let exporting = 0;
const leaveGuard = createLeaveGuard(() => exporting > 0);
const exportRunning = (on: boolean) => {
  exporting = Math.max(0, exporting + (on ? 1 : -1));
  leaveGuard.refresh();
};

// Fast export: a worker decodes, grades and encodes the clip faster than real time, without drawing a preview.
let source: File | null = null;
const fastOk = typeof Worker !== 'undefined' && 'VideoDecoder' in window && 'VideoEncoder' in window && typeof OffscreenCanvas !== 'undefined';
if (!fastOk) $('fast').style.display = 'none';
$('fast').onclick = () => {
  if (!source) return;
  const wanted = wantedCodec();
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
  exportRunning(true);
  status('Exporting in the background…');
  const finish = (msg: string) => { exportRunning(false); busy(false); worker.terminate(); status(msg); };
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
      const fell = m.fellBack ? ` ${codecLabel(wanted)} is not available here, so it used ${codecLabel(m.codec)}.` : '';
      finish(`Saved ${a.download} (${codecLabel(m.codec)}, ${((performance.now() - t0) / 1000).toFixed(1)} s).${fell}`);
    } else if (m.type === 'canceled') finish('Export canceled.');
    else finish(`Export failed: ${m.message}. Try the real-time export.`);
  };
  worker.onerror = (e) => finish(`Export failed: ${e.message}. Try the real-time export.`);
  cancel.onclick = () => worker.postMessage({ cancel: true });
  const request: ExportRequest = { file: source, grade: { ...grade }, codec: wanted, quality: wantedQuality() };
  worker.postMessage(request);
};

// Real-time export: plays the clip once from the start while recording the canvas (and the clip's sound).
$('export').onclick = async () => {
  const btn = $<HTMLButtonElement>('export');
  btn.disabled = true;
  exportRunning(true);
  video.pause();
  video.currentTime = 0;
  await new Promise((r) => (video.onseeked = () => r(null)));
  video.onseeked = redraw;
  const stream = canvas.captureStream(30);
  const v = video as HTMLVideoElement & { captureStream?: () => MediaStream };
  v.captureStream?.().getAudioTracks().forEach((t) => stream.addTrack(t));
  // The chosen format if MediaRecorder supports it, else the other MP4 codec, else whatever the browser records.
  const wanted = wantedCodec();
  const order = [...CODECS].sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted));
  const pick = order.find((c) => MediaRecorder.isTypeSupported(c.mime));
  const type = pick?.mime ?? ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: recorderBitrate(wantedQuality(), pick?.id ?? 'avc', canvas.width, canvas.height) });
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
  exportRunning(false);
  status(`Saved ${a.download}${pick && pick.id !== wanted ? ` (${codecLabel(wanted)} is not available for recording here, used ${codecLabel(pick.id)})` : ''}.`);
  btn.disabled = false;
};

applyExposure();
fillChoices();
