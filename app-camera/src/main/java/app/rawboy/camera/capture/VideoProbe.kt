package app.rawboy.camera.capture

import android.content.Context
import android.os.Build
import app.rawboy.gl.EncoderConfig

/**
 * One whole way of recording video: how the encoder's EGL surface is made, which encoder takes it, and whether the
 * viewfinder's own config must be recordable. [VideoProbe] tries them in [ORDER] until the encoder hands out a frame.
 */
enum class VideoVariant(
    /** The EGL configs tried for the encoder's surface ([app.rawboy.gl.VideoSink.encoderConfigs]). */
    val encoderConfigs: List<EncoderConfig>,
    /** A software H.264 encoder instead of the hardware HEVC (H.264 fallback). */
    val softwareAvc: Boolean = false,
    /** The viewfinder is made with a recordable 8-bit RGBA config: needs the view made again. */
    val recordableViewfinder: Boolean = false,
) {
    /** The path every phone took before the probe: what the Pixel 9 Pro records with. */
    STANDARD(EncoderConfig.DEFAULT_ORDER),

    /**
     * The encoder's surface in a context of its own with the recordable config. Qualcomm's HEVC encoder (OnePlus 11)
     * refused the 8-bit RGBX buffers [STANDARD] falls back to, and the driver refused a recordable surface in a context
     * of another config.
     */
    OWN_CONTEXT(listOf(EncoderConfig.RECORDABLE_OWN_CONTEXT)),

    /** The viewfinder itself on a recordable RGBA config, so [STANDARD]'s recordable surface matches its context. */
    RECORDABLE_VIEWFINDER(EncoderConfig.DEFAULT_ORDER, recordableViewfinder = true),

    /** Last resort: the platform's software H.264 encoder (it took the RGBX buffers on the OnePlus 11), on the CPU. */
    SOFTWARE_AVC(EncoderConfig.DEFAULT_ORDER, softwareAvc = true);

    companion object {
        /** [STANDARD] first, so a phone it works on never goes further. */
        val ORDER: List<VideoVariant> = entries.toList()
    }
}

/** Why an attempt recorded nothing. [definite]: the same failure would come again (see [VideoProbe]). */
enum class VideoFailure(val definite: Boolean, val text: String) {
    /** The device refused the encoder's EGL surface. */
    EGL_SURFACE(true, "EGL surface refused"),

    /** The encoder threw before it put out a frame. */
    CODEC_ERROR(true, "encoder error"),

    /** Frames went in, none came out in time. */
    NO_OUTPUT(false, "no frames out"),

    /** The variant's encoder could not be made or configured (it may be busy elsewhere). */
    NO_ENCODER(false, "no encoder"),
}

/** What [VideoProbe] keeps between recordings. */
data class VideoProbeState(
    /** The variant to start with, or null: [VideoVariant.STANDARD] and the whole list. */
    val variant: VideoVariant? = null,
    /** True: [variant] recorded. False: it is next in a probe that needs the viewfinder made again first. */
    val confirmed: Boolean = false,
    /** [VideoProbe.buildKey] when it was stored; another key means a system or app update, so the probe starts over. */
    val buildKey: String = "",
    /** The last probe's attempts, "VARIANT: outcome", for the device report. */
    val lastTries: List<String> = emptyList(),
)

/** Where [VideoProbe] keeps its state. */
interface VideoProbeStore {
    fun read(): VideoProbeState
    fun write(state: VideoProbeState)
}

/**
 * Picks the way to record video on this phone by trying ([run]) and remembers what worked.
 *
 * - A phone [VideoVariant.STANDARD] works on records with it and nothing else is tried or stored.
 * - Another variant is remembered only when [VideoVariant.STANDARD] failed [VideoFailure.definite] in the same probe (or
 *   an earlier one under the same build): a one-off failure (encoder busy, slow to start) may move that recording to
 *   another variant but never the next ones.
 * - A remembered variant goes first; if it fails, the probe starts over from [VideoVariant.STANDARD].
 * - A variant that needs the viewfinder made again ([VideoVariant.recordableViewfinder]) stops the probe
 *   ([Result.NeedsViewfinder]): it is stored as pending, and the next recording, on the new view, starts with it.
 * - A system or app update ([buildKey] changes) forgets everything.
 */
class VideoProbe(
    private val store: VideoProbeStore,
    private val buildKey: String,
    /** The variants in the order to try them ([VideoVariant.ORDER]; a debug override may narrow it). */
    private val order: List<VideoVariant> = VideoVariant.ORDER,
) {
    /** One try of [variant], as the caller saw it. */
    sealed interface Attempt<out R> {
        /** The encoder put out its first frame: [recording] goes on. */
        data class Started<R>(val recording: R) : Attempt<R>

        /** Nothing recorded; the attempt has been cleaned up. */
        data class Failed(val failure: VideoFailure) : Attempt<Nothing>

        /** Stopped for a reason that says nothing about the variant (stop pressed, no camera frames). */
        data object Aborted : Attempt<Nothing>
    }

    sealed interface Result<out R> {
        data class Recording<R>(val variant: VideoVariant, val recording: R) : Result<R>

        /** [variant] is next and needs the viewfinder made recordable: stored, for the next recording. */
        data class NeedsViewfinder(val variant: VideoVariant) : Result<Nothing>

        /** Every variant failed. */
        data class AllFailed(val tries: List<Pair<VideoVariant, VideoFailure>>) : Result<Nothing>

        data object Aborted : Result<Nothing>
    }

    /** The state that applies to this build (another build's is forgotten). */
    fun state(): VideoProbeState = store.read().takeIf { it.buildKey == buildKey } ?: VideoProbeState(buildKey = buildKey)

    /** Whether the viewfinder should be made with a recordable config now (read once, when the view is made). */
    fun recordableViewfinder(): Boolean = state().variant?.recordableViewfinder == true

    /** The variants to try next, in order. */
    fun plan(): List<VideoVariant> {
        val s = state()
        val v = s.variant?.takeIf { it in order } ?: return order
        return if (s.confirmed) listOf(v) + order.filter { it != v } else order.dropWhile { it != v }.ifEmpty { order }
    }

    /**
     * Tries the [plan] with [attempt] until one starts. [viewfinderRecordable]: how the current view was made. The
     * attempt must leave nothing behind when it fails or aborts.
     */
    suspend fun <R> run(viewfinderRecordable: Boolean, attempt: suspend (VideoVariant) -> Attempt<R>): Result<R> {
        val before = state()
        val plan = plan()
        // Evidence that the standard path doesn't work here: an earlier probe under this build stored something else.
        var definite = before.variant != null && before.variant != VideoVariant.STANDARD
        val tries = ArrayList<Pair<VideoVariant, VideoFailure>>()
        // A probe that went on after the viewfinder was made again keeps its first part in the report.
        val log = ArrayList<String>(if (before.variant != null && !before.confirmed) before.lastTries else emptyList())
        for (variant in plan) {
            if (variant.recordableViewfinder && !viewfinderRecordable) {
                // Only on evidence: otherwise a one-off failure would change the viewfinder for good.
                if (!definite) continue
                log += "${variant.name}: needs the viewfinder made again"
                store.write(VideoProbeState(variant, confirmed = false, buildKey = buildKey, lastTries = log.toList()))
                return Result.NeedsViewfinder(variant)
            }
            when (val a = attempt(variant)) {
                is Attempt.Started -> {
                    log += "${variant.name}: ok"
                    val keep = variant == VideoVariant.STANDARD || definite
                    // The report keeps the probe that chose the variant, not the plain recordings after it.
                    val lastTries = if (before.confirmed && tries.isEmpty() && variant == before.variant && before.lastTries.isNotEmpty()) before.lastTries else log.toList()
                    store.write(
                        if (keep) VideoProbeState(variant, confirmed = true, buildKey = buildKey, lastTries = lastTries)
                        else before.copy(buildKey = buildKey, lastTries = lastTries),
                    )
                    return Result.Recording(variant, a.recording)
                }
                is Attempt.Failed -> {
                    log += "${variant.name}: ${a.failure.text}"
                    tries += variant to a.failure
                    if (variant == VideoVariant.STANDARD && a.failure.definite) definite = true
                }
                Attempt.Aborted -> {
                    if (tries.isNotEmpty()) store.write(before.copy(buildKey = buildKey, lastTries = log + "${variant.name}: stopped"))
                    return Result.Aborted
                }
            }
        }
        // Nothing worked: start from the top next time (and the viewfinder as usual).
        store.write(VideoProbeState(buildKey = buildKey, lastTries = log.toList()))
        return Result.AllFailed(tries)
    }

    companion object {
        /** Changes with a system update (firmware, SDK) and with each install of the app, debug reinstalls included. */
        fun buildKey(context: Context): String {
            val installed = runCatching {
                context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
            }.getOrDefault(0L)
            return "${Build.DISPLAY}|${Build.VERSION.SDK_INT}|$installed"
        }
    }
}

/** [VideoProbeStore] in SharedPreferences `video` (survives app updates; [VideoProbe.buildKey] tells them apart). */
class PrefsVideoProbeStore(context: Context) : VideoProbeStore {
    private val prefs = context.applicationContext.getSharedPreferences("video", Context.MODE_PRIVATE)

    override fun read(): VideoProbeState = VideoProbeState(
        variant = prefs.getString("variant", null)?.let { name -> VideoVariant.entries.firstOrNull { it.name == name } },
        confirmed = prefs.getBoolean("confirmed", false),
        buildKey = prefs.getString("buildKey", "") ?: "",
        lastTries = prefs.getString("lastTries", null)?.split('\n')?.filter { it.isNotBlank() } ?: emptyList(),
    )

    override fun write(state: VideoProbeState) {
        prefs.edit()
            .putString("variant", state.variant?.name)
            .putBoolean("confirmed", state.confirmed)
            .putString("buildKey", state.buildKey)
            .putString("lastTries", state.lastTries.joinToString("\n"))
            .commit() // the viewfinder reads it when it is made, possibly right after
    }
}
