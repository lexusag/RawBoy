// Generates every app icon from the logos in branding/ (one SVG per app: a background rect plus flat paths, the
// lens path being the app's accent):
//   - Android adaptive icons: app-*/src/main/res/drawable/ic_launcher{,_foreground,_monochrome}.xml and the background
//     colour in values/ic_launcher.xml. The artwork is scaled into the 66 dp safe circle of the 108 dp canvas, so round
//     and squircle masks don't cut it. The monochrome layer (themed icons) cuts the lens ring out of the camera body.
//   - iOS: ios/<App>/Assets.xcassets/AppIcon.appiconset/icon-1024.png (full bleed, no alpha: iOS rounds the corners).
//   - Web (when web/ exists): favicon.svg, icon-192/512.png, icon-maskable-512.png (art in the 80% safe circle) and
//     apple-touch-icon.png in web/public.
//   - RawBoy Film (when app-camera/src/film exists, i.e. in its repository): the film flavour's resources in
//     app-camera/src/film/res and the AppIconFilm set in ios/Camera/film/Film.xcassets.
//
//   node tools/icons/gen.mjs
//
// Needs playwright-core (kept outside the repo, see CLAUDE.md) and the installed Chrome, or playwright's own Chromium.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 512; // the logos' viewBox is 2034 units; ART_RADIUS is measured on this many pixels for speed

function loadPlaywright() {
  try {
    const { chromium } = createRequire(join(process.env.HOME, 'node_modules', 'x.js'))('playwright-core');
    return () => chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    const { chromium } = createRequire(import.meta.url)('playwright');
    return () => chromium.launch({ headless: true });
  }
}

// The logos are written by hand-cleaning the designer's export: one <rect id="background"> and <path id transform
// fill d> elements, nothing else.
function parseLogo(file) {
  const svg = readFileSync(file, 'utf8');
  const viewBox = Number(/viewBox="0 0 ([\d.]+) [\d.]+"/.exec(svg)[1]);
  const background = /<rect id="background"[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(svg)[1];
  const paths = [...svg.matchAll(/<path id="([^"]+)" transform="matrix\(([^)]+)\)" fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"\/>/g)]
    .map(([, id, m, fill, d]) => ({ id, matrix: m.split(',').map(Number), fill, d }));
  if (!paths.some((p) => p.id === 'lens') || !paths.some((p) => p.id === 'camera')) throw new Error(`${file}: no lens/camera path`);
  return { file, svg, viewBox, background, paths };
}

// Renders in the page: art scaled by `scale` about the logo's centre, on the background (or transparent). Returns
// RGBA pixels. With measure, returns the largest distance of any painted pixel from the centre, in logo units.
async function render(page, logo, size, { scale = 1, background = true, measure = false } = {}) {
  return page.evaluate(({ logo, size, scale, background, measure }) => {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = logo.background; ctx.fillRect(0, 0, size, size); }
    const k = size / logo.viewBox, c = logo.viewBox / 2;
    for (const p of logo.paths) {
      const [a, b, cc, d, e, f] = p.matrix;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.translate(c, c); ctx.scale(scale, scale); ctx.translate(-c, -c);
      ctx.transform(a, b, cc, d, e, f);
      ctx.fillStyle = p.fill;
      ctx.fill(new Path2D(p.d));
    }
    const data = ctx.getImageData(0, 0, size, size).data;
    if (measure) {
      let r = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (data[(y * size + x) * 4 + 3] > 8) r = Math.max(r, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2));
      return (r + 1) / k;
    }
    return Array.from(data);
  }, { logo: { viewBox: logo.viewBox, background: logo.background, paths: logo.paths }, size, scale, background, measure });
}

// 8-bit PNG, RGB (opaque) or RGBA. iOS wants its 1024 px icon without an alpha channel.
function png(rgba, size, alpha) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((size * ch + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * ch + 1)] = 0;
    for (let x = 0; x < size; x++)
      for (let i = 0; i < ch; i++) raw[y * (size * ch + 1) + 1 + x * ch + i] = rgba[(y * size + x) * 4 + i];
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function write(path, data) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), data);
  console.log('wrote', path);
}

const argb = (hex) => `#FF${hex.slice(1).toUpperCase()}`;
const num = (v) => String(Math.round(v * 1e5) / 1e5);

// VectorDrawable: an outer group fits the logo's viewBox into the 108 dp canvas, one group per path carries its
// matrix (the logos only scale and translate). Monochrome: the lens ring is joined to the camera body with evenOdd so
// it shows as a hole, every other dark path stays.
function vector(logo, artRadius, { monochrome = false } = {}) {
  const scale = 33 / artRadius; // dp per logo unit: the art's farthest point lands on the 66 dp safe circle
  const shift = 54 - (logo.viewBox / 2) * scale;
  const groups = [];
  const lens = logo.paths.find((p) => p.id === 'lens');
  for (const p of logo.paths) {
    if (monochrome && p.id === 'lens') continue;
    const [a, b, c, d, e, f] = p.matrix;
    if (b !== 0 || c !== 0) throw new Error(`${logo.file}: ${p.id} is rotated or skewed`);
    const evenOdd = monochrome && p.id === 'camera';
    if (evenOdd && lens.matrix.join() !== p.matrix.join()) throw new Error(`${logo.file}: lens and camera transforms differ`);
    groups.push(
      `        <group android:scaleX="${num(a)}" android:scaleY="${num(d)}" android:translateX="${num(e)}" android:translateY="${num(f)}">\n` +
      `            <path\n` +
      `                android:fillColor="${monochrome ? '#FF000000' : argb(p.fill)}"${evenOdd ? '\n                android:fillType="evenOdd"' : ''}\n` +
      `                android:pathData="${evenOdd ? `${p.d} ${lens.d}` : p.d}" />\n` +
      `        </group>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!-- Generated from branding/${logo.file.split('/').pop()} by tools/icons/gen.mjs; edit the logo, not this file. -->\n` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
    `    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n` +
    `    <group android:scaleX="${num(scale)}" android:scaleY="${num(scale)}" android:translateX="${num(shift)}" android:translateY="${num(shift)}">\n` +
    `${groups.join('\n')}\n    </group>\n</vector>\n`;
}

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/icons/gen.mjs. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;

const colour = (logo) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from branding/${logo.file.split('/').pop()} by tools/icons/gen.mjs. -->
<resources>
    <color name="ic_launcher_background">${argb(logo.background)}</color>
</resources>
`;

const appIconSet = (dir) => {
  write(`${dir}/Contents.json`, JSON.stringify({
    images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n');
  write(`${dirname(dir)}/Contents.json`, JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
};

const film = existsSync(join(ROOT, 'app-camera/src/film'));
const apps = [
  { logo: 'pro', res: 'app-pro/src/main/res', ios: 'ios/Pro/Assets.xcassets/AppIcon.appiconset', adaptive: true },
  { logo: 'auto', res: 'app-auto/src/main/res', ios: 'ios/Auto/Assets.xcassets/AppIcon.appiconset', adaptive: true },
  { logo: 'camera', res: 'app-camera/src/main/res', ios: 'ios/Camera/Assets.xcassets/AppIcon.appiconset', adaptive: true },
  // The flavour inherits main's ic_launcher.xml and overrides its layers.
  ...(film ? [{ logo: 'film', res: 'app-camera/src/film/res', ios: 'ios/Camera/film/Film.xcassets/AppIconFilm.appiconset' }] : []),
].filter((a) => existsSync(join(ROOT, a.res, '..')));

const browser = await loadPlaywright()();
const page = await browser.newPage();
await page.setContent('<!doctype html><title>icons</title>');
for (const app of apps) {
  const logo = parseLogo(join(ROOT, 'branding', `${app.logo}.svg`));
  const artRadius = await render(page, logo, SOURCE, { background: false, measure: true });
  if (app.adaptive) write(`${app.res}/drawable/ic_launcher.xml`, ADAPTIVE);
  write(`${app.res}/drawable/ic_launcher_foreground.xml`, vector(logo, artRadius));
  write(`${app.res}/drawable/ic_launcher_monochrome.xml`, vector(logo, artRadius, { monochrome: true }));
  write(`${app.res}/values/ic_launcher.xml`, colour(logo));
  if (existsSync(join(ROOT, app.ios.split('/').slice(0, 2).join('/')))) {
    write(`${app.ios}/icon-1024.png`, png(await render(page, logo, 1024), 1024, false));
    appIconSet(app.ios);
  }
  if (app.logo === 'pro' && existsSync(join(ROOT, 'web/public'))) {
    // RawBoy Web is RawBoy and RawBoy Auto in the browser: it wears RawBoy's (Pro's) logo.
    copyFileSync(logo.file, join(ROOT, 'web/public/favicon.svg'));
    console.log('wrote web/public/favicon.svg');
    for (const size of [192, 512]) write(`web/public/icon-${size}.png`, png(await render(page, logo, size), size, false));
    write('web/public/apple-touch-icon.png', png(await render(page, logo, 180), 180, false));
    // Maskable: the art's farthest point on the 40% radius safe circle.
    const maskScale = (0.4 * logo.viewBox) / artRadius;
    write('web/public/icon-maskable-512.png', png(await render(page, logo, 512, { scale: maskScale }), 512, false));
  }
}
await browser.close();
