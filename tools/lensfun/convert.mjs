#!/usr/bin/env node
// Converts the Lensfun lens database (XML) into the compact JSON RawBoy Web loads lazily.
//
//   node tools/lensfun/convert.mjs <lensfun checkout>/data/db web/public/lensfun [upstream-commit] [upstream-date]
//
// Output: index.json (cameras and lenses, for the pickers and the EXIF match) and calib-<n>.json chunks (one per upstream
// XML file) with the calibration data, fetched only for the lens in use. The database is CC BY-SA 3.0 (see
// web/public/lensfun/README.txt): this file only reformats it, it contains none of Lensfun's LGPL code.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dbDir, outDir, commit = '', date = ''] = process.argv.slice(2);
if (!dbDir || !outDir) {
  console.error('usage: convert.mjs <lensfun data/db> <output dir> [upstream commit] [upstream date]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Minimal parser for Lensfun's XML: elements, attributes, text. No namespaces, CDATA or DTD use. */
function parse(xml) {
  xml = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) {
      stack[stack.length - 1].text += unescapeXml(m[5]);
    } else if (m[1]) {
      stack.pop();
    } else {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
      const el = { name: m[2], attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root;
}

const kids = (el, name) => el.children.filter((c) => c.name === name);
const text = (el, name) => (kids(el, name)[0]?.text ?? '').trim();
/** The text of the first <name> without a lang attribute (the original), else the first. */
const plain = (el, name) => {
  const all = kids(el, name);
  return (all.find((c) => !c.attrs.lang) ?? all[0])?.text.trim() ?? '';
};
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const aspectOf = (s) => {
  if (!s) return 1.5;
  const [a, b] = s.split(':').map(Number);
  return b ? a / b : a || 1.5;
};
const TYPES = { rectilinear: 0, fisheye: 1, panoramic: 2, equirectangular: 3, orthographic: 4, stereographic: 5, equisolid: 6, 'fisheye_stereographic': 5 };

const mounts = {};
const cameras = [];
const lenses = [];
const chunks = [];
const calibs = [];
const files = readdirSync(dbDir).filter((f) => f.endsWith('.xml')).sort();
for (const file of files) {
  const doc = parse(readFileSync(join(dbDir, file), 'utf8')).children.find((c) => c.name === 'lensdatabase');
  if (!doc) continue;
  for (const mount of kids(doc, 'mount')) {
    const name = plain(mount, 'name');
    mounts[name] = [...new Set([...(mounts[name] ?? []), ...kids(mount, 'compat').map((c) => c.text.trim())])];
  }
  for (const c of kids(doc, 'camera')) {
    cameras.push([plain(c, 'maker'), plain(c, 'model'), text(c, 'variant'), text(c, 'mount'), num(text(c, 'cropfactor'), 1)]);
  }
  const chunk = {};
  const chunkIndex = chunks.length;
  for (const l of kids(doc, 'lens')) {
    const focal = kids(l, 'focal')[0]?.attrs ?? {};
    const aperture = kids(l, 'aperture')[0]?.attrs ?? {};
    const fmin = num(focal.min ?? focal.value);
    const fmax = num(focal.max ?? focal.value ?? focal.min);
    const crop = num(text(l, 'cropfactor'), 1);
    const aspect = aspectOf(text(l, 'aspect-ratio'));
    const sets = [];
    let flags = 0;
    for (const cal of kids(l, 'calibration')) {
      const dist = [];
      const tca = [];
      const vig = [];
      for (const d of kids(cal, 'distortion')) {
        const a = d.attrs;
        const model = { poly3: 0, poly5: 1, ptlens: 2 }[a.model];
        if (model === undefined) continue;
        const t = model === 0 ? [num(a.k1)] : model === 1 ? [num(a.k1), num(a.k2)] : [num(a.a), num(a.b), num(a.c)];
        dist.push([num(a.focal), num(a['real-focal']), model, ...t]);
      }
      for (const t of kids(cal, 'tca')) {
        const a = t.attrs;
        if (a.model === 'linear') tca.push([num(a.focal), 0, num(a.kr, 1), num(a.kb, 1)]);
        else if (a.model === 'poly3') tca.push([num(a.focal), 1, num(a.vr, 1), num(a.vb, 1), num(a.cr), num(a.cb), num(a.br), num(a.bb)]);
      }
      for (const v of kids(cal, 'vignetting')) {
        const a = v.attrs;
        if (a.model === 'pa') vig.push([num(a.focal), num(a.aperture), num(a.distance), num(a.k1), num(a.k2), num(a.k3)]);
      }
      if (dist.length) flags |= 1;
      if (tca.length) flags |= 2;
      if (vig.length) flags |= 4;
      if (dist.length || tca.length || vig.length) {
        sets.push([num(cal.attrs.cropfactor, crop), cal.attrs['aspect-ratio'] ? aspectOf(cal.attrs['aspect-ratio']) : aspect, dist, tca, vig]);
      }
    }
    const id = lenses.length;
    lenses.push([
      plain(l, 'maker'), plain(l, 'model'), kids(l, 'mount').map((m) => m.text.trim()), crop, aspect,
      TYPES[text(l, 'type').toLowerCase()] ?? 0, fmin, fmax, num(aperture.min ?? aperture.value), num(aperture.max ?? aperture.value ?? aperture.min), chunkIndex, flags,
    ]);
    if (sets.length) chunk[id] = sets;
  }
  chunks.push(file.replace(/\.xml$/, ''));
  calibs.push(chunk);
}

const keep = [];
calibs.forEach((chunk, i) => {
  if (Object.keys(chunk).length === 0) return;
  keep.push(i);
  writeFileSync(join(outDir, `calib-${chunks[i]}.json`), JSON.stringify(chunk));
});
const index = { format: 1, source: { commit, date }, types: Object.keys(TYPES).slice(0, 7), mounts, cameras, lenses, chunks };
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
console.log(`${cameras.length} cameras, ${lenses.length} lenses, ${keep.length} calibration chunks`);
