package app.rawboy.gl

import kotlin.math.roundToInt

/**
 * Film scan export constants (port of ScanScale.ts; the pre-pass is [ScanUpscaler], shaders/scan.frag).
 *
 * A film scan renders Film mode [SCALE] times larger than the photo: the image is upscaled first (back projection),
 * then the film grain is generated on the finer pixel pitch, so it reads as a finer scan of the same negative, not as
 * a soft enlargement.
 */
object ScanScale {
    const val SCALE = 1.5f

    /** Source pixels the upscale reads around a pixel: 4 back projection rounds (2 px each), the cubic, the unsharp blur. */
    const val MARGIN = 16

    /**
     * Grain strength at the finer pitch. Per pixel the grain is [SCALE] times stronger (Selwyn: sigma ~ 1/sqrt(area)),
     * but each grain also covers more output pixels, so averaged back to the photo's size it comes out stronger than a
     * plain export's (flat grey through Portra 400: std 0.0538 vs 0.0472). 0.86 matches them: on a portrait's cheek,
     * wall and hair the grain alone, area-averaged back to the photo's size, measured within 0.5% of a plain export's.
     */
    const val GRAIN = 0.86f

    /** Unsharp mask on the upscale (log2 ratio gain), where the develop's own Sharpen then works on top. */
    const val SHARPEN = 1.0f

    /** Output size of a film scan of a [width] x [height] image. */
    fun size(width: Int, height: Int): Pair<Int, Int> = Pair((width * SCALE).roundToInt(), (height * SCALE).roundToInt())

    /** Whether a film scan applies: a film look is on (the scan is Film mode's). */
    fun applies(params: ShaderParams): Boolean = params.film != null && params.filmAmount > 0f
}
