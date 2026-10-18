// Runs RawBoy Web's real auto analysis (AutoAnalysis.ts, the same code path as RawBoy Auto) on every raw in a folder
// and writes one JSON per photo: stats with the histogram, the auto develop, and the 512 px linear Rec.2020 copy
// (half floats, base64) for tag.py.
//
//   cd web && npm run dev            # in another terminal
//   node tools/auto-eval/harness.mjs <raw-folder> <out-dir> [http://localhost:5173/]
//
// Needs playwright-core (kept outside the repo, see CLAUDE.md) and the installed Chrome.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.env.HOME, 'node_modules', 'x.js'));
const { chromium } = require('playwright-core');

const [, , dir, out, url = 'http://localhost:5173/'] = process.argv;
mkdirSync(out, { recursive: true });
const files = readdirSync(dir).filter((f) => /\.(dng|raf|cr2|cr3|nef|arw|orf|rw2)$/i.test(f)).sort();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.text().includes('RawBoyAuto analysis')) console.log('  ' + m.text().replace(/.*cameraMetered=(\w+).*/, 'cameraMetered=$1'));
});
await page.goto(url);
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const i = document.createElement('input');
  i.type = 'file';
  i.id = 'auto-eval';
  document.body.appendChild(i);
});
for (const f of files) {
  await page.setInputFiles('#auto-eval', join(dir, f));
  const r = await page.evaluate(async (label) => {
    const { analyzeFile } = await import('/src/engine/auto/AutoAnalysis.ts');
    const a = await analyzeFile(document.getElementById('auto-eval').files[0], label);
    const s = a.stats;
    const b = a.base;
    const u8 = new Uint8Array(b.pixels.buffer, b.pixels.byteOffset, b.pixels.byteLength);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return {
      stats: {
        key: s.key, p1: s.p1, p5: s.p5, p50: s.p50, p98: s.p98, p99: s.p99, clipped: s.clipped, chroma: s.chroma,
        greenBlue: s.greenBlue, warm: s.warm, faceArea: s.faceArea, skinLuminance: s.skinLuminance, iso: s.iso,
        histogram: Array.from(s.histogram),
      },
      auto: a.autoBase,
      defaults: a.defaults,
      base: { width: b.width, height: b.height, fullWidth: b.fullWidth, fullHeight: b.fullHeight, f16: btoa(bin) },
    };
  }, f);
  writeFileSync(join(out, basename(f) + '.json'), JSON.stringify(r));
  console.log(f, `exposure ${r.auto.exposure}`);
}
await browser.close();
