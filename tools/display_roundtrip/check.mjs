// Checks that JPEG/HEIC input (decoder_display.cpp + display_inverse.cpp, rendered with uDisplaySource) develops back
// into itself: each file is opened in RawBoy Web, exported at its as-shot defaults (no edits) as a 16-bit TIFF and
// compared with the file as the browser decodes it. Also renders it at Exposure -2 to show the highlight headroom an
// Ultra HDR gain map restores (detail where the SDR picture is clipped).
//
//   cd web && npm run dev            # in another terminal (restart it after editing shaders or engine files)
//   node tools/display_roundtrip/check.mjs <folder> <out-dir> [--url http://localhost:5173/] [--browser webkit]
//
// Prints per file: dE76 median / p99 / max and the share of pixels more than 2 levels off, and for clipped areas the
// luminance spread at -2 EV (about 0 without recovered headroom). JPEGs are compared with PIL's colour-managed decode.
// HEICs need --browser webkit (Playwright's WebKit decodes them through ImageIO, as Safari does; Chrome can't) and are
// compared with the browser's own sRGB decode. Needs playwright-core (kept outside the repo, see CLAUDE.md; WebKit via
// its installer), the installed Chrome, numpy, PIL and tifffile.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(join(process.env.HOME, 'node_modules', 'x.js'));
const { chromium, webkit } = require('playwright-core');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const url = opt('--url', 'http://localhost:5173/');
const useWebkit = opt('--browser', 'chrome') === 'webkit';
const [dir, out] = args;
mkdirSync(out, { recursive: true });
const files = readdirSync(dir).filter((f) => (useWebkit ? /\.(jpe?g|heic|heif)$/i : /\.(jpe?g)$/i).test(f)).sort();

const browser = useWebkit
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(e.message));
await page.goto(url);
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const i = document.createElement('input');
  i.type = 'file';
  i.id = 'roundtrip';
  document.body.appendChild(i);
});

/** Exports the page's file at its defaults with [exposure] EV, as a 16-bit TIFF. */
async function render(exposure) {
  const b64 = await page.evaluate(async ({ exposure }) => {
    const { ShaderParams } = await import('/src/engine/gl/ShaderParams.ts');
    const { LensTransform } = await import('/src/engine/lens/LensTransform.ts');
    const { RawImage } = await import('/src/engine/raw/RawImage.ts');
    const { asShotDefaults } = await import('/src/engine/session/PhotoSession.ts');
    const { exportImage } = await import('/src/engine/export/Exporter.ts');
    const file = document.getElementById('roundtrip').files[0];
    const img = await RawImage.open(file);
    try {
      const defaults = asShotDefaults(img);
      const params = { ...defaults, exposure };
      const shader = ShaderParams.from(params, defaults, null, new LensTransform(img.lens, params), null, null, null);
      const settings = { format: 'tiff', jpegQuality: 98, tiffBits: 16, maxLongSide: null };
      const u8 = new Uint8Array(await (await exportImage(img, shader, settings, () => {})).arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(bin);
    } finally {
      img.close();
    }
  }, { exposure });
  return Buffer.from(b64, 'base64');
}

/** The browser's own decode of the page's file (upright, sRGB) as a PNG: the reference for HEIC. */
async function browserDecode() {
  const b64 = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(document.getElementById('roundtrip').files[0]);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const u8 = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

const names = [];
for (const f of files) {
  await page.setInputFiles('#roundtrip', join(dir, f));
  const name = basename(f).replace(/\.[^.]+$/, '');
  let reference = join(dir, f);
  if (/\.hei[cf]$/i.test(f)) {
    reference = join(out, `${name}-reference.png`);
    writeFileSync(reference, await browserDecode());
  }
  writeFileSync(join(out, `${name}-defaults.tif`), await render(0));
  writeFileSync(join(out, `${name}-minus2.tif`), await render(-2));
  names.push([name, reference]);
  console.log('rendered', f);
}
await browser.close();

const measure = String.raw`
import json, sys
import numpy as np
from PIL import Image, ImageOps
out, items = sys.argv[1], json.loads(sys.argv[2])

def tiff16(path):
    import tifffile  # PIL reads 16-bit RGB TIFFs as 8-bit
    return tifffile.imread(path).astype(np.float64) / 65535 * 255

def lab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

def de76(a, b):
    return np.sqrt(((lab(a) - lab(b)) ** 2).sum(-1))

for name, src in items:
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    icc = Image.open(src).info.get('icc_profile')
    if icc:  # the reference in sRGB, as the export is (PIL alone would read P3 values as sRGB)
        from io import BytesIO
        from PIL import ImageCms
        im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(BytesIO(icc)), ImageCms.createProfile('sRGB'))
    s = np.asarray(im).astype(np.float64)
    d = tiff16(f'{out}/{name}-defaults.tif')
    m = tiff16(f'{out}/{name}-minus2.tif')
    e = de76(s, d)
    lv = np.abs(s - d).max(-1)
    clipped = s.min(-1) >= 254
    spread = float(m[clipped].mean(-1).std()) if clipped.sum() > 100 else float('nan')
    print(f'{name}: dE76 median {np.median(e):.2f} p99 {np.percentile(e, 99):.2f} max {e.max():.1f}; '
          f'>2 levels {100 * (lv > 2).mean():.2f}%; clipped {100 * clipped.mean():.2f}% of pixels, '
          f'their spread at -2 EV {spread:.2f} levels')
`;
console.log(execFileSync('python3', ['-c', measure, out, JSON.stringify(names)], { encoding: 'utf8' }));
