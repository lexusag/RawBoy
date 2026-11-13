package app.rawboy.camera

import android.app.ActivityManager
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.Process
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.rawboy.auto.AutoAnalysis
import app.rawboy.auto.analysis.AutoTone
import app.rawboy.auto.analysis.MeterArea
import app.rawboy.auto.analysis.SceneStats
import app.rawboy.export.DateStamp
import app.rawboy.export.ExportFormat
import app.rawboy.export.ExportGpu
import app.rawboy.export.ExportSettings
import app.rawboy.export.Exporter
import app.rawboy.export.JpegEncoder
import app.rawboy.film.FilmData
import app.rawboy.film.FilmStocks
import app.rawboy.gl.ShaderParams
import app.rawboy.lens.LensTransform
import app.rawboy.lut.LutData
import app.rawboy.lut.LutLoader
import app.rawboy.raw.DngJxlNative
import app.rawboy.raw.RawImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.updateAndGet
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.roundToInt

/** A captured raw waiting to be developed, with the controls as they were at the shutter. */
internal data class Shot(
    val id: Long,
    val dng: Uri,
    val name: String,
    val temporary: File?,
    val settings: CameraSettings,
    /** The viewfinder's scene key at the shutter, for calibrating [CameraSettings.previewScale]. */
    val viewfinderKey: Float?,
    /** Sensor ISO from the capture, in case the DNG lacks it. */
    val iso: Float,
    /** The camera's face detection saw a face at the shutter (or can't tell): run skin detection. */
    val mayHaveFace: Boolean = true,
    /** Flash shot: the guide it was exposed with, for calibrating [CameraSettings.flashGuides]. */
    val flashGuide: Float? = null,
    /** The flash shot's lens reported a focus distance (which of the lens's guides [flashGuide] is). */
    val flashDistanceKnown: Boolean = true,
    /** Where the photo is metered, in the photo's own (level) orientation. */
    val meter: MeterArea = CameraViewModel.METER_CENTRE,
    /** A merged burst: frames the raw is worth ([app.rawboy.camera.capture.Still.effectiveFrames]); 1 = one frame. */
    val effectiveFrames: Float = 1f,
    /** Whether the lens captured this raw in its maximum-resolution sensor mode, for per-mode calibration. */
    val hiRes: Boolean = false,
    /** AE compensation (EV) the raw was shot with, from Brightness (CameraController.setExposureBias). */
    val compensationEv: Float = 0f,
    /** Debug note on whether the burst merge ran, saved in the JPEG's ImageDescription (and the DNG's). */
    val description: String = "",
    /** Capture timestamp (ms since epoch), used when [CameraSettings.dateStamp] is on. */
    val timeMs: Long = System.currentTimeMillis(),
)

/** A finished shot and the sequence number assigned at its shutter, so lock screen launches hide earlier ones. */
internal class SavedShot(val id: Long, val shot: LastShot)

internal sealed interface Calibration {
    class PreviewScale(val lensKey: String, val scale: Float) : Calibration
    class FlashGuide(val key: String, val guide: Float) : Calibration
}

/**
 * Application-scoped queue that develops captured raws into JPEGs, in two overlapping stages: the CPU decode and
 * analysis of a shot ([prepare], on `RawBoy-decode`) runs while the shot before it is developed on the GPU and
 * encoded ([finish], on `RawBoy-develop`). At most two shots are open at once; the lossy JPEG XL DNG re-save has a
 * queue of its own ([compressExecutor]) so it never holds up the next JPEG.
 *
 * Kept outside [CameraViewModel] (with [SaveService] holding the process and CPU awake while [pending] > 0) so locking
 * the phone immediately after shooting — which finishes the lock screen camera and clears its ViewModel — never
 * cancels a capture or develop still in progress.
 */
internal object ShotSaver {
    private const val TAG = "RawBoyCamera"

    /** Flash raws are aimed this far under the auto develop's target (it lifts them back; see [calibrateFlash]). */
    private const val FLASH_LIFT_EV = 0.5f
    private const val MIN_FLASH_GUIDE = 1e-2f
    private const val MAX_FLASH_GUIDE = 1e4f

    /**
     * A phone sensor is roughly as noisy as the camera raws the auto denoise was tuned on at
     * ~4x (2 stops more) its ISO, so the develop picks denoise/sharpening for that ISO.
     */
    private const val PHONE_NOISE_ISO_SCALE = 4f

    /** Selfie sensors are smaller still: a first guess, to tune on photos. */
    private const val FRONT_NOISE_ISO_SCALE = 8f

    /**
     * Black beyond the DNG's (a fraction of the white range, ~1.4 DN of 959 on the Pixel 9 Pro): the phone's ISP
     * renders black that much deeper than the DNG's BlackLevel (which is the frame's dynamic black), measured
     * against the viewfinder at ISO 170-250. Without it the photo's deepest shadows were lifted, and bluish
     * after the white balance's blue gain, compared with the viewfinder.
     */
    const val EXTRA_BLACK = 1.46e-3f

    /** Nice value of the decode and develop threads: normal priority so OpenMP / GPU develop keeps the big cores. */
    private const val DEVELOP_THREAD_PRIORITY = 0

    /** A develop slower than this logs the memory state (normal is ~1 s). */
    private const val SLOW_DEVELOP_MS = 8_000L

    /**
     * The lossy JPEG XL DNG re-save runs in the background (little cores): the JPEGs come first, and the kept DNG is
     * already complete (uncompressed) until it is replaced.
     */
    private const val COMPRESS_THREAD_PRIORITY = Process.THREAD_PRIORITY_BACKGROUND

    /** Main-thread scope that outlives individual camera activities, for in-flight captures. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val nextId = AtomicLong(0)
    val latestId: Long get() = nextId.get()

    /** Shots being captured or developed ("Saving N…"). */
    private val _pending = MutableStateFlow(0)
    val pending = _pending.asStateFlow()

    private val _lastShot = MutableStateFlow<SavedShot?>(null)
    val lastShot = _lastShot.asStateFlow()

    private val _calibrations = MutableSharedFlow<Calibration>(extraBufferCapacity = 8)
    val calibrations = _calibrations.asSharedFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors = _errors.asSharedFlow()

    private val activeViews = AtomicInteger(0)

    private val luts = HashMap<String, LutData>()
    private val films = HashMap<String, FilmData>()
    private val lutLock = Mutex()

    private val shots = Channel<Pair<Application, Shot>>(Channel.UNLIMITED)

    /**
     * Decoded shots handed from [prepare] to [finish]. Rendezvous: a decoded shot waits here (open) until the develop
     * stage takes it, and the decode stage starts no other shot meanwhile, so at most two shots are open at once.
     */
    private val prepared = Channel<Prepared>(Channel.RENDEZVOUS)

    /** Shots handed to (or being handed to) the develop stage and not finished yet. */
    private val inDevelop = MutableStateFlow(0)

    /** Bursts being captured and merged ([beginMerge]): the decode stage doesn't start a second open shot meanwhile. */
    private val merges = MutableStateFlow(0)

    private fun stageThread(name: String, priority: Int) = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(priority)
            r.run()
        }, name)
    }

    /**
     * Shots decode on one thread and develop on another (it keeps the export GL context between shots). (Not
     * THREAD_PRIORITY_BACKGROUND: that moves a thread to the little cores.) Threads they start for decoding (LibRaw's
     * OpenMP, parallel rows) inherit the priority.
     */
    private val decodeDispatcher = stageThread("RawBoy-decode", DEVELOP_THREAD_PRIORITY).asCoroutineDispatcher()
    private val developExecutor = stageThread("RawBoy-develop", DEVELOP_THREAD_PRIORITY)
    private val developDispatcher = developExecutor.asCoroutineDispatcher()
    private val compressExecutor = stageThread("RawBoy-dng", COMPRESS_THREAD_PRIORITY)

    /** Used only on the develop thread; low GPU priority so the viewfinder's frames come first. */
    private val exportGpu = ExportGpu(lowPriority = true)

    /** A shot decoded and analysed by [prepare], ready for [finish]; owns [image] until [finish] closes it. */
    private class Prepared(
        val app: Application,
        val shot: Shot,
        val image: RawImage,
        val shader: ShaderParams,
        val export: ExportSettings,
        val rawKey: Float,
        val autoEv: Float,
        val started: Long,
    )

    init {
        val queue = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        // Decode stage: one shot at a time (each needs a full-resolution decode).
        queue.launch {
            for ((app, shot) in shots) {
                val p = try {
                    // A second open shot only when there's memory for it: not while a burst merges, nor when the
                    // system is low on memory. Otherwise wait for the shot in develop, as when shots never overlapped.
                    if (inDevelop.value > 0) {
                        if (merges.value > 0) merges.first { it == 0 }
                        if (lowOnMemory(app)) {
                            Log.d(TAG, "${shot.name}: memory tight (${memoryNote(app)}), decoding after the develop")
                            inDevelop.first { it == 0 }
                        }
                    }
                    withContext(decodeDispatcher) { prepare(app, shot) }
                } catch (e: Throwable) {
                    failed(shot, e)
                    shotDone(shot)
                    continue
                }
                inDevelop.update { it + 1 }
                prepared.send(p)
            }
        }
        // Develop stage: GPU develop + JPEG, then the shot's bookkeeping.
        queue.launch {
            for (p in prepared) {
                try {
                    finish(p)
                } catch (e: Throwable) {
                    failed(p.shot, e)
                } finally {
                    runCatching { p.image.close() }
                    inDevelop.update { it - 1 }
                    shotDone(p.shot)
                }
            }
        }
    }

    /** Free memory under which a second open shot (another full-resolution decode) isn't started: it would swap. */
    private const val TIGHT_AVAIL_BYTES = 2_500L * 1024 * 1024

    /** After the system asked apps to trim (running low or worse), shots stay one at a time for this long. */
    private const val TRIM_MEMORY_HOLD_MS = 60_000L

    @Volatile private var trimmedUntil = 0L
    private var trimRegistered = false

    /** Listens for the system's low-memory signals: drops the GPU when idle, and serialises shots for a while. */
    private fun registerTrim(app: Application) {
        if (trimRegistered) return
        trimRegistered = true
        app.registerComponentCallbacks(object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
                    trimmedUntil = System.currentTimeMillis() + TRIM_MEMORY_HOLD_MS
                    Log.d(TAG, "onTrimMemory $level (${memoryNote(app)})")
                    if (_pending.value == 0) releaseGpuIfIdle()
                }
            }

            override fun onConfigurationChanged(newConfig: Configuration) {}

            @Deprecated("Replaced by onTrimMemory")
            override fun onLowMemory() {
                trimmedUntil = System.currentTimeMillis() + TRIM_MEMORY_HOLD_MS
            }
        })
    }

    private fun memoryInfo(app: Context): ActivityManager.MemoryInfo? = runCatching {
        ActivityManager.MemoryInfo().also { app.getSystemService(ActivityManager::class.java).getMemoryInfo(it) }
    }.getOrNull()

    /**
     * Memory is short enough that a second full-resolution shot open at once would likely swap (a save once spent
     * 62-70 s in the GPU develop, normally ~1.1 s, with ~2 GB of 16 GB free): the system says low, free memory is
     * under [TIGHT_AVAIL_BYTES], or it recently asked apps to trim.
     */
    private fun lowOnMemory(app: Context): Boolean {
        if (System.currentTimeMillis() < trimmedUntil) return true
        val info = memoryInfo(app) ?: return false
        return info.lowMemory || info.availMem < TIGHT_AVAIL_BYTES
    }

    /** One-line memory state for the logs, to correlate slow saves with memory pressure. */
    private fun memoryNote(app: Context): String {
        val i = memoryInfo(app) ?: return "memory unknown"
        val mb = 1024 * 1024
        return "avail ${i.availMem / mb} of ${i.totalMem / mb} MB, low=${i.lowMemory} (threshold ${i.threshold / mb} MB), " +
            "native heap ${android.os.Debug.getNativeHeapAllocatedSize() / mb} MB"
    }

    private fun failed(shot: Shot, e: Throwable) {
        Log.w(TAG, "develop ${shot.name}", e)
        _errors.tryEmit(
            "Could not save ${shot.name}: " +
                if (e is OutOfMemoryError) "not enough memory" else e.message ?: e.javaClass.simpleName,
        )
    }

    /** A shot has left the queue (saved or failed): its temporary raw goes, and the GPU is released when all are done. */
    private fun shotDone(shot: Shot) {
        shot.temporary?.delete()
        val left = _pending.updateAndGet { (it - 1).coerceAtLeast(0) }
        if (left == 0 && activeViews.get() == 0) releaseGpuIfIdle()
    }

    /** A burst capture started: until [endMerge], a second shot isn't decoded while one develops (memory). */
    fun beginMerge() {
        merges.update { it + 1 }
    }

    fun endMerge() {
        merges.update { (it - 1).coerceAtLeast(0) }
    }

    fun attachView() {
        activeViews.incrementAndGet()
    }

    fun detachView() {
        if (activeViews.decrementAndGet() <= 0 && _pending.value == 0) releaseGpuIfIdle()
    }

    /** Marks a shot started at the shutter (while the activity is in front, so [SaveService] can start) and returns its id. */
    fun beginCapture(app: Context): Long {
        val id = nextId.incrementAndGet()
        _pending.update { it + 1 }
        SaveService.start(app)
        return id
    }

    /** Balances [beginCapture] when a capture fails before queuing a [Shot]. */
    fun cancelCapture() {
        val left = _pending.updateAndGet { (it - 1).coerceAtLeast(0) }
        if (left == 0 && activeViews.get() == 0) releaseGpuIfIdle()
    }

    fun enqueue(app: Application, shot: Shot) {
        registerTrim(app)
        shots.trySend(app to shot)
    }

    suspend fun loadLut(app: Context, id: String): LutData = lutLock.withLock {
        luts[id] ?: withContext(Dispatchers.IO) { LutLoader.load(app, id) }.also { luts[id] = it }
    }

    /** A film stock's two LUTs, loaded once (shares the LUT lock: loads are large and synchronized anyway). */
    suspend fun loadFilm(app: Context, id: String): FilmData = lutLock.withLock {
        films[id] ?: withContext(Dispatchers.IO) {
            val stock = FilmStocks.byId(app, id) ?: throw IllegalArgumentException("Unknown film stock $id")
            FilmStocks.load(app, stock)
        }.also { films[id] = it }
    }

    private fun releaseGpuIfIdle() {
        // The export GL context belongs to the develop thread: release it there once all queued work has drained.
        developExecutor.execute {
            if (_pending.value == 0 && activeViews.get() <= 0) exportGpu.close()
        }
    }

    /**
     * Decode stage: raw -> auto analysis -> the shot's develop (auto develop + look), as RawBoy Auto develops a photo.
     * On the decode thread. The returned [Prepared] owns the open image.
     */
    private suspend fun prepare(app: Application, shot: Shot): Prepared {
        val s = shot.settings
        val started = System.nanoTime()
        val decodeStart = System.nanoTime()
        Log.d(TAG, "${shot.name}: decode starts, ${memoryNote(app)}")
        val img = RawImage.open(app, shot.dng, EXTRA_BLACK)
        try {
            val decodeMs = ms(decodeStart)
            val analysisStart = System.nanoTime()
            // A merged burst is as clean as one frame at 1/frames the ISO: denoise for that.
            val noiseScale = (if (s.front) FRONT_NOISE_ISO_SCALE else PHONE_NOISE_ISO_SCALE) / shot.effectiveFrames
            // The phone's auto exposure already metered the raw (Camera2 AE on the same box, its post-raw boost in
            // the DNG's BaselineExposure): keep it, but lift it where the AE protected a highlight and took the
            // scene down (AutoTone.PHONE_KEY). Re-metering it to Auto's camera-raw target pulled ordinary rooms 1-2 EV
            // darker than the phone's camera. Flash shots are exposed manually (AE off), so they are metered here,
            // which also calibrates the flash guide.
            val a = AutoAnalysis.analyze(
                app, img, shot.name, noiseScale, shot.iso, detectSkin = shot.mayHaveFace, meter = shot.meter,
                phoneAe = shot.flashGuide == null, captureEv = shot.compensationEv, splitLuma = false,
            )
            val analysisMs = ms(analysisStart)
            val looked = CameraSettings.withPhoneIspLook(s.develop(a.autoBase, a.stats.hasFace), img.make)
            // High ISO: more denoise than the auto develop's table, up to the coarse stage (denoise > 65).
            val denoise = maxOf(looked.denoise, highIsoDenoise(a.stats.iso * noiseScale))
            val params = looked.copy(
                denoise = denoise,
                colorDenoise = maxOf(measuredColorDenoise(img, looked.exposure, denoise) ?: denoise, looked.colorDenoise ?: 0f),
                shadows = maxOf(looked.shadows, backlightShadows(a.stats)),
            )
            val lut = params.lut?.let { loadLut(app, it) }
            val film = params.film?.let { loadFilm(app, it) }
            val shader = ShaderParams.from(
                params, a.defaults, lut, LensTransform(img.lens, params), a.base, a.bloom, a.skin,
                CameraViewModel.GRAIN_SIZE_SCALE, CameraViewModel.grainStrength(s), film = film,
            )
            val export = ExportSettings(
                format = ExportFormat.JPEG,
                jpegQuality = s.jpegQuality,
                jpegEncoder = JpegEncoder.JPEGLI,
                maxLongSide = s.maxLongSide,
                downscaleSharpen = CameraSettings.SMALL_SHARPEN,
                hdrGainMap = s.hdrGainMap,
                description = shot.description,
                dateStamp = if (s.dateStamp) DateStamp.format(shot.timeMs) else "",
            )
            Log.d(TAG, "${shot.name}: decode $decodeMs ms, analysis $analysisMs ms")
            return Prepared(app, shot, img, shader, export, a.stats.key, a.autoBase.exposure, started)
        } catch (t: Throwable) {
            img.close()
            throw t
        }
    }

    /** Develop stage: GPU develop + JPEG of a [prepare]d shot, then calibration, the thumbnail and the DNG re-save. */
    private suspend fun finish(p: Prepared) {
        val shot = p.shot
        val s = shot.settings
        val app = p.app
        val waitMs = ms(p.started)
        val saved = withContext(developDispatcher) {
            val exportStart = System.nanoTime()
            Exporter(app).exportFile(p.image, shot.dng, shot.name, p.shader, p.export, CameraViewModel.JPEG_NAMING, exportGpu) {}
                .also {
                    val took = ms(exportStart)
                    Log.d(TAG, "${shot.name}: develop + JPEG $took ms")
                    if (took > SLOW_DEVELOP_MS) Log.w(TAG, "${shot.name}: slow develop, ${memoryNote(app)}")
                }
        }
        Log.d(TAG, "saved ${saved.name} in ${ms(p.started)} ms (develop started after $waitMs ms)")
        val key = s.lensKey(shot.hiRes)
        shot.viewfinderKey?.let { calibrate(app, p.rawKey, it, key, s.previewScale(shot.hiRes)) }
        shot.flashGuide?.let { calibrateFlash(app, p.autoEv, it, CameraSettings.flashGuideKey(key, shot.flashDistanceKnown)) }
        withContext(Dispatchers.IO) { thumbnail(app, saved.uri) }?.let { _lastShot.value = SavedShot(shot.id, LastShot(saved.uri, it)) }
        // The JPEG came from the uncompressed raw; now the kept DNG shrinks to a lossy JPEG XL one, on its own queue
        // so the next shot's JPEG doesn't wait for it. It counts as pending, so SaveService keeps the process up.
        if (s.keepDng && s.lossyDng && shot.temporary == null) {
            _pending.update { it + 1 }
            compressExecutor.execute {
                try {
                    compressDng(app, shot)
                } finally {
                    val left = _pending.updateAndGet { (it - 1).coerceAtLeast(0) }
                    if (left == 0 && activeViews.get() == 0) releaseGpuIfIdle()
                }
            }
        }
    }

    private fun ms(from: Long) = (System.nanoTime() - from) / 1_000_000

    /** Re-saves the kept DNG as a lossy JPEG XL DNG, in place. Best effort: the uncompressed DNG stays if it fails. [compressExecutor]. */
    private fun compressDng(app: Context, shot: Shot) {
        val start = System.nanoTime()
        try {
            val result = app.contentResolver.openFileDescriptor(shot.dng, "rw")?.use { DngJxlNative.transcode(it.fd) }
            Log.d(TAG, "${shot.name}: lossy JPEG XL DNG $result in ${(System.nanoTime() - start) / 1_000_000} ms")
        } catch (e: Throwable) {
            Log.w(TAG, "lossy DNG ${shot.name}", e)
            _errors.tryEmit("${shot.name}.dng stays uncompressed: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    /**
     * Learns the viewfinder's preview gain for a lens from a shot: the raw's scene key over the viewfinder's.
     * Each lens's preview pipeline has its own gain (on the Pixel 9 Pro 0.5 for the selfie camera up to ~9
     * for T3), so a lens's first shot takes the full correction; later shots move halfway (in stops), which
     * smooths out scene-to-scene noise (about ±0.3 stop between shots of the same view).
     */
    private fun calibrate(app: Context, rawKey: Float, viewfinderKey: Float, lens: String, scaleAtShutter: Float) {
        if (!(rawKey > 0f) || !(viewfinderKey > 0f)) return
        // The gain that would have matched this shot. Judged against the gain in use at its shutter: shots taken
        // back to back are calibrated after both were captured.
        val estimate = scaleAtShutter * (rawKey / viewfinderKey).coerceIn(1f / 64, 64f)
        val clamped = CameraSettingsStore.updatePreviewScale(app, lens, estimate)
        Log.d(TAG, "calibrate $lens: raw key $rawKey, viewfinder key $viewfinderKey (raw/viewfinder ${rawKey / viewfinderKey}) -> preview scale $clamped")
        _calibrations.tryEmit(Calibration.PreviewScale(lens, clamped))
    }

    /**
     * Learns a lens's flash exposure from a flash shot: the auto develop's exposure says how far the raw was from
     * where it should be; aiming [FLASH_LIFT_EV] under it keeps highlights in the raw (dark raws are recoverable,
     * clipped ones aren't). First flash shot on a lens takes the full correction, later ones move halfway.
     */
    private fun calibrateFlash(app: Context, autoEv: Float, guideUsed: Float, lens: String) {
        if (!(guideUsed > 0f)) return
        val estimate = guideUsed * 2f.pow(autoEv - FLASH_LIFT_EV)
        val guide = CameraSettingsStore.updateFlashGuide(app, lens, estimate, MIN_FLASH_GUIDE, MAX_FLASH_GUIDE)
        Log.d(TAG, "calibrate flash $lens: auto exposure $autoEv EV at guide $guideUsed -> flash guide $guide")
        _calibrations.tryEmit(Calibration.FlashGuide(lens, guide))
    }

    private fun thumbnail(app: Context, uri: Uri): Bitmap? = runCatching {
        app.contentResolver.openInputStream(uri)?.use { input ->
            BitmapFactory.decodeStream(input, null, BitmapFactory.Options().apply { inSampleSize = 16 })
        }
    }.getOrNull()

    /**
     * Backlit scenes (a window, a lamp in frame): the phone's own preview lifts the dark parts locally, and the plain
     * raw develop left them near black (owner preferred the preview). Shadows rise with the scene's range, p98 - p5:
     * ordinary scenes span 3-5 stops (no change), a room against a window 7 (75, which matched the iPhone's
     * viewfinder on that shot). Fades out from ISO 800 to 3200, where lifting would mostly lift noise. Shots only:
     * the viewfinder's frames come already lifted.
     */
    private fun backlightShadows(s: SceneStats): Float {
        val lift = ((s.p98 - s.p5 - 5f) * 37.5f).coerceIn(0f, 80f)
        val t = ((s.iso - 800f) / 2400f).coerceIn(0f, 1f)
        return (lift * (1f - t * t * (3f - 2f * t))).roundToInt().toFloat()
    }

    /**
     * Colour denoise from the shot's measured colour noise (~30 ms; Auto's calibration, [AutoTone.measuredNoiseSettings]
     * at the develop's [exposure]), at least the luma [denoise] it used to follow; null (follows [denoise]) when the
     * raw can't be measured. The ISO table under-rated low-ISO night shots: a merged burst at ISO 20-150 got no colour
     * denoise, yet the phone's lens shading had lifted its corners up to 3.4x, and lifted shadows showed the colour
     * speckle (Pixel 9 Pro test, 2026-10-30). Luma stays on the ISO table (the owner's call: luma noise is right).
     * The shader scales this towards the corners by the shading gain (develop.glsl `colorNoiseScale`).
     */
    private fun measuredColorDenoise(img: RawImage, exposure: Float, denoise: Float): Float? {
        val noise = img.measureNoise()
        if (!noise.measured) return null
        return maxOf(AutoTone.measuredNoiseSettings(noise, exposure).second, denoise)
    }

    /**
     * Denoise for a phone shot at high ISO, by "equivalent" ISO (shot ISO x noise scale): unchanged up to 3200
     * (back ISO 800), then 6400 -> 60, 12800 -> 80, 25600 and up -> 100 (back ISO 1600 / 3200 / 6400; selfie
     * 800 / 1600 / 3200), interpolated in stops. Above 65 the shader adds its coarse stage.
     */
    private fun highIsoDenoise(equivalentIso: Float): Float {
        if (equivalentIso <= 3200f) return 0f
        val stops = log2(equivalentIso / 3200f) // 1 at 6400, 2 at 12800, 3 at 25600
        return when {
            stops <= 1f -> 60f * stops // the auto table already gives ~45 at 6400; max() keeps the higher
            stops <= 2f -> 60f + 20f * (stops - 1f)
            stops <= 3f -> 80f + 20f * (stops - 2f)
            else -> 100f
        }.roundToInt().toFloat()
    }
}

/**
 * Short-lived foreground service that keeps the camera process out of the cached/frozen state and holds a partial
 * wake lock while [ShotSaver] is capturing or developing shots. Started at the shutter (while the camera is on
 * screen); stops itself as soon as [ShotSaver.pending] drops back to 0.
 */
class SaveService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var job: Job? = null
    private var lastStartId = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(CHANNEL_ID, "Saving photos", NotificationManager.IMPORTANCE_LOW).apply {
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RawBoyCamera:save")
            .apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle("Saving photo…")
            .setOngoing(true)
            .setSilent(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        wakeLock?.acquire(WAKE_LOCK_TIMEOUT_MS)
        if (job == null) {
            job = CoroutineScope(Dispatchers.Main.immediate).launch {
                ShotSaver.pending.collect { count ->
                    if (count == 0) stopSelf(lastStartId)
                }
            }
        } else if (ShotSaver.pending.value == 0) {
            stopSelf(lastStartId)
        }
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int) = stopSelf()

    override fun onTimeout(startId: Int, fgsType: Int) = stopSelf()

    override fun onDestroy() {
        job?.cancel()
        job = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "saving"
        private const val NOTIFICATION_ID = 1
        /** Matches Android's 3-minute shortService ceiling; a single shot develops in ~3 s. */
        private const val WAKE_LOCK_TIMEOUT_MS = 3 * 60_000L

        fun start(context: Context) {
            runCatching {
                ContextCompat.startForegroundService(context.applicationContext, Intent(context, SaveService::class.java))
            }.onFailure { Log.w("RawBoyCamera", "SaveService start", it) }
        }
    }
}
