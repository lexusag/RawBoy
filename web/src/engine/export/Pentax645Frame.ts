import { type DateStampFormat, type TimeStampFormat, hash } from './DateStamp';

/** Mutually exclusive film frame / stamp imprint options. */
export type PhotoFrame = 'NONE' | 'DATE_STAMP' | 'PENTAX_645' | 'CONTAX_645';

export const PHOTO_FRAMES: { value: PhotoFrame; label: string }[] = [
  { value: 'NONE', label: 'Off' },
  { value: 'DATE_STAMP', label: 'Date stamp' },
  { value: 'PENTAX_645', label: 'Pentax 645' },
  { value: 'CONTAX_645', label: 'Contax 645' },
];

/** Individual shoot-info items that can be toggled and reordered on the Pentax 645 / Contax 645 rebate. */
export type Pentax645Field = 'frame' | 'mode' | 'shutter' | 'aperture' | 'ev' | 'metering' | 'focal' | 'iso' | 'date' | 'time';

export const PENTAX645_FIELD_LABELS: Record<Pentax645Field, string> = {
  frame: 'Frame #',
  mode: 'Mode',
  shutter: 'Shutter',
  aperture: 'Aperture',
  ev: 'EV',
  metering: 'Metering',
  focal: 'Focal length',
  iso: 'ISO',
  date: 'Date',
  time: 'Time',
};

/** Shoot-info fields available from photo EXIF in RawBoy Pro and Auto (excludes camera-only mode/EV/metering). */
export const EXPORT_PENTAX645_FIELDS: Pentax645Field[] = ['frame', 'shutter', 'aperture', 'focal', 'iso', 'date', 'time'];

export function parseExportFields(raw: unknown): Pentax645Field[] {
  if (!Array.isArray(raw)) return [...EXPORT_PENTAX645_FIELDS];
  const valid = new Set<string>(EXPORT_PENTAX645_FIELDS);
  return raw.filter((v): v is Pentax645Field => typeof v === 'string' && valid.has(v));
}

export function parseExportOrder(raw: unknown): Pentax645Field[] {
  if (!Array.isArray(raw)) return [...EXPORT_PENTAX645_FIELDS];
  const valid = new Set<string>(EXPORT_PENTAX645_FIELDS);
  const result: Pentax645Field[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && valid.has(v) && !result.includes(v as Pentax645Field)) {
      result.push(v as Pentax645Field);
    }
  }
  for (const f of EXPORT_PENTAX645_FIELDS) {
    if (!result.includes(f)) result.push(f);
  }
  return result;
}

/** LED imprint color for film rebate frames (`Pentax 645` and `Contax 645`). */
export type FilmFrameColor = 'AMBER' | 'SLIDE' | 'RED' | 'GREEN';

export const FILM_FRAME_COLORS: { value: FilmFrameColor; label: string }[] = [
  { value: 'AMBER', label: 'Amber' },
  { value: 'SLIDE', label: 'Slide' },
  { value: 'RED', label: 'Red' },
  { value: 'GREEN', label: 'Green' },
];

/** Film rebate frame layout style. */
export type FilmFrameStyle = 'PENTAX_645' | 'CONTAX_645';

/** Shoot metadata imprinted into the film rebate of a Pentax 645 or Contax 645-style frame. */
export interface Pentax645Info {
  frameNumber?: number | null;
  mode?: string | null;
  exposureTime?: number | null;
  fNumber?: number | null;
  compensationEv?: number | null;
  spotMetered?: boolean | null;
  focalLengthMm?: number | null;
  iso?: number | null;
  date?: string | null;
  time?: string | null;
  dateTime?: string | null;
  flipped?: boolean;
  fieldOrder?: string[] | null;
  color?: FilmFrameColor;
  style?: FilmFrameStyle;
}

export interface Pentax645Layout {
  photoWidth: number;
  photoHeight: number;
  border: number;
  infoBar: number;
  style: FilmFrameStyle;
  infoOnLeft: boolean;
  topPad: number;
  bottomPad: number;
  leftPad: number;
  rightPad: number;
  outWidth: number;
  outHeight: number;
  topBar: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DEFAULT_FIELD_ORDER = ['frame', 'mode', 'shutter', 'aperture', 'ev', 'metering', 'focal', 'iso', 'date', 'time', 'datetime'];

const GAIN = 3.0;
const BASE_R = 0.011;
const BASE_G = 0.010;
const BASE_B = 0.009;
const BASE_MONO = 0.010;
const LED_MONO = 0.85;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function trimOneDecimal(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function ledRgb(color: FilmFrameColor): [number, number, number] {
  switch (color) {
    case 'SLIDE': return [0.76, 0.90, 0.14];
    case 'RED': return [1.0, 0.13, 0.05];
    case 'GREEN': return [0.08, 0.95, 0.08];
    case 'AMBER':
    default: return [1.0, 0.44, 0.04];
  }
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'metering'; spot: boolean };

function charCols(ch: string): number {
  return ch === '.' || ch === ':' || ch === "'" || ch === ' ' ? 3 : 5;
}

interface StampDots {
  u0: number;
  v0: number;
  totalU: number;
  charH: number;
  dotR: number;
  soft: number;
  reach: number;
  haloInv: number;
  flipped: boolean;
  dotU: Float32Array;
  dotV: Float32Array;
  dotBright: Float32Array;
}

interface ContaxCounterStamp {
  u0: number;
  v0: number;
  totalU: number;
  charH: number;
  charW: number;
  ht: number;
  charGap: number;
  triLen: number;
  triHalfBase: number;
  triCornerR: number;
  triGap: number;
  soft: number;
  reach: number;
  haloInv: number;
  flipped: boolean;
  text: string;
}

/**
 * Renders a Pentax 645N or Contax 645-style film rebate around an exported photo (port of export/Pentax645Frame.kt).
 */
export const Pentax645Frame = {
  layout(photoWidth: number, photoHeight: number, style: FilmFrameStyle = 'PENTAX_645'): Pentax645Layout {
    const shortSide = Math.min(photoWidth, photoHeight);
    const border = style === 'CONTAX_645'
      ? Math.max(6, Math.round(shortSide * 0.012))
      : Math.max(3, Math.round(shortSide * 0.005));
    const infoBar = Math.max(28, Math.round(shortSide * 0.036));
    const infoOnLeft = photoWidth > photoHeight;
    const topPad = style === 'CONTAX_645' && !infoOnLeft ? infoBar : border;
    const bottomPad = style === 'CONTAX_645' && !infoOnLeft ? infoBar : border;
    const leftPad = style === 'CONTAX_645' && infoOnLeft ? infoBar : border;
    const rightPad = style === 'CONTAX_645' && infoOnLeft ? infoBar : border;
    return {
      photoWidth,
      photoHeight,
      border,
      infoBar,
      style,
      infoOnLeft,
      topPad,
      bottomPad,
      leftPad,
      rightPad,
      outWidth: photoWidth + leftPad + rightPad,
      outHeight: photoHeight + topPad + bottomPad,
      topBar: infoBar,
    };
  },

  formatFrameNumber(frameNumber: number): string {
    return frameNumber > 0 ? `#${frameNumber}` : '#--';
  },

  formatContaxFrameNumber(frameNumber: number): string {
    return frameNumber > 0 ? `${frameNumber}` : '--';
  },

  formatShutter(t: number): string {
    if (!Number.isFinite(t) || t <= 0) return '---';
    const n = Math.round(1.0 / t);
    return t >= 0.95 || n < 2 ? `${trimOneDecimal(t)}s` : `1/${n}`;
  },

  formatContaxShutter(t: number): string {
    return Pentax645Frame.formatShutter(t);
  },

  formatAperture(f: number): string {
    if (!Number.isFinite(f) || f <= 0) return 'F--';
    const rounded = Math.round(f);
    return Math.abs(f - rounded) < 0.05 && rounded < 10 ? `F ${rounded}` : `F${trimOneDecimal(f)}`;
  },

  formatContaxAperture(f: number): string {
    if (!Number.isFinite(f) || f <= 0) return 'F--';
    return `F ${trimOneDecimal(f)}`;
  },

  formatEv(ev: number): string {
    if (!Number.isFinite(ev) || Math.abs(ev) < 0.05) return '±0.0EV';
    const sign = ev > 0 ? '+' : '-';
    return `${sign}${Math.abs(ev).toFixed(1)}EV`;
  },

  formatFocalLength(mm: number): string {
    if (!Number.isFinite(mm) || mm <= 0) return '--mm';
    return `${Math.round(mm)}mm`;
  },

  formatIso(iso: number): string {
    if (!Number.isFinite(iso) || iso <= 0) return 'ISO---';
    return `ISO${Math.round(iso)}`;
  },

  formatDate(timeMs: number = Date.now(), format: DateStampFormat = 'DMY', utc = false): string {
    const d = new Date(timeMs);
    const year = (utc ? d.getUTCFullYear() : d.getFullYear()) % 100;
    const month = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
    const day = utc ? d.getUTCDate() : d.getDate();
    switch (format) {
      case 'YMD':
        return `${pad2(year)}.${pad2(month)}.${pad2(day)}`;
      case 'MDY':
        return `${pad2(month)}.${pad2(day)}.${pad2(year)}`;
      case 'MMM_YY':
        return `${MONTHS[Math.min(11, Math.max(0, month - 1))]} ${pad2(year)}`;
      case 'DMY':
      default:
        return `${pad2(day)}.${pad2(month)}.${pad2(year)}`;
    }
  },

  formatTime(timeMs: number = Date.now(), format: TimeStampFormat = 'H24', utc = false): string {
    const d = new Date(timeMs);
    const hour = utc ? d.getUTCHours() : d.getHours();
    const minute = utc ? d.getUTCMinutes() : d.getMinutes();
    if (format === 'H12') {
      const h12 = hour % 12 === 0 ? 12 : hour % 12;
      const ampm = hour < 12 ? 'AM' : 'PM';
      return `${h12}:${pad2(minute)}${ampm}`;
    }
    return `${pad2(hour)}:${pad2(minute)}`;
  },

  formatDateTime(
    timeMs: number = Date.now(),
    format: DateStampFormat = 'DMY',
    timeFormat: TimeStampFormat = 'H24',
    utc = false,
  ): string {
    return `${Pentax645Frame.formatDate(timeMs, format, utc)} ${Pentax645Frame.formatTime(timeMs, timeFormat, utc)}`;
  },

  renderTopBarBand(
    band: Uint16Array,
    layout: Pentax645Layout,
    bandY: number,
    bandRows: number,
    info: Pentax645Info,
    monochrome = false,
  ) {
    if (layout.style === 'CONTAX_645' && !layout.infoOnLeft) {
      const outW = layout.outWidth;
      const grainCell = Math.max(1, layout.infoBar * 0.03);
      const dots = buildStampDots(layout, info);
      const color = info.color ?? 'AMBER';
      for (let py = bandY; py < bandY + bandRows; py++) {
        const rowOffset = (py - bandY) * outW;
        for (let px = 0; px < outW; px++) {
          const idx = (rowOffset + px) * 3;
          sampleRebatePixel(px, py, px + 0.5, py + 0.5, dots, grainCell, monochrome, color, band, idx);
        }
      }
    } else {
      Pentax645Frame.renderBorderBand(band, layout, bandY, bandRows, monochrome, info);
    }
  },

  renderBorderBand(
    band: Uint16Array,
    layout: Pentax645Layout,
    bandY: number,
    bandRows: number,
    monochrome = false,
    info?: Pentax645Info | null,
  ) {
    const outW = layout.outWidth;
    const grainCell = Math.max(1, layout.infoBar * 0.03);
    const bottomStart = layout.topPad + layout.photoHeight;
    const isContaxBottom = layout.style === 'CONTAX_645' && !layout.infoOnLeft && bandY >= bottomStart;
    const counter = isContaxBottom && info ? buildContaxCounter(layout, info) : null;
    const color = info?.color ?? 'AMBER';
    for (let py = bandY; py < bandY + bandRows; py++) {
      const rowOffset = (py - bandY) * outW;
      const v = isContaxBottom ? py - bottomStart + 0.5 : 0;
      for (let px = 0; px < outW; px++) {
        const idx = (rowOffset + px) * 3;
        sampleRebatePixel(px, py, px + 0.5, v, null, grainCell, monochrome, color, band, idx, counter);
      }
    }
  },

  wrapPhotoBand(
    src: Uint16Array,
    dst: Uint16Array,
    layout: Pentax645Layout,
    photoY: number,
    bandRows: number,
    monochrome = false,
    info?: Pentax645Info | null,
  ) {
    const pw = layout.photoWidth;
    const ph = layout.photoHeight;
    const ow = layout.outWidth;
    const oh = layout.outHeight;
    const leftPad = layout.leftPad;
    const onLeft = layout.infoOnLeft;
    const infoBar = layout.infoBar;
    const grainCell = Math.max(1, infoBar * 0.03);
    const color = info?.color ?? 'AMBER';
    const isPentax = layout.style === 'PENTAX_645';
    const isContaxVertical = !isPentax && onLeft;
    const dots = (isPentax || isContaxVertical) && info ? buildStampDots(layout, info) : null;
    const contaxRightCounter = isContaxVertical && info ? buildContaxCounter(layout, info) : null;
    const softEdge = Math.max(1.12, infoBar * 0.0385);
    const tmp = new Uint16Array(3);

    for (let r = 0; r < bandRows; r++) {
      const y = photoY + r;
      const py = layout.topPad + y;
      const dstRow = r * ow;
      for (let px = 0; px < leftPad; px++) {
        const u = isContaxVertical ? oh - 1 - py + 0.5 : 0;
        const v = isContaxVertical ? px + 0.5 : 0;
        sampleRebatePixel(px, py, u, v, isContaxVertical ? dots : null, grainCell, monochrome, color, dst, (dstRow + px) * 3);
      }
      dst.set(src.subarray(r * pw * 3, (r + 1) * pw * 3), (dstRow + leftPad) * 3);
      for (let px = leftPad + pw; px < ow; px++) {
        const u = isContaxVertical ? oh - 1 - py + 0.5 : 0;
        const v = isContaxVertical ? px - (leftPad + pw) + 0.5 : 0;
        sampleRebatePixel(px, py, u, v, null, grainCell, monochrome, color, dst, (dstRow + px) * 3, contaxRightCounter);
      }

      if (!isPentax) {
        const gateInset = Math.max(2, infoBar * 0.11);
        const sideInset = Math.max(1.2, infoBar * 0.045);
        const cornerR = Math.max(2, infoBar * 0.10);
        const yc = y + 0.5;
        const isTop = yc < ph * 0.5;
        const yFromEdge = isTop ? yc : ph - yc;
        const horizDepthLimit = isContaxVertical ? sideInset : gateInset;
        const vertDepthLimit = isContaxVertical ? gateInset : sideInset;
        const nearHorizEdge = yFromEdge < horizDepthLimit * 1.8 + softEdge + cornerR;
        const sideSpan = Math.min(Math.trunc(pw / 2), Math.trunc(vertDepthLimit * 2.2 + softEdge + cornerR) + 1);

        const contaxEdgeMask = (x: number): number => {
          const xc = x + 0.5;
          const isLeft = xc < pw * 0.5;
          const xFromEdge = isLeft ? xc : pw - xc;
          const cornerSeed = (isTop ? 0 : 2) + (isLeft ? 0 : 1);

          let mask = 0;
          if (nearHorizEdge) {
            if (!isContaxVertical) {
              const cutoutEnd = infoBar * (1.15 + 0.35 * hash(cornerSeed, 101));
              const ramp = infoBar * (0.28 + 0.12 * hash(cornerSeed, 202));
              const t = Math.min(1, Math.max(0, (xFromEdge - cutoutEnd) / ramp));
              const cutoutDepth = sideInset * (0.85 + 0.25 * gateImperfection(xc, infoBar, cornerSeed * 17 + 11));
              const baseDepth = cutoutDepth + (gateInset - cutoutDepth) * t * t * (3 - 2 * t);
              const wobble = gateImperfection(xc, infoBar, cornerSeed * 17 + 7) * gateInset * 0.22 * t;
              const edgeDepth = Math.max(0, baseDepth + wobble);
              mask = Math.max(mask, gateMask(yFromEdge - edgeDepth, softEdge));
            } else {
              const horizSeed = isTop ? 31 : 53;
              const horizDepth = Math.max(0, sideInset * (0.85 + 0.25 * gateImperfection(xc, infoBar, horizSeed)));
              mask = Math.max(mask, gateMask(yFromEdge - horizDepth, softEdge));
            }
          }

          if (xFromEdge < sideSpan) {
            if (isContaxVertical) {
              const cutoutEnd = infoBar * (1.15 + 0.35 * hash(cornerSeed, 101));
              const ramp = infoBar * (0.28 + 0.12 * hash(cornerSeed, 202));
              const t = Math.min(1, Math.max(0, (yFromEdge - cutoutEnd) / ramp));
              const cutoutDepth = sideInset * (0.85 + 0.25 * gateImperfection(yc, infoBar, cornerSeed * 17 + 11));
              const baseDepth = cutoutDepth + (gateInset - cutoutDepth) * t * t * (3 - 2 * t);
              const wobble = gateImperfection(yc, infoBar, cornerSeed * 17 + 7) * gateInset * 0.22 * t;
              const edgeDepth = Math.max(0, baseDepth + wobble);
              mask = Math.max(mask, gateMask(xFromEdge - edgeDepth, softEdge));
            } else {
              const sideSeed = isLeft ? 31 : 53;
              const sideDepth = Math.max(0, sideInset * (0.85 + 0.25 * gateImperfection(yc, infoBar, sideSeed)));
              mask = Math.max(mask, gateMask(xFromEdge - sideDepth, softEdge));
            }

            if (yFromEdge < cornerR && xFromEdge < cornerR) {
              const dx = cornerR - xFromEdge;
              const dy = cornerR - yFromEdge;
              const cornerDist = cornerR - Math.hypot(dx, dy);
              mask = Math.max(mask, gateMask(cornerDist, softEdge));
            }
          }
          return mask;
        };

        if (nearHorizEdge) {
          for (let x = 0; x < pw; x++) {
            const mask = contaxEdgeMask(x);
            if (mask <= 0.001) continue;
            const px = leftPad + x;
            const idx = (dstRow + px) * 3;
            sampleRebatePixel(px, py, 0, 0, null, grainCell, monochrome, color, tmp, 0);
            blendPixel(dst, idx, tmp, mask);
          }
        } else {
          for (let x = 0; x < sideSpan; x++) {
            const mask = contaxEdgeMask(x);
            if (mask > 0.001) {
              const px = leftPad + x;
              const idx = (dstRow + px) * 3;
              sampleRebatePixel(px, py, 0, 0, null, grainCell, monochrome, color, tmp, 0);
              blendPixel(dst, idx, tmp, mask);
            }
          }
          for (let x = Math.max(sideSpan, pw - sideSpan); x < pw; x++) {
            const mask = contaxEdgeMask(x);
            if (mask > 0.001) {
              const px = leftPad + x;
              const idx = (dstRow + px) * 3;
              sampleRebatePixel(px, py, 0, 0, null, grainCell, monochrome, color, tmp, 0);
              blendPixel(dst, idx, tmp, mask);
            }
          }
        }
        continue;
      }

      if (!onLeft) {
        if (y >= layout.infoBar + Math.trunc(softEdge) + 2) continue;
        const yc = y + 0.5;
        for (let x = 0; x < pw; x++) {
          const xc = x + 0.5;
          const distFromEnd = Math.min(xc, pw - xc);
          const d = pentaxMonobrowDist(distFromEnd, yc, infoBar);
          const mask = gateMask(d, softEdge);
          if (mask <= 0.001) continue;
          const px = leftPad + x;
          const idx = (dstRow + px) * 3;
          sampleRebatePixel(px, py, px + 0.5, py + 0.5, dots, grainCell, monochrome, color, tmp, 0);
          blendPixel(dst, idx, tmp, mask);
        }
      } else {
        const yc = y + 0.5;
        const distFromEnd = Math.min(yc, ph - yc);
        const xMax = Math.min(pw, Math.trunc(infoBar + softEdge + 2));
        for (let x = 0; x < xMax; x++) {
          const d = pentaxMonobrowDist(distFromEnd, x + 0.5, infoBar);
          const mask = gateMask(d, softEdge);
          if (mask <= 0.001) continue;
          const px = leftPad + x;
          const idx = (dstRow + px) * 3;
          sampleRebatePixel(px, py, oh - 1 - py + 0.5, px + 0.5, dots, grainCell, monochrome, color, tmp, 0);
          blendPixel(dst, idx, tmp, mask);
        }
      }
    }
  },
};

function buildStampDots(layout: Pentax645Layout, info: Pentax645Info): StampDots {
  const barLength = layout.infoOnLeft ? layout.outHeight : layout.outWidth;
  const photoShortSide = Math.min(layout.photoWidth, layout.photoHeight);
  const infoBar = layout.infoBar;
  const isContax = info.style === 'CONTAX_645';

  const rawOrder = info.fieldOrder && info.fieldOrder.length > 0 ? info.fieldOrder : DEFAULT_FIELD_ORDER;
  const order = [...rawOrder, ...DEFAULT_FIELD_ORDER.filter((k) => !rawOrder.includes(k))];
  const tokens: Token[] = [];
  for (const key of order) {
    switch (key) {
      case 'frame':
        if (!isContax && info.frameNumber != null) tokens.push({ kind: 'text', value: Pentax645Frame.formatFrameNumber(info.frameNumber) });
        break;
      case 'mode':
        if (info.mode) tokens.push({ kind: 'text', value: info.mode });
        break;
      case 'shutter':
        if (info.exposureTime != null) {
          tokens.push({
            kind: 'text',
            value: isContax ? Pentax645Frame.formatContaxShutter(info.exposureTime) : Pentax645Frame.formatShutter(info.exposureTime),
          });
        }
        break;
      case 'aperture':
        if (info.fNumber != null) {
          tokens.push({
            kind: 'text',
            value: isContax ? Pentax645Frame.formatContaxAperture(info.fNumber) : Pentax645Frame.formatAperture(info.fNumber),
          });
        }
        break;
      case 'ev':
        if (info.compensationEv != null) tokens.push({ kind: 'text', value: Pentax645Frame.formatEv(info.compensationEv) });
        break;
      case 'metering':
        if (info.spotMetered != null) tokens.push({ kind: 'metering', spot: info.spotMetered });
        break;
      case 'focal':
        if (info.focalLengthMm != null) tokens.push({ kind: 'text', value: Pentax645Frame.formatFocalLength(info.focalLengthMm) });
        break;
      case 'iso':
        if (info.iso != null) tokens.push({ kind: 'text', value: Pentax645Frame.formatIso(info.iso) });
        break;
      case 'date':
        if (info.date) tokens.push({ kind: 'text', value: info.date });
        break;
      case 'time':
        if (info.time) tokens.push({ kind: 'text', value: info.time });
        break;
      case 'datetime':
        if (info.dateTime) tokens.push({ kind: 'text', value: info.dateTime });
        break;
    }
  }

  const vTop = isContax ? 0 : layout.border;
  return buildDotsFromTokens(tokens, barLength, photoShortSide, infoBar, vTop, info.flipped ?? false);
}

function buildContaxCounter(layout: Pentax645Layout, info: Pentax645Info): ContaxCounterStamp | null {
  if (info.frameNumber == null) return null;
  const text = Pentax645Frame.formatContaxFrameNumber(info.frameNumber);
  const barLength = layout.infoOnLeft ? layout.outHeight : layout.outWidth;
  const infoBar = layout.infoBar;
  const charH = infoBar * 0.54;
  const charW = charH * 0.65;
  const ht = charH * 0.088;
  const charGap = charH * 0.22;
  const triLen = charH * 1.55;
  const triHalfBase = charH * 0.45;
  const triCornerR = charH * 0.035;
  const triGap = charH * 0.42;
  const digitsW = text.length === 0 ? 0 : text.length * charW + (text.length - 1) * charGap;
  const totalU = triLen + triGap + digitsW;
  const u0 = (barLength - totalU) * 0.5;
  const v0 = (infoBar - charH) * 0.5;
  const soft = Math.max(0.56, charH * 0.032);
  const reach = charH * 0.22;
  const haloInv = 1 / Math.max(0.8, charH * 0.07);
  return {
    u0,
    v0,
    totalU,
    charH,
    charW,
    ht,
    charGap,
    triLen,
    triHalfBase,
    triCornerR,
    triGap,
    soft,
    reach,
    haloInv,
    flipped: info.flipped ?? false,
    text,
  };
}

function buildDotsFromTokens(
  tokens: Token[],
  barLength: number,
  photoShortSide: number,
  infoBar: number,
  vTop: number,
  flipped: boolean,
  maxGroupGapMul = 14,
): StampDots {
  let charH = infoBar * 0.56;
  let dotPitch = charH / 7;
  let charGap = dotPitch * 1.15;
  let minGroupGap = dotPitch * 5.0;

  const tokenWidth = (t: Token): number => {
    if (t.kind === 'text') {
      const s = t.value;
      if (!s) return 0;
      let cols = 0;
      for (const ch of s) cols += charCols(ch);
      return cols * dotPitch + (s.length - 1) * charGap;
    }
    return 7 * dotPitch;
  };

  let sumTokensW = tokens.reduce((acc, t) => acc + tokenWidth(t), 0);
  const maxContentW = Math.max(photoShortSide * 0.72, photoShortSide - 3.6 * infoBar);
  const minTotalW = tokens.length === 0 ? 0 : sumTokensW + (tokens.length - 1) * minGroupGap;
  if (minTotalW > maxContentW && minTotalW > 0) {
    const scale = maxContentW / minTotalW;
    charH *= scale;
    dotPitch *= scale;
    charGap *= scale;
    minGroupGap *= scale;
    sumTokensW = tokens.reduce((acc, t) => acc + tokenWidth(t), 0);
  }

  let groupGap: number;
  if (tokens.length <= 1) {
    groupGap = 0;
  } else {
    const targetSpan = Math.min(photoShortSide * 0.80, maxContentW);
    const idealGap = (targetSpan - sumTokensW) / (tokens.length - 1);
    const maxGap = dotPitch * maxGroupGapMul;
    groupGap = Math.min(maxGap, Math.max(Math.min(minGroupGap, maxGap), idealGap));
  }

  const totalU = tokens.length === 0 ? 0 : sumTokensW + (tokens.length - 1) * groupGap;
  const u0 = (barLength - totalU) * 0.5;
  const v0 = vTop + (infoBar - charH) * 0.5;

  const dotR = dotPitch * 0.36;
  const soft = Math.max(dotPitch * 0.252, 0.56);
  const reach = dotPitch * 1.26;
  const haloInv = 1 / (dotPitch * 0.595);

  const uList: number[] = [];
  const vList: number[] = [];
  const bList: number[] = [];
  let cursorU = 0;
  let glyphIdx = 0;
  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];
    if (token.kind === 'text') {
      const s = token.value;
      for (let ci = 0; ci < s.length; ci++) {
        const ch = s[ci];
        const cols = charCols(ch);
        const rows = GLYPH_5X7[ch];
        if (rows) {
          const colShift = Math.trunc((5 - cols) / 2);
          for (let r = 0; r < 7; r++) {
            const bits = rows[r];
            for (let c = 0; c < cols; c++) {
              const srcCol = c + colShift;
              if (srcCol >= 0 && srcCol <= 4 && ((bits >> (4 - srcCol)) & 1) !== 0) {
                uList.push(cursorU + (c + 0.5) * dotPitch);
                vList.push((r + 0.5) * dotPitch);
                bList.push(0.90 + 0.10 * hash(glyphIdx * 64 + r * 8 + c, 733));
              }
            }
          }
        }
        cursorU += cols * dotPitch + (ci + 1 < s.length ? charGap : 0);
        glyphIdx++;
      }
    } else {
      const rows = token.spot ? SPOT_METER_7X7 : AUTO_METER_7X7;
      for (let r = 0; r < 7; r++) {
        const bits = rows[r];
        for (let c = 0; c < 7; c++) {
          if (((bits >> (6 - c)) & 1) !== 0) {
            uList.push(cursorU + (c + 0.5) * dotPitch);
            vList.push((r + 0.5) * dotPitch);
            bList.push(0.92 + 0.08 * hash(glyphIdx * 64 + r * 8 + c, 733));
          }
        }
      }
      cursorU += 7 * dotPitch;
      glyphIdx++;
    }
    if (ti + 1 < tokens.length) cursorU += groupGap;
  }

  return {
    u0,
    v0,
    totalU,
    charH,
    dotR,
    soft,
    reach,
    haloInv,
    flipped,
    dotU: new Float32Array(uList),
    dotV: new Float32Array(vList),
    dotBright: new Float32Array(bList),
  };
}

function sampleRebatePixel(
  px: number,
  py: number,
  u: number,
  v: number,
  dots: StampDots | null,
  grainCell: number,
  monochrome: boolean,
  color: FilmFrameColor,
  out: Uint16Array,
  idx: number,
  counter: ContaxCounterStamp | null = null,
) {
  const grain = 0.90 + 0.20 * hash(Math.trunc(px / grainCell), Math.trunc(py / grainCell));
  let r = (monochrome ? BASE_MONO : BASE_R) * grain;
  let g = (monochrome ? BASE_MONO : BASE_G) * grain;
  let b = (monochrome ? BASE_MONO : BASE_B) * grain;

  if (dots && dots.dotU.length > 0) {
    const rawLu = u - dots.u0;
    const rawLv = v - dots.v0;
    const lu = dots.flipped ? dots.totalU - rawLu : rawLu;
    const lv = dots.flipped ? dots.charH - rawLv : rawLv;
    const reach = dots.reach;
    if (lu >= -reach && lu <= dots.totalU + reach && lv >= -reach && lv <= dots.charH + reach) {
      let core = 0;
      let minDist = Number.MAX_VALUE;
      const { dotU, dotV, dotBright, dotR, soft } = dots;
      for (let k = 0; k < dotU.length; k++) {
        const du = Math.abs(lu - dotU[k]);
        if (du > reach) continue;
        const dv = Math.abs(lv - dotV[k]);
        if (dv > reach) continue;
        const d = Math.hypot(du, dv) - dotR;
        if (d < minDist) minDist = d;
        if (d < soft * 0.5) {
          const e = dotBright[k] * edge(d, soft);
          if (e > core) core = e;
        }
      }
      const excess = Math.max(0, minDist) * dots.haloInv;
      const halo = 0.16 * Math.exp(-excess * excess);
      if (core > 0.002 || halo >= 0.004) {
        const e = (core + halo * (1 - core)) * grain;
        if (monochrome) {
          const l = 1 - Math.exp(-GAIN * e * LED_MONO);
          r = 1 - (1 - r) * (1 - l);
          g = 1 - (1 - g) * (1 - l);
          b = 1 - (1 - b) * (1 - l);
        } else {
          const [ledR, ledG, ledB] = ledRgb(color);
          const lr = 1 - Math.exp(-GAIN * e * ledR);
          const lg = 1 - Math.exp(-GAIN * e * ledG);
          const lb = 1 - Math.exp(-GAIN * e * ledB);
          r = 1 - (1 - r) * (1 - lr);
          g = 1 - (1 - g) * (1 - lg);
          b = 1 - (1 - b) * (1 - lb);
        }
      }
    }
  } else if (counter) {
    const rawLu = u - counter.u0;
    const rawLv = v - counter.v0;
    const lu = counter.flipped ? counter.totalU - rawLu : rawLu;
    const lv = counter.flipped ? counter.charH - rawLv : rawLv;
    const reach = counter.reach;
    if (lu >= -reach && lu <= counter.totalU + reach && lv >= -reach && lv <= counter.charH + reach) {
      let d = sdContaxTriangle(lu, lv, counter.triLen, counter.triHalfBase, counter.charH * 0.5, counter.triCornerR);
      const digitsStart = counter.triLen + counter.triGap;
      const step = counter.charW + counter.charGap;
      for (let i = 0; i < counter.text.length; i++) {
        const du = lu - (digitsStart + i * step);
        if (du >= -reach && du <= counter.charW + reach) {
          const dd = sdContaxDigit(counter.text[i], du, lv, counter.charW, counter.charH, counter.ht);
          if (dd < d) d = dd;
        }
      }
      const core = edge(d, counter.soft);
      const excess = Math.max(0, d) * counter.haloInv;
      const halo = 0.11 * Math.exp(-excess * excess);
      if (core > 0.002 || halo >= 0.004) {
        const e = (core + halo * (1 - core)) * grain;
        if (monochrome) {
          const l = 1 - Math.exp(-GAIN * e * LED_MONO);
          r = 1 - (1 - r) * (1 - l);
          g = 1 - (1 - g) * (1 - l);
          b = 1 - (1 - b) * (1 - l);
        } else {
          const [ledR, ledG, ledB] = ledRgb(color);
          const lr = 1 - Math.exp(-GAIN * e * ledR);
          const lg = 1 - Math.exp(-GAIN * e * ledG);
          const lb = 1 - Math.exp(-GAIN * e * ledB);
          r = 1 - (1 - r) * (1 - lr);
          g = 1 - (1 - g) * (1 - lg);
          b = 1 - (1 - b) * (1 - lb);
        }
      }
    }
  }

  out[idx] = toU16(r);
  out[idx + 1] = toU16(g);
  out[idx + 2] = toU16(b);
}

/**
 * C1-smooth iPhone-notch ("monobrow") signed distance for the Pentax 645 data bar:
 * - Open side cutout for `distFromEnd <= x0` (`edgeDepth = 0`, with subtle outer photo corner radius `outerR`),
 * - Concave top fillet of radius `rTop` curving into a steep straight wall (`sinT = 0.92`, ~67°),
 * - Generous convex bottom corner of radius `rBot` curving into `edgeDepth = infoBar`.
 */
function pentaxMonobrowDist(distFromEnd: number, depth: number, infoBar: number): number {
  const outerR = infoBar * 0.16;
  let dCorner = Number.MAX_VALUE;
  if (distFromEnd < outerR && depth < outerR) {
    const dx = outerR - distFromEnd;
    const dy = outerR - depth;
    dCorner = outerR - Math.hypot(dx, dy);
  }

  const x0 = infoBar * 1.25;
  const rTop = infoBar * 0.22;
  const rBot = infoBar * 0.52;
  const sinT = 0.92;
  const cosT = 0.39191836;
  const tanT = sinT / cosT;
  const x1 = x0 + rTop * sinT;
  const y1 = rTop * (1 - cosT);
  const y2 = infoBar - rBot * (1 - cosT);
  const x2 = x1 + (y2 - y1) / tanT;
  const x3 = x2 + rBot * sinT;

  let edgeDepth: number;
  let slope: number;
  if (distFromEnd <= x0) {
    edgeDepth = 0;
    slope = 0;
  } else if (distFromEnd < x1) {
    const dx = distFromEnd - x0;
    const rem = Math.sqrt(Math.max(1e-4, rTop * rTop - dx * dx));
    edgeDepth = rTop - rem;
    slope = dx / rem;
  } else if (distFromEnd < x2) {
    edgeDepth = y1 + (distFromEnd - x1) * tanT;
    slope = tanT;
  } else if (distFromEnd < x3) {
    const dx = x3 - distFromEnd;
    const rem = Math.sqrt(Math.max(1e-4, rBot * rBot - dx * dx));
    edgeDepth = infoBar - rBot + rem;
    slope = dx / rem;
  } else {
    edgeDepth = infoBar;
    slope = 0;
  }
  const dNotch = (depth - edgeDepth) / Math.hypot(1, slope);
  return Math.min(dCorner, dNotch);
}

function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2)) : 0;
  const dx = wx - vx * t;
  const dy = wy - vy * t;
  return Math.hypot(dx, dy);
}

function sdArc(px: number, py: number, cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): number {
  const midRad = ((startDeg + sweepDeg * 0.5) * Math.PI) / 180;
  const halfRad = (Math.abs(sweepDeg) * 0.5 * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const cosM = Math.cos(midRad);
  const sinM = Math.sin(midRad);
  const ux = dx * cosM + dy * sinM;
  const uy = Math.abs(-dx * sinM + dy * cosM);
  const cosH = Math.cos(halfRad);
  const sinH = Math.sin(halfRad);
  return ux * sinH - uy * cosH >= 0 ? Math.abs(Math.hypot(ux, uy) - r) : Math.hypot(ux - r * cosH, uy - r * sinH);
}

function sdContaxTriangle(lu: number, lv: number, triLen: number, halfBase: number, cy: number, cornerR: number): number {
  const x0 = cornerR;
  const x1 = Math.max(x0 + 1, triLen - cornerR * 2.2);
  const hb = Math.max(1, halfBase - cornerR * 1.2);
  const dy = Math.abs(lv - cy);
  const pBaseX = lu - x0;
  const pBaseY = dy - Math.min(dy, hb);
  const dBase2 = pBaseX * pBaseX + pBaseY * pBaseY;

  const ex = x1 - x0;
  const ey = -hb;
  const wx = lu - x0;
  const wy = dy - hb;
  const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
  const dx = wx - ex * t;
  const dy2 = wy - ey * t;
  const dSlope2 = dx * dx + dy2 * dy2;

  const inside = lu >= x0 && dy * ex <= hb * (x1 - lu);
  const dist = Math.sqrt(Math.min(dBase2, dSlope2));
  return (inside ? -dist : dist) - cornerR;
}

function sdContaxDigit(ch: string, x: number, y: number, w: number, h: number, ht: number): number {
  const xL = ht;
  const xR = w - ht;
  const xC = w * 0.5;
  const yT = ht;
  const yB = h - ht;
  const rx = (xR - xL) * 0.5;
  let d: number;
  switch (ch) {
    case '0':
      d = Math.min(
        Math.min(sdArc(x, y, xC, yT + rx, rx, 180, 180), sdArc(x, y, xC, yB - rx, rx, 0, 180)),
        Math.min(sdSegment(x, y, xL, yT + rx, xL, yB - rx), sdSegment(x, y, xR, yT + rx, xR, yB - rx)),
      );
      break;
    case '1': {
      const stemX = xC + rx * 0.16;
      d = Math.min(
        sdSegment(x, y, stemX, yT, stemX, yB),
        sdSegment(x, y, xC - rx * 0.52, yT + rx * 0.45, stemX, yT),
      );
      break;
    }
    case '2': {
      const aRad = (28 * Math.PI) / 180;
      const startX = xC + rx * Math.cos(aRad);
      const startY = yT + rx + rx * Math.sin(aRad);
      d = Math.min(
        sdArc(x, y, xC, yT + rx, rx, 195, 193),
        Math.min(sdSegment(x, y, startX, startY, xL, yB), sdSegment(x, y, xL, yB, xR, yB)),
      );
      break;
    }
    case '3': {
      const midY = h * 0.47;
      const rTop = (midY - yT) * 0.5;
      const rBot = (yB - midY) * 0.5;
      d = Math.min(
        sdArc(x, y, xC, yT + rTop, rTop, 195, 255),
        Math.min(sdArc(x, y, xC, midY + rBot, rBot, 270, 255), sdSegment(x, y, xC - rx * 0.20, midY, xC, midY)),
      );
      break;
    }
    case '4': {
      const stemX = xL + rx * 1.36;
      const barY = h * 0.64;
      d = Math.min(
        sdSegment(x, y, stemX, yT, stemX, yB),
        Math.min(sdSegment(x, y, xL, barY, xR, barY), sdSegment(x, y, stemX - rx * 0.12, yT, xL, barY)),
      );
      break;
    }
    case '5': {
      const midY = h * 0.45;
      const rBot = (yB - midY) * 0.5;
      d = Math.min(
        sdSegment(x, y, xL + rx * 0.04, yT, xR - rx * 0.08, yT),
        Math.min(
          sdSegment(x, y, xL + rx * 0.04, yT, xL, midY + rBot * 0.25),
          sdArc(x, y, xC, yB - rBot, rBot, 220, 280),
        ),
      );
      break;
    }
    case '6': {
      const topCy = yT + rx;
      const bowlCy = yB - rx;
      d = Math.min(
        sdArc(x, y, xC, bowlCy, rx, 0, 360),
        Math.min(sdArc(x, y, xC, topCy, rx, 180, 145), sdSegment(x, y, xL, topCy, xL, bowlCy)),
      );
      break;
    }
    case '7':
      d = Math.min(
        sdSegment(x, y, xL, yT, xR, yT),
        sdSegment(x, y, xR, yT, xC - rx * 0.25, yB),
      );
      break;
    case '8': {
      const midY = h * 0.47;
      const rTop = (midY - yT) * 0.5;
      const rBot = (yB - midY) * 0.5;
      d = Math.min(
        sdArc(x, y, xC, yT + rTop, rTop, 0, 360),
        sdArc(x, y, xC, midY + rBot, rBot, 0, 360),
      );
      break;
    }
    case '9':
      return sdContaxDigit('6', w - x, h - y, w, h, ht);
    case '-':
      d = sdSegment(x, y, xL + rx * 0.1, h * 0.5, xR - rx * 0.1, h * 0.5);
      break;
    default:
      return 1e9;
  }
  return d - ht;
}

function blendPixel(dst: Uint16Array, idx: number, stripe: Uint16Array, mask: number) {
  if (mask >= 0.999) {
    dst[idx] = stripe[0];
    dst[idx + 1] = stripe[1];
    dst[idx + 2] = stripe[2];
    return;
  }
  const inv = 1 - mask;
  for (let c = 0; c < 3; c++) {
    dst[idx + c] = Math.round(dst[idx + c] * inv + stripe[c] * mask);
  }
}

function edge(d: number, soft: number): number {
  const t = Math.min(1, Math.max(0, (soft * 0.5 - d) / soft));
  return t * t * (3 - 2 * t);
}

function gateMask(d: number, softEdge: number): number {
  if (d >= softEdge) return 0;
  const t = Math.min(1, Math.max(0, (softEdge - d) / (2 * softEdge)));
  return t * t * (3 - 2 * t);
}

function gateImperfection(pos: number, infoBar: number, seed: number): number {
  const slow = smoothNoise1D(pos / Math.max(12, infoBar * 1.4), seed) - 0.5;
  const med = smoothNoise1D(pos / Math.max(5, infoBar * 0.45), seed + 101) - 0.5;
  return slow * 0.45 + med * 0.25;
}

function smoothNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}

function toU16(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 65535);
}

const AUTO_METER_7X7 = [
  0b1111111,
  0b1000001,
  0b1001001,
  0b1011101,
  0b1001001,
  0b1000001,
  0b1111111,
];

const SPOT_METER_7X7 = [
  0b0000000,
  0b0000000,
  0b0001000,
  0b0011100,
  0b0001000,
  0b0000000,
  0b0000000,
];

const GLYPH_5X7: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  'I': [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  'M': [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  'S': [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  'V': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  'a': [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  'b': [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  'c': [0b00000, 0b00000, 0b01110, 0b10001, 0b10000, 0b10001, 0b01110],
  'd': [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  'e': [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  'f': [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000],
  'g': [0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  'h': [0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  'i': [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  'j': [0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100],
  'k': [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  'l': [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'm': [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001],
  'n': [0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  'o': [0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  'p': [0b00000, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000],
  'q': [0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001],
  'r': [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  's': [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  't': [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
  'u': [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  'v': [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'w': [0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010],
  'x': [0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  'y': [0b00000, 0b10001, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  'z': [0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  "'": [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '±': [0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000, 0b11111],
};
