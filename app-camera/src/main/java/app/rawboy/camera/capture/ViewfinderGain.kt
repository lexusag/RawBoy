package app.rawboy.camera.capture

import app.rawboy.camera.platform.PreviewLevel

/**
 * The viewfinder's gain from linear preview to raw units (`ViewfinderRenderer.Frame.scale`) and the key a shot or raw
 * meter calibrates it from, per [PreviewLevel]. Pure arithmetic, so it can be checked on the JVM.
 */
object ViewfinderGain {
    /**
     * The gain to ease towards: [stored] (the lens's learned calibration) with the frame's [boost] (post-raw digital
     * gain), the still's predicted [stillGain] over the preview, Long exposure's [longGain] (its frames' exposure time x
     * ISO over the preview frame's, `CameraController.longExposureGainOverPreview`; null when off) and the frame's
     * [neutralFloor] (smallest as-shot neutral component).
     */
    fun target(level: PreviewLevel, stored: Float, boost: Float, stillGain: Float, longGain: Float?, neutralFloor: Float): Float =
        when (level) {
            PreviewLevel.BOOSTED -> stored / boost * (longGain ?: stillGain)
            // The preview is already as bright as the still, boost and all (the DNG carries the boost as BaselineExposure):
            // only the white balance's normalisation and, with Long exposure, its frames' gain over the preview's whole
            // gain (time x ISO x boost; the manual frames have no boost) remain.
            PreviewLevel.STILL_WHITE_BALANCED -> stored * neutralFloor * (longGain?.let { it / boost.coerceAtLeast(1f) } ?: 1f)
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

    /**
     * The raw key of a frame shot at the preview frame's whole gain, from the viewfinder's scene key per unit of scale
     * ([sceneKey], `CameraViewModel.sceneKey`) and the lens's [stored] calibration: what Long exposure lifts from
     * (`CameraSettings.longExposureSpec`). [PreviewLevel.STILL_WHITE_BALANCED] also needs the frame's [neutralFloor]
     * (as [target]); without it the OnePlus 11 read 0.039 for a scene whose raw was 0.019-0.020 and lifted 1 EV short.
     */
    fun longExposureKey(level: PreviewLevel, sceneKey: Float, stored: Float, neutralFloor: Float): Float =
        when (level) {
            PreviewLevel.BOOSTED -> sceneKey * stored
            PreviewLevel.STILL_WHITE_BALANCED -> sceneKey * stored * neutralFloor
        }
}

