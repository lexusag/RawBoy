import type { DevelopParams } from '../develop/DevelopParams';
import type { BloomSources, PreviewImage } from '../gl/PreviewImage';
import type { LensInfo } from '../lens/LensInfo';
import { RawImage } from '../raw/RawImage';
import { segmentSkin } from '../retouch/SkinSegmenter';
import type { SkinMask } from '../retouch/SkinMask';
import { BASE_MAX_DIMENSION, asShotDefaults, bloomSourcesOf } from '../session/PhotoSession';
import { NO_NOISE, autoDevelop, cameraMetered, type NoiseLevel } from './analysis/AutoTone';
import { analyzeScene, type SceneStats } from './analysis/SceneAnalyzer';

/** Everything learned from a photo once; enough to render it small and to export it (port of Analysis). */
export interface Analysis {
  defaults: DevelopParams;
  autoBase: DevelopParams;
  stats: SceneStats;
  lens: LensInfo;
  base: PreviewImage;
  bloom: BloomSources;
  skin: SkinMask | null;
  description: string;
}

/** Tag of the per-photo stats log, used for recalibrating the auto develop. */
const TAG = 'RawBoyAuto';

/**
 * Decodes [file], keeps its small whole-image copies and works out the auto develop (port of AutoAnalysis.kt).
 * Memory hungry (a full-resolution decode): one at a time. The raw is closed before segmentation, which needs
 * only the 512 px copy.
 */
export async function analyzeFile(file: Blob, label: string): Promise<Analysis> {
  const img = await RawImage.open(file);
  let base: PreviewImage;
  let bloom: BloomSources;
  let noise: NoiseLevel = NO_NOISE;
  const info = {
    lens: img.lens,
    iso: img.iso,
    defaults: asShotDefaults(img),
    description: img.description,
    cameraMetered: cameraMetered(img.metadata.make, img.baselineExposure),
  };
  try {
    const t0 = performance.now();
    base = await img.createPreview(BASE_MAX_DIMENSION);
    bloom = await bloomSourcesOf(img);
    noise = await img.measureNoise();
    console.debug(`${TAG} small copies: ${Math.round(performance.now() - t0)} ms`);
  } finally {
    img.close();
  }
  const t0 = performance.now();
  let skin: SkinMask | null = null;
  try {
    skin = await segmentSkin(base, base.fullWidth, base.fullHeight);
  } catch {
    // MediaPipe can fail; the photo is then treated as having no face.
  }
  console.debug(`${TAG} skin detection: ${Math.round(performance.now() - t0)} ms`);
  const stats = analyzeScene(base, skin, info.iso);
  const auto = autoDevelop(stats, info.defaults, 1, info.cameraMetered, noise);
  console.debug(
    `${TAG} analysis ${label}: key=${stats.key} p1=${stats.p1} p5=${stats.p5} p50=${stats.p50} p98=${stats.p98} p99=${stats.p99} ` +
      `clipped=${stats.clipped} chroma=${stats.chroma} face=${stats.faceArea} skin=${stats.skinLuminance} iso=${info.iso} cameraMetered=${info.cameraMetered} ` +
      `noise=${noise.luma}/${noise.chroma} -> exposure=${auto.exposure} hl=${auto.highlights} denoise=${auto.denoise}/${auto.colorDenoise} sh=${auto.shadows} contrast=${auto.contrast} ` +
      `wb=${Math.trunc(info.defaults.temperature)}K/${Math.trunc(info.defaults.tint)} -> ${Math.trunc(auto.temperature)}K/${Math.trunc(auto.tint)}`,
  );
  return { defaults: info.defaults, autoBase: auto, stats, lens: info.lens, base, bloom, skin, description: info.description };
}

/**
 * The auto develop alone, for a photo already open elsewhere (RawBoy Pro's Auto button): [base] is its 512 px copy,
 * [skin] its skin mask (null: no face metering), [noise] its measured noise. Fast; no decode or segmentation.
 */
export function autoBase(
  base: PreviewImage,
  skin: SkinMask | null,
  iso: number,
  defaults: DevelopParams,
  metered: boolean,
  noise: NoiseLevel = NO_NOISE,
): DevelopParams {
  return autoDevelop(analyzeScene(base, skin, iso), defaults, 1, metered, noise);
}
