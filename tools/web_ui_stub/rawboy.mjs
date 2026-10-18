// UI-review stub of the WASM decoder: every file opens as the same synthetic linear image (half floats).
export default async function create() {
  const W = 3000, H = 2000;
  const src = new Uint16Array(await (await fetch(new URL('stub.f16', import.meta.url))).arrayBuffer());
  const handles = new Map(); let next = 1; let flips = 0;
  const md = () => ({ make: 'Fujifilm', model: 'X-T5', lensMake: 'Fujifilm', lensModel: 'XF23mmF1.4 R LM WR', artist: '', copyright: '',
    dateTimeOriginal: '2026:09:12 19:41:03', subSecTimeOriginal: '', offsetTimeOriginal: '', exposureTime: 1/250, fNumber: 5.6,
    exposureBias: 0, focalLength: 23, focalLength35mm: 35, iso: 400, gps: null });
  const open = () => { const h = next++; handles.set(h, { flip: (flips++) % 2 === 1 }); return h; };
  const sample = (h, sx, sy) => { const f = handles.get(h)?.flip; const x = f ? W - 1 - sx : sx; return (sy * W + x) * 3; };
  const m = {
    hasDngSdk: () => false, lastError: () => 'stub', open, openPixels: open, close: (h) => handles.delete(h),
    width: () => W, height: () => H, describe: () => 'Fujifilm X-T5 · RAF (stub)', camera: () => 'Fujifilm X-T5', iso: () => 400,
    baselineExposure: () => NaN, displayReferred: () => false, asShotWhite: () => new Float64Array([0.3127, 0.329]),
    lensName: () => 'XF23mmF1.4 R LM WR', lensInfo: () => { const v = new Float64Array(41); v[0] = 1; v[1] = W; v[2] = H; return v; },
    lensShading: () => new Float32Array(0), metadata: md,
    downsample: (h, w, hh) => { const out = new Uint16Array(w * hh * 3);
      for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const s = sample(h, Math.floor(x * W / w), Math.floor(y * H / hh)); const o = (y * w + x) * 3;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; } return out; },
    copyTile: (h, x0, y0, w, hh) => { const out = new Uint16Array(w * hh * 3);
      for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { const s = sample(h, x0 + x, y0 + y); const o = (y * w + x) * 3;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; } return out; },
    noiseLevel: () => new Float32Array([0.004, 0.003]),
    detectBlemishes: () => new Float32Array(0), healBlemishes: () => {},
    getExceptionMessage: () => ['', 'stub'],
  };
  m.Downscaler = class { constructor(a, b, c, d) { this.w = c; this.h = d; } push() { return new Uint16Array(0); } finish() { return new Uint16Array(this.w * this.h * 3); } delete() {} };
  m.JpegEncoder = class { writeRows() {} finish() { return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); } delete() {} };
  return m;
}
