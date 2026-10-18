// Decodes raw files with the WASM build in Node and prints what the app would see:
// node scripts/decode-check.mjs [--full] file...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const full = args[0] === '--full';
const files = full ? args.slice(1) : args;
const { default: createRawBoy } = await import(`../public/wasm/${full ? 'rawboy-full' : 'rawboy'}.mjs`);
const m = await createRawBoy();
console.log('DNG SDK:', m.hasDngSdk());

const halfToFloat = (h) => {
  const e = (h >> 10) & 0x1f, f = h & 0x3ff;
  return e === 0 ? f / 16777216 : e === 31 ? Infinity : 2 ** (e - 15) * (1 + f / 1024);
};

for (const file of files) {
  const t = performance.now();
  const h = m.open(readFileSync(file), 0);
  if (!h) { console.log(basename(file), 'FAILED:', m.lastError()); continue; }
  const ms = Math.round(performance.now() - t);
  const lens = m.lensInfo(h);
  const w = m.width(h), hh = m.height(h);
  const s = 512 / Math.max(w, hh);
  const bw = Math.round(w * s), bh = Math.round(hh * s);
  const base = m.downsample(h, bw, bh, false);
  const mean = [0, 0, 0];
  for (let i = 0; i < base.length; i++) mean[i % 3] += halfToFloat(base[i]);
  const n = base.length / 3;
  console.log(basename(file), `${ms} ms`, m.describe(h), '| iso', m.iso(h), '| lens', JSON.stringify(m.lensName(h)),
    '| white', Array.from(m.asShotWhite(h)).map((v) => v.toFixed(4)).join(','),
    '| orientation', lens[0], 'sensor', lens[1], 'x', lens[2], 'warp', lens[3], 'vig', lens[25], 'shading', lens[33], 'gainMaps', lens[40],
    '| mean', mean.map((v) => (v / n).toFixed(4)).join(','));
  m.close(h);
}
process.exit(0);
