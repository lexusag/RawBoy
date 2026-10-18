import type { LutData } from './LutData';

/** Parses .cube and HaldCLUT .png files into [LutData], resampled to at most 64^3 (port of LutLoader.kt). */

/** 64^3 is plenty for smooth film looks and keeps the GPU texture small. */
const MAX_SIZE = 64;

/** Adobe/Resolve .cube: LUT_3D_SIZE N, then N^3 "r g b" lines with red varying fastest. */
export function parseCube(id: string, text: string): LutData {
  let size = 0;
  let values: Float32Array | null = null;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line[0] === '#') continue;
    const c = line[0];
    if ((c >= '0' && c <= '9') || c === '-' || c === '.') {
      if (!values) throw new Error('LUT data before LUT_3D_SIZE');
      const parts = line.split(/[ \t]+/).filter((p) => p.length > 0);
      if (parts.length < 3 || count + 3 > values.length) throw new Error('Malformed .cube data');
      values[count++] = parseFloat(parts[0]);
      values[count++] = parseFloat(parts[1]);
      values[count++] = parseFloat(parts[2]);
    } else if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.substring('LUT_3D_SIZE'.length).trim(), 10);
      if (!(size >= 2 && size <= 256)) throw new Error(`Unsupported LUT size ${size}`);
      values = new Float32Array(size * size * size * 3);
    } else if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D .cube LUTs are not supported');
    }
    // TITLE, DOMAIN_MIN/MAX (assumed 0..1) and other keywords are ignored.
  }
  if (!values) throw new Error('Missing LUT_3D_SIZE');
  if (count !== values.length) throw new Error(`Expected ${values.length / 3} entries, found ${count / 3}`);
  const v = values;
  return finish(id, size, (i, ch) => v[i * 3 + ch]);
}

/**
 * HaldCLUT: a square image of level^3 pixels per side holding a level^2 cube. Pixel index = r + g*N + b*N^2.
 * Decoded without colour management, so the 8-bit values are read exactly as stored.
 */
export async function parseHald(id: string, blob: Blob): Promise<LutData> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const w = bitmap.width;
  const level = Math.round(Math.cbrt(w));
  if (bitmap.height !== w || level * level * level !== w) {
    bitmap.close();
    throw new Error(`Not a HaldCLUT image (${w}x${bitmap.height})`);
  }
  const canvas = new OffscreenCanvas(w, w);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, w, w).data;
  return finish(id, level * level, (i, c) => pixels[i * 4 + c] / 255);
}

/** Sniffs the format (PNG magic) and parses. */
export async function loadLut(id: string, blob: Blob): Promise<LutData> {
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
  return isPng ? parseHald(id, blob) : parseCube(id, await blob.text());
}

/** [sample] (node index, channel) reads the source cube, red fastest. */
function finish(id: string, size: number, sample: (i: number, c: number) => number): LutData {
  const outSize = Math.min(size, MAX_SIZE);
  let out: Float32Array;
  if (outSize === size) {
    out = new Float32Array(size * size * size * 3);
    for (let i = 0; i < out.length; i++) out[i] = sample(Math.floor(i / 3), i % 3);
  } else {
    out = resample(sample, size, outSize);
  }
  return { id, size: outSize, data: out };
}

/** Trilinear resampling of a size^3 cube onto an outSize^3 grid spanning the same 0..1 domain. */
function resample(sample: (i: number, c: number) => number, size: number, outSize: number): Float32Array {
  const out = new Float32Array(outSize * outSize * outSize * 3);
  const scale = Math.fround((size - 1) / (outSize - 1));
  const idx = (r: number, g: number, b: number) => (b * size + g) * size + r;
  let o = 0;
  for (let b = 0; b < outSize; b++) {
    const fb = b * scale;
    const b0 = Math.min(Math.trunc(fb), size - 2);
    const tb = fb - b0;
    for (let g = 0; g < outSize; g++) {
      const fg = g * scale;
      const g0 = Math.min(Math.trunc(fg), size - 2);
      const tg = fg - g0;
      for (let r = 0; r < outSize; r++) {
        const fr = r * scale;
        const r0 = Math.min(Math.trunc(fr), size - 2);
        const tr = fr - r0;
        for (let c = 0; c < 3; c++) {
          const at = (dr: number, dg: number, db: number) => sample(idx(r0 + dr, g0 + dg, b0 + db), c);
          const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tr;
          const c10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tr;
          const c01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tr;
          const c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tr;
          const c0 = c00 + (c10 - c00) * tg;
          const c1 = c01 + (c11 - c01) * tg;
          out[o++] = c0 + (c1 - c0) * tb;
        }
      }
    }
  }
  return out;
}
