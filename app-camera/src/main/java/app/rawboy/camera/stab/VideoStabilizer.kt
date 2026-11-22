package app.rawboy.camera.stab

import android.content.ContentValues
import android.content.Context
import android.media.MediaMuxer
import android.net.Uri
import android.os.Environment
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import app.rawboy.camera.Edition
import app.rawboy.camera.capture.MotionData
import app.rawboy.camera.platform.MotionGain
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors

/**
 * Stabilize later, on the phone (video-stabilization plan, Phase 2): after a recording with motion data, renders a
 * stabilized copy ([StabPlan] + [StabRenderer]) and saves it beside the video as `<name>-stab.mp4`. One video at a
 * time, on a background thread of the app's own, so it carries on when the camera screen goes; a partial wake lock
 * keeps it going with the screen off.
 */
object VideoStabilizer {
    private const val TAG = "RawBoyStab"

    /** The default crop (plan §12: "0.7 is pretty great"). */
    const val CROP = 0.7

    /** Longest a render may hold the wake lock. */
    private const val WAKE_MS = 15 * 60 * 1000L

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            r.run()
        }, "RawBoy-stabilize")
    }

    private val _pending = MutableStateFlow(0)

    /** Videos queued or being stabilized. */
    val pending: StateFlow<Int> = _pending

    /**
     * Queues [video] (named [name], without extension) with its [motion] file; [done] gets a one-line message for the
     * user (on the stabilizing thread).
     */
    fun enqueue(context: Context, video: Uri, name: String, motion: File, gain: Map<String, MotionGain>, done: (String) -> Unit) {
        val app = context.applicationContext
        _pending.value++
        executor.execute {
            val lock = app.getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RawBoyCamera:stabilize")
            lock.acquire(WAKE_MS)
            try {
                done(stabilize(app, video, name, motion, gain))
            } catch (e: Throwable) {
                Log.w(TAG, "stabilizing $name failed", e)
                done("Couldn't stabilize the video: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                if (lock.isHeld) lock.release()
                _pending.value--
            }
        }
    }

    private fun stabilize(context: Context, video: Uri, name: String, motion: File, gain: Map<String, MotionGain>): String {
        val started = SystemClock.elapsedRealtime()
        val data = MotionData.read(motion.readBytes())
        val input = inputOf(data.headerJson)
        val g = gain[input.label]
        val plan = StabPlan.make(input, data, CROP, floatArrayOf(g?.x ?: 1f, g?.y ?: 1f))
            ?: return "This video can't be stabilized (selfie camera or no motion data)"
        Log.i(TAG, "$name: plan in ${SystemClock.elapsedRealtime() - started} ms, ${plan.outputs.size} frames, eased ${"%.2f".format(plan.eased)}")

        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "$name-stab.mp4")
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + Edition.FOLDER + "/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
            ?: throw IOException("Could not create the stabilized file")
        var ok = false
        try {
            resolver.openFileDescriptor(uri, "w").use { fd ->
                fd ?: throw IOException("Could not open the stabilized file")
                val muxer = MediaMuxer(fd.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                try {
                    StabRenderer(plan, { it.setDataSource(context, video, null) }, muxer).run()
                    muxer.stop()
                } finally {
                    muxer.release()
                }
            }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            ok = true
        } finally {
            if (!ok) runCatching { resolver.delete(uri, null, null) }
        }
        val seconds = (SystemClock.elapsedRealtime() - started) / 1000f
        Log.i(TAG, "$name: stabilized in ${"%.1f".format(seconds)} s")
        return "Stabilized copy saved to Movies/${Edition.FOLDER}"
    }

    /** The geometry and lens [StabPlan] needs, from a `.motion` header. */
    fun inputOf(headerJson: String): StabInput {
        val h = JSONObject(headerJson)
        val rec = h.getJSONObject("recording")
        val lens = h.getJSONObject("lens")
        val active = lens.optJSONArray("activeArray")
        val activeWidth = active?.let { it.getInt(2) - it.getInt(0) } ?: 0
        return StabInput(
            width = rec.getInt("width"),
            height = rec.getInt("height"),
            turns = rec.getInt("turns"),
            sensorOrientation = lens.optInt("sensorOrientation", 90),
            front = lens.optString("facing") == "front",
            activeWidth = activeWidth,
            label = lens.optString("label"),
        )
    }
}
