import { describe, expect, it } from 'vitest';
import { DateStamp } from '../export/DateStamp';
import {
  EXPORT_PENTAX645_FIELDS,
  Pentax645Frame,
  parseExportFields,
  parseExportOrder,
  type Pentax645Info,
} from '../export/Pentax645Frame';
import { DEFAULT_EXPORT, exportOutputSize, resolveExportFrame } from '../export/ExportSettings';

describe('DateStamp and Pentax645Frame', () => {
  it('formats date stamps and parses EXIF timestamps', () => {
    const ms = DateStamp.parseExifDate('2026:11:13 14:46:00', true)!;
    expect(ms).toBeGreaterThan(0);
    expect(DateStamp.format(ms, 'DMY', true)).toBe("13 11 '26");
    expect(DateStamp.format(ms, 'YMD', true)).toBe("'26 11 13");
    expect(DateStamp.format(ms, 'MDY', true)).toBe("11 13 '26");
    expect(Pentax645Frame.formatDate(ms, 'MMM_YY', true)).toBe('nov 26');
    expect(Pentax645Frame.formatTime(ms, 'H24', true)).toBe('14:46');
    expect(Pentax645Frame.formatTime(ms, 'H12', true)).toBe('2:46PM');
  });

  it('imprints yellow-orange or red LED 7-segment date stamp in bottom-right', () => {
    const w = 400;
    const h = 300;
    const topBand = new Uint16Array(w * 100 * 3);
    DateStamp.imprint(topBand, w, h, 0, 100, "'26 11 13");
    expect(topBand.every((v) => v === 0)).toBe(true);

    const bottomBand = new Uint16Array(w * 100 * 3);
    DateStamp.imprint(bottomBand, w, h, 200, 100, "'26 11 13");
    let brightPixels = 0;
    for (let i = 0; i < w * 100; i++) {
      const r = bottomBand[i * 3];
      const g = bottomBand[i * 3 + 1];
      const b = bottomBand[i * 3 + 2];
      if (r > 50000 && g > 25000 && b < 15000) brightPixels++;
    }
    expect(brightPixels).toBeGreaterThan(20);
  });

  it('renders Pentax 645 and Contax 645 frames and resolves export settings', () => {
    expect(Pentax645Frame.formatFrameNumber(3)).toBe('#3');
    expect(Pentax645Frame.formatShutter(1 / 125)).toBe('1/125');
    expect(Pentax645Frame.formatAperture(2.8)).toBe('F2.8');

    expect(parseExportFields(['shutter', 'mode', 'aperture'])).toEqual(['shutter', 'aperture']);
    const order = parseExportOrder(['time', 'mode', 'shutter']);
    expect(order[0]).toBe('time');
    expect(order.length).toBe(EXPORT_PENTAX645_FIELDS.length);

    const layout = Pentax645Frame.layout(600, 800, 'PENTAX_645');
    expect(layout.outWidth).toBe(600 + 2 * layout.border);
    expect(layout.outHeight).toBe(800 + 2 * layout.border);

    const info: Pentax645Info = {
      frameNumber: 3,
      exposureTime: 1 / 125,
      fNumber: 1.8,
      focalLengthMm: 24,
      iso: 400,
      date: '13.11.26',
      time: '14:46',
      color: 'AMBER',
      style: 'PENTAX_645',
    };
    const src = new Uint16Array(600 * layout.infoBar * 3).fill(20000);
    const dst = new Uint16Array(layout.outWidth * layout.infoBar * 3);
    Pentax645Frame.wrapPhotoBand(src, dst, layout, 0, layout.infoBar, false, info);
    let brightOrange = 0;
    for (let i = 0; i < layout.outWidth * layout.infoBar; i++) {
      const r = dst[i * 3];
      const g = dst[i * 3 + 1];
      const b = dst[i * 3 + 2];
      if (r > 30000 && r > g && g > b) brightOrange++;
    }
    expect(brightOrange).toBeGreaterThan(50);

    const contaxLayout = Pentax645Frame.layout(600, 800, 'CONTAX_645');
    const contaxInfo: Pentax645Info = { ...info, style: 'CONTAX_645', color: 'RED' };
    const topBar = new Uint16Array(contaxLayout.outWidth * contaxLayout.topPad * 3);
    Pentax645Frame.renderTopBarBand(topBar, contaxLayout, 0, contaxLayout.topPad, contaxInfo, false);
    const bottomBar = new Uint16Array(contaxLayout.outWidth * contaxLayout.bottomPad * 3);
    Pentax645Frame.renderBorderBand(bottomBar, contaxLayout, contaxLayout.topPad + contaxLayout.photoHeight, contaxLayout.bottomPad, false, contaxInfo);
    expect(topBar.some((v) => v > 30000)).toBe(true);
    expect(bottomBar.some((v) => v > 30000)).toBe(true);

    const settings = {
      ...DEFAULT_EXPORT,
      photoFrame: 'PENTAX_645' as const,
      frameNumber: 5,
      captureDate: '2026:11:13 14:46:00',
    };
    const [outW, outH] = exportOutputSize(600, 800, settings);
    expect(outW).toBe(layout.outWidth);
    expect(outH).toBe(layout.outHeight);
    const resolved = resolveExportFrame(settings, {
      iso: 200,
      metadata: {
        make: '',
        model: '',
        lensMake: '',
        lensModel: '',
        artist: '',
        copyright: '',
        dateTimeOriginal: '2026:11:13 14:46:00',
        subSecTimeOriginal: '',
        offsetTimeOriginal: '',
        exposureTime: 1 / 250,
        fNumber: 4.0,
        exposureBias: 0,
        focalLength: 50,
        focalLength35mm: 50,
        iso: 200,
        gps: null,
      },
    });
    expect(resolved.pentax645?.frameNumber).toBe(5);
    expect(resolved.pentax645?.fNumber).toBe(4.0);
  });
});
