import type { PhotoMetadata } from '../../worker/protocol';
import { scanSize } from '../gl/ScanScale';
import { BandDownscaler } from './BandDownscaler';
import {
  DateStamp,
  type DateStampFormat,
  type DateStampStyle,
  type TimeStampFormat,
} from './DateStamp';
import {
  EXPORT_PENTAX645_FIELDS,
  Pentax645Frame,
  parseExportFields,
  parseExportOrder,
  type FilmFrameColor,
  type FilmFrameStyle,
  type Pentax645Field,
  type Pentax645Info,
  type PhotoFrame,
} from './Pentax645Frame';

export type ExportFormat = 'jpeg' | 'tiff';

export const EXTENSIONS: Record<ExportFormat, string> = { jpeg: 'jpg', tiff: 'tif' };
export const MIME_TYPES: Record<ExportFormat, string> = { jpeg: 'image/jpeg', tiff: 'image/tiff' };

/** Port of export/ExportSettings.kt. The web build always encodes JPEG with jpegli (16-bit in, 4:4:4). */
export interface ExportSettings {
  format: ExportFormat;
  jpegQuality: number; // 1..100
  tiffBits: 8 | 16;
  /** Long side of the saved image in pixels, area-downscaled from full resolution; null = full size. */
  maxLongSide: number | null;
  /** Film mode only: render 1.5x larger, upscaling the photo and growing the film grain on the finer pitch (ScanScale). */
  filmScan: boolean;
  /** Optional film-style date stamp imprinted in the bottom-right corner of the exported image. */
  dateStamp?: string;
  /** Visual style for dateStamp ('CLASSIC' or 'RED_LED'). */
  dateStampStyle?: DateStampStyle;
  /** Optional Pentax 645N / Contax 645-style black film rebate with dot-matrix shoot info. */
  pentax645?: Pentax645Info | null;
  /** When true (B&W mode), both dateStamp and pentax645 render in neutral black-and-white. */
  monochromeImprint?: boolean;
  /** High-level frame / date-stamp choice from the Pro or Auto Export dialog; 'NONE' by default. */
  photoFrame?: PhotoFrame;
  /** Date order for PhotoFrame 'DATE_STAMP' and Pentax645Field 'date': 'DMY' by default. */
  dateStampFormat?: DateStampFormat;
  /** Time format for Pentax645Field 'time': 'H24' by default. */
  timeStampFormat?: TimeStampFormat;
  /** Shoot-info items imprinted on the Pentax 645 / Contax 645 rebate. */
  pentax645Fields?: Pentax645Field[];
  /** Display order of shoot-info items on the Pentax 645 / Contax 645 rebate. */
  pentax645Order?: Pentax645Field[];
  /** Rotate the Pentax 645 / Contax 645 shoot-info LED text 180° upside down. */
  pentax645Flip?: boolean;
  /** LED imprint color for Pentax 645 and Contax 645. */
  frameColor?: FilmFrameColor;
  /** Optional 1-based frame counter for Pentax645Field 'frame' (e.g. batch index in Auto, 1 in Pro). */
  frameNumber?: number;
  /** Optional EXIF date string ('YYYY:MM:DD HH:MM:SS') pre-read for the photo. */
  captureDate?: string | null;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'jpeg',
  jpegQuality: 92,
  tiffBits: 16,
  maxLongSide: null,
  filmScan: false,
  dateStamp: '',
  dateStampStyle: 'CLASSIC',
  pentax645: null,
  monochromeImprint: false,
  photoFrame: 'NONE',
  dateStampFormat: 'DMY',
  timeStampFormat: 'H24',
  pentax645Fields: [...EXPORT_PENTAX645_FIELDS],
  pentax645Order: [...EXPORT_PENTAX645_FIELDS],
  pentax645Flip: false,
  frameColor: 'AMBER',
};

/** Pixel dimensions a [width] x [height] image will be saved at (including film rebate border when enabled). */
export function exportOutputSize(width: number, height: number, settings: ExportSettings, scan = false): [number, number] {
  const photoSize = scan ? scanSize(width, height) : BandDownscaler.outputSize(width, height, settings.maxLongSide);
  const style: FilmFrameStyle | null = settings.pentax645?.style
    ?? (settings.photoFrame === 'PENTAX_645' ? 'PENTAX_645' : settings.photoFrame === 'CONTAX_645' ? 'CONTAX_645' : null);
  if (!style) return photoSize;
  const layout = Pentax645Frame.layout(photoSize[0], photoSize[1], style);
  return [layout.outWidth, layout.outHeight];
}

/**
 * Resolves [settings.photoFrame] into [dateStamp] or [pentax645] from [image]'s EXIF metadata
 * when [dateStamp] and [pentax645] were not already populated by the caller.
 */
export function resolveExportFrame(
  settings: ExportSettings,
  image: { metadata: PhotoMetadata; iso: number },
  monochrome = false,
  nowMs = Date.now(),
): ExportSettings {
  const mono = Boolean(settings.monochromeImprint) || monochrome;
  const photoFrame = settings.photoFrame ?? 'NONE';
  if ((settings.dateStamp && settings.dateStamp.length > 0) || settings.pentax645 != null || photoFrame === 'NONE') {
    return { ...settings, monochromeImprint: mono };
  }
  const exifDate = settings.captureDate ?? image.metadata.dateTimeOriginal;
  const timeMs = DateStamp.parseExifDate(exifDate) ?? nowMs;
  const dateStampFormat = settings.dateStampFormat ?? 'DMY';
  const timeStampFormat = settings.timeStampFormat ?? 'H24';
  if (photoFrame === 'DATE_STAMP') {
    const fmt: DateStampFormat = dateStampFormat === 'MMM_YY' ? 'DMY' : dateStampFormat;
    return {
      ...settings,
      dateStamp: DateStamp.format(timeMs, fmt),
      monochromeImprint: mono,
    };
  }
  const fields = new Set<Pentax645Field>(settings.pentax645Fields ?? EXPORT_PENTAX645_FIELDS);
  const order = settings.pentax645Order ?? EXPORT_PENTAX645_FIELDS;
  const m = image.metadata;
  const focal35 = Number.isFinite(m.focalLength35mm) && m.focalLength35mm > 0
    ? m.focalLength35mm
    : Number.isFinite(m.focalLength) && m.focalLength > 0
      ? m.focalLength
      : 0;
  const iso = Number.isFinite(m.iso) && m.iso > 0 ? m.iso : image.iso;
  return {
    ...settings,
    pentax645: {
      frameNumber: fields.has('frame') ? (settings.frameNumber ?? 1) : null,
      exposureTime: fields.has('shutter') && Number.isFinite(m.exposureTime) && m.exposureTime > 0 ? m.exposureTime : null,
      fNumber: fields.has('aperture') && Number.isFinite(m.fNumber) && m.fNumber > 0 ? m.fNumber : null,
      focalLengthMm: fields.has('focal') && focal35 > 0 ? focal35 : null,
      iso: fields.has('iso') && Number.isFinite(iso) && iso > 0 ? iso : null,
      date: fields.has('date') ? Pentax645Frame.formatDate(timeMs, dateStampFormat) : null,
      time: fields.has('time') ? Pentax645Frame.formatTime(timeMs, timeStampFormat) : null,
      flipped: Boolean(settings.pentax645Flip),
      fieldOrder: [...order],
      color: settings.frameColor ?? 'AMBER',
      style: photoFrame === 'CONTAX_645' ? 'CONTAX_645' : 'PENTAX_645',
    },
    monochromeImprint: mono,
  };
}

const KEY = 'rawboy.export';

/** Remembered per browser, like Android's SharedPreferences (best effort). [key]: Auto keeps its own. */
export const ExportSettingsStore = {
  load(key = KEY): ExportSettings {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? '{}');
      const photoFrame: PhotoFrame =
        s.photoFrame === 'DATE_STAMP' || s.photoFrame === 'PENTAX_645' || s.photoFrame === 'CONTAX_645' ? s.photoFrame : 'NONE';
      const dateStampFormat: DateStampFormat =
        s.dateStampFormat === 'YMD' || s.dateStampFormat === 'MDY' || s.dateStampFormat === 'MMM_YY' ? s.dateStampFormat : 'DMY';
      const dateStampStyle: DateStampStyle = s.dateStampStyle === 'RED_LED' ? 'RED_LED' : 'CLASSIC';
      const timeStampFormat: TimeStampFormat = s.timeStampFormat === 'H12' ? 'H12' : 'H24';
      const frameColor: FilmFrameColor =
        s.frameColor === 'SLIDE' || s.frameColor === 'RED' || s.frameColor === 'GREEN' ? s.frameColor : 'AMBER';
      return {
        format: s.format === 'tiff' ? 'tiff' : 'jpeg',
        jpegQuality: Math.min(100, Math.max(1, Number(s.jpegQuality) || DEFAULT_EXPORT.jpegQuality)),
        tiffBits: s.tiffBits === 8 ? 8 : 16,
        maxLongSide: typeof s.maxLongSide === 'number' && s.maxLongSide > 0 ? s.maxLongSide : null,
        filmScan: s.filmScan === true,
        photoFrame,
        dateStampFormat,
        dateStampStyle,
        timeStampFormat,
        pentax645Fields: parseExportFields(s.pentax645Fields),
        pentax645Order: parseExportOrder(s.pentax645Order),
        pentax645Flip: s.pentax645Flip === true,
        frameColor,
      };
    } catch {
      return {
        ...DEFAULT_EXPORT,
        pentax645Fields: [...EXPORT_PENTAX645_FIELDS],
        pentax645Order: [...EXPORT_PENTAX645_FIELDS],
      };
    }
  },
  save(settings: ExportSettings, key = KEY) {
    try {
      const { dateStamp: _d, pentax645: _p, frameNumber: _f, captureDate: _c, ...persisted } = settings;
      localStorage.setItem(key, JSON.stringify(persisted));
    } catch {
      // Storage may be unavailable (private mode); settings then last for the session.
    }
  },
};

/** Where exports go and how they are named: <original>-<suffix>.<ext> (port of OutputNaming). */
export interface OutputNaming {
  suffix: string;
}

/** Strips the extension and characters file systems won't accept. */
export function baseNameOf(displayName: string): string {
  const dot = displayName.lastIndexOf('.');
  const stem = (dot > 0 ? displayName.substring(0, dot) : displayName).trim() || displayName;
  return stem.replace(/[/\\:*?"<>|]/g, '_') || 'image';
}

/** "<base>-<suffix>.<ext>", then "-001", "-002", ... for [counter] > 0. */
export function fileName(baseName: string, extension: string, counter: number, naming: OutputNaming): string {
  const stem = naming.suffix ? `${baseName}-${naming.suffix}` : baseName;
  return counter === 0 ? `${stem}.${extension}` : `${stem}-${String(counter).padStart(3, '0')}.${extension}`;
}
