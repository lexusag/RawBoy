package app.rawboy.camera.depth

import android.content.Context
import app.rawboy.retouch.DualPixelCalibration
import java.util.Locale

/**
 * The lenses' dual-pixel calibrations ([DepthCalibrationActivity]), by camera id (the shot's `Shot.cameraId`: the
 * logical camera for W). Learned per phone like the flash guides, so kept apart from the settings and their reset.
 */
object DualPixelCalibrations {
    private const val PREFS = "dualPixelCalibration"

    /** The calibration of camera [cameraId], or null. */
    fun get(context: Context, cameraId: String): DualPixelCalibration? {
        val v = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(cameraId, null) ?: return null
        val parts = v.split(',')
        val slope = parts.getOrNull(0)?.toFloatOrNull() ?: return null
        val offset = parts.getOrNull(1)?.toFloatOrNull() ?: return null
        return DualPixelCalibration(slope, offset, parts.getOrNull(2)?.toIntOrNull() ?: 0)
    }

    fun put(context: Context, cameraId: String, c: DualPixelCalibration) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(cameraId, String.format(Locale.ROOT, "%.6f,%.6f,%d", c.slope, c.offset, c.samples))
            .apply()
    }

    fun clear(context: Context, cameraId: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(cameraId).apply()
    }
}
