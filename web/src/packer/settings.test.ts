import { describe, expect, it } from 'vitest';
import type { PackInfo } from './protocol';
import { DEFAULT_SETTINGS, PRESETS, outputName, presetOf, settingsSuffix, summarize, threadsPerFile } from './settings';

const info = (p: Partial<PackInfo>): PackInfo => ({
  make: 'Sony', model: 'ILCE-7M3', lens: '', format: 'ARW', width: 6024, height: 4024, dng: false, mosaic: true, bayer: true,
  lensData: 'Sony', lensDistortion: true, lensVignetting: true, lensCa: true, adobeHints: true, modeUsed: 'small', linear: false,
  lensWritten: false, preview: '', outWidth: 0, outHeight: 0, seconds: 0, ...p,
});
const text = (lines: ReturnType<typeof summarize>) => lines.map((l) => l.map((s) => s.text).join('')).join('\n');
const bold = (lines: ReturnType<typeof summarize>) => lines.flatMap((l) => l.filter((s) => s.bold).map((s) => s.text));

describe('Packer settings', () => {
  it('defaults to the Small raw preset', () => {
    expect(presetOf(DEFAULT_SETTINGS)).toBe('small');
    expect(presetOf({ ...DEFAULT_SETTINGS, ...PRESETS.micro })).toBe('micro');
    expect(presetOf({ ...DEFAULT_SETTINGS, ...PRESETS.lossless, quality: 'compact' })).toBe('lossless');
    expect(presetOf({ ...DEFAULT_SETTINGS, quality: 'archive' })).toBe('custom');
    expect(presetOf({ ...DEFAULT_SETTINGS, format: 'losslessJxl' })).toBe('custom');
  });

  it('names outputs without overwriting DNG sources', () => {
    expect(outputName('DSC07421.ARW')).toBe('DSC07421.dng');
    expect(outputName('IMG_1.DNG')).toBe('IMG_1-packed.dng');
    expect(outputName('DSCF3736.RAF', 2)).toBe('DSCF3736-2.dng');
    expect(DEFAULT_SETTINGS.nameSuffix).toBe(false);
    expect(outputName('DSC1.ARW', 0, 'small-high')).toBe('DSC1-small-high.dng');
    expect(outputName('IMG_1.DNG', 1, 'lossless')).toBe('IMG_1-lossless-1.dng');
    expect(settingsSuffix({ format: 'micro', quality: 'good', maxSize: 3000 })).toBe('micro3000-good');
  });

  it('shares cores between files at once', () => {
    expect(threadsPerFile(1, 8)).toBe(6);
    expect(threadsPerFile(2, 8)).toBe(4);
    expect(threadsPerFile(4, 2)).toBe(1);
  });

  it('says what applies to the files', () => {
    const files = [info({}), info({ make: 'Olympus', model: 'E-PL9', lensData: '' }), info({ model: 'ILCE-7M5', adobeHints: false }), info({ bayer: false })];
    const lines = summarize(DEFAULT_SETTINGS, files);
    expect(text(lines)).toContain('3 files: the camera\'s lens corrections');
    expect(text(lines)).toContain('1 file without lens corrections in the file (Olympus E-PL9');
    expect(text(lines)).toContain('Sony ILCE-7M5: ');
    expect(bold(lines)).toContain('1 file can\'t be saved as Small raw');
    expect(bold(summarize({ ...DEFAULT_SETTINGS, lensCorrections: false }, files))).toContain('Lens corrections are dropped. ');
    expect(bold(summarize({ ...DEFAULT_SETTINGS, format: 'losslessJxl' }, []))).toContain('Apple Photos shows it black');
    expect(text(summarize({ ...DEFAULT_SETTINGS, format: 'micro', maxSize: 3000 }, []))).toContain('resized to 3000 px');
  });
});
