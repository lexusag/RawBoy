import type { DevelopParams } from '../develop/DevelopParams';
import type { BloomSources, PreviewImage } from '../gl/PreviewImage';
import type { LensInfo } from '../lens/LensInfo';
import { RawImage } from '../raw/RawImage';
import { segmentSkin } from '../retouch/SkinSegmenter';
import type { SkinMask } from '../retouch/SkinMask';
import type { RawWorker } from '../raw/RawWorker';
import { BASE_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, asShotDefaultsOf, bloomSourcesOf } from '../session/PhotoSession';
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
 * Decodes [file], keeps its small whole-image copies and works out the auto develop (port of AutoAnalysis.kt):
 * [decodeForAnalysis], then [finishAnalysis]. [onPreview], if given, gets the detail view's preview
 * (PREVIEW_MAX_DIMENSION) made from the same decode, so RawBoy Auto can show the photo before decoding it again.
 * [plain] (Auto's "As is" import): no auto develop (autoBase = the as-shot defaults), and the noise measurement and
 * skin segmentation it needs are skipped, so already finished files (TIFFs from another editor...) import fast and
 * stay as they are.
 */
export async function analyzeFile(file: Blob, label: string, onPreview?: (preview: PreviewImage) => void, plain = false): Promise<Analysis> {
  return finishAnalysis(await decodeForAnalysis(file, onPreview, plain), label);
}

/** What [decodeForAnalysis] keeps of a photo: its small copies and what the file says. */
export interface DecodedForAnalysis {
  /** As-shot white (CIE xy), display-referred, clip level: what the as-shot defaults are made from. */
  asShotWhite: number[];
  displayReferred: boolean;
  clipLevel: number;
  lens: LensInfo;
  iso: number;
  description: string;
  cameraMetered: boolean;
  base: PreviewImage;
  bloom: BloomSources;
  noise: NoiseLevel;
  plain: boolean;
}

/**
 * The decode half of [analyzeFile]: memory hungry (a whole decode), so one at a time per decoder [worker]; the raw is
 * closed before it returns. Raws are decoded as drafts (half size, no demosaic: 2-4x faster); the copies kept are
 * small and the noise level is measured as the full decode would read it.
 */
export async function decodeForAnalysis(
  file: Blob, onPreview?: (preview: PreviewImage) => void, plain = false, worker?: RawWorker,
): Promise<DecodedForAnalysis> {
  const img = await RawImage.open(file, 0, true, worker);
  try {
    if (onPreview) onPreview(await img.createPreview(PREVIEW_MAX_DIMENSION));
    const t0 = performance.now();
    const base = await img.createPreview(BASE_MAX_DIMENSION);
    const bloom = await bloomSourcesOf(img);
    const noise = plain ? NO_NOISE : await img.measureNoise();
    console.debug(`${TAG} small copies: ${Math.round(performance.now() - t0)} ms`);
    return {
      asShotWhite: img.asShotWhite,
      displayReferred: img.displayReferred,
      clipLevel: img.clipLevel,
      lens: img.lens,
      iso: img.iso,
      description: img.description,
      cameraMetered: cameraMetered(img.metadata.make, img.baselineExposure),
      base,
      bloom,
      noise,
      plain,
    };
  } finally {
    img.close();
  }
}

/**
 * The rest of [analyzeFile], from the small copies alone: skin segmentation (in its worker, so RawBoy Auto decodes the
 * next photo meanwhile), scene stats and the auto develop. [knownSkin]: a mask found before (null: none), so the
 * segmentation is skipped.
 */
export async function finishAnalysis(d: DecodedForAnalysis, label: string, knownSkin?: SkinMask | null): Promise<Analysis> {
  const t0 = performance.now();
  const defaults = asShotDefaultsOf(d.asShotWhite, d.displayReferred, d.clipLevel);
  let skin: SkinMask | null = knownSkin ?? null;
  if (!d.plain && knownSkin === undefined) {
    try {
      skin = await segmentSkin(d.base, d.base.fullWidth, d.base.fullHeight);
    } catch {
      // MediaPipe can fail; the photo is then treated as having no face.
    }
  }
  console.debug(`${TAG} skin detection: ${Math.round(performance.now() - t0)} ms`);
  const stats = analyzeScene(d.base, skin, d.iso);
  const noise = d.noise;
  const auto = d.plain ? defaults : autoDevelop(stats, defaults, 1, d.cameraMetered, noise);
  console.debug(
    `${TAG} analysis ${label}: key=${stats.key} p1=${stats.p1} p5=${stats.p5} p50=${stats.p50} p98=${stats.p98} p99=${stats.p99} ` +
      `clipped=${stats.clipped} chroma=${stats.chroma} face=${stats.faceArea} skin=${stats.skinLuminance} iso=${d.iso} cameraMetered=${d.cameraMetered} ` +
      `noise=${noise.luma}/${noise.chroma} -> exposure=${auto.exposure} hl=${auto.highlights} denoise=${auto.denoise}/${auto.colorDenoise} sh=${auto.shadows} contrast=${auto.contrast} ` +
      `wb=${Math.trunc(defaults.temperature)}K/${Math.trunc(defaults.tint)} -> ${Math.trunc(auto.temperature)}K/${Math.trunc(auto.tint)}`,
  );
  return { defaults, autoBase: auto, stats, lens: d.lens, base: d.base, bloom: d.bloom, skin, description: d.description };
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
