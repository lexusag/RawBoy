package app.rawboy.camera

/**
 * Eases the viewfinder's live exposure between analysed frames (`CameraViewModel.onViewfinderBase`; iOS
 * `CameraViewModel.easedExposure`, keep both in step).
 *
 * Only the metering eases: a new metering area (a tap, a release, a tracked subject hiding) can move the auto exposure by
 * a stop at once, and the viewfinder follows over a few updates. Brightness's AE compensation ([captureEv], AutoTone's)
 * is not eased: the phone's AE puts it into the frames within a few frames, and the develop must take it back out just
 * as fast. When the whole exposure eased, a Brightness move to +3 EV (+2 EV of it as compensation, the rest in the
 * develop) showed the develop's +3 at once, then the raw's +2 on top while the develop took it back out at 0.3 EV per
 * update: the viewfinder overshot to about +4.4 EV and sank back to +3 over ~2 s (and the same the other way down).
 */
object LiveExposure {
    /**
     * The exposure to show: [exposure] is AutoTone's for this frame (compensation [captureEv] already taken out),
     * [lastExposure] / [lastCaptureEv] the previous update's (null = the first: no easing). The metered part
     * (exposure + compensation, the exposure the frame would need without compensation) moves at most [step] EV.
     */
    fun ease(lastExposure: Float?, lastCaptureEv: Float, exposure: Float, captureEv: Float, step: Float): Float {
        if (lastExposure == null) return exposure
        val lastMetered = lastExposure + lastCaptureEv
        val metered = exposure + captureEv
        return lastMetered + (metered - lastMetered).coerceIn(-step, step) - captureEv
    }
}
