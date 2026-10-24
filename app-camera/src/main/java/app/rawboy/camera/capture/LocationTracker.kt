package app.rawboy.camera.capture

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * The phone's position for geotagging (CameraSettings.geotag): listens to the location providers while [start]ed and
 * keeps the best recent fix. Platform LocationManager, so no Play services: the fused provider where the phone has
 * one (Android 12+), else GPS and network.
 */
class LocationTracker(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(LocationManager::class.java)

    @Volatile
    private var best: Location? = null
    private var running = false

    private val listener = LocationListener { update(it) }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Starts listening (main thread); seeds with the providers' last known fixes. No-op without permission. */
    @SuppressLint("MissingPermission") // checked by hasPermission; a provider the permission doesn't cover throws
    fun start() {
        if (running || manager == null || !hasPermission()) return
        running = true
        for (provider in providers()) {
            try {
                manager.getLastKnownLocation(provider)?.let(::update)
                manager.requestLocationUpdates(provider, UPDATE_MS, UPDATE_METRES, listener, Looper.getMainLooper())
            } catch (e: Exception) {
                Log.d(TAG, "location provider $provider: ${e.message}")
            }
        }
    }

    fun stop() {
        if (!running) return
        running = false
        runCatching { manager?.removeUpdates(listener) }
    }

    /** The best fix no older than [MAX_AGE_MS], or null. */
    fun current(): Location? = best?.takeIf { ageMs(it) <= MAX_AGE_MS }

    private fun providers(): List<String> {
        val all = manager?.allProviders.orEmpty()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && LocationManager.FUSED_PROVIDER in all) {
            return listOf(LocationManager.FUSED_PROVIDER)
        }
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { it in all }
    }

    private fun update(fix: Location) {
        val old = best
        if (old == null || isBetter(fix, old)) best = fix
    }

    /** A newer fix wins unless it is much less accurate and the older one is still recent. */
    private fun isBetter(fix: Location, old: Location): Boolean {
        val newer = (fix.elapsedRealtimeNanos - old.elapsedRealtimeNanos) / 1_000_000
        if (newer > RECENT_MS) return true
        if (newer < -RECENT_MS) return false
        if (!fix.hasAccuracy()) return !old.hasAccuracy() && newer >= 0
        if (!old.hasAccuracy()) return true
        return fix.accuracy <= old.accuracy || (newer >= 0 && fix.accuracy <= old.accuracy * 2)
    }

    private fun ageMs(fix: Location) = (SystemClock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000

    private companion object {
        const val TAG = "RawBoy"
        const val UPDATE_MS = 5_000L
        const val UPDATE_METRES = 5f
        const val RECENT_MS = 30_000L
        /** A shot is tagged with a fix up to this old (indoors the last fix outside is still close). */
        const val MAX_AGE_MS = 10 * 60_000L
    }
}
