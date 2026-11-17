package app.rawboy.camera.capture

import app.rawboy.camera.platform.PreviewLevel

/**
 * The viewfinder's gain from linear preview to raw units (`ViewfinderRenderer.Frame.scale`) and the key a shot or raw
 * meter calibrates it from, per [PreviewLevel]. Pure arithmetic, so it can be checked on the JVM.
 */
object ViewfinderGain {
    /**
     * The gain to ease towards: [stored] (the lens's learned calibration) with the frame's [boost] (post-raw digital
     * gain), the still's predicted [stillGain] over the preview, Long exposure's [longGain] over the boosted preview
     * (null when off) and the frame's [neutralFloor] (smallest as-shot neutral component).
     */
    fun target(level: PreviewLevel, stored: Float, boost: Float, stillGain: Float, longGain: Float?, neutralFloor: Float): Float =
        when (level) {
            PreviewLevel.BOOSTED -> stored / boost * (longGain ?: stillGain)
            // The preview is already as bright as the still: only the white balance's normalisation and, with Long
            // exposure, its frames' gain over the still remain.
            PreviewLevel.STILL_WHITE_BALANCED -> stored * neutralFloor * (longGain?.let { it * boost / stillGain } ?: 1f)
        }

    /**
     * A viewfinder copy's scene [key] for calibrating from [stored] (estimate = stored x raw key / this); the copy was
     * drawn at [drawnScale]. [PreviewLevel.BOOSTED]: the key as measured, as the Pixel was tuned.
     * [PreviewLevel.STILL_WHITE_BALANCED]: as if drawn at stored x [neutralFloor]: the gain in use eases there after a
     * lens starts (and after each calibration), so a key taken meanwhile would be judged against the wrong gain.
     */
    fun calibrationKey(level: PreviewLevel, key: Float, stored: Float, drawnScale: Float, neutralFloor: Float): Float =
        when (level) {
            PreviewLevel.BOOSTED -> key
            PreviewLevel.STILL_WHITE_BALANCED -> if (drawnScale > 0f) key * stored * neutralFloor / drawnScale else key
        }
}
