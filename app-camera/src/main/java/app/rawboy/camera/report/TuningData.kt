package app.rawboy.camera.report

import android.content.Context
import android.util.Log
import app.rawboy.camera.debug.DebugProbe
import app.rawboy.gl.PreviewImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Settings › Collect tuning data: what a debug build's [DebugProbe] gathers for a new phone's profile, in any build,
 * for a set number of shots, so someone without adb can send it (docs/camera-platforms.md, "Adding a phone").
 *
 * For each collected shot it keeps the viewfinder's and the shot's 512 px linear copies (`<n>-vf.f16`, `<n>-raw.f16`
 * with a `.txt` beside each, as `DebugProbe.dump` writes them, so `tools/camera_fit/fit.py` reads them) in
 * `files/tuning`, numbered on from the last collection (shot ids restart with the process), and appends RawBoy's own
 * log lines ([LOG_TAGS]; an app reads its own logcat without a permission) to `log.txt`. [writeBundle] zips them with
 * the device report for the share sheet. Nothing leaves the phone otherwise: the camera has no network access.
 */
object TuningData {
    private const val TAG = "RawBoyCamera"
    private const val PREFS = "tuning"
    private const val KEY_REMAINING = "remaining"
    private const val KEY_NEXT = "next"
    private const val KEY_LAST_LOG = "lastLogLine"

    /** Shots one collection takes: enough for every lens and a few scenes, small enough to finish in a few minutes. */
    const val SHOTS = 10

    /** The camera's own log tags: lines from other apps never reach the app, and other tags of ours aren't needed. */
    val LOG_TAGS = listOf("RawBoyPlatform", "RawBoyCamera", "RawBoyViewfinder", "RawBoyVideo", "RawBoyProbe", "RawBoy", "RawBoyAuto")

    /** [remaining] shots still to collect (0 = off) and [shots] with both copies saved. */
    data class State(val remaining: Int, val shots: Int)

    private val _state = MutableStateFlow(State(0, 0))
    val state: StateFlow<State> = _state.asStateFlow()

    /** The camera's shot id → this collection's number, between the shutter and the shot's analysis. */
    private val numbers = ConcurrentHashMap<Long, Int>()

    private fun dir(context: Context) = File(context.filesDir, "tuning")
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Reads the stored state; call once at start. */
    fun init(context: Context) = refresh(context)

    private fun refresh(context: Context) {
        val shots = dir(context).listFiles { f -> f.name.endsWith("-raw.f16") }?.count { File(it.parentFile, it.name.replace("-raw.", "-vf.")).exists() } ?: 0
        _state.value = State(prefs(context).getInt(KEY_REMAINING, 0), shots)
    }

    /** Starts (or restarts) collecting for the next [SHOTS] shots, keeping what was collected before. */
    fun start(context: Context) {
        prefs(context).edit().putInt(KEY_REMAINING, SHOTS).apply()
        refresh(context)
        Log.i(TAG, "tuning data: collecting the next $SHOTS shots")
    }

    /** Stops collecting; what was collected stays until [clear]. */
    fun stop(context: Context) {
        prefs(context).edit().putInt(KEY_REMAINING, 0).apply()
        refresh(context)
    }

    /** Deletes everything collected and stops. */
    fun clear(context: Context) {
        dir(context).deleteRecursively()
        numbers.clear()
        prefs(context).edit().putInt(KEY_REMAINING, 0).remove(KEY_LAST_LOG).apply()
        refresh(context)
    }

    /** True while shots are being collected (the shutter's preview result is described for the copies' notes). */
    val collecting: Boolean get() = _state.value.remaining > 0

    /**
     * At the shutter: when collecting, numbers shot [shotId] and saves the viewfinder's copy. Returns false when not
     * collecting (the shot's raw copy is then not kept either).
     */
    fun saveViewfinder(context: Context, shotId: Long, image: PreviewImage, note: String): Boolean {
        val p = prefs(context)
        val remaining = p.getInt(KEY_REMAINING, 0)
        if (remaining <= 0) return false
        val n = p.getInt(KEY_NEXT, 1)
        p.edit().putInt(KEY_NEXT, n + 1).putInt(KEY_REMAINING, remaining - 1).apply()
        numbers[shotId] = n
        DebugProbe.writeCopy(dir(context), "$n-vf", image, note)
        refresh(context)
        return true
    }

    /** After the shot's decode: saves its raw copy if its viewfinder copy was kept, and the log lines so far. */
    fun saveRaw(context: Context, shotId: Long, image: PreviewImage, note: String) {
        val n = numbers.remove(shotId) ?: return
        DebugProbe.writeCopy(dir(context), "$n-raw", image, note)
        appendLog(context)
        refresh(context)
    }

    /**
     * Appends RawBoy's log lines that came after the last appended one to `log.txt` (logcat keeps only a few
     * minutes, so this runs after every collected shot and before zipping).
     */
    @Synchronized
    private fun appendLog(context: Context) {
        runCatching {
            val cmd = listOf("logcat", "-d", "-v", "threadtime", "-s") + LOG_TAGS.map { "$it:V" }
            val lines = ProcessBuilder(cmd).redirectErrorStream(true).start().inputStream.bufferedReader().readLines()
                .filter { it.isNotBlank() && !it.startsWith("-----") }
            if (lines.isEmpty()) return
            val p = prefs(context)
            val last = p.getString(KEY_LAST_LOG, null)
            val from = last?.let { lines.lastIndexOf(it) }?.takeIf { it >= 0 }?.plus(1) ?: 0
            val fresh = lines.subList(from, lines.size)
            if (fresh.isEmpty()) return
            val file = File(dir(context).apply { mkdirs() }, "log.txt")
            if (from == 0 && last != null) file.appendText("----- (lines between here and the previous ones were lost)\n")
            file.appendText(fresh.joinToString("\n", postfix = "\n"))
            p.edit().putString(KEY_LAST_LOG, lines.last()).apply()
        }.onFailure { Log.w(TAG, "tuning data: log", it) }
    }

    /** Zips the collected copies, the log and [report] (the device report's text) into [out]. */
    fun writeBundle(context: Context, report: String, out: File) {
        appendLog(context)
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            fun put(name: String, bytes: ByteArray) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(bytes)
                zip.closeEntry()
            }
            put("README.txt", README.toByteArray())
            put("device-report.txt", report.toByteArray())
            dir(context).listFiles()?.sortedBy { it.name }?.forEach { put(it.name, it.readBytes()) }
        }
    }

    private val README = """
        RawBoy Camera tuning data

        Made by Settings › Collect tuning data, for tuning RawBoy Camera to this phone. It holds:
        - device-report.txt: the phone's cameras, GPU and video encoders (no serial numbers, accounts or locations);
        - <n>-vf.f16 / <n>-raw.f16: for each collected shot, a 512 px copy of what the viewfinder showed and of the photo's
          raw (half-float linear RGB, no metadata), with a .txt of numbers beside each;
        - log.txt: RawBoy Camera's own log lines from those shots (exposure, colour and timing; photo file names may appear).
        No full-size photos, locations, sound or other apps' data. Read the copies with tools/camera_fit/fit.py.
    """.trimIndent() + "\n"
}
