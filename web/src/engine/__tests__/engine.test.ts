import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_ADJUSTMENTS, applyEditsDevelop, applyLook, developAuto } from '../auto/looks/LookApplier';
import { ALL_FILM_LOOKS, FILM_GRAIN, FilmLooks, filmLookById } from '../auto/looks/FilmLooks';
import { ALL_LOOKS, Looks, isMonochromeLut, lookById, lookSections, lutGroup, lutIdOf } from '../auto/looks/Look';
import { applyAuto, measuredNoiseSettings } from '../auto/analysis/AutoTone';
import { Warmth } from '../auto/analysis/Warmth';
import { Mat3 } from '../color/Mat3';
import { PrimariesTrack } from '../color/PrimariesTrack';
import { Primaries } from '../color/Primaries';
import { WhiteBalance } from '../color/WhiteBalance';
import { CROP_ASPECTS, cropAspectLabel, cropAspectRatio, cropHandleAt, cropWithAspect, dragCrop, FULL_CROP, flipped, rotateCrop, withCrop } from '../develop/CropMath';
import { developParams, effectiveColorDenoise } from '../develop/DevelopParams';
import { decodeEdits, encodeEdits } from '../develop/Edits';
import { BrushRaster, type BrushGuide } from '../develop/BrushRaster';
import { MAX_LENS_BLUR, NO_ADJUST, curveOffset, forPreset, newBrushLayer, newLinearLayer, newRadialLayer, newStripeLayer, parseLayers, type BrushStroke, type MaskLayer } from '../develop/Masks';
import {
  CURVE_MIN_GAP,
  CURVE_SIZE,
  DEFAULT_CURVES,
  IDENTITY_CURVE,
  addCurvePoint,
  curveTable,
  evaluateCurve,
  moveCurvePoint,
  nearestCurvePoint,
  parseCurves,
  removeCurvePoint,
  sampleCurve,
  type CurvePoint,
} from '../develop/ToneCurve';
import { applyPreset, captureLensPreset, capturePreset, chosenLensPreset, decodePresets, DEFAULT_PRESET_GROUPS, encodePresets, isLensPreset, isMonochromePreset, lensPresetFor, NO_LENS_PRESET, presetSections, putLensPreset, type Preset } from '../develop/Presets';
import { BandDownscaler } from '../export/BandDownscaler';
import { FilmStocks } from '../film/FilmStocks';
import { baseNameOf, fileName } from '../export/ExportSettings';
import { NO_LAYERS, ShaderParams, WIDE_DENOISE_MARGIN, packLayers } from '../gl/ShaderParams';
import { BOKEH_RADIUS, bokehGeometry } from '../gl/BokehTexture';
import { SampleGeometry } from '../gl/GlCommon';
import { SCAN_SCALE, filmScanApplies, scanSize } from '../gl/ScanScale';
import { WAVELET_DENOISE_MARGIN, denoiseLevels } from '../gl/WaveletDenoise';
import { ZoomMath, rect } from '../gl/Zoom';
import { LensInfo } from '../lens/LensInfo';
import { LensTransform } from '../lens/LensTransform';
import { parseCube } from '../lut/LutLoader';
import { floatToHalf, halfToFloat } from '../util/half';
import { flareCoarseRows, flareRows, makeFlareSource } from '../gl/FlareSource';

const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('colour', () => {
  it('white balance round-trips temperature and tint', () => {
    for (const [k, t] of [[2850, 0], [5500, 10], [6500, -20], [9000, 35]]) {
      const xy = WhiteBalance.xyFromTempTint(k, t);
      const [k2, t2] = WhiteBalance.tempTintFromXY(xy[0], xy[1]);
      expect(Math.abs(k2 - k) / k).toBeLessThan(1e-3);
      expect(t2).toBeCloseTo(t, 1);
    }
  });

  it('positive tint is above the locus (green illuminant), as in Lightroom', () => {
    const on = WhiteBalance.xyFromTempTint(5500, 0);
    const green = WhiteBalance.xyFromTempTint(5500, 40);
    expect(green[1]).toBeGreaterThan(on[1]);
  });

  it('re-balancing to the same white is the identity', () => {
    const xy = WhiteBalance.xyFromTempTint(4300, 5);
    close(WhiteBalance.rebalanceMatrix(xy, xy), IDENTITY, 1e-6);
  });

  it('primaries at defaults are the identity and keep white neutral when changed', () => {
    close(Primaries.matrix([0, 0, 0], [1, 1, 1], 0, 0), IDENTITY, 1e-6);
    const m = Primaries.matrix([0.1, -0.05, 0.2], [1.2, 0.9, 1.1], 0, 0);
    close(Mat3.apply(m, [1, 1, 1]), [1, 1, 1], 1e-6);
  });

  it('column-major conversion transposes', () => {
    expect(Array.from(Mat3.toGlColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });
});

describe('shader params', () => {
  it('defaults develop the image untouched (identity WB, neutral sliders)', () => {
    const asShot = developParams({ temperature: 5100, tint: 7 });
    const lens = new LensTransform(LensInfo.none(4000, 3000), asShot);
    const p = ShaderParams.from(asShot, asShot, null, lens, null, null, null);
    close(Array.from(p.whiteBalance), IDENTITY, 1e-6);
    expect(p.exposure).toBeCloseTo(2 ** 0.7, 9); // the AgX base lift only
    expect(p.contrast).toBe(1);
    expect(p.saturation).toBe(1);
    expect([p.shadows, p.highlights, p.blacks, p.whites, p.denoise, p.grain, p.bloom, p.skinRetouch]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p.spatialMargin).toBe(ZoomMath.HALO);
    expect(p.toneMapper).toBe(0); // AgX
  });

  it("takes the clip level from the photo's as-shot defaults, not the edit", () => {
    const asShot = developParams({ clipLevel: 0.71 });
    const edit = developParams({ temperature: 3000 });
    expect(ShaderParams.from(edit, asShot, null, new LensTransform(LensInfo.none(100, 100), edit), null, null, null).clipLevel).toBe(0.71);
    const d = developParams();
    expect(ShaderParams.from(d, d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null).clipLevel).toBe(0);
  });

  it('maps the tone mapper to its shader id', () => {
    const d = developParams({ toneMapper: 'sigmoid' });
    expect(ShaderParams.from(d, d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null).toneMapper).toBe(2);
  });

  it('the coarse denoise stage starts above 65 and widens the margin', () => {
    const d = developParams({ denoise: 100 });
    const p = ShaderParams.from(d, d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null);
    expect(p.denoiseWide).toBe(1);
    // The wavelet pre-pass's reach adds to the shader's.
    expect(p.spatialMargin).toBe(WIDE_DENOISE_MARGIN + WAVELET_DENOISE_MARGIN);
  });

  it('any denoise adds the wavelet pre-pass margin', () => {
    const d = developParams({ denoise: 10 });
    const p = ShaderParams.from(d, d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null);
    expect(p.spatialMargin).toBe(ZoomMath.HALO + WAVELET_DENOISE_MARGIN);
  });

  it('wavelet denoise: full-res bands at any preview scale, fine chroma left to the shader', () => {
    const full = denoiseLevels(1, 0.01, 0.01);
    expect(full.map((l) => l.stride)).toEqual([1, 2, 4, 8, 16]);
    expect(full.map((l) => l.chromaThreshold > 0)).toEqual([false, false, true, true, true]);
    // A quarter-size preview: its band 0 is full-res band 2, and three levels reach as far as five at full size.
    const quarter = denoiseLevels(0.25, 0.01, 0.01);
    expect(quarter.length).toBe(3);
    expect(quarter[0].lumaThreshold).toBeCloseTo(full[2].lumaThreshold);
    expect(quarter[0].chromaThreshold).toBeCloseTo(full[2].chromaThreshold);
  });

  it('colour denoise follows luma denoise until set, and has its own coarse stage', () => {
    const lens = (d: ReturnType<typeof developParams>) => new LensTransform(LensInfo.none(100, 100), d);
    const old = developParams({ denoise: 40 });
    const p = ShaderParams.from(old, old, null, lens(old), null, null, null);
    expect([p.denoise, p.colorDenoise]).toEqual([0.4, 0.4]);
    const split = developParams({ denoise: 0, colorDenoise: 100 });
    const q = ShaderParams.from(split, split, null, lens(split), null, null, null);
    expect([q.denoise, q.denoiseWide, q.colorDenoise, q.colorDenoiseWide]).toEqual([0, 0, 1, 1]);
    expect(q.spatialMargin).toBe(WIDE_DENOISE_MARGIN + WAVELET_DENOISE_MARGIN);
  });
});

describe('lens geometry', () => {
  it('is the identity without corrections', () => {
    const l = new LensTransform(LensInfo.none(6000, 4000), developParams());
    expect(l.zoom).toBe(1);
    close(l.source(123.5, 456.25), [123.5, 456.25]);
    expect(l.sourceBounds(rect(100, 100, 50, 50), 16)).toEqual(rect(84, 84, 82, 82));
  });

  it('quarter turns swap the output size and map corners', () => {
    const l = new LensTransform(LensInfo.none(6000, 4000), developParams({ rotation: 1 }));
    expect([l.outputWidth, l.outputHeight]).toEqual([4000, 6000]);
    // Clockwise turn: the output's top-right corner is the image's top-left.
    close(l.source(4000, 0), [0, 0], 1e-6);
  });

  it('orientation matrices are invertible and map the image onto the sensor', () => {
    for (let o = 1; o <= 8; o++) {
      const m = LensTransform.orientationMatrix(o, 300, 200);
      const inv = Mat3.inverse(m);
      close(Mat3.multiply(m, inv), IDENTITY, 1e-9);
    }
  });

  it('manual chromatic aberration scales the red and blue planes around the centre only', () => {
    const l = new LensTransform(LensInfo.none(6000, 4000), developParams({ caRed: 100, caBlue: -50 }));
    expect(l.zoom).toBe(1); // no auto scale
    close(l.source(0, 0, 1), [0, 0]);
    // +100 enlarges red by 0.2%: the corner samples 0.2% nearer the centre.
    close(l.source(0, 0, 0), [3000 * 0.002, 2000 * 0.002], 1e-9);
    close(l.source(0, 0, 2), [-3000 * 0.001, -2000 * 0.001], 1e-9);
    close(l.source(3000, 2000, 0), [3000, 2000], 1e-9);
    // Tiles reach the planes' samples too.
    const b = l.sourceBounds(rect(5900, 3900, 100, 100), 0);
    expect(b.x).toBeLessThanOrEqual(5900 - 3);
  });

  it('chromatic aberration travels with lens presets into Auto', () => {
    const lens = captureLensPreset(developParams({ caRed: 40, caBlue: -20 }), 'XF23mmF2 R WR');
    const p = developAuto(developParams(), ALL_LOOKS[0], 100, NO_ADJUSTMENTS, false, null, lens);
    expect([p.caRed, p.caBlue]).toEqual([40, -20]);
  });

  it('manual distortion zooms in so no empty corners show', () => {
    const l = new LensTransform(LensInfo.none(6000, 4000), developParams({ lensDistortion: -60 }));
    expect(l.zoom).toBeGreaterThan(1);
    const corner = l.source(0, 0);
    expect(corner[0]).toBeGreaterThan(-0.6);
    expect(corner[1]).toBeGreaterThan(-0.6);
  });

  it('anamorphic distortion bows verticals while keeping horizontals straight, and Crop adjusts zoom and frame clipping', () => {
    const info = LensInfo.none(6000, 4000);
    const auto = new LensTransform(info, developParams({ lensAnamorphic: -60 }));
    expect(auto.clipFrame).toBe(false);
    expect(auto.zoom).toBeGreaterThan(1);
    // Horizontals keep constant source y when radial distortion is 0.
    const y0 = auto.source(1000, 500)[1];
    expect(auto.source(3000, 500)[1]).toBeCloseTo(y0, 9);
    expect(auto.source(5000, 500)[1]).toBeCloseTo(y0, 9);
    // Off-centre verticals bow horizontally between vertical centre and top/bottom.
    expect(auto.source(1000, 200)[0]).not.toBeCloseTo(auto.source(1000, 2000)[0], 3);
    for (const [x, y] of [[0, 0], [6000, 0], [0, 2000], [3000, 0]]) {
      const s = auto.source(x, y);
      expect(s[0]).toBeGreaterThan(-0.6);
      expect(s[0]).toBeLessThan(6000.6);
      expect(s[1]).toBeGreaterThan(-0.6);
      expect(s[1]).toBeLessThan(4000.6);
    }
    const zoomedOut = new LensTransform(info, developParams({ lensAnamorphic: -60, lensCrop: -100 }));
    expect(zoomedOut.clipFrame).toBe(true);
    expect(zoomedOut.zoom).toBeLessThan(auto.zoom);
    expect(zoomedOut.source(0, 0)[0]).toBeLessThan(-10);
    const tighter = new LensTransform(info, developParams({ lensAnamorphic: -60, lensCrop: 100 }));
    expect(tighter.clipFrame).toBe(false);
    expect(tighter.zoom).toBeGreaterThan(auto.zoom);

    // Extreme positive pincushion + anamorphic stays monotone and invertible even when zoomed out.
    const mono = new LensTransform(info, developParams({ lensDistortion: 100, lensAnamorphic: 100, lensCrop: -100 }));
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const sx = mono.source(i * 300, 200)[0];
      expect(sx).toBeGreaterThan(prev);
      prev = sx;
    }
    const extreme = new LensTransform(info, developParams({ lensDistortion: 100, lensAnamorphic: 100, lensCrop: -100, straighten: 6, rotation: 1 }));
    for (const [x, y] of [[200, 300], [1800, 1200], [3500, 5200]]) {
      const s = extreme.source(x, y);
      close(extreme.output(s[0], s[1]), [x, y], 1e-2);
    }
  });
});

describe('crop', () => {
  const warped = new LensInfo(
    'test', 6000, 4000, 4000, 6000, 6,
    { planes: 3, coefficients: [1, -0.02, 0.01, 0, 0.001, -0.002, 1.001, -0.02, 0.01, 0, 0.001, -0.002, 1.002, -0.02, 0.01, 0, 0.001, -0.002], centerX: 0.48, centerY: 0.52 },
    { k: [-0.3, 0.1, 0, 0, 0], centerX: 0.5, centerY: 0.5 },
    null,
    0,
  );
  const edit = { lensDistortion: 40, lensAnamorphic: -35, lensCrop: -20, vignetteAmount: 30, straighten: 7.5, rotation: 1 };

  it('a full crop changes nothing', () => {
    const a = new LensTransform(warped, developParams(edit));
    const b = new LensTransform(warped, withCrop(developParams(edit), FULL_CROP));
    expect(b.cropRect).toEqual(rect(0, 0, a.frameWidth, a.frameHeight));
    close(b.outToImage, a.outToImage);
  });

  it('lens correction works on the full frame: a cropped pixel is the uncropped pixel', () => {
    const full = new LensTransform(warped, developParams(edit));
    const cropped = new LensTransform(warped, developParams({ ...edit, cropLeft: 0.3, cropTop: 0.1, cropRight: 0.8, cropBottom: 0.45 }));
    expect(cropped.zoom).toBe(full.zoom);
    expect(cropped.frameWidth).toBe(full.frameWidth);
    const c = cropped.cropRect;
    expect([cropped.outputWidth, cropped.outputHeight]).toEqual([c.width, c.height]);
    expect([c.x, c.y]).toEqual([Math.round(0.3 * full.frameWidth), Math.round(0.1 * full.frameHeight)]);
    for (const [x, y] of [[0, 0], [c.width, c.height], [123.5, 77.25]]) {
      for (const plane of [0, 1, 2]) close(cropped.source(x, y, plane), full.source(x + c.x, y + c.y, plane), 1e-6);
    }
    // A reused auto scale gives the same transform.
    const reused = new LensTransform(warped, developParams({ ...edit, cropLeft: 0.3, cropTop: 0.1, cropRight: 0.8, cropBottom: 0.45 }), full.zoom);
    close(reused.outToImage, cropped.outToImage);
  });

  it('turns with the picture', () => {
    const r = { left: 0.1, top: 0.2, right: 0.5, bottom: 0.6 };
    close(Object.values(rotateCrop(r, 1)), [0.4, 0.1, 0.8, 0.5]);
    close(Object.values(rotateCrop(r, 4)), Object.values(r));
    close(Object.values(rotateCrop(rotateCrop(r, 1), -1)), Object.values(r));
    // The same frame content stays selected: the crop centre follows the image point through a quarter turn.
    const before = new LensTransform(LensInfo.none(6000, 4000), withCrop(developParams(), r));
    const after = new LensTransform(LensInfo.none(6000, 4000), withCrop(developParams({ rotation: 1 }), rotateCrop(r, 1)));
    close(before.source(before.outputWidth / 2, before.outputHeight / 2), after.source(after.outputWidth / 2, after.outputHeight / 2), 1e-6);
  });

  it('scale zooms around the centre while preserving resolution of the frame', () => {
    const info = LensInfo.none(6000, 4000);
    const unscaled = new LensTransform(info, developParams());
    const scaled = new LensTransform(info, developParams({ scale: 150 }));
    // Preserves output resolution:
    expect(scaled.outputWidth).toBe(unscaled.outputWidth);
    expect(scaled.outputHeight).toBe(unscaled.outputHeight);
    // Centre of frame maps to centre of image:
    const cx = unscaled.outputWidth / 2;
    const cy = unscaled.outputHeight / 2;
    close(scaled.source(cx, cy), unscaled.source(cx, cy), 1e-6);
    // Zoomed in by 1.5x: moving 150 px in output corresponds to 100 px in source:
    const s1 = scaled.source(cx + 150, cy);
    const s0 = unscaled.source(cx + 100, cy);
    close(s1, s0, 1e-6);
  });

  it('flips mirror the picture as shown, crop and straighten included', () => {
    const info = LensInfo.none(6000, 4000);
    for (const rotation of [0, 1, 2, 3]) {
      for (const vertical of [false, true]) {
        const before = developParams({ ...edit, rotation, cropLeft: 0.1, cropTop: 0.2, cropRight: 0.5, cropBottom: 0.9 });
        const a = new LensTransform(warped, before);
        const b = new LensTransform(warped, flipped(before, vertical));
        expect([b.outputWidth, b.outputHeight]).toEqual([a.outputWidth, a.outputHeight]);
        // Crop edges round to whole pixels, so allow a pixel's worth.
        for (const [x, y] of [[0, 0], [a.outputWidth, 0], [137.5, 401.25]]) {
          const m = vertical ? [x, a.outputHeight - y] : [a.outputWidth - x, y];
          for (const plane of [0, 1, 2]) close(b.source(m[0], m[1], plane), a.source(x, y, plane), 2);
        }
        // Twice is no flip.
        close(new LensTransform(warped, flipped(flipped(before, vertical), vertical)).outToImage, a.outToImage, 1e-9);
      }
    }
    // Without a turn, a horizontal flip mirrors the image about its centre.
    const plain = new LensTransform(info, flipped(developParams(), false));
    expect(plain.flipHorizontal).toBe(true);
    close(plain.source(100, 50), [5900, 50], 1e-6);
    // After a quarter turn the picture's left-right is the photo's top-bottom.
    expect(flipped(developParams({ rotation: 1 }), false).flipVertical).toBe(true);
  });

  it('aspect ratios and drags keep the shape and stay inside the frame, including cinema 2:1 and 2.39:1', () => {
    expect(CROP_ASPECTS).toContain('2:1');
    expect(CROP_ASPECTS).toContain('2.39:1');
    expect([cropAspectLabel('2:1', false), cropAspectLabel('2:1', true)]).toEqual(['2:1', '1:2']);
    expect([cropAspectLabel('2.39:1', false), cropAspectLabel('2.39:1', true)]).toEqual(['2.39:1', '1:2.39']);
    expect(cropAspectRatio('2:1', 6000, 4000, false)).toBeCloseTo(2, 9);
    expect(cropAspectRatio('2:1', 6000, 4000, true)).toBeCloseTo(0.5, 9);
    expect(cropAspectRatio('2.39:1', 6000, 4000, false)).toBeCloseTo(2.39, 9);
    expect(cropAspectRatio('2.39:1', 6000, 4000, true)).toBeCloseTo(1 / 2.39, 9);
    const scope = cropWithAspect(FULL_CROP, 2.39, 6000, 4000);
    expect(scope.left).toBeCloseTo(0, 6);
    expect(scope.right).toBeCloseTo(1, 6);
    expect(((scope.right - scope.left) * 6000) / ((scope.bottom - scope.top) * 4000)).toBeCloseTo(2.39, 5);

    const r = cropWithAspect(FULL_CROP, 1, 6000, 4000);
    expect(((r.right - r.left) * 6000) / ((r.bottom - r.top) * 4000)).toBeCloseTo(1, 6);
    expect(r.top).toBeCloseTo(0, 6);
    expect(r.bottom).toBeCloseTo(1, 6);
    const d = dragCrop(r, 'bottomRight', -0.1, 0.3, 1, 6000, 4000);
    expect(((d.right - d.left) * 6000) / ((d.bottom - d.top) * 4000)).toBeCloseTo(1, 6);
    expect(d.bottom).toBeLessThanOrEqual(1);
    const m = dragCrop({ left: 0.2, top: 0.2, right: 0.4, bottom: 0.4 }, 'move', 0.9, -0.5, null, 6000, 4000);
    close(Object.values(m), [0.8, 0, 1, 0.2], 1e-6);
    const free = dragCrop(FULL_CROP, 'left', 0.25, 0, null, 6000, 4000);
    close(Object.values(free), [0.25, 0, 1, 1], 1e-6);
    expect(cropHandleAt(FULL_CROP, 0.01, 0.99, 0.02, 0.02)).toBe('bottomLeft');
    expect(cropHandleAt(FULL_CROP, 0.5, 0.5, 0.02, 0.02)).toBe('move');
    expect(cropHandleAt({ left: 0.2, top: 0.2, right: 0.4, bottom: 0.4 }, 0.9, 0.9, 0.02, 0.02)).toBeNull();
  });
});

describe('presets', () => {
  it('puts black and white presets and LUTs in their own section', () => {
    const lut = 'asset:luts/Yellow Mono 400.cube';
    const mono = capturePreset('Mono', developParams({ lut }), ['lut']);
    const grey = capturePreset('Grey', developParams({ saturation: -100 }), ['color']);
    const half = capturePreset('Half', developParams({ lut, lutAmount: 50 }), ['lut']);
    const warm = capturePreset('Warm', developParams({ lut: 'asset:luts/Yellow Warm 200.cube' }), ['lut']);
    expect([mono, grey, half, warm].map(isMonochromePreset)).toEqual([true, true, false, false]);
    // A film stock drops the LUT, so the photo keeps its colour.
    expect(isMonochromePreset(capturePreset('Film', developParams({ lut, film: 'portra400' }), ['light', 'lut']))).toBe(false);
    expect(presetSections([warm, mono, half, grey])).toEqual([
      { label: 'Color', presets: [warm, half] },
      { label: 'Black & white', presets: [mono, grey] },
    ]);
    expect(presetSections([warm])).toEqual([{ label: null, presets: [warm] }]);
    expect(presetSections([mono])).toEqual([{ label: 'Black & white', presets: [mono] }]);
    expect(isMonochromeLut(lut)).toBe(true);
    expect(isMonochromeLut('asset:luts/Yellow Mono Soft.cube')).toBe(true);
    expect(isMonochromeLut('asset:luts/Redscale.png')).toBe(false);
    expect(isMonochromeLut('asset:luts/Movie Green.cube')).toBe(false);
    expect(isMonochromeLut(null)).toBe(false);
  });

  it('lists looks and bundled LUTs as Color, Experimental, Black & white', () => {
    const sections = lookSections(ALL_LOOKS);
    expect(sections.map((s) => s.group)).toEqual(['color', 'experimental', 'monochrome']);
    expect(sections[1].looks).toEqual([Looks.MOVIE_GREEN, Looks.REDSCALE, Looks.LAGOON, Looks.VIOLET_DUST, Looks.UNSEEN]);
    expect(sections.reduce((n, s) => n + s.looks.length, 0)).toBe(ALL_LOOKS.length);
    expect(lookSections(ALL_FILM_LOOKS)).toHaveLength(1);
    expect(lutGroup('asset:luts/Redscale.png')).toBe('experimental');
    expect(lutGroup('asset:luts/Movie Green.cube')).toBe('experimental');
    expect(lutGroup('asset:luts/Unseen.cube')).toBe('experimental');
    expect(lutGroup('asset:luts/Yellow Mono 400.cube')).toBe('monochrome');
    expect(lutGroup('asset:luts/Yellow Vivid 100.cube')).toBe('color');
    expect(lutGroup('asset:luts/Film Flash.cube')).toBe('color');
    expect(lutGroup(null)).toBe('color');
    expect(lookById('filmflash')).toBe(Looks.FILM_FLASH);
  });

  const edited = developParams({
    exposure: 0.7, contrast: 20, temperature: 4200, tint: 8, grain: 30, lut: 'asset:luts/x.cube', lutAmount: 60,
    lensProfile: false, rotation: 1, straighten: 3, cropLeft: 0.1,
  });

  it('captures only the chosen groups, never geometry', () => {
    const p = capturePreset(' Warm ', edited, DEFAULT_PRESET_GROUPS);
    expect(p.name).toBe('Warm');
    expect(p.values.exposure).toBe(0.7);
    expect(p.values.lut).toBe('asset:luts/x.cube');
    expect(p.values.temperature).toBe(4200); // white balance is on by default
    expect('lensProfile' in p.values).toBe(false); // lens is off by default
    expect('rotation' in p.values || 'straighten' in p.values || 'cropLeft' in p.values).toBe(false);
  });

  it('applies its fields and leaves the rest', () => {
    const p = capturePreset('Light only', edited, ['light']);
    const target = developParams({ temperature: 6000, grain: 10, rotation: 2 });
    const out = applyPreset(p, target);
    expect(out.exposure).toBe(0.7);
    expect(out.contrast).toBe(20);
    expect(out.grain).toBe(10);
    expect(out.temperature).toBe(6000);
    expect(out.rotation).toBe(2);
  });

  it('keeps grain size, roughness and colour in the Detail group', () => {
    const grainy = developParams({ grain: 40, grainSize: 60, grainRoughness: 30, grainColor: 0 });
    const out = applyPreset(capturePreset('Grain', grainy, ['detail']), developParams());
    expect([out.grain, out.grainSize, out.grainRoughness, out.grainColor]).toEqual([40, 60, 30, 0]);
    const old = applyPreset(capturePreset('Old', developParams({ grain: 40 }), ['light']), grainy);
    expect([old.grainSize, old.grainRoughness, old.grainColor]).toEqual([60, 30, 0]);
  });

  it('round-trips through the file format and skips what it does not know', () => {
    const a = capturePreset('A', edited, ['light', 'lut', 'lens']);
    const b = capturePreset('B', edited, ['whiteBalance']);
    const [a2, b2] = decodePresets(encodePresets([a, b]));
    expect(a2.values).toEqual(a.values);
    expect(a2.groups).toEqual(['light', 'lut', 'lens']);
    expect(b2.values).toEqual({ temperature: 4200, tint: 8 });
    expect(a2.id).not.toBe(a.id);
    const [single] = decodePresets(encodePresets([a]));
    expect(single.name).toBe('A');
    const future = decodePresets(
      JSON.stringify({ format: 'rawboy-preset', version: 2, name: 'F', groups: ['light', 'hdr'], values: { exposure: 1, hdrAmount: 5, grain: 9 } }),
    );
    expect(future[0].groups).toEqual(['light']);
    expect(future[0].values).toEqual({ exposure: 1 });
    expect(() => decodePresets('{"name":"x"}')).toThrow();
  });

  it('keeps the tone mapper in the Light group and ignores unknown ones', () => {
    const [p] = decodePresets(encodePresets([capturePreset('F', developParams({ toneMapper: 'filmic' }), ['light'])]));
    expect(p.values.toneMapper).toBe('filmic');
    expect(applyPreset(p, developParams()).toneMapper).toBe('filmic');
    const bad = { ...p, values: { toneMapper: 'aces' } };
    expect(applyPreset(bad, developParams({ toneMapper: 'sigmoid' })).toneMapper).toBe('sigmoid');
  });

  it('keeps local contrast in the Detail group', () => {
    const [p] = decodePresets(encodePresets([capturePreset('T', developParams({ localContrast: 35 }), ['detail'])]));
    expect(applyPreset(p, developParams()).localContrast).toBe(35);
    expect(applyPreset(capturePreset('L', developParams({ localContrast: 35 }), ['light']), developParams()).localContrast).toBe(0);
  });

  it('keeps anamorphic flare and color in the Detail group and round-trips them', () => {
    const flare = developParams({ anamorphic: 45, anamorphicColor: 'magenta', anamorphicGhosts: true });
    const [p] = decodePresets(encodePresets([capturePreset('Flare', flare, ['detail'])]));
    expect(p.values).toMatchObject({ anamorphic: 45, anamorphicColor: 'magenta', anamorphicGhosts: true });
    const applied = applyPreset(p, developParams());
    expect(applied.anamorphic).toBe(45);
    expect(applied.anamorphicColor).toBe('magenta');
    expect(applied.anamorphicGhosts).toBe(true);

    // Unknown color key is ignored, leaving existing
    const bad = { ...p, values: { ...p.values, anamorphicColor: 'cyan' as never } };
    expect(applyPreset(bad, developParams({ anamorphicColor: 'golden' })).anamorphicColor).toBe('golden');
  });

  it('anamorphic flare maps to shader params with nonlinear strength and color tint', () => {
    const d = developParams({ anamorphic: 50, anamorphicColor: 'golden' });
    const sp = ShaderParams.from(d, d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null);
    expect(sp.anamorphic).toBeCloseTo(0.5 * (0.35 + 0.65 * 0.5), 5);
    close(Array.from(sp.anamorphicTint), [1.2, 0.9, 0.55, 0], 1e-5);
    close(Array.from(sp.anamorphicLength), [1, 0.7, 0.4, 0], 1e-5);
    expect(ShaderParams.from(developParams({ anamorphic: 50, anamorphicGhosts: true }), d, null, new LensTransform(LensInfo.none(100, 100), d), null, null, null).anamorphicTint[3]).toBe(1);

    const neutral = developParams({ anamorphic: 0, anamorphicColor: 'neutral' });
    const spNeutral = ShaderParams.from(neutral, neutral, null, new LensTransform(LensInfo.none(100, 100), neutral), null, null, null);
    expect(spNeutral.anamorphic).toBe(0);
    close(Array.from(spNeutral.anamorphicTint), [1, 1, 1, 0], 1e-5);
  });
});

describe('mask layers', () => {
  const sky = { ...newLinearLayer('Sky'), adjust: { ...NO_ADJUST, exposure: -1, temperature: 30 } };
  const spot = { ...newRadialLayer(), invert: true, opacity: 50, adjust: { ...NO_ADJUST, clarity: 40 } };

  it('packs only layers that change the image, unless their mask is shown', () => {
    expect(packLayers([], 4000, 3000, 5500, 0, true)).toBe(NO_LAYERS);
    const empty = newRadialLayer();
    expect(packLayers([empty], 4000, 3000, 5500, 0, true).count).toBe(0);
    expect(packLayers([empty], 4000, 3000, 5500, 0, true, empty.id).view).toBe(1);
    expect(packLayers([{ ...sky, enabled: false }, spot], 4000, 3000, 5500, 0, true).count).toBe(1);
  });

  it('puts gradients in image pixels and turns warmer for + temperature', () => {
    const u = packLayers([sky, spot], 4000, 3000, 5500, 0, false);
    expect(u.count).toBe(2);
    // linear: p0 in px, then the direction over its squared length (p0 -> p1 is 1050 px straight down)
    close([...u.geom.slice(0, 4)], [2000, 450, 0, 1 / 1050], 1e-6);
    // radial: centre, 1 / radius (fractions of the long side)
    close([...u.geom.slice(4, 8)], [2000, 1500, 1 / 1000, 1 / 720], 1e-6);
    expect(u.color[4 + 1]).toBe(0); // clarity waits for the base copy
    expect(u.color[4 + 2]).toBeCloseTo(0.5);
    expect(u.color[4 + 3]).toBe(1);
    // Warmer: the layer matrix lifts red over blue on a grey pixel (column-major).
    const m = u.whiteBalance;
    const r = m[0] + m[3] + m[6];
    const b = m[2] + m[5] + m[8];
    expect(r).toBeGreaterThan(b);
    close([...u.whiteBalance.slice(9, 18)], [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-6); // no temperature/tint: identity
  });

  it('bends linear masks the way the overlay draws them', () => {
    const bent = { ...sky, shape: { kind: 'linear' as const, x0: 0.5, y0: 0.1, x1: 0.5, y1: 0.4, curve: 40 } };
    const u = packLayers([bent], 4000, 3000, 5500, 0, true);
    // The shader's t at a point on the overlay's centre line (along = len/2 - offset, across = s) is 0.5.
    const len = 900;
    const across = 1200;
    const along = len / 2 - curveOffset(40, across, 4000);
    const [px, py] = [2000 - across, 300 + along]; // perp = (-dy, dx)/len = (-1, 0)
    const g = u.geom;
    const d = [px - g[0], py - g[1]];
    const t = d[0] * g[2] + d[1] * g[3];
    const n = Math.hypot(g[2], g[3]);
    const s = (d[0] * -g[3] + d[1] * g[2]) / n;
    expect(t + u.shape[1] * s * s).toBeCloseTo(0.5, 6);
    expect(packLayers([{ ...bent, shape: { ...bent.shape, curve: 0 } }], 4000, 3000, 5500, 0, true).shape[1]).toBe(0);
  });

  it('packs a stripe like a light leak streak and keeps it through presets', () => {
    const band = { ...newStripeLayer(), adjust: { ...NO_ADJUST, exposure: 1 } };
    const bent = { ...band, shape: { ...band.shape, angle: 90, bend: 50, taper: -40, feather: 20 } };
    const u = packLayers([bent], 4000, 3000, 5500, 0, true);
    close([...u.geom.slice(0, 4)], [2000, 1500, 1 / 2200, 1 / 320], 1e-6);
    close([...u.shape.slice(0, 4)], [3, 0, 1, 0.2], 1e-6);
    // bend 50 over a 2200 px half length; the ends fade over the sides' 64 px
    close([...u.form.slice(0, 4)], [0.5 / 2200, -0.4, 64 / 2200, 0], 1e-7);
    const [p] = decodePresets(encodePresets([capturePreset('S', developParams({ masks: [bent] }), ['masks'])]));
    const out = applyPreset(p, developParams()).masks[0];
    expect(out.shape).toEqual(bent.shape);
    // Older or partial stripes: straight and even.
    const [plain] = parseLayers([{ shape: { kind: 'stripe', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.05, angle: 0, feather: 50 } }]);
    expect(plain.shape).toMatchObject({ kind: 'stripe', bend: 0, taper: 0 });
    expect(plain.name).toBe('Stripe');
  });

  it('round-trips through presets with fresh ids and drops broken layers', () => {
    const edited = developParams({ masks: [sky, spot] });
    expect(DEFAULT_PRESET_GROUPS).not.toContain('masks');
    const [p] = decodePresets(encodePresets([capturePreset('M', edited, ['masks'])]));
    const out = applyPreset(p, developParams({ exposure: 1 }));
    expect(out.exposure).toBe(1);
    expect(out.masks.map((l) => l.name)).toEqual(['Sky', 'Radial']);
    expect(out.masks[0].adjust.exposure).toBe(-1);
    expect(out.masks[1].invert).toBe(true);
    expect(out.masks[0].id).not.toBe(sky.id);
    const parsed = parseLayers([
      { shape: { kind: 'linear', x0: 0, y0: 0, x1: 0, y1: 'x' } },
      { shape: { kind: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 } }, // before curvature: straight
      { shape: { kind: 'blob' } },
      { shape: { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, angle: 0, feather: 500 }, opacity: 300, adjust: { exposure: 99 } },
      'nope',
    ]);
    expect(parsed.length).toBe(2);
    expect(parsed[0].shape.kind === 'linear' && parsed[0].shape.curve).toBe(0);
    expect(parsed[1].opacity).toBe(100);
    expect(parsed[1].adjust.exposure).toBe(5);
    expect(parsed[1].shape.kind === 'radial' && parsed[1].shape.feather).toBe(100);
  });

  it('packs lens blur as a radius and sizes the bokeh texture to it', () => {
    const blurred = { ...newRadialLayer(), adjust: { ...NO_ADJUST, lensBlur: 50 } };
    const u = packLayers([blurred], 6000, 4000, 5500, 0, true);
    expect(u.count).toBe(1); // lens blur alone makes a layer count
    expect(u.blur[0]).toBeCloseTo(0.5 * MAX_LENS_BLUR * 6000);
    const [neg, big] = parseLayers([
      { shape: { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, angle: 0, feather: 50 }, adjust: { lensBlur: -20 } },
      { shape: { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, angle: 0, feather: 50 }, adjust: { lensBlur: 300 } },
    ]);
    expect(neg.adjust.lensBlur).toBe(0);
    expect(big.adjust.lensBlur).toBe(100);

    const source = { width: 1536, height: 1024, pixels: new Uint16Array(0), fullWidth: 6000, fullHeight: 4000 };
    const params = (layers: MaskLayer[]) => {
      const lens = new LensTransform(LensInfo.none(6000, 4000), developParams());
      return ShaderParams.from(developParams({ masks: layers }), developParams(), null, lens, null, null, null, 1, 1, null, () => null, null, source);
    };
    expect(bokehGeometry(params([]))).toBeNull();
    const g = bokehGeometry(params([blurred]))!;
    expect(g.maxRadius).toBeCloseTo(BOKEH_RADIUS, 0);
    expect(g.width / g.height).toBeCloseTo(1.5, 1);
    // A small blur can't use more than the source copy.
    const faint = bokehGeometry(params([{ ...blurred, adjust: { ...NO_ADJUST, lensBlur: 1 } }]))!;
    expect(faint.width).toBe(1536);
    expect(faint.maxRadius).toBeLessThan(BOKEH_RADIUS);
  });
});

describe('brush', () => {
  const W = 200;
  const H = 100;
  const noGuide = (): BrushGuide => ({ lum: new Float32Array(W * H), red: new Float32Array(W * H), blue: new Float32Array(W * H) });
  const stroke = (id: string, points: number[], over: Partial<BrushStroke> = {}): BrushStroke => ({
    id, erase: false, auto: false, radius: 0.05, hardness: 50, flow: 60, points, ...over,
  });
  const a = stroke('a', [0.1, 0.5, 0.3, 0.5, 0.5, 0.6, 0.7, 0.4]);
  const b = stroke('b', [0.2, 0.2, 0.8, 0.8], { erase: true, radius: 0.03 });
  const c = stroke('c', [0.5, 0.2, 0.5, 0.8], { flow: 100 });

  it('draws the same incrementally as all at once', () => {
    const whole = new BrushRaster(W, H, noGuide);
    whole.sync([a, b, c]);
    const step = new BrushRaster(W, H, noGuide);
    for (let n = 2; n <= a.points.length; n += 2) step.sync([{ ...a, points: a.points.slice(0, n) }]);
    step.sync([a, { ...b, points: b.points.slice(0, 2) }]);
    step.sync([a, b]);
    step.sync([a, b, c]);
    expect([...step.rg]).toEqual([...whole.rg]);
    // Undo: back to a and b only, redrawn from scratch.
    const ab = new BrushRaster(W, H, noGuide);
    ab.sync([a, b]);
    step.sync([a, b]);
    expect([...step.rg]).toEqual([...ab.rg]);
  });

  it('applies paint and erase in order and tracks what changed', () => {
    const r = new BrushRaster(W, H, noGuide);
    const k = 50 * W + 100; // centre
    r.sync([stroke('p', [0.5, 0.5], { flow: 100, hardness: 100 })]);
    expect(r.rg[k * 2]).toBe(255);
    expect(r.rg[k * 2 + 1]).toBe(0);
    const v = r.version;
    r.sync([stroke('p', [0.5, 0.5], { flow: 100, hardness: 100 }), stroke('e', [0.5, 0.5], { erase: true, flow: 100, hardness: 100 })]);
    expect(r.rg[k * 2]).toBe(0);
    expect(r.rg[k * 2 + 1]).toBe(255);
    const pending = r.pendingRect(v);
    expect(pending).not.toBe('all');
    expect(pending && pending !== 'all' && pending.width).toBeLessThan(W);
    expect(r.pendingRect(r.version)).toBeNull();
    expect(r.pendingRect(v - 5)).toBe('all');
  });

  it('auto mask stays on the colour under the brush', () => {
    const guide = noGuide();
    for (let y = 0; y < H; y++) for (let x = 100; x < W; x++) guide.lum[y * W + x] = 3; // 3 EV brighter on the right
    const r = new BrushRaster(W, H, () => guide);
    r.sync([stroke('x', [0.45, 0.5], { auto: true, flow: 100, hardness: 100, radius: 0.1 })]);
    expect(r.rg[(50 * W + 92) * 2]).toBeGreaterThan(200); // left of the edge: painted
    expect(r.rg[(50 * W + 108) * 2]).toBe(0); // right of it: untouched
  });

  it('packs brush layers into atlas slots and keeps strokes out of presets', () => {
    const painted = { ...newBrushLayer(), adjust: { ...NO_ADJUST, exposure: 1 }, strokes: [a] };
    const sky = { ...newLinearLayer(), adjust: { ...NO_ADJUST, exposure: -1 }, strokes: [b] };
    const raster = new BrushRaster(W, H, noGuide);
    const u = packLayers([{ ...newBrushLayer(), adjust: { ...NO_ADJUST, exposure: 1 } }, sky, painted], 4000, 3000, 5500, 0, true, null, () => raster);
    expect(u.count).toBe(2); // the empty brush layer has no mask
    expect(u.shape[4]).toBe(2);
    expect(u.brush).toEqual([raster, raster]);
    const kept = forPreset([sky, painted]);
    expect(kept.length).toBe(1);
    expect(kept[0].strokes).toEqual([]);
    const [p] = decodePresets(encodePresets([capturePreset('M', developParams({ masks: [sky, painted] }), ['masks'])]));
    expect(applyPreset(p, developParams()).masks.map((l) => [l.shape.kind, l.strokes.length])).toEqual([['linear', 0]]);
  });

  it('places the 100% view consistently with viewRect', () => {
    const [left, top, w, h] = ZoomMath.zoomedRect(1500, 1000, 800, 600, 4000, 3000);
    const v = ZoomMath.viewRect(1500, 1000, 800, 600, 4000, 3000);
    expect([w, h]).toEqual([4000, 3000]);
    expect(left + v.x).toBe(0); // the visible region's left edge at the view's left edge
    expect(top + v.y).toBe(0);
  });

  it('keeps the frame around the zoomed view, and the photo edges reachable inside it', () => {
    const v = ZoomMath.viewRect(0, 0, 800, 600, 4000, 3000, 1, 12);
    expect(v).toEqual({ x: 0, y: 0, width: 776, height: 576 });
    const [left, top] = ZoomMath.zoomedRect(0, 0, 800, 600, 4000, 3000, 1, 12);
    expect([left, top]).toEqual([12, 12]); // the photo's corner just inside the frame
    expect(ZoomMath.clampCenter(4000, 3000, 800, 600, 4000, 3000, 1, 12)).toEqual([4000 - 388, 3000 - 288]);
  });
});

describe('lens output', () => {
  it('inverts source() with straighten and distortion', () => {
    const lens = new LensTransform(LensInfo.none(4000, 3000), developParams({ straighten: 7, lensDistortion: 40, rotation: 1 }));
    for (const [x, y] of [[100, 200], [1500, 900], [2900, 3800]]) {
      const s = lens.source(x, y);
      const o = lens.output(s[0], s[1]);
      close(o, [x, y], 1e-2);
    }
  });
});

describe('LUTs', () => {
  it('parses a .cube (red fastest)', () => {
    const lines = ['TITLE "id"', 'LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
    const lut = parseCube('x', lines.join('\n'));
    expect(lut.size).toBe(2);
    expect(Array.from(lut.data.subarray(3, 6))).toEqual([1, 0, 0]);
    expect(Array.from(lut.data.subarray(21, 24))).toEqual([1, 1, 1]);
  });

  it('rejects 1D and short .cube files', () => {
    expect(() => parseCube('x', 'LUT_1D_SIZE 4')).toThrow();
    expect(() => parseCube('x', 'LUT_3D_SIZE 2\n0 0 0')).toThrow();
  });
});

describe('auto looks', () => {
  it('bundles every look LUT', () => {
    for (const l of ALL_LOOKS) if (l.lutFile) expect(existsSync(new URL(`../../../../luts/${l.lutFile}`, import.meta.url)), l.lutFile).toBe(true);
  });

  it('Strength 0 is the auto develop alone, without the LUT', () => {
    const base = developParams({ exposure: 0.5, contrast: 15, temperature: 6000, tint: 5 });
    const p = applyLook(base, Looks.PORTRA_400, 0, NO_ADJUSTMENTS, false);
    expect(p.lut).toBeNull();
    expect(p).toMatchObject({ exposure: 0.5, contrast: 15, temperature: 6000, tint: 5 });
  });

  it('applies the look scaled by strength', () => {
    const base = developParams({ temperature: 6000 });
    const p = applyLook(base, Looks.GOLD_200, 80, NO_ADJUSTMENTS, false);
    expect(p.lut).toBe(lutIdOf(Looks.GOLD_200));
    expect(p.lut).toBe('asset:luts/Yellow Warm 200.cube');
    expect(p.grain).toBeCloseTo(25 * 0.8, 9);
    expect(p.temperature).toBeCloseTo(6000 + 200 * 0.8, 9);
  });

  it('adjustments are offsets on top of the auto develop and the look', () => {
    const base = developParams({ contrast: 15, saturation: 30, denoise: 20, temperature: 6000, tint: 5 });
    const p = applyLook(base, Looks.NATURAL, 100, { ...NO_ADJUSTMENTS, contrast: -20, saturation: 10, denoise: -50, tint: 8 }, false);
    expect(p).toMatchObject({ contrast: -5, saturation: 40, denoise: 0, temperature: 6000, tint: 13 });
  });

  it('Denoise moves colour denoise first and luma later and gently', () => {
    const base = developParams({ denoise: 20, colorDenoise: 30 });
    const at = (denoise: number) => {
      const p = applyLook(base, Looks.NATURAL, 100, { ...NO_ADJUSTMENTS, denoise }, false);
      return [p.denoise, p.colorDenoise];
    };
    expect(at(0)).toEqual([20, 30]);
    expect(at(25)).toEqual([23.75, 73.75]);
    expect(at(50)).toEqual([35, 100]);
    expect(at(100)).toEqual([80, 100]);
    expect(at(-20)).toEqual([0, 26]);
    expect(at(-100)).toEqual([0, 0]);
    // A colour denoise that follows luma gets its own value once Denoise moves.
    const iso = applyLook(developParams({ denoise: 20, colorDenoise: null }), Looks.NATURAL, 100, { ...NO_ADJUSTMENTS, denoise: 50 }, false);
    expect([iso.denoise, iso.colorDenoise]).toEqual([35, 95]);
    expect(applyLook(developParams({ denoise: 20, colorDenoise: null }), Looks.NATURAL, 100, NO_ADJUSTMENTS, false).colorDenoise).toBeNull();
  });

  it('rotation adds quarter turns to the photo, wrapping at four', () => {
    const base = developParams({ rotation: 1 });
    expect(applyLook(base, Looks.NATURAL, 100, NO_ADJUSTMENTS, false).rotation).toBe(1);
    expect(applyLook(base, Looks.NATURAL, 100, { ...NO_ADJUSTMENTS, rotation: 3 }, false).rotation).toBe(0);
    expect(applyLook(developParams(), Looks.NATURAL, 0, { ...NO_ADJUSTMENTS, rotation: 3 }, false).rotation).toBe(3);
  });

  it('Saturation -100 is black and white whatever the auto develop and the look add', () => {
    const base = developParams({ saturation: 30 });
    const look = { ...Looks.NATURAL, saturation: 20 };
    expect(applyLook(base, look, 100, { ...NO_ADJUSTMENTS, saturation: -100 }, false).saturation).toBe(-100);
    expect(applyLook(base, look, 100, { ...NO_ADJUSTMENTS, saturation: -50 }, false).saturation).toBeCloseTo(-25, 9);
  });

  it('removed looks, stocks and LUTs resolve to the closest kept one', () => {
    expect(lookById('ultramax400')).toBe(Looks.PORTRA_800);
    expect(lookById('portra160')).toBe(Looks.PORTRA_400);
    expect(filmLookById('c200').id).toBe('xtra400');
    expect(filmLookById('ultramax400').id).toBe('portra800');
    expect(FilmStocks.byId('portra160')?.id).toBe('portra400');
    const old = applyPreset({ id: 'x', name: 'Old', groups: ['light', 'lut'], values: { film: 'c200', lut: 'asset:luts/Kodak Portra 160.cube' } }, developParams());
    expect(old.film).toBe('xtra400');
    expect(old.lut).toBe('asset:luts/Yellow Portrait 400.cube');
  });

  it('every film look has a stock, its two LUTs and its own grain and halation', () => {
    for (const l of ALL_FILM_LOOKS) {
      if (!l.film) continue;
      const s = FilmStocks.byId(l.film);
      expect(s, l.film).not.toBeNull();
      for (const f of [s!.filmLut, s!.printLut]) expect(existsSync(new URL(`../../../../luts/spektrafilm/${f}`, import.meta.url)), f).toBe(true);
      expect(s!.formation.grainRms.every((v) => v > 0)).toBe(true);
      expect(s!.formation.halation[0]).toBeGreaterThan(0);
    }
  });

  it('a film look replaces the LUT; Strength blends it and 0 turns it off', () => {
    const base = developParams();
    const full = applyLook(base, FilmLooks.PORTRA_400, 100, NO_ADJUSTMENTS, false);
    expect(full).toMatchObject({ film: 'portra400', filmAmount: 100, lut: null });
    expect(applyLook(base, FilmLooks.PORTRA_400, 50, NO_ADJUSTMENTS, false).filmAmount).toBeCloseTo(50, 9);
    expect(applyLook(base, FilmLooks.PORTRA_400, 0, NO_ADJUSTMENTS, false).film).toBeNull();
    expect(applyLook(base, Looks.PORTRA_400, 100, NO_ADJUSTMENTS, false).film).toBeNull();
  });

  it('Grain scales a film look\'s grain 0..2x', () => {
    const grain = (g: number) => applyLook(developParams(), FilmLooks.PORTRA_400, 100, { ...NO_ADJUSTMENTS, grain: g }, false).filmGrain;
    expect([grain(-50), grain(0), grain(50)]).toEqual([0, FILM_GRAIN, 2 * FILM_GRAIN]);
  });

  it('renders no film until the stock is loaded', () => {
    const p = applyLook(developParams(), FilmLooks.PORTRA_400, 100, NO_ADJUSTMENTS, false);
    const lens = new LensTransform(LensInfo.none(100, 100), p);
    expect(ShaderParams.from(p, developParams(), null, lens, null, null, null).filmAmount).toBe(0);
  });

  it('warming adds magenta, cooling adds green', () => {
    const p = developParams({ temperature: 5000, tint: 0 });
    expect(Warmth.shift(p, 1.5).tint).toBeGreaterThan(0);
    expect(Warmth.shift(p, 0.7).tint).toBeLessThan(0);
  });
});

describe('export', () => {
  it('limits the long side and keeps the aspect', () => {
    expect(BandDownscaler.outputSize(6208, 8280, 3000)).toEqual([2249, 3000]);
    expect(BandDownscaler.outputSize(6000, 4000, null)).toEqual([6000, 4000]);
    expect(BandDownscaler.outputSize(2000, 1000, 3000)).toEqual([2000, 1000]);
  });

  it('a film scan is 1.5x the output, only with a film look on', () => {
    expect(SCAN_SCALE).toBe(1.5);
    expect(scanSize(6208, 8280)).toEqual([9312, 12420]);
    expect(scanSize(1001, 667)).toEqual([1502, 1001]);
    expect(filmScanApplies({ film: null, filmAmount: 100 })).toBe(false);
    expect(filmScanApplies({ film: {}, filmAmount: 0 })).toBe(false);
    expect(filmScanApplies({ film: {}, filmAmount: 60 })).toBe(true);
  });

  it('a scaled render spans the photo in fractions of a pixel', () => {
    const plain = new SampleGeometry(100, 100, rect(10, 10, 100, 100), rect(5, 6, 64, 32), 1000, 800);
    expect(plain.outputF).toEqual([5, 6, 64, 32]);
    const scan = new SampleGeometry(150, 150, rect(10, 10, 100, 100), rect(1024, 512, 1024, 512), 1000, 800, 1, 1.5);
    expect(scan.outputF[0]).toBeCloseTo(1024 / 1.5, 9);
    expect(scan.outputF[1]).toBeCloseTo(512 / 1.5, 9);
    expect(scan.outputF[2]).toBeCloseTo(1024 / 1.5, 9);
  });

  it('names files like Android', () => {
    expect(fileName(baseNameOf('IMG_1234.CR3'), 'jpg', 0, { suffix: 'rawboy' })).toBe('IMG_1234-rawboy.jpg');
    expect(fileName('IMG_1234', 'jpg', 2, { suffix: 'auto' })).toBe('IMG_1234-auto-002.jpg');
    expect(baseNameOf('a:b?.dng')).toBe('a_b_');
  });

  it('decodes half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
  });
});

describe('Pro Auto button', () => {
  it('takes light and colour from the auto develop and keeps the LUT, geometry and retouch', () => {
    const current = { ...developParams(), toneMapper: 'filmic' as const, exposure: 1, lut: 'portra', lutAmount: 60, grain: 30, rotation: 1, skinRetouch: 40 };
    const auto = { ...developParams(), exposure: -0.35, contrast: 20, saturation: 30, temperature: 4800, denoise: 20, sharpening: 15, grain: 5 };
    const p = applyAuto(current, auto);
    expect([p.toneMapper, p.exposure, p.contrast, p.saturation, p.temperature, p.denoise]).toEqual(['agx', -0.35, 20, 30, 4800, 20]);
    expect([p.lut, p.lutAmount, p.grain, p.rotation, p.skinRetouch]).toEqual(['portra', 60, 30, 1, 40]);
  });
  it('sets both denoises from the measured noise (as AutoToneTest)', () => {
    expect(measuredNoiseSettings({ luma: 0.0107, chroma: 0.0141 }, 2)).toEqual([17, 93, 8]);
    expect(measuredNoiseSettings({ luma: 0.0023, chroma: 0.0019 }, 0)).toEqual([0, 6, 15]);
    expect(measuredNoiseSettings({ luma: 0.05, chroma: 0.05 }, 0)[1]).toBe(100);
  });
});

describe('Halation slider', () => {
  it('is the stock\'s own at 100, linear below and doubling every 25 above', () => {
    expect(ShaderParams.halationGain(0)).toBe(0);
    expect(ShaderParams.halationGain(50)).toBeCloseTo(0.5);
    expect(ShaderParams.halationGain(100)).toBeCloseTo(1);
    expect(ShaderParams.halationGain(125)).toBeCloseTo(2);
    expect(ShaderParams.halationGain(200)).toBeCloseTo(16);
  });
});

describe('Film tone mapper in presets', () => {
  it('the Light group carries the film, and old presets leave it alone', () => {
    const film = developParams({ film: 'ektar100', filmAmount: 70, filmGrain: 150, halation: 50 });
    const preset = decodePresets(encodePresets([capturePreset('Ektar', film, ['light'])]))[0];
    expect(applyPreset(preset, developParams())).toMatchObject({ film: 'ektar100', filmAmount: 70, filmGrain: 150, halation: 50 });
    const noFilm = capturePreset('AgX', developParams(), ['light']);
    expect(applyPreset(noFilm, film).film).toBeNull(); // a Light preset without film turns it off
    const old = { ...noFilm, values: { toneMapper: 'agx', exposure: 1 } };
    expect(applyPreset(old, film)).toMatchObject({ film: 'ektar100', exposure: 1 });
  });
});

describe('PrimariesTrack', () => {
  // Values printed by the Kotlin PrimariesTrack (5 steps, defaults; 8-bit, truncated): within one level.
  const near = (got: number[][], want: string[]) =>
    want.forEach((h, i) => [1, 3, 5].forEach((o, ch) => expect(Math.abs(got[i][ch] * 255 - parseInt(h.slice(o, o + 2), 16))).toBeLessThan(1.01)));

  it('matches the Kotlin engine', () => {
    const p = developParams();
    near(PrimariesTrack.colors(p, 'redHue', -15, 15, 5), ['#ff7595', '#ff7587', '#ff7575', '#ff8875', '#ff9875']);
    near(PrimariesTrack.colors(p, 'bluePurity', -100, 100, 5), ['#9393ff', '#8585ff', '#7575ff', '#6363ff', '#4d4dff']);
    near(PrimariesTrack.colors(p, 'tintHue', -180, 180, 5), ['#e2fffd', '#fae9ff', '#ffc9cd', '#e7ffe0', '#e2fffd']);
  });
});

describe('split denoise in presets', () => {
  it('the Denoise & sharpening group carries both denoises', () => {
    const preset = decodePresets(encodePresets([capturePreset('Split', developParams({ denoise: 30, colorDenoise: 60, sharpening: 7 }), ['denoise'])]))[0];
    expect(applyPreset(preset, developParams({ colorDenoise: 5 }))).toMatchObject({ denoise: 30, colorDenoise: 60, sharpening: 7 });
    // Detail alone leaves them.
    const detail = decodePresets(encodePresets([capturePreset('Grain', developParams({ denoise: 30, grain: 40 }), ['detail'])]))[0];
    expect(detail.groups).toEqual(['detail']);
    expect(applyPreset(detail, developParams({ denoise: 5 }))).toMatchObject({ denoise: 5, grain: 40 });
  });

  it('presets from before the Denoise group: Detail-only ones keep their denoise, ones with Light leave it', () => {
    const detail = decodePresets('{"format":"rawboy-preset","version":1,"name":"D","groups":["detail"],"values":{"denoise":40,"colorDenoise":80,"sharpening":9,"grain":20}}')[0];
    expect(detail.groups).toEqual(['detail', 'denoise']);
    expect(applyPreset(detail, developParams())).toMatchObject({ denoise: 40, colorDenoise: 80, sharpening: 9, grain: 20 });
    const scene = decodePresets('{"format":"rawboy-preset","version":1,"name":"S","groups":["light","detail"],"values":{"contrast":10,"denoise":40,"grain":20}}')[0];
    expect(scene.groups).toEqual(['light', 'detail']);
    expect(applyPreset(scene, developParams({ denoise: 5 }))).toMatchObject({ contrast: 10, denoise: 5, grain: 20 });
  });

  it('presets from before the split set both from the one denoise', () => {
    const old = '{"format":"rawboy-preset","version":1,"name":"Old","groups":["detail"],"values":{"denoise":40}}';
    const applied = applyPreset(decodePresets(old)[0], developParams({ colorDenoise: 10 }));
    expect(applied).toMatchObject({ denoise: 40, colorDenoise: null });
    expect(effectiveColorDenoise(applied)).toBe(40);
  });
});

describe('curves', () => {
  const s: CurvePoint[] = [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]];

  it('passes through its points and stays monotone between them', () => {
    for (const [x, y] of s) expect(evaluateCurve(s, x)).toBeCloseTo(y, 6);
    const v = sampleCurve(s, 101);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    // Same values as ToneCurveTest.kt, so the ports agree.
    expect(evaluateCurve(s, 0.1)).toBeCloseTo(0.06528, 5);
    expect(evaluateCurve(s, 0.5)).toBeCloseTo(0.5, 6);
    expect(evaluateCurve(s, 0.9)).toBeCloseTo(0.93472, 5);
    // Flat beyond the end points.
    expect(evaluateCurve([[0.1, 0.2], [0.9, 0.7]], 0.05)).toBeCloseTo(0.2, 6);
    expect(evaluateCurve([[0.1, 0.2], [0.9, 0.7]], 0.95)).toBeCloseTo(0.7, 6);
  });

  it('turns off at the identity and puts each channel after the RGB curve', () => {
    expect(curveTable(DEFAULT_CURVES)).toBeNull();
    expect(ShaderParams.from(developParams(), developParams(), null, new LensTransform(LensInfo.none(100, 100), developParams()), null, null, null).curve).toBeNull();
    const t = curveTable({ ...DEFAULT_CURVES, rgb: [[0, 0.2], [1, 1]], red: [[0, 1], [1, 0]] })!;
    expect(t.length).toBe(CURVE_SIZE * 3);
    expect(t[0]).toBeCloseTo(0.8, 6); // red: inverted after the RGB lift
    expect(t[1]).toBeCloseTo(0.2, 6);
    expect(t[(CURVE_SIZE - 1) * 3]).toBeCloseTo(0, 6);
    expect(t[(CURVE_SIZE - 1) * 3 + 2]).toBeCloseTo(1, 6);
  });

  it('adds, moves and removes points within their neighbours', () => {
    const added = addCurvePoint(IDENTITY_CURVE, 0.5, 0.6)!;
    expect(added.index).toBe(1);
    expect(added.points).toEqual([[0, 0], [0.5, 0.6], [1, 1]]);
    expect(addCurvePoint(added.points, 0.51, 0.3)).toBeNull(); // too close
    expect(moveCurvePoint(added.points, 1, 1.5, -1)).toEqual([[0, 0], [1 - CURVE_MIN_GAP, 0], [1, 1]]);
    expect(moveCurvePoint(added.points, 0, 0.7, 0.1)[0]).toEqual([0.5 - CURVE_MIN_GAP, 0.1]);
    expect(removeCurvePoint(added.points, 1)).toEqual(IDENTITY_CURVE);
    expect(removeCurvePoint(added.points, 0)).toBe(added.points);
  });

  it('finds the nearest point on screen in a wide box', () => {
    expect(nearestCurvePoint(s, 0.25, 0.28, 0.05)).toBe(-1);
    // A box 0.4 as tall as wide: 0.1 of its height is 0.04 of its width, inside the radius.
    expect(nearestCurvePoint(s, 0.25, 0.28, 0.05, 0.4)).toBe(1);
  });

  it('round-trips through presets in their own group and rejects malformed curves', () => {
    const curves = { ...DEFAULT_CURVES, rgb: s, blue: [[0, 0.1], [1, 0.9]] as CurvePoint[] };
    const p = capturePreset('Curve', developParams({ curves, exposure: 1 }), ['curves']);
    expect(p.values).toEqual({ curves });
    const [p2] = decodePresets(encodePresets([p]));
    expect(p2.groups).toEqual(['curves']);
    expect(applyPreset(p2, developParams({ exposure: 2 }))).toEqual(developParams({ curves, exposure: 2 }));
    const parsed = parseCurves({ rgb: [[0, 0], [0.5, 2], [1, 1]], red: [[0.5, 0], [0.2, 1]], green: 'x' })!;
    expect(parsed.rgb).toEqual([[0, 0], [0.5, 1], [1, 1]]);
    expect(parsed.red).toEqual(IDENTITY_CURVE); // not sorted
    expect(parsed.green).toEqual(IDENTITY_CURVE);
    expect(parseCurves([1, 2])).toBeNull();
  });
});

describe('lens presets', () => {
  it('round-trip with their lens and match it, ignoring case', () => {
    const lens = captureLensPreset(developParams({ lensDistortion: -12, lensAnamorphic: -45, lensCrop: -30, vignetteAmount: 40 }), 'XF23mmF2 R WR');
    expect(isLensPreset(lens)).toBe(true);
    expect(lens.name).toBe('XF23mmF2 R WR');
    const [decoded] = decodePresets(encodePresets([lens]));
    expect(decoded.lens).toBe('XF23mmF2 R WR');
    expect(Object.keys(decoded.values).sort()).toEqual([
      'caBlue', 'caRed', 'lensAnamorphic', 'lensCrop', 'lensDistortion', 'lensProfile', 'vignetteAmount', 'vignetteMidpoint',
    ]);
    const applied = applyPreset(decoded, developParams());
    expect([applied.lensAnamorphic, applied.lensCrop]).toEqual([-45, -30]);
    const look = capturePreset('Look', developParams(), ['light', 'lens'], 'XF23mmF2 R WR');
    expect(isLensPreset(look)).toBe(false);
    expect(lensPresetFor([look, decoded], ' xf23mmf2 r wr')).toBe(decoded);
    expect(lensPresetFor([look, decoded], 'XF35mmF2 R WR')).toBeNull();
    // A lens-only preset naming no lens (a manual lens, or saved before the lens was recorded) is only picked by hand.
    const [manual] = decodePresets('{"format":"rawboy-preset","version":1,"name":"Helios 44-2","groups":["lens"],"values":{"lensDistortion":5}}');
    expect(manual.lens).toBeUndefined();
    expect(lensPresetFor([manual], 'XF35mmF2 R WR')).toBeNull();
    expect(lensPresetFor([manual], '')).toBeNull();
    expect(lensPresetFor([manual, decoded], 'XF23mmF2 R WR')).toBe(decoded);
  });

  it('are picked by lens, by id or not at all', () => {
    const auto = captureLensPreset(developParams({ lensDistortion: 3 }), 'XF23mmF2 R WR');
    const manual = captureLensPreset(developParams({ lensDistortion: -8 }), '', 'Helios 44-2');
    expect(manual.name).toBe('Helios 44-2');
    expect(manual.lens).toBeUndefined();
    const list = [auto, manual];
    expect(chosenLensPreset(list, null, 'XF23mmF2 R WR')).toBe(auto);
    expect(chosenLensPreset(list, null, '')).toBeNull();
    expect(chosenLensPreset(list, manual.id, 'XF23mmF2 R WR')).toBe(manual);
    expect(chosenLensPreset(list, NO_LENS_PRESET, 'XF23mmF2 R WR')).toBeNull();
    expect(chosenLensPreset([auto], manual.id, '')).toBeNull();
  });

  it('named for manual lenses live side by side', () => {
    const helios = captureLensPreset(developParams({ lensDistortion: 5 }), '', 'Helios 44-2');
    const jupiter = captureLensPreset(developParams({ lensDistortion: 2 }), '', 'Jupiter-9');
    const list = [helios, jupiter].reduce<Preset[]>(putLensPreset, []);
    expect(list.length).toBe(2);
    const updated = putLensPreset(list, captureLensPreset(developParams({ lensDistortion: 7 }), '', 'helios 44-2 '));
    expect(updated.map((p) => p.id)).toEqual([helios.id, jupiter.id]);
    expect(updated[0].values.lensDistortion).toBe(7);
    // One photo, one recorded lens, two names: two presets.
    const a = captureLensPreset(developParams({ lensDistortion: 1 }), '----', 'Helios 44-2');
    const b = captureLensPreset(developParams({ lensDistortion: 2 }), '----', 'Jupiter-9');
    expect(putLensPreset([a], b)).toHaveLength(2);
  });

  it('saved again replace the one for that lens', () => {
    const first = captureLensPreset(developParams({ lensDistortion: 5 }), '50mm');
    const other = captureLensPreset(developParams({ lensDistortion: 9 }), '85mm');
    const list = putLensPreset([first, other], captureLensPreset(developParams({ lensDistortion: 7 }), '50mm'));
    expect(list.map((p) => p.id)).toEqual([first.id, other.id]);
    expect(list[0].values.lensDistortion).toBe(7);
  });

  it('change only the lens settings, on top of the look or a RawBoy preset', () => {
    const lens = captureLensPreset(
      developParams({ lensProfile: false, lensDistortion: -15, lensAnamorphic: -45, lensCrop: -30, vignetteAmount: 20, vignetteMidpoint: 30 }),
      '24mm',
    );
    const base = developParams({ exposure: 1.2, temperature: 5600 });
    const plain = developAuto(base, Looks.NATURAL, 100, NO_ADJUSTMENTS, false, null, null);
    const p = developAuto(base, Looks.NATURAL, 100, NO_ADJUSTMENTS, false, null, lens);
    expect(p).toEqual({
      ...plain, lensProfile: false, lensDistortion: -15, lensAnamorphic: -45, lensCrop: -30, vignetteAmount: p.vignetteAmount, vignetteMidpoint: 30,
    });
    // The look's own vignette stays on top of the lens preset's.
    expect(p.vignetteAmount).toBeCloseTo(Math.min(100, Math.max(-100, 20 + plain.vignetteAmount - base.vignetteAmount)), 5);
    // A RawBoy preset's Lens group gives way to the lens preset; its other groups stay.
    const street = capturePreset('Street', developParams({ exposure: 0.3, lensDistortion: 40, lensAnamorphic: 25, lensCrop: 15, vignetteAmount: -50 }), ['light', 'lens']);
    const q = developAuto(base, Looks.NATURAL, 100, NO_ADJUSTMENTS, false, street, lens);
    expect(q.exposure).toBeCloseTo(0.3, 6);
    expect(q.lensDistortion).toBe(-15);
    expect(q.lensAnamorphic).toBe(-45);
    expect(q.lensCrop).toBe(-30);
    expect(q.vignetteAmount).toBe(20);
  });

  it('round-trips lensAnamorphic and lensCrop in photo edits', () => {
    const defaults = developParams();
    const edited = developParams({ lensAnamorphic: -55, lensCrop: -25 });
    const text = encodeEdits(edited, defaults);
    expect(text).not.toBeNull();
    expect(decodeEdits(text!, defaults)).toEqual(edited);
  });
});

describe('applyEditsDevelop', () => {
  // "Back to Auto": RawBoy's edits come back exactly as made, with Auto's adjustments on top.
  const edits = { ...developParams(), exposure: 0.7, contrast: 20, denoise: 40, sharpening: 30, rotation: 1 };
  it('keeps the edits unchanged with no adjustments', () => {
    expect(applyEditsDevelop(edits, NO_ADJUSTMENTS)).toEqual(edits);
  });
  it('adds the adjustments to the edits, denoise and sharpening from the edits', () => {
    const p = applyEditsDevelop(edits, { ...NO_ADJUSTMENTS, contrast: 10, denoise: 5, rotation: 1 });
    expect(p.contrast).toBe(30);
    // Denoise +5 is mostly colour denoise (see the Denoise mapping above).
    expect(p.denoise).toBeCloseTo(40.15, 9);
    expect(p.colorDenoise).toBeCloseTo(49.75, 9);
    expect(p.sharpening).toBe(30);
    expect(p.rotation).toBe(2);
  });

  it('the flare source keeps a small bright lamp and gates a big lit window', () => {
    const w = 900, h = 600;
    const pixels = new Uint16Array(w * h * 3);
    const put = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) pixels[(y * w + x) * 3 + c] = floatToHalf(v);
    };
    put(120, 270, 126, 276, 12); // a lamp
    put(450, 60, 870, 540, 12); // a window
    put(300, 270, 306, 276, 12); // a lamp a little way from it
    const src = { width: w, height: h, pixels, fullWidth: w * 10, fullHeight: h * 10 };
    const f = makeFlareSource(src);
    expect(f.width).toBe(300);
    expect(f.height).toBe(h + 2 * flareCoarseRows(h));
    expect(flareRows(f)).toBe(h);
    const at = (x: number, y: number) => halfToFloat(f.pixels[(y * f.width + x) * 3]);
    expect(at(41, 273)).toBeGreaterThan(5);
    expect(at(101, 273)).toBeGreaterThan(5); // a small light near a big one still flares
    expect(at(200, 300)).toBeLessThan(0.5);
  });
});
