/**
 * Film scan export constants (port of gl/ScanScale.kt; the pre-pass is ScanUpscaler).
 *
 * A film scan renders Film mode [SCAN_SCALE] times larger than the photo: the image is upscaled first (back
 * projection, shaders/scan.frag), then the film grain is generated on the finer pixel pitch, so it reads as a finer
 * scan of the same negative, not as a soft enlargement.
 */
export const SCAN_SCALE = 1.5;

/** Source pixels the upscale reads around a pixel: 4 back projection rounds (2 px each), the cubic, the unsharp blur. */
export const SCAN_MARGIN = 16;

/**
 * Grain strength at the finer pitch. Per pixel the grain is SCAN_SCALE times stronger (Selwyn: sigma ~ 1/sqrt(area)),
 * but each grain also covers more output pixels, so averaged back to the photo's size it comes out stronger than a plain
 * export's (flat grey through Portra 400: std 0.0538 vs 0.0472). 0.86 matches them: on a portrait's cheek, wall and
 * hair the grain alone, area-averaged back to the photo's size, measured within 0.5% of a plain export's.
 */
export const SCAN_GRAIN = 0.86;

/** Unsharp mask on the upscale (log2 ratio gain), where the develop's own Sharpen then works on top. */
export const SCAN_SHARPEN = 1.0;

/** Output size of a film scan of a [width] x [height] image. */
export function scanSize(width: number, height: number): [number, number] {
  return [Math.round(width * SCAN_SCALE), Math.round(height * SCAN_SCALE)];
}

/** Whether a film scan applies: a film look is on (the scan is Film mode's). */
export function filmScanApplies(params: { film: unknown; filmAmount: number }): boolean {
  return params.film != null && params.filmAmount > 0;
}
