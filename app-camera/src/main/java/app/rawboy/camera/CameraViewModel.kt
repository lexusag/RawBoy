package app.rawboy.camera

import android.app.Application
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraMetadata
import android.location.Location
import android.location.altitude.AltitudeConverter
import android.net.Uri
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.system.Os
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.rawboy.auto.analysis.AutoTone
import app.rawboy.auto.analysis.MeterArea
import app.rawboy.auto.analysis.SceneAnalyzer
import app.rawboy.auto.analysis.SceneStats
import app.rawboy.auto.looks.Adjustments
import app.rawboy.auto.looks.LookApplier
import app.rawboy.camera.capture.CameraController
import app.rawboy.camera.capture.FlashMode
import app.rawboy.camera.capture.LocationTracker
import app.rawboy.camera.capture.ShutterSound
import app.rawboy.camera.qr.QrPayload
import app.rawboy.camera.qr.QrReader
import app.rawboy.camera.qr.QrTracker
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.Histogram
import app.rawboy.export.DngGps
import app.rawboy.export.ExifMetadata
import app.rawboy.export.MediaStoreOutput
import app.rawboy.export.OutputNaming
import app.rawboy.gl.PreviewImage
import app.rawboy.gl.ShaderParams
import app.rawboy.gl.ThumbnailRenderer
import app.rawboy.gl.ViewfinderBase
import app.rawboy.gl.ViewfinderRenderer
import app.rawboy.lens.LensInfo
import app.rawboy.lens.LensTransform
import app.rawboy.retouch.SkinMask
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.runningFold
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.pow

enum class CameraStatus { NEEDS_PERMISSION, OPENING, READY, FAILED }

/** The newest saved photo, for the thumbnail next to the shutter. */
class LastShot(val uri: Uri, val thumbnail: Bitmap)

/**
 * RawBoy Camera: a viewfinder developed live with the auto develop and the chosen look, and a
 * queue that develops each raw shot into a JPEG with the same engine as RawBoy Auto.
 */
class CameraViewModel(application: Application) : AndroidViewModel(application) {
    private val app get() = getApplication<Application>()
    val controller = CameraController(application)

    /** The scene is dark enough for [BurstMode.AUTO] to merge frames ([LowLight]); follows the preview's exposure. */
    val lowLight = controller.frames
        .runningFold(false) { prev, f -> if (f == null) prev else LowLight.next(prev, f.iso, f.exposureNs, f.postRawBoost) }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val _settings = MutableStateFlow(CameraSettingsStore.load(application))
    val settings = _settings.asStateFlow()

    private val _status = MutableStateFlow(CameraStatus.NEEDS_PERMISSION)
    val status = _status.asStateFlow()

    /** Shots being captured or developed as JPEG ("Saving N…"). */
    val pending = ShotSaver.pending

    /** Shots still reading a raw from Camera2; the camera and lock screen activity wait for 0 before closing. */
    private var activeCaptures = 0
    private val _capturing = MutableStateFlow(0)
    val capturing = _capturing.asStateFlow()
    private var restartAfterCapture = false

    /**
     * A burst is being captured and merged: the shutter waits for its DNG. Back-to-back bursts each held their own
     * frames and merge sums next to the previous shot's develop (~590 MB native on the Pixel 9 Pro).
     */
    private val _merging = MutableStateFlow(false)
    val merging = _merging.asStateFlow()

    private val hiddenUpToId = MutableStateFlow(0L)
    val lastShot: StateFlow<LastShot?> = combine(ShotSaver.lastShot, hiddenUpToId) { saved, hidden ->
        saved?.takeIf { it.id > hidden }?.shot
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Opened over the lock screen: a photo taken before this launch (even one still saving) isn't shown. */
    fun forgetLastShot() {
        hiddenUpToId.value = ShotSaver.latestId
    }

    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    /** How camera frames map to the developed image; null until the camera runs. */
    private val _frame = MutableStateFlow<ViewfinderRenderer.Frame?>(null)
    val frame = _frame.asStateFlow()

    /** The viewfinder's develop: auto develop of the live frame plus the look. */
    private val _shaderParams = MutableStateFlow<ShaderParams?>(null)
    val shaderParams = _shaderParams.asStateFlow()

    /** The live develop's RGB histogram ([CameraSettings.showHistogram]); null while it is off. */
    private val _histogram = MutableStateFlow<Histogram?>(null)
    val histogram = _histogram.asStateFlow()

    /** Renders the histogram's small copy of the live develop; its own GL context and thread. */
    private val histogramRenderer = ThumbnailRenderer()
    private var histogramJob: Job? = null

    /** The QR code in the viewfinder ([CameraSettings.scanQr]), or null. */
    private val _qrCode = MutableStateFlow<QrPayload?>(null)
    val qrCode = _qrCode.asStateFlow()
    private val qrTracker = QrTracker()
    private val qrBusy = AtomicBoolean(false)

    /**
     * QR codes are read on a thread of their own at background priority (the little cores are plenty for a few
     * reads a second), never holding up the GL thread or a shot's develop.
     */
    private val qrExecutor = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            r.run()
        }, "RawBoy-qr")
    }

    /** Press and hold: show the auto develop without the look. */
    private val _compare = MutableStateFlow(false)
    val compare = _compare.asStateFlow()

    /** The current side's lenses with RAW (UW / W / T…), found when the camera first starts. */
    private val _lenses = MutableStateFlow<List<CameraController.Info>>(emptyList())
    val lenses = _lenses.asStateFlow()

    /** Lenses per side (true = front), discovered once. */
    private var lensesBySide: Map<Boolean, List<CameraController.Info>>? = null

    /** Whether the front camera can deliver RAW (the selfie flip button shows only then). */
    private val _frontAvailable = MutableStateFlow(false)
    val frontAvailable = _frontAvailable.asStateFlow()

    /** Whether the current lens has a flash (the flash button shows only then). */
    private val _flashAvailable = MutableStateFlow(false)
    val flashAvailable = _flashAvailable.asStateFlow()

    /** Focus lock point (upright normalised, as shown), or null for continuous autofocus. */
    private val _focusPoint = MutableStateFlow<Pair<Float, Float>?>(null)
    val focusPoint = _focusPoint.asStateFlow()

    /** Where the focus ring is being dragged (upright normalised, as shown), or null; it focuses there on release. */
    private val _dragPoint = MutableStateFlow<Pair<Float, Float>?>(null)
    val dragPoint = _dragPoint.asStateFlow()

    /** One event per capture, as the request goes to the camera: the UI's shutter feedback. */
    private val _shutterEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
    val shutterEvents = _shutterEvents.asSharedFlow()

    private val shutterSound = ShutterSound()
    /** The phone's position while geotagging is on and the camera is in front. */
    private val location = LocationTracker(application)
    val hasLocationPermission: Boolean get() = location.hasPermission()
    /** The law here requires the shutter sound (Japan, Korea…): it plays whatever the setting says. */
    val shutterSoundRequired = ShutterSound.required()

    /** The settings or help sheet is open: the volume keys shouldn't take photos then. */
    @Volatile
    var settingsOpen = false
    private var info: CameraController.Info? = null
    private var surfaceTexture: SurfaceTexture? = null
    private var hasPermission = false
    private var resumed = false
    private var startJob: Job? = null

    /** Device rotation (degrees clockwise from portrait), for the photo's orientation. */
    @Volatile
    var deviceDegrees = 0

    /** The latest analysed viewfinder frame. */
    private class Live(val base: ViewfinderBase, val stats: SceneStats, val defaults: DevelopParams, val auto: DevelopParams)

    @Volatile
    private var live: Live? = null
    private var liveJob: Job? = null

    init {
        ShotSaver.attachView()
        viewModelScope.launch(Dispatchers.Main.immediate) {
            ShotSaver.calibrations.collect { cal ->
                _settings.value = when (cal) {
                    is Calibration.PreviewScale -> _settings.value.let { it.copy(previewScales = it.previewScales + (cal.lensKey to cal.scale)) }
                    is Calibration.FlashGuide -> _settings.value.let { it.copy(flashGuides = it.flashGuides + (cal.key to cal.guide)) }
                }
                republish()
            }
        }
        viewModelScope.launch(Dispatchers.Main.immediate) {
            ShotSaver.errors.collect { _message.value = it }
        }
    }

    // ---- Camera lifecycle ----

    fun onPermission(granted: Boolean) {
        hasPermission = granted
        if (!granted) _status.value = CameraStatus.NEEDS_PERMISSION
        startIfReady()
    }

    fun onResume() {
        resumed = true
        // Location access taken away in the system settings: geotagging can't work, so it shows as off.
        if (_settings.value.geotag && !location.hasPermission()) {
            change { it.copy(geotag = false) }
            _message.value = "Geotagging turned off: no location access"
        }
        updateLocation()
        startIfReady()
    }

    fun onPause() {
        resumed = false
        updateLocation()
        // The process may be killed in the background: write settings still waiting for a slider to rest.
        if (saveJob?.isActive == true) {
            saveJob?.cancel()
            CameraSettingsStore.save(app, _settings.value)
        }
        // Defer closing Camera2 until an in-flight capture has read its raw (e.g. locking right after the shutter).
        if (activeCaptures == 0) stopCamera()
    }

    private fun stopCamera() {
        restartAfterCapture = false
        startJob?.cancel()
        startJob = null
        controller.stop() // also ends a focus lock
        _focusPoint.value = null
        _dragPoint.value = null
        clearQr()
        if (hasPermission) _status.value = CameraStatus.OPENING
    }

    private fun restartCamera() {
        restartAfterCapture = false
        startJob?.cancel()
        startJob = null
        if (hasPermission) _status.value = CameraStatus.OPENING
        startIfReady()
    }

    /** The viewfinder's (new) camera texture; called whenever its GL context is created. */
    fun onSurfaceTexture(st: SurfaceTexture) {
        viewModelScope.launch {
            surfaceTexture = st
            if (activeCaptures == 0) restartCamera() else restartAfterCapture = true
        }
    }

    private fun startIfReady() {
        val st = surfaceTexture ?: return
        if (!hasPermission || !resumed || startJob != null) return
        _status.value = CameraStatus.OPENING
        startJob = viewModelScope.launch {
            try {
                val inf = info ?: run {
                    val sides = lensesBySide ?: withContext(Dispatchers.Default) {
                        mapOf(
                            false to controller.lenses(CameraMetadata.LENS_FACING_BACK),
                            true to controller.lenses(CameraMetadata.LENS_FACING_FRONT),
                        )
                    }.also { lensesBySide = it }
                    _frontAvailable.value = sides[true].orEmpty().isNotEmpty()
                    if (sides[false].orEmpty().isEmpty()) throw java.io.IOException("No back camera with RAW support")
                    // The saved side may have no RAW (or another phone): fall back to the back cameras.
                    val front = _settings.value.front && _frontAvailable.value
                    val all = sides.getValue(front)
                    _lenses.value = all
                    if (front != _settings.value.front) change { it.copy(front = front) }
                    (all.firstOrNull { it.label == _settings.value.lens } ?: all.first { it.label == "W" }).also { info = it }
                }
                _flashAvailable.value = inf.hasFlash
                controller.start(inf, st)
                _frame.value = ViewfinderRenderer.Frame(
                    bufferWidth = inf.previewSize.width,
                    bufferHeight = inf.previewSize.height,
                    rotation = inf.sensorOrientation,
                    fullWidth = inf.viewfinderWidth,
                    fullHeight = inf.viewfinderHeight,
                    gamma = inf.previewGamma,
                    scale = _settings.value.previewScale,
                    mirror = inf.isFront,
                )
                _status.value = CameraStatus.READY
                if (inf.label != _settings.value.lens) change { it.copy(lens = inf.label) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "camera start", e)
                _message.value = "Camera: ${e.message ?: e.javaClass.simpleName}"
                _status.value = CameraStatus.FAILED
                startJob = null
            }
        }
    }

    /** Focus lock at a point of the viewfinder (upright normalised, as shown). */
    fun focusAt(x: Float, y: Float) {
        if (_status.value != CameraStatus.READY) return
        _focusPoint.value = x to y
        controller.focusAt(x, y)
    }

    fun releaseFocus() {
        _focusPoint.value = null
        _dragPoint.value = null
        controller.releaseFocus()
    }

    /** The focus ring follows a drag to ([x], [y]); [endDragFocus] focuses there. */
    fun dragFocus(x: Float, y: Float) {
        if (_focusPoint.value == null) return
        _dragPoint.value = x.coerceIn(0f, 1f) to y.coerceIn(0f, 1f)
    }

    fun endDragFocus() {
        val (x, y) = _dragPoint.value ?: return
        _dragPoint.value = null
        focusAt(x, y)
    }

    /**
     * Where the auto develop meters exposure: around the tapped focus point while focus is locked (as Camera2's AE
     * does), else the centre box. Upright as the viewfinder shows it, like its 512 px copy.
     */
    private fun meterArea(): MeterArea = _focusPoint.value?.let { (x, y) -> MeterArea.Spot(x, y) } ?: METER_CENTRE

    /** Switches to the lens labelled [label] (UW, W, T) on the current side. */
    fun selectLens(label: String) {
        val lens = _lenses.value.firstOrNull { it.label == label } ?: return
        if (lens === info) return
        switchTo(lens)
        change { it.copy(lens = label) }
    }

    /** Back cameras <-> selfie camera (its main lens). */
    fun switchFacing() {
        val front = !_settings.value.front
        val all = lensesBySide?.get(front).orEmpty()
        val lens = all.firstOrNull { it.label == "W" } ?: all.firstOrNull() ?: return
        _lenses.value = all
        switchTo(lens)
        change { it.copy(front = front, lens = lens.label) }
    }

    private fun switchTo(lens: CameraController.Info) {
        info = lens
        _focusPoint.value = null // the restart ends any focus lock
        _dragPoint.value = null
        // The live develop belongs to the old lens: start the new one fresh.
        live = null
        clearQr()
        _shaderParams.value = null
        if (activeCaptures == 0) restartCamera() else restartAfterCapture = true
    }

    // ---- Live develop ----

    /** A small copy of the viewfinder frame (GL thread): analyse it unless the last one is still running. */
    fun onViewfinderBase(width: Int, height: Int, rgba: FloatArray) {
        if (liveJob?.isActive == true) return
        val f = _frame.value ?: return
        // The ISP's post-raw digital gain isn't in the raw: take it back out, and add what the still will gain
        // over the preview in low light (longer exposure), so the viewfinder meters like the shot's raw.
        val state = controller.frames.value
        val boost = state?.postRawBoost ?: 1f
        val stillGain = state?.let { controller.stillGain(it) } ?: 1f
        val scale = _settings.value.previewScale / boost * stillGain
        // The raw's colours for the ISP's current white balance and colour matrix (they follow AWB).
        val color = state?.previewColor
        if (scale != f.scale || !color.contentEquals(f.color)) _frame.value = f.copy(scale = scale, color = color)
        liveJob = viewModelScope.launch(Dispatchers.Default) {
            val base = ViewfinderBase.from(width, height, rgba, f.fullWidth, f.fullHeight)
            val state = controller.frames.value
            val defaults = state?.whiteXY?.let { xy ->
                val (kelvin, tint) = CameraController.tempTint(xy)
                DevelopParams(temperature = kelvin, tint = tint)
            } ?: DevelopParams()
            val skin = state?.faces?.takeIf { it.isNotEmpty() }?.let { faceMask(it, base) }
            val stats = SceneAnalyzer.analyze(base.base, skin, state?.iso ?: 0f, meterArea())
            // The phone's auto exposure set the frame (and the shot's raw): keep it, lifted where it went dark, as the
            // shot does (see develop).
            live = Live(base, stats, defaults, AutoTone.develop(stats, defaults, phoneAe = true))
            publish()
        }
    }

    /**
     * A greyscale copy of the viewfinder frame (GL thread), while [CameraSettings.scanQr] is on: look for a QR code
     * unless the last read is still running. Skipped while a burst merges, which needs the CPU and memory.
     */
    fun onViewfinderLuma(width: Int, height: Int, luma: ByteArray) {
        if (_merging.value || !qrBusy.compareAndSet(false, true)) return
        qrExecutor.execute {
            try {
                val text = runCatching { QrReader.read(width, height, luma) }.getOrNull()
                synchronized(qrTracker) {
                    if (qrTracker.update(text, SystemClock.uptimeMillis()) && _settings.value.scanQr) _qrCode.value = qrTracker.shown
                }
            } finally {
                qrBusy.set(false)
            }
        }
    }

    /** The chip's ✕: hides the code until it has left the view. */
    fun dismissQr() {
        synchronized(qrTracker) {
            qrTracker.dismiss(SystemClock.uptimeMillis())
            _qrCode.value = null
        }
    }

    private fun clearQr() {
        synchronized(qrTracker) {
            qrTracker.clear()
            _qrCode.value = null
        }
    }

    /** Viewfinder uniforms for the latest frame and the current controls. */
    private suspend fun publish() {
        val l = live ?: return
        val f = _frame.value ?: return
        val s = _settings.value
        val look = Edition.look(s.lookId)
        val developed = if (_compare.value) l.auto else LookApplier.apply(l.auto, look, s.strength, Adjustments(brightness = s.brightness, warmth = s.warmth), l.stats.hasFace)
        // The ISP has already denoised and sharpened the preview stream.
        val p = developed.copy(denoise = 0f, sharpening = 0f, skinRetouch = 0f)
        val lut = p.lut?.let { id -> runCatching { ShotSaver.loadLut(app, id) }.getOrNull() }
        val film = p.film?.let { id -> runCatching { ShotSaver.loadFilm(app, id) }.getOrNull() }
        val lens = LensTransform(LensInfo.none(f.fullWidth, f.fullHeight), p)
        val params = ShaderParams.from(
            p, l.defaults, lut, lens, l.base.base, null, null, GRAIN_SIZE_SCALE, grainStrength(s), film = film,
        )
        _shaderParams.value = params
        updateHistogram(params, l.base.base, s.showHistogram)
    }

    /**
     * Histogram of the live develop at [HISTOGRAM_SIZE] px, from the same base copy and params as the viewfinder.
     * Skipped while the previous one is still rendering: the next live update brings a newer one anyway.
     */
    private fun updateHistogram(params: ShaderParams, base: PreviewImage, on: Boolean) {
        if (!on) {
            _histogram.value = null
            return
        }
        if (histogramJob?.isActive == true) return
        histogramJob = viewModelScope.launch(Dispatchers.Default) {
            try {
                val bitmap = histogramRenderer.render(params, base, HISTOGRAM_SIZE)
                val pixels = IntArray(bitmap.width * bitmap.height)
                bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                bitmap.recycle()
                // Switched off while rendering: don't bring it back.
                if (_settings.value.showHistogram) _histogram.value = Histogram.fromArgb(pixels)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Histogram failed", e)
            }
        }
    }

    /** Only the newest control values matter: a newer publish replaces one still running. */
    private fun republish() {
        publishJob?.cancel()
        publishJob = viewModelScope.launch(Dispatchers.Default) { publish() }
    }
    private var publishJob: Job? = null

    // ---- Controls ----

    fun setLook(id: String) = change { it.copy(lookId = id) }
    fun setStrength(v: Float) = change { it.copy(strength = v) }
    fun setBrightness(v: Float) = change { it.copy(brightness = v) }
    fun setWarmth(v: Float) = change { it.copy(warmth = v) }
    fun setJpegQuality(q: Int) = change { it.copy(jpegQuality = q.coerceIn(CameraSettings.MIN_QUALITY, 100)) }
    fun setKeepDng(keep: Boolean) = change { it.copy(keepDng = keep) }
    fun setSmallExport(on: Boolean) = change { it.copy(smallExport = on) }
    fun setRememberLast(on: Boolean) = change { it.copy(rememberLast = on) }
    fun setShowHistogram(on: Boolean) = change { it.copy(showHistogram = on) }
    fun setBurstMode(mode: BurstMode) = change { it.copy(burstMode = mode) }
    fun setShutterSound(on: Boolean) = change { it.copy(shutterSound = on) }
    fun setScanQr(on: Boolean) {
        change { it.copy(scanQr = on) }
        if (!on) clearQr()
    }

    /** Turning it on needs location access first: the UI asks for it, then calls [onLocationPermission]. */
    fun setGeotag(on: Boolean) {
        change { it.copy(geotag = on && location.hasPermission()) }
        updateLocation()
    }

    fun onLocationPermission(granted: Boolean) {
        if (granted) setGeotag(true) else _message.value = "No location access: photos aren't geotagged"
    }

    /** Listens for the position only while it is used: geotagging on and the camera in front. */
    private fun updateLocation() {
        if (_settings.value.geotag && resumed) location.start() else location.stop()
    }

    /** Off <-> Focus-flash. */
    fun cycleFlash() = change { it.copy(flash = FlashMode.entries[(it.flash.ordinal + 1) % FlashMode.entries.size]) }

    fun setCompare(on: Boolean) {
        _compare.value = on
        republish()
    }

    private fun change(edit: (CameraSettings) -> CameraSettings) {
        val s = edit(_settings.value)
        _settings.value = s
        // A slider drag changes settings every frame: save once it rests.
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(SAVE_DELAY_MS)
            CameraSettingsStore.save(app, _settings.value)
        }
        republish()
    }
    private var saveJob: Job? = null

    fun consumeMessage() {
        _message.value = null
    }

    fun showMessage(text: String) {
        _message.value = text
    }

    // ---- Capture ----

    /** Takes a raw now; it is developed into a JPEG in the background. */
    fun shutter() {
        if (!resumed || _status.value != CameraStatus.READY || _merging.value) return
        val settings = _settings.value
        val flash = settings.flash.takeIf { info?.hasFlash == true } ?: FlashMode.OFF
        // Flash shots are single frames (CameraController.captureDng).
        val burstFrames = settings.burstFrames(lowLight.value)
        val burst = burstFrames > 1 && flash == FlashMode.OFF
        // A flash shot's raw is lit by the flash, the viewfinder wasn't: no calibration from it.
        val viewfinderKey = if (flash == FlashMode.OFF) live?.stats?.key else null
        val mayHaveFace = info?.hasFaceDetection != true || controller.frames.value?.faces?.isNotEmpty() != false
        controller.frames.value?.let { f ->
            Log.d(TAG, "shutter ${settings.lensKey}: preview ISO ${f.iso.toInt()}, ${f.exposureNs / 1000} µs, boost ${f.postRawBoost}, " +
                "tonemap ${f.tonemapMode}, viewfinder key $viewfinderKey, preview scale ${settings.previewScale}, " +
                "colour ${f.previewColor?.joinToString(" ") { "%.3f".format(it) } ?: "sRGB"}, " +
                "wb ${live?.defaults?.let { "${it.temperature.toInt()}K/${it.tint.toInt()}" }} -> " +
                "${live?.auto?.let { "${it.temperature.toInt()}K/${it.tint.toInt()}" }}")
        }
        val shotId = ShotSaver.beginCapture(app)
        activeCaptures++
        _capturing.value = activeCaptures
        if (burst) _merging.value = true
        // Runs in ShotSaver.scope so finishing LockScreenCameraActivity never cancels an in-flight capture.
        ShotSaver.scope.launch {
            try {
                val shot = capture(shotId, settings, viewfinderKey, flash, burstFrames).copy(mayHaveFace = mayHaveFace)
                ShotSaver.enqueue(app, shot)
            } catch (e: Throwable) {
                Log.w(TAG, "capture", e)
                if (e !is CancellationException) {
                    _message.value = "Capture failed: ${e.message ?: e.javaClass.simpleName}"
                }
                ShotSaver.cancelCapture()
            } finally {
                if (burst) _merging.value = false
                activeCaptures--
                if (activeCaptures == 0) {
                    if (!resumed) stopCamera() else if (restartAfterCapture) restartCamera()
                }
                _capturing.value = activeCaptures
            }
        }
    }

    /** As the request goes to the camera: the click (if on, or required here) and the UI's shutter feedback. */
    private fun onShutter() {
        if (_settings.value.shutterSound || shutterSoundRequired) shutterSound.play()
        _shutterEvents.tryEmit(Unit)
    }

    /** Captures a raw and saves it as DNG (in Pictures/<Edition.FOLDER>/RAW, or a temporary file). */
    private suspend fun capture(shotId: Long, settings: CameraSettings, viewfinderKey: Float?, flash: FlashMode, burstFrames: Int): Shot {
        val resolver = app.contentResolver
        val baseName = "IMG_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(Date())
        val degrees = deviceDegrees
        val orientation = controller.exifOrientation(degrees)
        // The photo is level with the horizon; the tap was on the (portrait) viewfinder.
        val meter = meterArea().let { if (it is MeterArea.Spot) it.turned(degrees) else it }
        val fix = if (settings.geotag) location.current() else null
        return if (settings.keepDng) {
            val (uri, name) = withContext(Dispatchers.IO) {
                MediaStoreOutput.create(resolver, baseName, "dng", DNG_MIME, RAW_NAMING)
            }
            val dngStart = System.nanoTime()
            val result = try {
                withContext(Dispatchers.IO) {
                    val out = resolver.openOutputStream(uri, "w") ?: throw java.io.IOException("Cannot write $name")
                    val result = out.buffered(1 shl 20).use { controller.captureDng(orientation, it, flash, settings.flashGuide, burstFrames, fix) { onShutter() } }
                    fix?.let { addGps(uri, it) }
                    MediaStoreOutput.publish(resolver, uri)
                    result
                }
            } catch (t: Throwable) {
                withContext(Dispatchers.IO + NonCancellable) { resolver.delete(uri, null, null) }
                throw t
            }
            Log.d(TAG, "$name: capture + DNG write ${(System.nanoTime() - dngStart) / 1_000_000} ms")
            Shot(shotId, uri, name, null, settings, viewfinderKey, isoOf(result.result), flashGuide = result.flashGuide, flashDistanceKnown = result.distanceKnown, meter = meter, effectiveFrames = result.effectiveFrames)
        } else {
            val file = File(app.cacheDir, "$baseName-$shotId.dng")
            val result = try {
                withContext(Dispatchers.IO) {
                    val result = file.outputStream().buffered(1 shl 20).use { controller.captureDng(orientation, it, flash, settings.flashGuide, burstFrames, fix) { onShutter() } }
                    fix?.let { addGps(Uri.fromFile(file), it) }
                    result
                }
            } catch (t: Throwable) {
                file.delete()
                throw t
            }
            Shot(shotId, Uri.fromFile(file), "$baseName.dng", file, settings, viewfinderKey, isoOf(result.result), flashGuide = result.flashGuide, flashDistanceKnown = result.distanceKnown, meter = meter, effectiveFrames = result.effectiveFrames)
        }
    }

    /**
     * Completes the DNG's GPS tags with the altitude, which DngCreator leaves out (see DngGps); the JPEG copies them
     * from the DNG. Best effort: DngCreator's latitude, longitude and time stay if this fails. IO thread.
     */
    private fun addGps(dng: Uri, fix: Location) {
        try {
            app.contentResolver.openFileDescriptor(dng, "rw")?.use { pfd ->
                val fd = pfd.fileDescriptor
                val done = DngGps.write(
                    gpsOf(fix), Os.fstat(fd).st_size,
                    read = { offset, length ->
                        val b = ByteArray(length)
                        var n = 0
                        while (n < length) {
                            val got = Os.pread(fd, b, n, length - n, offset + n)
                            if (got <= 0) break
                            n += got
                        }
                        b.copyOf(n)
                    },
                    write = { offset, bytes ->
                        var n = 0
                        while (n < bytes.size) n += Os.pwrite(fd, bytes, n, bytes.size - n, offset + n)
                    },
                )
                if (!done) Log.w(TAG, "DNG GPS: no GPS IFD to replace")
            }
        } catch (e: Exception) {
            Log.w(TAG, "DNG GPS", e)
        }
    }

    /** [fix] as GPS tags. Altitude above sea level: Android 14+ converts the fix's height above the ellipsoid. */
    private fun gpsOf(fix: Location): ExifMetadata.Gps {
        val altitude = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && fix.hasMslAltitude() -> fix.mslAltitudeMeters
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && fix.hasAltitude() -> try {
                Location(fix).also { AltitudeConverter().addMslAltitudeToLocation(app, it) }.mslAltitudeMeters
            } catch (e: Exception) {
                fix.altitude
            }
            fix.hasAltitude() -> fix.altitude
            else -> Double.NaN
        }
        return ExifMetadata.Gps.of(fix.latitude, fix.longitude, altitude, fix.time)
    }

    override fun onCleared() {
        if (saveJob?.isActive == true) {
            saveJob?.cancel()
            CameraSettingsStore.save(app, _settings.value) // still pending: save now
        }
        location.stop()
        shutterSound.release()
        controller.close()
        histogramRenderer.close()
        qrExecutor.shutdown()
        ShotSaver.detachView()
    }

    companion object {
        private const val TAG = "RawBoyCamera"
        private const val DNG_MIME = "image/x-adobe-dng"
        private const val SAVE_DELAY_MS = 500L

        /** Exposure is metered on the middle half of the frame's width and height (owner's choice), unless tapped. */
        internal val METER_CENTRE = MeterArea.Centre(0.5f)

        /** Camera grain is twice as fine as the film-scaled default (owner's preference). */
        internal const val GRAIN_SIZE_SCALE = 0.5f

        /** Long side of the live histogram's copy: enough pixels for 64 bins, cheap every update. */
        private const val HISTOGRAM_SIZE = 128

        /**
         * Half-size grain partly averages out when the photo is saved at 3000 px (area downscale ×1.36): measured
         * std 0.83 -> 0.62 (simulation of the shader's grain), so it's raised to look as strong as before.
         * At full size each pixel is a point sample: no loss.
         */
        internal fun grainStrength(s: CameraSettings) = if (s.smallExport) 1.34f else 1f

        private fun isoOf(r: android.hardware.camera2.CaptureResult): Float =
            (r.get(android.hardware.camera2.CaptureResult.SENSOR_SENSITIVITY) ?: 0).toFloat()
        val JPEG_NAMING = OutputNaming(folder = Edition.FOLDER, suffix = Edition.JPEG_SUFFIX)
        val RAW_NAMING = OutputNaming(folder = Edition.FOLDER + "/RAW", suffix = "")

        /**
         * Camera face rectangles as a coarse skin mask for metering (SceneAnalyzer meters skin and
         * sizes faces from it): an ellipse in the middle of each face box.
         */
        private fun faceMask(faces: List<android.graphics.RectF>, base: ViewfinderBase): SkinMask {
            val w = 64
            val h = max(1, (64f * base.base.height / base.base.width).toInt())
            val data = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
            var diameter = 0f
            for (face in faces) {
                diameter = max(diameter, face.width() * base.base.fullWidth)
                val cx = face.centerX() * w
                val cy = face.centerY() * h
                val rx = face.width() * w * 0.35f
                val ry = face.height() * h * 0.35f
                if (rx <= 0f || ry <= 0f) continue
                for (y in 0 until h) for (x in 0 until w) {
                    val dx = (x + 0.5f - cx) / rx
                    val dy = (y + 0.5f - cy) / ry
                    if (dx.pow(2) + dy.pow(2) <= 1f) data.put(y * w + x, 1f)
                }
            }
            return SkinMask(w, h, data, sigmaPx = 3f, hasSkin = diameter > 0f, faceDiameterPx = diameter)
        }
    }
}
