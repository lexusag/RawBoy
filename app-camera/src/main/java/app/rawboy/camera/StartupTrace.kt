package app.rawboy.camera

import android.os.SystemClock
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Lightweight startup and shutter latency tracer (logcat tag `RawBoyStartup`).
 * Logs monotonic milliseconds from launch ([beginLaunch]) once per milestone so cold/warm start regressions
 * and Street Mode timings can be measured directly on phones.
 */
object StartupTrace {
    private const val TAG = "RawBoyStartup"

    @Volatile
    private var launchMs: Long = 0L

    @Volatile
    private var source: String = ""

    private val generation = AtomicInteger(0)
    private val logged = ConcurrentHashMap.newKeySet<String>()

    /** Starts a new launch timing window (called from `CameraActivity.onCreate` / `onNewIntent`). */
    fun beginLaunch(launchSource: String, street: Boolean) {
        launchMs = SystemClock.elapsedRealtime()
        source = launchSource
        generation.incrementAndGet()
        logged.clear()
        Log.i(TAG, "+0 ms launch source=$launchSource street=$street")
    }

    /** Logs [milestone] once for the current launch with elapsed ms since [beginLaunch]. */
    fun mark(milestone: String, detail: String = "") {
        val base = launchMs
        if (base == 0L || !logged.add(milestone)) return
        val dt = SystemClock.elapsedRealtime() - base
        if (detail.isEmpty()) {
            Log.i(TAG, "+$dt ms $milestone ($source)")
        } else {
            Log.i(TAG, "+$dt ms $milestone: $detail ($source)")
        }
    }

    /** Logs a shutter-to-capture timing event (not deduplicated). */
    fun markShutter(event: String, sinceShutterMs: Long, detail: String = "") {
        if (detail.isEmpty()) {
            Log.i(TAG, "shutter +$sinceShutterMs ms $event")
        } else {
            Log.i(TAG, "shutter +$sinceShutterMs ms $event: $detail")
        }
    }
}
