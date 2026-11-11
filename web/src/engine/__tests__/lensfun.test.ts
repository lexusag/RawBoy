import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { developParams } from '../develop/DevelopParams';
import { LensInfo } from '../lens/LensInfo';
import { LensTransform } from '../lens/LensTransform';
import {
  calibrationsOf, cropFactorOf, distortionFactor, fisheyeFov, fitEven, genericCalibration, lensfunCorrection, matchCamera, matchLens, parseIndex, searchByWords,
  DEFAULT_GENERIC, type CalibrationSet, type ChunkJson, type LensfunIndex, type RawIndex,
} from '../lens/Lensfun';

const dir = resolve(__dirname, '../../../public/lensfun');
const index: LensfunIndex = parseIndex(JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as RawIndex);
const setsOf = (name: string): { sets: CalibrationSet[]; lens: (typeof index.lenses)[number] } => {
  const lens = index.lenses.find((l) => l.model === name)!;
  expect(lens).toBeDefined();
  const chunk = JSON.parse(readFileSync(resolve(dir, `calib-${index.chunks[lens.chunk]}.json`), 'utf8')) as ChunkJson;
  return { sets: calibrationsOf(chunk, lens.id), lens };
};

describe('lensfun database', () => {
  it('has the expected size and sources', () => {
    expect(index.cameras.length).toBeGreaterThan(900);
    expect(index.lenses.length).toBeGreaterThan(1400);
    expect(index.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('matches EXIF camera and lens names', () => {
    const cam = matchCamera(index, 'SONY', 'NEX-7')!;
    expect(cam.model).toBe('NEX-7');
    expect(cam.crop).toBeCloseTo(1.534, 3);
    expect(matchCamera(index, 'NIKON CORPORATION', 'NIKON D750')?.model).toBe('Nikon D750');
    expect(matchCamera(index, 'Nobody', 'Imaginary 9000')).toBeNull();
    expect(matchLens(index, 'Sony', 'E 16mm F2.8', cam, 16)?.model).toBe('E 16mm f/2.8');
    expect(matchLens(index, '', 'Some Unknown 17-35mm lens', cam, 20)).toBeNull();
    const fuji = matchCamera(index, 'FUJIFILM', 'X-T3')!;
    expect(matchLens(index, 'FUJIFILM', 'XF18-55mmF2.8-4 R LM OIS', fuji, 30)?.model).toMatch(/XF ?18-55mm ?F ?2\.8-4/i);
    // The mount keeps a Canon EF lens off a Fuji body.
    expect(matchLens(index, 'Canon', 'EF50mm f/1.8 II', fuji, 50)).toBeNull();
  });

  it('searches by words', () => {
    const hits = searchByWords(index.lenses, 'sony 16 f/2.8', (l) => `${l.maker} ${l.model}`);
    expect(hits.some((l) => l.model === 'E 16mm f/2.8')).toBe(true);
  });
});

describe('lensfun correction', () => {
  const { sets, lens } = setsOf('E 16mm f/2.8');
  const shot = { crop: 1.534, focal: 16, aperture: 2.8, distance: 1000 };

  it('puts the calibration into a warp that reproduces the ptlens model', () => {
    const c = lensfunCorrection(sets, shot, lens);
    expect(c.warp?.planes).toBe(3);
    expect(c.warpError).toBeLessThan(2e-4);
    // Direct evaluation of the model at the corner (a, b, c from the database, one set, exact focal).
    const set = sets[0];
    const f = distortionFactor(set.distortion[0], set, shot.crop, 16);
    const k = c.warp!.coefficients;
    const green = k[6] + k[7] + k[8] + k[9];
    expect(green).toBeCloseTo(f(1), 3);
    expect(c.summary).toBe('distortion, chromatic aberration, vignetting');
  });

  it('vignetting gain at the corner equals the model (same crop)', () => {
    const c = lensfunCorrection(sets, shot, lens);
    const k = c.vignette!.k;
    const gain = 1 + k[0] + k[1] + k[2] + k[3] + k[4];
    const e = sets[0].vignetting.find((v) => v[1] === 2.8 && v[2] === 1000)!;
    expect(Math.abs(gain / (1 / (1 + e[3] + e[4] + e[5])) - 1)).toBeLessThan(0.01);
    expect(gain).toBeGreaterThan(1.5);
  });

  it('is the identity at the centre and handles no data', () => {
    const c = lensfunCorrection(sets, shot, lens);
    expect(c.warp!.coefficients[0]).toBeCloseTo(1, 1);
    expect(lensfunCorrection([], shot).warp).toBeNull();
    expect(lensfunCorrection([], shot).summary).toBe('');
  });

  it('follows Lensfun\'s crop rule: no profile for a bigger sensor than the lens was measured on', () => {
    expect(lensfunCorrection(sets, { ...shot, crop: 1 }, lens).warp).toBeNull();
    // A smaller sensor (Micro Four Thirds crop 2) uses the central part: weaker vignetting at its corner.
    const small = lensfunCorrection(sets, { ...shot, crop: 2 }, lens);
    const full = lensfunCorrection(sets, shot, lens);
    const corner = (k: number[]) => k.reduce((s, v) => s + v, 1);
    expect(corner(small.vignette!.k)).toBeLessThan(corner(full.vignette!.k));
  });
});

describe('lensfun maths', () => {
  it('poly3 and ptlens with equal terms agree', () => {
    const set: CalibrationSet = { crop: 1, aspect: 1.5, distortion: [], tca: [], vignetting: [] };
    const p3 = distortionFactor([50, 0, 0, 0.02], set, 1, 50);
    const pt = distortionFactor([50, 0, 2, 0, 0.02, 0], set, 1, 50);
    for (const u of [0, 0.3, 0.7, 1]) expect(p3(u)).toBeCloseTo(pt(u), 9);
  });

  it('fits an even polynomial exactly', () => {
    const k = fitEven((u) => 1 + 0.1 * u * u - 0.05 * u ** 4, 4, 0);
    expect(k[0]).toBeCloseTo(1, 6);
    expect(k[1]).toBeCloseTo(0.1, 6);
    expect(k[2]).toBeCloseTo(-0.05, 6);
    expect(k[3]).toBeCloseTo(0, 6);
  });

  it('interpolates between focal lengths', () => {
    const set: CalibrationSet = {
      crop: 1, aspect: 1.5, tca: [], vignetting: [],
      distortion: [[20, 0, 2, 0, 0.04, 0], [40, 0, 2, 0, 0, 0]],
    };
    const mid = lensfunCorrection([set], { crop: 1, focal: 30, aperture: 4, distance: 1000 });
    const lo = lensfunCorrection([set], { crop: 1, focal: 20, aperture: 4, distance: 1000 });
    const hi = lensfunCorrection([set], { crop: 1, focal: 40, aperture: 4, distance: 1000 });
    expect(Math.abs(lo.warp!.coefficients[1])).toBeGreaterThan(Math.abs(mid.warp!.coefficients[1]));
    expect(Math.abs(mid.warp!.coefficients[1])).toBeGreaterThan(Math.abs(hi.warp!.coefficients[1]));
  });
});

describe('generic lenses', () => {
  it('has no data without coefficients and a ptlens set with them', () => {
    expect(genericCalibration(DEFAULT_GENERIC)).toEqual([]);
    const sets = genericCalibration({ ...DEFAULT_GENERIC, crop: 1.5, a: 0.01, k1: -0.5 });
    const c = lensfunCorrection(sets, { crop: 1.5, focal: 50, aperture: 2.8, distance: 1000 });
    expect(c.warp).not.toBeNull();
    expect(c.vignette).not.toBeNull();
  });

  it('computes the diagonal field of view of fisheye types', () => {
    // Full frame 15 mm equidistant: 21.63 mm half diagonal / 15 mm = 1.442 rad → 165°.
    expect(fisheyeFov('fisheye', 15, 1)).toBeCloseTo(165.2, 0);
    expect(fisheyeFov('equisolid', 15, 1)).toBeCloseTo(180, -1);
    expect(fisheyeFov('rectilinear', 15, 1)).toBe(0);
    expect(cropFactorOf(36, 24)).toBeCloseTo(1, 6);
    expect(cropFactorOf(23.5, 15.6)).toBeCloseTo(1.534, 2);
  });
});

describe('lensfun profile in the lens transform', () => {
  it('moves the corner of each colour plane the way the model says', () => {
    const { sets, lens } = setsOf('E 16mm f/2.8');
    const shot = { crop: 1.534, focal: 16, aperture: 2.8, distance: 1000 };
    const c = lensfunCorrection(sets, shot, lens);
    const base = new LensInfo('', 6000, 4000, 6000, 4000, 1, null, null, null, 0);
    const info = base.withLensfun(c.warp, c.vignette, 'x');
    expect(info.hasProfile).toBe(true);
    const t = new LensTransform(info, developParams(), 1);
    const set = sets[0];
    const fd = distortionFactor(set.distortion[0], set, shot.crop, 16);
    const [gx, gy] = t.source(0, 0, 1);
    // Corner (0, 0) is u = 1 from the centre; the source is the centre plus the offset times the factor.
    // Within a pixel at the corner of a 24 MP frame (the even-polynomial fit's error).
    expect(Math.abs(gx - (3000 - 3000 * fd(1)))).toBeLessThan(1);
    expect(Math.abs(gy - (2000 - 2000 * fd(1)))).toBeLessThan(1);
    // This lens's CA is small at the corner and largest mid-field.
    const [gmx] = t.source(1200, 800, 1);
    const [rx] = t.source(1200, 800, 0);
    const [bx] = t.source(1200, 800, 2);
    // The red and blue planes differ from green by the (small) lateral CA, in opposite senses here.
    expect(Math.abs(rx - gmx)).toBeGreaterThan(0.3);
    expect(Math.abs(rx - gmx)).toBeLessThan(20);
    expect(Math.abs(bx - gmx)).toBeLessThan(20);
    expect(info.fisheyeCircle).toBeNull();
  });
});
