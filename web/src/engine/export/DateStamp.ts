/** Display order for the film data-back date stamp (`DD MM 'YY` by default) and Pentax 645 date imprint. */
export type DateStampFormat = 'DMY' | 'YMD' | 'MDY' | 'MMM_YY';

export const DATE_STAMP_FORMATS: { value: DateStampFormat; label: string }[] = [
  { value: 'DMY', label: "DD MM 'YY" },
  { value: 'YMD', label: "'YY MM DD" },
  { value: 'MDY', label: "MM DD 'YY" },
  { value: 'MMM_YY', label: 'jan 26' },
];

/** Visual style for the 35mm film data-back date stamp (`Classic` by default, or `Red LED`). */
export type DateStampStyle = 'CLASSIC' | 'RED_LED';

export const DATE_STAMP_STYLES: { value: DateStampStyle; label: string }[] = [
  { value: 'CLASSIC', label: 'Classic' },
  { value: 'RED_LED', label: 'Red LED' },
];

/** Time format for the Pentax 645 / Contax 645 shoot-info imprint (`24h` by default, or `12h (AM/PM)`). */
export type TimeStampFormat = 'H24' | 'H12';

export const TIME_STAMP_FORMATS: { value: TimeStampFormat; label: string }[] = [
  { value: 'H24', label: '24h' },
  { value: 'H12', label: '12h (AM/PM)' },
];

const LED_R = 1.0;
const LED_G = 0.42;
const LED_B = 0.035;
const BLUE_ABSORB = 0.55;
const GAIN = 3.0;
const INV_SQRT2 = 0.70710678;

const RED_LED_R = 1.0;
const RED_LED_G = 0.13;
const RED_LED_B = 0.05;
const RED_BLUE_ABSORB = 0.12;
const RED_GAIN = 4.0;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Imprints a 35mm film data-back date (`DD MM 'YY`, `'YY MM DD`, or `MM DD 'YY`) in the bottom-right corner of an
 * exported image (port of export/DateStamp.kt).
 */
export const DateStamp = {
  /** Formats [timeMs] (epoch ms) in classic film date-back order (defaults to `DD MM 'YY`, e.g. `13 11 '26`). */
  format(timeMs: number = Date.now(), format: DateStampFormat = 'DMY', utc = false): string {
    const d = new Date(timeMs);
    const year = (utc ? d.getUTCFullYear() : d.getFullYear()) % 100;
    const month = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
    const day = utc ? d.getUTCDate() : d.getDate();
    switch (format) {
      case 'YMD':
        return `'${pad2(year)} ${pad2(month)} ${pad2(day)}`;
      case 'MDY':
        return `${pad2(month)} ${pad2(day)} '${pad2(year)}`;
      case 'DMY':
      case 'MMM_YY':
      default:
        return `${pad2(day)} ${pad2(month)} '${pad2(year)}`;
    }
  },

  /**
   * Parses an EXIF date string (`YYYY:MM:DD HH:MM:SS`, or at least `YYYY:MM:DD`) into epoch milliseconds,
   * or returns `null` if [exifDate] is null/undefined or malformed.
   */
  parseExifDate(exifDate: string | null | undefined, utc = false): number | null {
    const s = exifDate?.trim();
    if (!s || s.length < 10) return null;
    if (s[4] !== ':' || s[7] !== ':') return null;
    const year = Number.parseInt(s.slice(0, 4), 10);
    const month = Number.parseInt(s.slice(5, 7), 10);
    const day = Number.parseInt(s.slice(8, 10), 10);
    if (!Number.isFinite(year) || year < 1970) return null;
    if (!Number.isFinite(month) || month < 1 || month > 12) return null;
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;
    let hour = 0;
    let minute = 0;
    let second = 0;
    if (s.length >= 16 && s[10] === ' ' && s[13] === ':') {
      const h = Number.parseInt(s.slice(11, 13), 10);
      const m = Number.parseInt(s.slice(14, 16), 10);
      hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0;
      minute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
      if (s.length >= 19 && s[16] === ':') {
        const sec = Number.parseInt(s.slice(17, 19), 10);
        second = Number.isFinite(sec) ? Math.min(59, Math.max(0, sec)) : 0;
      }
    }
    return utc
      ? Date.UTC(year, month - 1, day, hour, minute, second, 0)
      : new Date(year, month - 1, day, hour, minute, second, 0).getTime();
  },

  /**
   * Burns [text] into the 16-bit interleaved RGB [band] covering rows `[bandY, bandY + bandRows)` of an image of
   * size [width] x [height]. Bands outside the bottom-right stamp box return immediately.
   */
  imprint(
    band: Uint16Array,
    width: number,
    height: number,
    bandY: number,
    bandRows: number,
    text: string,
    monochrome = false,
    style: DateStampStyle = 'CLASSIC',
  ) {
    if (!text || width <= 0 || height <= 0 || bandRows <= 0) return;

    const redLed = style === 'RED_LED';
    const shortSide = Math.min(width, height);
    const charH = Math.max(14, shortSide * (redLed ? 0.036 : 0.028));
    const charW = charH * (redLed ? 0.6 : 0.52);
    const thick = charH * (redLed ? 0.19 : 0.115);
    const gap = charH * (redLed ? 0.26 : 0.22);
    const tickAdv = charW * 0.35;

    const count = text.length;
    const cellX = new Float32Array(count);
    const cellW = new Float32Array(count);
    const masks = new Int32Array(count);
    const isTick = new Uint8Array(count);
    let cursorX = 0;
    for (let i = 0; i < count; i++) {
      const ch = text[i];
      const adv = ch === "'" ? tickAdv : charW;
      cellX[i] = cursorX;
      cellW[i] = adv;
      isTick[i] = ch === "'" ? 1 : 0;
      masks[i] = segmentMask(ch);
      cursorX += adv + (i + 1 < count ? gap : 0);
    }
    const totalW = cursorX;

    // Real 35mm quartz date back stays fixed along the film's long side (bottom in landscape, right in portrait).
    const vertical = height > width;
    const reach = thick * (redLed ? 1.82 : 1.54);
    const slant = redLed ? 0 : 0.14;
    const slantMaxShift = charH * 0.5 * slant;

    let x0: number;
    let y0: number;
    let uEnd: number;
    let minY: number;
    let maxY: number;
    let minX: number;
    let maxX: number;
    if (!vertical) {
      x0 = width - shortSide * 0.055 - totalW;
      y0 = height - shortSide * 0.05 - charH;
      uEnd = 0;
      minY = Math.max(0, Math.trunc(y0 - reach));
      maxY = Math.min(height - 1, Math.trunc(y0 + charH + reach));
      minX = Math.max(0, Math.trunc(x0 - reach - slantMaxShift));
      maxX = Math.min(width - 1, Math.trunc(x0 + totalW + reach + slantMaxShift));
    } else {
      x0 = width - shortSide * 0.05 - charH;
      uEnd = height - shortSide * 0.055;
      y0 = uEnd - totalW;
      minY = Math.max(0, Math.trunc(y0 - reach - slantMaxShift));
      maxY = Math.min(height - 1, Math.trunc(uEnd + reach + slantMaxShift));
      minX = Math.max(0, Math.trunc(x0 - reach));
      maxX = Math.min(width - 1, Math.trunc(x0 + charH + reach));
    }
    if (bandY + bandRows <= minY || bandY > maxY) return;
    if (minX > maxX) return;

    const halfH = charH * 0.5;
    const halfThick = thick * 0.5;
    const segGap = thick * (redLed ? 0.3 : 0.22);
    const soft = redLed ? Math.max(thick * 0.385, 0.7) : Math.max(thick * 0.315, 0.56);
    const haloAmp = redLed ? 0.22 : 0.175;
    const haloInv = 1 / (thick * (redLed ? 0.77 : 0.63));
    const grainCell = Math.max(1, thick * 0.22);
    const grainBase = redLed ? 0.88 : 0.9;
    const grainAmp = redLed ? 0.24 : 0.2;
    const curLedR = redLed ? RED_LED_R : LED_R;
    const curLedG = redLed ? RED_LED_G : LED_G;
    const curLedB = redLed ? RED_LED_B : LED_B;
    const curBlueAbsorb = redLed ? RED_BLUE_ABSORB : BLUE_ABSORB;
    const curGain = redLed ? RED_GAIN : GAIN;

    const rowStart = Math.max(bandY, minY);
    const rowEnd = Math.min(bandY + bandRows - 1, maxY);
    for (let py = rowStart; py <= rowEnd; py++) {
      const rowOffset = (py - bandY) * width;
      for (let px = minX; px <= maxX; px++) {
        const vy = !vertical ? py + 0.5 - y0 : px + 0.5 - x0;
        const slantOffset = (halfH - vy) * slant;
        const ux = !vertical ? px + 0.5 - x0 - slantOffset : uEnd - (py + 0.5) - slantOffset;
        let core = 0;
        let minDist = Number.MAX_VALUE;
        for (let i = 0; i < count; i++) {
          const m = masks[i];
          const tick = isTick[i] !== 0;
          if (m === 0 && !tick) continue;
          const cx = cellX[i];
          const cw = cellW[i];
          if (ux < cx - reach || ux > cx + cw + reach) continue;
          const lx = ux - cx;
          if (tick) {
            const d = redLed
              ? distRoundVBar(lx, vy, cw * 0.5, charH * 0.21, charH * 0.17, halfThick)
              : distVBar(lx, vy, cw * 0.5, charH * 0.21, charH * 0.17, halfThick);
            if (d < minDist) minDist = d;
            const lum = redLed ? redLedBrightness(i, 7) : ledBrightness(i, 7);
            core = Math.max(core, lum * edge(d, soft));
            continue;
          }
          for (let s = 0; s < 7; s++) {
            if (((m >> s) & 1) === 0) continue;
            const d = distToDigitSegment(s, lx, vy, cw, charH, halfH, halfThick, segGap, redLed);
            if (d < minDist) minDist = d;
            let lum: number;
            if (redLed) {
              const a = segmentAlong(s, lx, vy, cw, charH, halfH, halfThick, segGap);
              lum = redLedBrightness(i, s) * (1 - 0.35 * a * a);
            } else {
              lum = ledBrightness(i, s);
            }
            core = Math.max(core, lum * edge(d, soft));
          }
        }
        const excess = Math.max(0, minDist) * haloInv;
        const halo = haloAmp * Math.exp(-excess * excess);
        if (core <= 0.002 && halo < 0.004) continue;

        const noise = redLed
          ? 0.7 * smoothNoise(px / grainCell, py / grainCell) + 0.3 * smoothNoise(px / (grainCell * 0.5), py / (grainCell * 0.5))
          : hash(Math.trunc(px / grainCell), Math.trunc(py / grainCell));
        const grain = grainBase + grainAmp * noise;
        const e = (core + halo * (1 - core)) * grain;

        let lr: number;
        let lg: number;
        let lb: number;
        let absorb: number;
        if (monochrome) {
          const l = 1 - Math.exp(-GAIN * e * 0.85);
          lr = l;
          lg = l;
          lb = l;
          absorb = 0;
        } else {
          lr = 1 - Math.exp(-curGain * e * curLedR);
          lg = 1 - Math.exp(-curGain * e * curLedG);
          lb = 1 - Math.exp(-curGain * e * curLedB);
          absorb = curBlueAbsorb;
        }

        const idx = (rowOffset + px) * 3;
        const r = band[idx] / 65535;
        const g = band[idx + 1] / 65535;
        const b = band[idx + 2] / 65535;
        band[idx] = toU16(1 - (1 - r) * (1 - lr));
        band[idx + 1] = toU16(1 - (1 - g) * (1 - lg));
        band[idx + 2] = toU16((1 - (1 - b) * (1 - lb)) * (1 - absorb * lr));
      }
    }
  },
};

function edge(d: number, soft: number): number {
  const t = Math.min(1, Math.max(0, (soft * 0.5 - d) / soft));
  return t * t * (3 - 2 * t);
}

function ledBrightness(char: number, segment: number): number {
  return 0.9 + 0.1 * hash(char * 8 + segment, 911);
}

function redLedBrightness(char: number, segment: number): number {
  return 0.78 + 0.22 * hash(char * 8 + segment, 911);
}

function segmentAlong(s: number, x: number, y: number, w: number, h: number, halfH: number, ht: number, segGap: number): number {
  const hx = w * 0.5 - segGap * 1.4;
  const hy = (halfH - ht) * 0.5 - segGap;
  let a: number;
  if (s === 0 || s === 3 || s === 6) {
    a = Math.abs(x - w * 0.5) / hx;
  } else if (s === 1 || s === 5) {
    a = Math.abs(y - (ht + halfH) * 0.5) / hy;
  } else {
    a = Math.abs(y - (halfH + h - ht) * 0.5) / hy;
  }
  return Math.min(1, Math.max(0, a));
}

function segmentMask(ch: string): number {
  switch (ch) {
    case '0': return 0x3f;
    case '1': return 0x06;
    case '2': return 0x5b;
    case '3': return 0x4f;
    case '4': return 0x66;
    case '5': return 0x6d;
    case '6': return 0x7d;
    case '7': return 0x07;
    case '8': return 0x7f;
    case '9': return 0x6f;
    case '-': return 0x40;
    default: return 0;
  }
}

function distToDigitSegment(
  s: number,
  x: number,
  y: number,
  w: number,
  h: number,
  halfH: number,
  ht: number,
  segGap: number,
  rounded = false,
): number {
  const hx = w * 0.5 - (rounded ? segGap * 1.4 : segGap);
  const hy = (halfH - ht) * 0.5 - segGap;
  if (rounded) {
    switch (s) {
      case 0: return distRoundHBar(x, y, w * 0.5, ht, hx, ht);
      case 1: return distRoundVBar(x, y, w - ht, (ht + halfH) * 0.5, hy, ht);
      case 2: return distRoundVBar(x, y, w - ht, (halfH + h - ht) * 0.5, hy, ht);
      case 3: return distRoundHBar(x, y, w * 0.5, h - ht, hx, ht);
      case 4: return distRoundVBar(x, y, ht, (halfH + h - ht) * 0.5, hy, ht);
      case 5: return distRoundVBar(x, y, ht, (ht + halfH) * 0.5, hy, ht);
      default: return distRoundHBar(x, y, w * 0.5, halfH, hx, ht);
    }
  }
  switch (s) {
    case 0: return distHBar(x, y, w * 0.5, ht, hx, ht);
    case 1: return distVBar(x, y, w - ht, (ht + halfH) * 0.5, hy, ht);
    case 2: return distVBar(x, y, w - ht, (halfH + h - ht) * 0.5, hy, ht);
    case 3: return distHBar(x, y, w * 0.5, h - ht, hx, ht);
    case 4: return distVBar(x, y, ht, (halfH + h - ht) * 0.5, hy, ht);
    case 5: return distVBar(x, y, ht, (ht + halfH) * 0.5, hy, ht);
    default: return distHBar(x, y, w * 0.5, halfH, hx, ht);
  }
}

function distHBar(x: number, y: number, cx: number, cy: number, hx: number, ht: number): number {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  return Math.max(dy - ht, (dx + dy - hx) * INV_SQRT2);
}

function distVBar(x: number, y: number, cx: number, cy: number, hy: number, ht: number): number {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  return Math.max(dx - ht, (dx + dy - hy) * INV_SQRT2);
}

function distRoundHBar(x: number, y: number, cx: number, cy: number, hx: number, ht: number): number {
  const dx = Math.max(0, Math.abs(x - cx) - Math.max(0, hx - ht));
  const dy = Math.abs(y - cy);
  return Math.hypot(dx, dy) - ht;
}

function distRoundVBar(x: number, y: number, cx: number, cy: number, hy: number, ht: number): number {
  const dx = Math.abs(x - cx);
  const dy = Math.max(0, Math.abs(y - cy) - Math.max(0, hy - ht));
  return Math.hypot(dx, dy) - ht;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

/** Deterministic 0..1 hash of an integer pair (matches the Kotlin and Swift versions bit for bit). */
export function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0xffffff) / 16777215;
}

function toU16(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 65535);
}
