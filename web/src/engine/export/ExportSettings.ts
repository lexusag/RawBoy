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
}

export const DEFAULT_EXPORT: ExportSettings = { format: 'jpeg', jpegQuality: 92, tiffBits: 16, maxLongSide: null };

const KEY = 'rawboy.export';

/** Remembered per browser, like Android's SharedPreferences (best effort). [key]: Auto keeps its own. */
export const ExportSettingsStore = {
  load(key = KEY): ExportSettings {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? '{}');
      return {
        format: s.format === 'tiff' ? 'tiff' : 'jpeg',
        jpegQuality: Math.min(100, Math.max(1, Number(s.jpegQuality) || DEFAULT_EXPORT.jpegQuality)),
        tiffBits: s.tiffBits === 8 ? 8 : 16,
        maxLongSide: typeof s.maxLongSide === 'number' && s.maxLongSide > 0 ? s.maxLongSide : null,
      };
    } catch {
      return { ...DEFAULT_EXPORT };
    }
  },
  save(settings: ExportSettings, key = KEY) {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
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
