package app.rawboy.camera

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ContentUris
import android.content.Context
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
)

/** A finished shot and the sequence number assigned at its shutter, so lock screen launches hide earlier ones. */
internal class SavedShot(val id: Long, val shot: LastShot)

internal sealed interface Calibration {
    class PreviewScale(val lensKey: String, val scale: Float) : Calibration
    class FlashGuide(val key: String, val guide: Float) : Calibration
}

/**
 * Application-scoped queue that develops captured raws into JPEGs one at a time.
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
    private const val EXTRA_BLACK = 1.46e-3f

    /** Nice value of the develop thread: normal priority so OpenMP / GPU develop keeps the big cores. */
    private const val DEVELOP_THREAD_PRIORITY = 0

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
     * Shots develop on one thread of their own: it keeps the export GL context between shots. (Not
     * THREAD_PRIORITY_BACKGROUND: that moves a thread to the little cores.) Threads it starts for
     * decoding (LibRaw's OpenMP, parallel rows) inherit the priority.
     */
    private val developExecutor = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(DEVELOP_THREAD_PRIORITY)
            r.run()
        }, "RawBoy-develop")
    }
    private val developDispatcher = developExecutor.asCoroutineDispatcher()

    /** Used only on the develop thread; low GPU priority so the viewfinder's frames come first. */
    private val exportGpu = ExportGpu(lowPriority = true)

    init {
        // One shot at a time: each needs a full-resolution decode.
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            for ((app, shot) in shots) {
                try {
                    develop(app, shot)
                } catch (e: Throwable) {
                    Log.w(TAG, "develop ${shot.name}", e)
                    _errors.tryEmit(
                        "Could not save ${shot.name}: " +
                            if (e is OutOfMemoryError) "not enough memory" else e.message ?: e.javaClass.simpleName,
                    )
                } finally {
                    shot.temporary?.delete()
                    val left = _pending.updateAndGet { (it - 1).coerceAtLeast(0) }
                    if (left == 0 && activeViews.get() == 0) releaseGpuIfIdle()
                }
            }
        }
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

    /** Raw -> auto develop + look -> JPEG (jpegli), as RawBoy Auto develops a photo. */
    private suspend fun develop(app: Application, shot: Shot) {
        val s = shot.settings
        val started = System.nanoTime()
        fun ms(from: Long) = (System.nanoTime() - from) / 1_000_000
        val (name, rawKey, autoEv) = withContext(developDispatcher) {
            val decodeStart = System.nanoTime()
            RawImage.open(app, shot.dng, EXTRA_BLACK).use { img ->
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
                    phoneAe = shot.flashGuide == null, captureEv = shot.compensationEv,
                )
                val analysisMs = ms(analysisStart)
                val looked = s.develop(a.autoBase, a.stats.hasFace)
                // High ISO: more denoise than the auto develop's table, up to the coarse stage (denoise > 65).
                val denoise = maxOf(looked.denoise, highIsoDenoise(a.stats.iso * noiseScale))
                val params = looked.copy(
                    denoise = denoise,
                    colorDenoise = measuredColorDenoise(img, looked.exposure, denoise),
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
                )
                val exportStart = System.nanoTime()
                val saved = Exporter(app).export(img, shot.dng, shot.name, shader, export, CameraViewModel.JPEG_NAMING, exportGpu) {}
                Log.d(TAG, "${shot.name}: decode $decodeMs ms, analysis $analysisMs ms, develop + JPEG ${ms(exportStart)} ms")
                Triple(saved, a.stats.key, a.autoBase.exposure)
            }
        }
        Log.d(TAG, "saved $name in ${ms(started)} ms")
        val key = s.lensKey(shot.hiRes)
        shot.viewfinderKey?.let { calibrate(app, rawKey, it, key, s.previewScale(shot.hiRes)) }
        shot.flashGuide?.let { calibrateFlash(app, autoEv, it, CameraSettings.flashGuideKey(key, shot.flashDistanceKnown)) }
        withContext(Dispatchers.IO) { findJpeg(app, name) }?.let { uri ->
            withContext(Dispatchers.IO) { thumbnail(app, uri) }?.let { _lastShot.value = SavedShot(shot.id, LastShot(uri, it)) }
        }
        // The JPEG came from the uncompressed raw; now the kept DNG shrinks to a lossy JPEG XL one.
        if (s.keepDng && s.lossyDng && shot.temporary == null) withContext(Dispatchers.IO) { compressDng(app, shot) }
    }

    /** Re-saves the kept DNG as a lossy JPEG XL DNG, in place. Best effort: the uncompressed DNG stays if it fails. IO thread. */
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
        val estimate = scaleAtShutter * (rawKey / viewfinderKey).coerceIn(1f / 16, 16f)
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

    private fun findJpeg(app: Context, name: String): Uri? {
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        return app.contentResolver.query(
            collection,
            arrayOf(MediaStore.MediaColumns._ID),
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
            arrayOf(name, CameraViewModel.JPEG_NAMING.relativePath),
            null,
        )?.use { c -> if (c.moveToFirst()) ContentUris.withAppendedId(collection, c.getLong(0)) else null }
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
