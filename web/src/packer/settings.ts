/**
 * RawBoy Packer's settings, presets and the live summary of what they do. Numbers quoted in the summary were measured
 * on the owner's files (A7 III, GFX 50R, E-PL9, NEX-3, Pixel 9 Pro) on 2026-11-01; app support was checked by the
 * owner in Lightroom (desktop and mobile), Apple Photos, XnView and darktable.
 */
import type { PackFormat, PackInfo, PackOptions } from './protocol';

export type Quality = 'archive' | 'high' | 'good' | 'compact';
export type Speed = 'fast' | 'normal' | 'best';
export type PreviewSize = 'standard' | 'large' | 'none';
export type Preset = 'small' | 'lossless' | 'micro' | 'custom';

export interface PackSettings {
  format: PackFormat;
  quality: Quality;
  speed: Speed;
  /** Micro: long side in pixels. */
  maxSize: number;
  preview: PreviewSize;
  lensCorrections: boolean;
  keepGps: boolean;
  /** Files packed in parallel, each in its own worker. */
  filesAtOnce: number;
}

export const DEFAULT_SETTINGS: PackSettings = {
  format: 'small',
  quality: 'high',
  speed: 'normal',
  maxSize: 4000,
  preview: 'standard',
  lensCorrections: true,
  keepGps: true,
  filesAtOnce: 1,
};

export const DISTANCE: Record<Quality, number> = { archive: 0.1, high: 0.2, good: 0.5, compact: 1.0 };
export const EFFORT: Record<Speed, number> = { fast: 3, normal: 5, best: 7 };
export const PREVIEW_PX: Record<PreviewSize, number> = { standard: 1024, large: 2048, none: 0 };
export const MAX_SIZES = [2048, 3000, 4000, 6000];
export const MAX_FILES_AT_ONCE = 4;

export const FORMAT_LABEL: Record<PackFormat, string> = {
  small: 'Small raw',
  micro: 'Micro',
  losslessJpeg: 'Lossless',
  losslessJxl: 'Lossless JPEG XL',
};

export const QUALITY_LABEL: Record<Quality, string> = { archive: 'Archive', high: 'High', good: 'Good', compact: 'Compact' };
export const SPEED_LABEL: Record<Speed, string> = { fast: 'Fast', normal: 'Normal', best: 'Smallest' };
export const PREVIEW_LABEL: Record<PreviewSize, string> = { standard: '1024 px', large: '2048 px', none: 'None' };

/** The preset chips: each sets the format and its quality fields. */
export const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<PackSettings, 'format' | 'quality' | 'speed' | 'maxSize'>> = {
  small: { format: 'small', quality: 'high', speed: 'normal', maxSize: 4000 },
  lossless: { format: 'losslessJpeg', quality: 'high', speed: 'normal', maxSize: 4000 },
  micro: { format: 'micro', quality: 'high', speed: 'normal', maxSize: 4000 },
};

export const PRESET_LABEL: Record<Preset, string> = { small: 'Small raw', lossless: 'Lossless', micro: 'Micro', custom: 'Custom' };

/** Which preset the settings match (fields a format doesn't use are ignored), or custom. */
export function presetOf(s: PackSettings): Preset {
  for (const [name, p] of Object.entries(PRESETS) as [Exclude<Preset, 'custom'>, (typeof PRESETS)['small']][]) {
    if (p.format !== s.format) continue;
    if (s.format === 'losslessJpeg') return name;
    if (s.format === 'losslessJxl') continue;
    if (p.quality === s.quality && p.speed === s.speed && (s.format !== 'micro' || p.maxSize === s.maxSize)) return name;
  }
  return 'custom';
}

/** Whether the format has a quality (JPEG XL distance) and a speed (effort) setting. */
export const usesQuality = (f: PackFormat) => f === 'small' || f === 'micro';
export const usesSpeed = (f: PackFormat) => f !== 'losslessJpeg';

export function packOptions(s: PackSettings, threads: number): PackOptions {
  return {
    mode: s.format,
    distance: DISTANCE[s.quality],
    effort: EFFORT[s.speed],
    maxSize: s.maxSize,
    previewSize: PREVIEW_PX[s.preview],
    lensCorrections: s.lensCorrections,
    keepGps: s.keepGps,
    threads,
  };
}

/** Threads for each worker: the cores shared between the files packed at once (the WASM pool allows 6). */
export const threadsPerFile = (filesAtOnce: number, cores = navigator.hardwareConcurrency || 4) =>
  Math.max(1, Math.min(6, Math.floor(cores / Math.max(1, filesAtOnce))));

const STORAGE_KEY = 'rawboy-packer-settings';

export function loadSettings(): PackSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PackSettings> | null;
    if (!saved) return DEFAULT_SETTINGS;
    const s = { ...DEFAULT_SETTINGS, ...saved };
    // Anything a newer or older build doesn't know falls back to the default.
    if (!(s.format in FORMAT_LABEL)) s.format = DEFAULT_SETTINGS.format;
    if (!(s.quality in DISTANCE)) s.quality = DEFAULT_SETTINGS.quality;
    if (!(s.speed in EFFORT)) s.speed = DEFAULT_SETTINGS.speed;
    if (!(s.preview in PREVIEW_PX)) s.preview = DEFAULT_SETTINGS.preview;
    if (!MAX_SIZES.includes(s.maxSize)) s.maxSize = DEFAULT_SETTINGS.maxSize;
    s.filesAtOnce = Math.min(MAX_FILES_AT_ONCE, Math.max(1, Math.round(Number(s.filesAtOnce)) || 1));
    return s;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: PackSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // private mode: settings last for this visit
  }
}

// ---- Which apps open the output ----

export type Support = 'yes' | 'no' | 'likely' | 'untested';

export interface AppSupport {
  app: string;
  support: Support;
  note: string;
}

const APPS = ['RawBoy', 'Lightroom', 'Apple Photos', 'Capture One', 'darktable'] as const;

const SUPPORT: Record<PackFormat, Record<(typeof APPS)[number], [Support, string]>> = {
  small: {
    RawBoy: ['yes', 'Opens and edits it as a raw.'],
    Lightroom: ['yes', 'Lightroom Classic, desktop and mobile open it as a raw (needs a current version: DNG 1.7.1).'],
    'Apple Photos': ['yes', 'Photos and Preview render it as a raw.'],
    'Capture One': ['untested', 'No support for JPEG XL DNGs has been reported.'],
    darktable: ['no', 'Shows a purple picture: it skips a step these DNGs need (the raw data is stored scaled).'],
  },
  micro: {
    RawBoy: ['yes', 'Opens and edits it (white balance and exposure stay editable).'],
    Lightroom: ['yes', 'Opens it as a linear DNG (a 2023 or later version: DNG 1.7).'],
    'Apple Photos': ['untested', 'Apple reads JPEG XL DNGs; this kind not checked yet.'],
    'Capture One': ['untested', 'No support for JPEG XL DNGs has been reported.'],
    darktable: ['untested', 'Not checked yet.'],
  },
  losslessJpeg: {
    RawBoy: ['yes', 'Opens and edits it as a raw.'],
    Lightroom: ['yes', 'Opens it as a raw, any version since 2012.'],
    'Apple Photos': ['yes', 'Photos and Preview render it as a raw.'],
    'Capture One': ['likely', 'Classic DNG compression that raw developers have read for years; not checked with Capture One.'],
    darktable: ['yes', 'Classic DNG compression.'],
  },
  losslessJxl: {
    RawBoy: ['yes', 'Opens and edits it as a raw.'],
    Lightroom: ['yes', 'Opens it as a raw (a 2023 or later version: DNG 1.7).'],
    'Apple Photos': ['no', 'Shows a black picture (only the preview is visible).'],
    'Capture One': ['untested', 'No support for JPEG XL DNGs has been reported.'],
    darktable: ['untested', 'Not checked yet.'],
  },
};

export const appSupport = (f: PackFormat): AppSupport[] => APPS.map((app) => ({ app, support: SUPPORT[f][app][0], note: SUPPORT[f][app][1] }));

// ---- The summary ----

/** A run of text, bold when it matters most. */
export type Span = { text: string; bold?: boolean };
export type Line = Span[];

const b = (text: string): Span => ({ text, bold: true });
const t = (text: string): Span => ({ text });

/** Size of the output against the camera's raw, measured at each quality (A7 III, GFX 50R, E-PL9). */
const SMALL_SIZE: Record<Quality, string> = { archive: '40–65%', high: '25–50%', good: '10–25%', compact: '5–15%' };
const QUALITY_TEXT: Record<Quality, string> = {
  archive: 'measurably different from the camera raw only in pixel peeping at extreme edits',
  high: 'looks the same as the camera raw on correctly exposed photos',
  good: 'looks the same at normal edits; pushing shadows by several stops shows smoothed, slightly blocky noise',
  compact: 'shows smoothed detail at 100% and breaks up under strong edits',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What packing with [s] does, as lines for the summary panel; [files] are the inspected files (may be empty), so the
 * lines can name what applies to them (lens data present or lost, X-Trans, DNG sources).
 */
export function summarize(s: PackSettings, files: PackInfo[]): Line[] {
  const lines: Line[] = [];
  const q = s.quality;
  switch (s.format) {
    case 'small':
      lines.push([
        b('Raw data, lossy JPEG XL. '),
        t('Every photosite is kept, so white balance, highlight recovery and demosaicing stay as editable as in the camera raw. At '),
        t(`${QUALITY_LABEL[q]} quality it `),
        b(QUALITY_TEXT[q]),
        t('. '),
        b(`About ${SMALL_SIZE[q]} of the camera raw's size.`),
      ]);
      break;
    case 'micro':
      lines.push([
        b(`Demosaiced and resized to ${s.maxSize} px`),
        t(' on the long side, lossy JPEG XL (a linear DNG). White balance and exposure stay editable, but '),
        b('the raw data itself is gone'),
        t(': demosaicing, noise reduction and sharpening start from the resized image. At '),
        t(`${QUALITY_LABEL[q]} quality it ${QUALITY_TEXT[q]}. `),
        b(s.maxSize <= 3000 ? 'About 5–15% of the camera raw.' : 'About 8–20% of the camera raw.'),
      ]);
      break;
    case 'losslessJpeg':
      lines.push([
        b('Bit-exact: '),
        t('the raw data is identical to the camera\'s, in classic lossless JPEG (DNG 1.4) that '),
        b('every raw developer reads'),
        t('. '),
        b('70–100% of compressed camera raws'),
        t(' (much smaller than uncompressed ones; Fujifilm compressed RAFs come out a little larger).'),
      ]);
      break;
    case 'losslessJxl':
      lines.push([
        b('Bit-exact '),
        t('raw data in lossless JPEG XL: '),
        b('40–100% of the camera raw'),
        t(', but '),
        b('slow'),
        t(' (about 40 s for a 50 MP photo) and '),
        b('Apple Photos shows it black'),
        t('. Lossless (classic) is the safer choice.'),
      ]);
      break;
  }

  const sources = files.filter((f) => !f.dng);
  const dngs = files.filter((f) => f.dng);
  const notBayer = files.filter((f) => !f.bayer || !f.mosaic);
  if (s.format === 'small' && notBayer.length) {
    lines.push([
      b(`${plural(notBayer.length, 'file')} can't be saved as Small raw`),
      t(' (X-Trans or already demosaiced, e.g. phone ProRAW): saved '),
      b('demosaiced at full size'),
      t(' instead, as in Micro.'),
    ]);
  }

  // Lens corrections.
  const withLens = sources.filter((f) => f.lensData);
  const withoutLens = sources.filter((f) => !f.lensData);
  if (!s.lensCorrections) {
    lines.push([
      b('Lens corrections are dropped. '),
      t('Lightroom applies its own lens profile only when it has one for the lens; RawBoy shows the photo uncorrected.'),
    ]);
  } else {
    const where =
      s.format === 'micro'
        ? 'applied to the pixels (they can\'t be turned off later)'
        : s.format === 'small'
          ? 'kept as DNG instructions that RawBoy and Lightroom apply (vignetting is applied to the raw data itself)'
          : 'kept as DNG instructions that RawBoy and Lightroom apply and can switch off';
    const corrections = withLens.length && sources.length ? `${plural(withLens.length, 'file')}: the camera's` : 'The camera\'s';
    lines.push([b(`${corrections} lens corrections`), t(' (Sony and Fujifilm: distortion, colour fringing, vignetting) are '), t(where), t('.')]);
    if (withoutLens.length) {
      const models = [...new Set(withoutLens.map((f) => `${f.make} ${f.model}`.trim()))].slice(0, 3).join(', ');
      lines.push([
        b(`${plural(withoutLens.length, 'file')} without lens corrections in the file`),
        t(` (${models}; adapted and manual lenses store none): Lightroom uses its own lens profile when it knows the lens.`),
      ]);
    }
    if (dngs.length) lines.push([t(`${plural(dngs.length, 'DNG')}: `), t('the DNG\'s own lens corrections are carried over.')]);
  }

  const noHints = sources.filter((f) => !f.adobeHints);
  if (noHints.length) {
    const models = [...new Set(noHints.map((f) => `${f.make} ${f.model}`.trim()))].slice(0, 3).join(', ');
    lines.push([
      t(`${models}: `),
      t('Adobe\'s default sharpening and exposure for this camera aren\'t known to the Packer, so '),
      b('Lightroom may open it a little softer and darker'),
      t(' than its own DNG (raise Sharpening to match).'),
    ]);
  }

  lines.push(
    s.preview === 'none'
      ? [b('No preview: '), t('Finder, Explorer and photo browsers show no thumbnail until an app renders the raw.')]
      : [t('Preview: the camera\'s own JPEG when the file has one, else a '), t(`${PREVIEW_PX[s.preview]} px render.`)],
  );
  if (!s.keepGps) lines.push([b('Location removed'), t(' (GPS tags).')]);
  lines.push([
    t('The original files are '),
    b('not changed or deleted'),
    t(s.filesAtOnce > 1 ? `. ${s.filesAtOnce} files at once: each 50 MP photo needs up to 1 GB of memory.` : '.'),
  ]);
  return lines;
}

/** The output's file name: the source's name with .dng; DNG sources get "-packed" so nothing is overwritten. */
export function outputName(source: string, counter = 0): string {
  const dot = source.lastIndexOf('.');
  const base = dot > 0 ? source.slice(0, dot) : source;
  const isDng = dot > 0 && source.slice(dot + 1).toLowerCase() === 'dng';
  return `${base}${isDng ? '-packed' : ''}${counter ? `-${counter}` : ''}.dng`;
}
