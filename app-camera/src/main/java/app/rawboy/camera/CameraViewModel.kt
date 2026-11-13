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
import app.rawboy.auto.looks.LookApplier
import app.rawboy.camera.capture.CameraController
import app.rawboy.camera.capture.FlashMode
import app.rawboy.camera.capture.LocationTracker
import app.rawboy.camera.capture.ShutterSound
import app.rawboy.camera.qr.QrPayload
import app.rawboy.camera.qr.QrReader
import app.rawboy.camera.qr.QrTracker
import app.rawboy.color.BwFilter
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
import app.rawboy.track.PatternTracker
import app.rawboy.camera.capture.VideoRecorder
import app.rawboy.gl.VideoSink
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
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

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

    /** Megapixels of the largest maximum-resolution sensor mode offered by any lens, 0 if none: the setting shows only then. */
    private val _maxResMp = MutableStateFlow(0)
    val maxResMp = _maxResMp.asStateFlow()

    /** Whether the current lens shoots in its maximum-resolution sensor mode (burst merging isn't used then). */
    private val _hiRes = MutableStateFlow(false)
    val hiRes = _hiRes.asStateFlow()

    /** Lenses per side (true = front), discovered once (again when the maximum-resolution setting changes). */
    private var lensesBySide: Map<Boolean, List<CameraController.Info>>? = null

    /** Whether the front camera can deliver RAW (the selfie flip button shows only then). */
    private val _frontAvailable = MutableStateFlow(false)
    val frontAvailable = _frontAvailable.asStateFlow()

    /** Whether the current lens has a flash (the flash button shows only then). */
    private val _flashAvailable = MutableStateFlow(false)
    val flashAvailable = _flashAvailable.asStateFlow()

    /** The selfie camera has no flash unit: the flash button lights the screen's frame instead (screen flash). */
    private val _screenFlashCamera = MutableStateFlow(false)
    val screenFlashCamera = _screenFlashCamera.asStateFlow()

    /** The frame is lit now: from just before a screen flash shot until its exposure is done. */
    private val _screenFlashLit = MutableStateFlow(false)
    val screenFlashLit = _screenFlashLit.asStateFlow()

    /** Focus lock point (upright normalised, as shown), or null for continuous autofocus. */
    private val _focusPoint = MutableStateFlow<Pair<Float, Float>?>(null)
    val focusPoint = _focusPoint.asStateFlow()

    /** Where the focus ring is being dragged (upright normalised, as shown), or null; it focuses there on release. */
    private val _dragPoint = MutableStateFlow<Pair<Float, Float>?>(null)
    val dragPoint = _dragPoint.asStateFlow()

    /**
     * Whether the focus point follows the tapped subject ([CameraSettings.trackFocus]): [_focusPoint] moves with it,
     * and the lock ends by itself once the subject is lost.
     */
    private val _tracking = MutableStateFlow(false)
    val tracking = _tracking.asStateFlow()

    /** Follows the tapped subject in the viewfinder's small grey copies; used under its own lock. */
    private val tracker = PatternTracker()
    /** The point the next grey copy starts [tracker] at (a tap since the last copy), or null. */
    private var trackStart: Pair<Float, Float>? = null
    /** Bumped by every tap and release, so a copy analysed meanwhile can't move or end the new lock. */
    private var trackGeneration = 0
    private var lastFocusMove = 0L
    /** The point the camera's AF region was last moved to. */
    private var sentFocus: Pair<Float, Float>? = null
    /** Whether the tracked subject is out of sight (held for a moment): metering goes to the centre meanwhile. */
    @Volatile
    private var subjectHidden = false
    private var sentHidden = false
    private val trackBusy = AtomicBoolean(false)

    /** The tracker's own thread: a search takes ~0.2 ms, but never on the GL thread or a shot's develop. */
    private val trackExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "RawBoy-track") }

    /** One event per capture, as the request goes to the camera: the UI's shutter feedback. */
    // ---- Video (prototype: the viewfinder's look recorded as 1080p30 H.264 + stereo AAC) ----

    private val _videoMode = MutableStateFlow(false)

    /** Photo / Video switch; not remembered between starts. */
    val videoMode = _videoMode.asStateFlow()

    private val _videoSink = MutableStateFlow<VideoSink?>(null)

    /** The encoder's surface while recording; the viewfinder draws into it. */
    val videoSink = _videoSink.asStateFlow()

    private val _recordingMs = MutableStateFlow<Long?>(null)

    /** Elapsed recording time, null when not recording. */
    val recordingMs = _recordingMs.asStateFlow()

    private var recorder: VideoRecorder? = null
    private var recordingJob: Job? = null
    private var audioGranted = false

    private var stopRequested = false

    fun onAudioPermission(granted: Boolean) {
        audioGranted = granted
        if (!granted) _message.value = "No microphone access: videos will have no sound"
    }

    fun hasAudioPermission() = audioGranted

    fun setVideoMode(on: Boolean) {
        if (_recordingMs.value != null) return
        _videoMode.value = on
        controller.setExposureBias(exposureBias(_settings.value)) // flat video raises it
        if (!on) setExposureLock(false) // the lock is video mode's: photos meter as always
        applyStabilization()
        republish() // the video viewfinder drops the colour denoise (see publish)
    }

    private val _exposureLocked = MutableStateFlow(false)

    /** Video mode's exposure lock (AE lock), separate from the focus lock. */
    val exposureLocked: StateFlow<Boolean> = _exposureLocked

    fun setExposureLock(locked: Boolean) {
        if (locked && !_videoMode.value) return
        _exposureLocked.value = locked
        controller.setExposureLock(locked)
    }

    /** Optical stabilization is video mode's, and only when switched on in Settings. */
    private fun applyStabilization() {
        controller.setVideoStabilization(_videoMode.value && _settings.value.videoStabilization)
    }

    /** Not in the middle of a recording: the file's format is fixed when it starts. */
    fun setFlatVideo(on: Boolean) {
        if (_recordingMs.value == null) change { it.copy(flatVideo = on) }
    }

    fun setVideoStabilization(on: Boolean) {
        change { it.copy(videoStabilization = on) }
        // Changing it restarts the preview (a visible blink and a new crop): not in the middle of a recording.
        if (_recordingMs.value == null) applyStabilization()
    }

    private fun toggleRecording() {
        if (recorder != null) stopRecording() else startRecording()
    }

    private fun startRecording() {
        if (recorder != null || _recordingMs.value != null) return
        // As photos do: the phone's own rotation, so a phone held sideways with auto-rotate off still records upright.
        val turns = (deviceDegrees / 90) % 4
        val withAudio = audioGranted
        val flat = _settings.value.flatVideo
        stopRequested = false
        _recordingMs.value = 0
        recordingJob = viewModelScope.launch {
            val r = try {
                withContext(Dispatchers.IO) { VideoRecorder.create(app, turns, withAudio, flat) { /* the view's requestRender is on the sink */ } }
            } catch (e: Exception) {
                Log.w(TAG, "recording did not start", e)
                _message.value = "Could not start recording: ${e.message}"
                _recordingMs.value = null
                stopRequested = false
                return@launch
            }
            recorder = r
            _videoSink.value = r.sink
            if (stopRequested) {
                stopRequested = false
                stopRecording()
                return@launch
            }
            // The timer, and a watch on the renderer: no encoder surface means no video, so stop instead of recording nothing.
            while (recorder === r) {
                _recordingMs.value = r.elapsedMs
                if (r.failed) {
                    _message.value = "Recording failed: this phone refused the encoder surface"
                    stopRecording()
                    return@launch
                }
                delay(200)
            }
        }
    }

    /** Ends the recording and saves the file (on a worker thread); shows where it went. */
    fun stopRecording() {
        val r = recorder ?: run {
            // Still starting up: the start stops again as soon as it has a recorder.
            if (_recordingMs.value != null) stopRequested = true
            return
        }
        recorder = null
        recordingJob = null
        viewModelScope.launch {
            val uri = withContext(Dispatchers.IO + NonCancellable) { r.stop() }
            _videoSink.value = null
            _recordingMs.value = null
            applyStabilization() // a switch flipped during the recording takes effect now
            _message.value = if (uri != null) "Video saved to Movies/${Edition.FOLDER}" else "Nothing was recorded"
        }
    }

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

    private val _tilt = MutableStateFlow<Float?>(null)
    private val tiltFilter = TiltFilter()

    /**
     * How far the phone is turned clockwise from upright portrait (continuous degrees, unwrapped across 360°), for the
     * level line; null while the phone lies flat (no usable direction) or the level is off.
     */
    val tilt = _tilt.asStateFlow()

    /** From the activity's orientation sensor: [degrees] is the device's turn clockwise from portrait, 0..359, or null when flat. */
    fun onTilt(degrees: Int?) {
        if (degrees == null || !_settings.value.showLevel) {
            tiltFilter.reset()
            _tilt.value = null
            return
        }
        _tilt.value = tiltFilter.update(degrees)
    }

    /** The latest analysed viewfinder frame. */
    private class Live(val base: ViewfinderBase, val stats: SceneStats, val defaults: DevelopParams, val auto: DevelopParams, val scale: Float = 1f)

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
        cancelSelfTimer()
        stopRecording() // a recording never carries on in the background
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
        stopTracking(clearPoint = true)
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
                            false to controller.lenses(CameraMetadata.LENS_FACING_BACK, _settings.value.maxRes),
                            true to controller.lenses(CameraMetadata.LENS_FACING_FRONT, _settings.value.maxRes),
                        )
                    }.also { lensesBySide = it }
                    _frontAvailable.value = sides[true].orEmpty().isNotEmpty()
                    if (sides[false].orEmpty().isEmpty()) throw java.io.IOException("No back camera with RAW support")
                    // The saved side may have no RAW (or another phone): fall back to the back cameras.
                    val front = _settings.value.front && _frontAvailable.value
                    val all = sides.getValue(front)
                    _lenses.value = all
                    _maxResMp.value = sides.values.flatten().mapNotNull { it.maxResSize }
                        .maxOfOrNull { Math.round(it.width.toLong() * it.height / 1e6f) } ?: 0
                    if (front != _settings.value.front) change { it.copy(front = front) }
                    (all.firstOrNull { it.label == _settings.value.lens } ?: all.first { it.label == "W" }).also { info = it }
                }
                _screenFlashCamera.value = inf.isFront && !inf.hasFlash
                _flashAvailable.value = inf.hasFlash || _screenFlashCamera.value
                _hiRes.value = inf.hiRes
                controller.setExposureBias(exposureBias(_settings.value))
                applyStabilization()
                controller.start(inf, st)
                _frame.value = ViewfinderRenderer.Frame(
                    bufferWidth = inf.previewSize.width,
                    bufferHeight = inf.previewSize.height,
                    rotation = inf.sensorOrientation,
                    fullWidth = inf.viewfinderWidth,
                    fullHeight = inf.viewfinderHeight,
                    gamma = inf.previewGamma,
                    scale = _settings.value.previewScale(inf.hiRes),
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

    private val _zoom = MutableStateFlow(1f)

    /** Digital zoom of the viewfinder, [MIN_ZOOM]..[MAX_ZOOM] (the centre 1/zoom of the frame; not saved between launches). */
    val zoom = _zoom.asStateFlow()

    /**
     * Zooms to [value] (clamped). Zoom is logarithmic to the eye, so callers step it by factors. A focus lock belongs to
     * the old picture, so it is released.
     */
    fun setZoom(value: Float) {
        val z = value.coerceIn(MIN_ZOOM, MAX_ZOOM)
        if (z == _zoom.value) return
        _zoom.value = z
        if (_focusPoint.value != null) releaseFocus()
    }

    /** A point of the zoomed viewfinder, as the camera's unzoomed frame has it. */
    private fun unzoom(v: Float): Float = 0.5f + (v - 0.5f) / _zoom.value

    /** Focus lock at a point of the viewfinder (upright normalised, as shown). */
    fun focusAt(x: Float, y: Float) {
        if (_status.value != CameraStatus.READY) return
        synchronized(tracker) {
            stopTracking()
            _focusPoint.value = x to y
            // Focus first scans at the tap as usual; the tracker takes over from the next grey copy.
            if (_settings.value.trackFocus) trackStart = x to y
        }
        controller.focusAt(unzoom(x), unzoom(y))
    }

    fun releaseFocus() {
        _dragPoint.value = null
        stopTracking(clearPoint = true)
        controller.releaseFocus()
    }

    /**
     * Stops following the subject; [clearPoint] also ends the lock, under the tracker's lock so that no answer still
     * being worked out brings the point back.
     */
    private fun stopTracking(clearPoint: Boolean = false) {
        synchronized(tracker) {
            if (clearPoint) _focusPoint.value = null
            trackGeneration++
            trackStart = null
            tracker.stop()
            _tracking.value = false
        }
    }

    /**
     * A small grey copy of the viewfinder frame (GL thread), while a tap's focus may be tracked: starts the tracker at
     * the tap, or finds the subject again and moves the focus point (and the AF and metering regions) with it. A
     * subject without enough detail keeps a plain focus lock; one lost for good releases focus to autofocus.
     */
    fun onTrackLuma(width: Int, height: Int, luma: ByteArray) {
        if (_merging.value || !trackBusy.compareAndSet(false, true)) return
        trackExecutor.execute {
            try {
                synchronized(tracker) { track(width, height, luma) }
            } finally {
                trackBusy.set(false)
            }
        }
    }

    /** [onTrackLuma]'s work, under the tracker's lock. */
    private fun track(width: Int, height: Int, luma: ByteArray) {
        val now = SystemClock.uptimeMillis()
        val start = trackStart
        if (start != null) {
            trackStart = null
            if (tracker.start(width, height, luma, start.first, start.second, now)) {
                _tracking.value = true
                controller.trackFocus(unzoom(start.first), unzoom(start.second))
                lastFocusMove = now
                sentFocus = start
                subjectHidden = false
                sentHidden = false
            }
            return
        }
        val r = tracker.update(width, height, luma, now) ?: return
        if (r.lost) {
            val generation = trackGeneration
            viewModelScope.launch {
                if (synchronized(tracker) { generation != trackGeneration }) return@launch
                releaseFocus()
                _message.value = "Subject lost: autofocus"
            }
            return
        }
        val point = _focusPoint.value ?: return
        if (abs(r.x - point.first) >= MIN_FOCUS_MOVE || abs(r.y - point.second) >= MIN_FOCUS_MOVE) {
            _focusPoint.value = r.x to r.y
        }
        subjectHidden = !r.found
        // Each move is a new repeating request: a few a second keep the AF box on the subject, and the last one
        // still goes out once the subject stops. Hiding or reappearing goes out at once (metering follows it).
        val shown = _focusPoint.value ?: return
        val moved = shown != sentFocus && now - lastFocusMove >= FOCUS_MOVE_INTERVAL_MS
        if (moved || subjectHidden != sentHidden) {
            lastFocusMove = now
            sentFocus = shown
            sentHidden = subjectHidden
            controller.moveFocus(unzoom(shown.first), unzoom(shown.second), meter = !subjectHidden)
        }
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
    private fun meterArea(): MeterArea =
        _focusPoint.value?.takeUnless { _tracking.value && subjectHidden }?.let { (x, y) -> MeterArea.Spot(x, y) } ?: METER_CENTRE

    /** Switches to the lens labelled [label] (UW, W, T) on the current side. */
    fun selectLens(label: String) {
        if (_recordingMs.value != null) return // the camera session would restart under the recording
        val lens = _lenses.value.firstOrNull { it.label == label } ?: return
        if (lens === info) return
        switchTo(lens)
        change { it.copy(lens = label) }
    }

    /** Back cameras <-> selfie camera (its main lens). */
    fun switchFacing() {
        if (_recordingMs.value != null) return
        val front = !_settings.value.front
        val all = lensesBySide?.get(front).orEmpty()
        val lens = all.firstOrNull { it.label == "W" } ?: all.firstOrNull() ?: return
        _lenses.value = all
        switchTo(lens)
        change { it.copy(front = front, lens = lens.label) }
    }

    private fun switchTo(lens: CameraController.Info) {
        info = lens
        _hiRes.value = lens.hiRes
        stopTracking(clearPoint = true) // the restart ends any focus lock
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
        // With Long exposure on, show what its frames will give (the same maths as the shutter's) instead of the still's.
        val settings = _settings.value
        val longGain = if (info?.hiRes != true && settings.flash == FlashMode.OFF && activeCaptures == 0 && (state?.exposureNs ?: 0L) < 250_000_000L) {
            settings.longExposureSpec(sceneKey())?.let { controller.longExposureGainOverPreview(it) }
        } else null
        val target = settings.previewScale(info?.hiRes == true) / boost * (longGain ?: stillGain)
        // The gain eases to its target (a fade) instead of jumping: a long exposure starts and ends with the viewfinder
        // changing exposure under the preview, and a step there reads as a flash. (Live.scale keeps the key honest.)
        val scale = if (f.scale > 0f && target > 0f) f.scale * (target / f.scale).coerceIn(1f / SCALE_FADE_STEP, SCALE_FADE_STEP) else target
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
            val auto = AutoTone.develop(stats, defaults, phoneAe = true, captureEv = controller.appliedCompensationEv(state, ofFrame = true), splitLuma = false)
            // A new metering area (a tap, a release, a tracked subject hiding) can move the exposure by a stop at once;
            // the viewfinder eases there over a few updates instead of snapping.
            val last = live?.auto?.exposure
            // Video eases much slower: a 0.3 EV step every 300 ms would pump visibly in a recording.
            val step = if (_videoMode.value) VIDEO_EV_STEP else MAX_EV_STEP
            val eased = if (last == null) auto else auto.copy(exposure = last + (auto.exposure - last).coerceIn(-step, step))
            live = Live(base, stats, defaults, eased, f.scale)
            if (activeCaptures == 0 && SystemClock.uptimeMillis() - captureEndedAt > SCENE_KEY_SETTLE_MS && f.scale > 0f) sceneKeyHeld = stats.key / f.scale
            publish()
            withContext(Dispatchers.Main) { meterRawIfUncalibrated() }
        }
    }

    /**
     * The viewfinder's scene key per unit of [ViewfinderRenderer.Frame.scale]: the key of the live frame is measured on
     * an image already scaled (the long-exposure preview moves that scale), so dividing it out keeps the lift from
     * feeding back on itself. Null before the first analysed frame.
     */
    private fun sceneKey(): Float? = sceneKeyHeld

    /** [sceneKey]'s last reading from a frame the AE preview made (not a long exposure's manual frames, which come after the shutter). */
    private var sceneKeyHeld: Float? = null
    private var captureEndedAt = 0L

    /** Lens keys whose raw metering ran this session ([meterRawIfUncalibrated]), so a lens is metered once at most. */
    private val rawMetered = mutableSetOf<String>()
    private var meterJob: Job? = null

    /**
     * A lens with no preview calibration yet: meter one raw frame of the still request and calibrate the viewfinder
     * from it, as a photo would ([ShotSaver]'s calibrate). Without it the viewfinder stayed at gain 1 until the first
     * shot, which suits the Pixel (0.5-0.8) but on a Galaxy Tab S11 Ultra, whose ISP adds ~4.4 stops the raw never
     * gets, showed a blown-out picture. Waits [RAW_METER_DELAY_MS] after the lens's first analysed frame for AE to
     * settle; skipped while a shot runs, focus is locked (spot metering) or for maximum-resolution lenses. Main thread.
     */
    private fun meterRawIfUncalibrated() {
        val lens = info ?: return
        val settings = _settings.value
        val key = settings.lensKey(lens.hiRes)
        if (lens.hiRes || key in settings.previewScales || key in rawMetered || meterJob?.isActive == true) return
        rawMetered += key
        meterJob = viewModelScope.launch {
            delay(RAW_METER_DELAY_MS)
            if (info !== lens || activeCaptures > 0 || meterArea() != METER_CENTRE) {
                rawMetered -= key
                return@launch
            }
            val scale = _settings.value.previewScale(false)
            val before = live?.stats?.key
            val rawKey = withContext(Dispatchers.Default) { controller.meterRaw(METER_CENTRE) }
            val after = live?.stats?.key
            // The viewfinder's key around the metered frame (analysed every ~300 ms).
            val viewfinderKey = if (before != null && after != null) kotlin.math.sqrt(before * after) else before ?: after
            if (info !== lens || rawKey == null || viewfinderKey == null || !(rawKey > 0f) || !(viewfinderKey > 0f)) {
                Log.d(TAG, "raw meter $key: no calibration (raw key $rawKey, viewfinder key $viewfinderKey)")
                return@launch
            }
            if (key in _settings.value.previewScales) return@launch // a shot calibrated it meanwhile
            val estimate = scale * (rawKey / viewfinderKey).coerceIn(1f / 64, 64f)
            val calibrated = withContext(Dispatchers.IO) { CameraSettingsStore.updatePreviewScale(app, key, estimate) }
            Log.d(TAG, "raw meter $key: raw key $rawKey, viewfinder key $viewfinderKey (raw/viewfinder ${rawKey / viewfinderKey}) -> preview scale $calibrated")
            _settings.value = _settings.value.let { it.copy(previewScales = it.previewScales + (key to calibrated)) }
            republish()
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
        val developed = if (_compare.value) l.auto else s.develop(l.auto, l.stats.hasFace)
        // The ISP has already denoised and sharpened the preview stream.
        // Video also drops the colour denoise: its coarse stages are many taps per pixel, drawn twice a frame (screen and
        // encoder), and a clip on a non-Film look (colour floor 70) ran at 12 fps instead of 30.
        val p = developed.copy(
            denoise = 0f, sharpening = 0f, skinRetouch = 0f,
            colorDenoise = if (_videoMode.value) 0f else developed.colorDenoise,
        )
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

    /**
     * AE compensation for [s]'s Brightness: all of it goes into the capture (preview and stills), and the develop takes
     * the applied part back out (AutoTone's captureEv), so Brightness looks the same and raises the shot's exposure.
     */
    private fun exposureBias(s: CameraSettings): Float =
        s.brightness / 100f * LookApplier.BRIGHTNESS_EV +
            // Flat video exposes this much higher for the shadows (the file keeps the lift, see VideoRecorder.FLAT_RAISE_EV).
            if (_videoMode.value && s.flatVideo) VideoRecorder.FLAT_RAISE_EV else 0f

    /** Only the newest control values matter: a newer publish replaces one still running. */
    private fun republish() {
        publishJob?.cancel()
        publishJob = viewModelScope.launch(Dispatchers.Default) { publish() }
    }
    private var publishJob: Job? = null

    // ---- Controls ----

    /** Picks [id] for the current mode: B&W mode's stock, Film mode's stock or the colour look. */
    fun setLook(id: String) = change {
        when {
            it.monoMode -> it.copy(monoLookId = id)
            it.filmMode -> it.copy(filmLookId = id)
            else -> it.copy(lookId = id)
        }
    }
    fun setMono(on: Boolean) = change { it.copy(mono = on) }
    /** The Film toggle: colour photos on the film stocks or on the LUT looks. */
    fun setFilm(on: Boolean) = change { it.copy(film = on) }
    fun setFilter(f: BwFilter) = change { it.copy(filter = f) }
    fun setStrength(v: Float) = change { it.copy(strength = v) }
    fun setBrightness(v: Float) = change { it.copy(brightness = v) }
    fun setWarmth(v: Float) = change { it.copy(warmth = v) }
    fun setJpegQuality(q: Int) = change { it.copy(jpegQuality = q.coerceIn(CameraSettings.MIN_QUALITY, 100)) }
    fun setKeepDng(keep: Boolean) = change { it.copy(keepDng = keep) }
    fun setLossyDng(on: Boolean) = change { it.copy(lossyDng = on) }
    fun setSmallExport(on: Boolean) = change { it.copy(smallExport = on) }

    /** Switches to the maximum-resolution sensor mode (or back); the lenses are listed again with the new size and the camera restarts. */
    fun setMaxRes(on: Boolean) {
        if (on == _settings.value.maxRes) return
        change { it.copy(maxRes = on) }
        lensesBySide = null
        info = null
        live = null
        _shaderParams.value = null
        if (activeCaptures == 0) restartCamera() else restartAfterCapture = true
    }
    fun setRememberLast(on: Boolean) = change { it.copy(rememberLast = on) }
    fun setShowHistogram(on: Boolean) = change { it.copy(showHistogram = on) }
    fun setShowZoomControl(on: Boolean) = change { it.copy(showZoomControl = on) }
    fun setShowGrid(on: Boolean) = change { it.copy(showGrid = on) }
    fun setShowLevel(on: Boolean) {
        if (!on) {
            tiltFilter.reset()
            _tilt.value = null
        }
        change { it.copy(showLevel = on) }
    }
    fun setBurstMode(mode: BurstMode) = change { it.copy(burstMode = mode) }
    fun cycleSelfTimer() = change {
        val t = CameraSettings.SELF_TIMERS
        it.copy(selfTimer = t[(t.indexOf(it.selfTimer) + 1) % t.size])
    }
    fun cycleLongExposure() = change {
        val t = CameraSettings.LONG_EXPOSURES
        it.copy(longExposure = t[(t.indexOf(it.longExposure) + 1) % t.size])
    }
    fun setLongExposureLighten(on: Boolean) = change { it.copy(longExposureLighten = on) }
    fun setShutterSound(on: Boolean) = change { it.copy(shutterSound = on) }
    fun setHdrGainMap(on: Boolean) = change { it.copy(hdrGainMap = on) }
    fun setTrackFocus(on: Boolean) {
        change { it.copy(trackFocus = on) }
        // A subject being followed: a plain lock where it is now.
        if (!on && _tracking.value) _focusPoint.value?.let { (x, y) -> focusAt(x, y) }
    }

    /** Experimental features (self-timer, long exposure) on or off. */
    fun setExperimental(on: Boolean) {
        change { it.copy(experimental = on) }
        if (!on) cancelSelfTimer()
    }

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
        controller.setExposureBias(exposureBias(s))
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

    private val _selfTimerLeft = MutableStateFlow<Int?>(null)

    /** Seconds left on the self-timer's countdown, or null when none runs. */
    val selfTimerLeft = _selfTimerLeft.asStateFlow()
    private var selfTimerJob: Job? = null

    /** A long exposure is being shot: the shutter ends it early instead of starting another shot. */
    private val _longExposing = MutableStateFlow(false)
    val longExposing = _longExposing.asStateFlow()

    /** Progress 0..1 of the running long exposure. */
    val longExposureProgress = controller.longExposureProgress

    private fun cancelSelfTimer() {
        selfTimerJob?.cancel()
        selfTimerJob = null
        _selfTimerLeft.value = null
    }

    /**
     * The shutter: with the self-timer (Experimental) set, it counts down first so the phone can settle on a tripod,
     * and a second press cancels the countdown; during a long exposure it ends the exposure early.
     */
    fun shutter() {
        if (_longExposing.value) {
            controller.stopLongExposure()
            return
        }
        if (selfTimerJob != null) {
            cancelSelfTimer()
            return
        }
        val seconds = _settings.value.activeSelfTimer
        if (seconds <= 0 || _videoMode.value) {
            shootNow()
            return
        }
        if (!resumed || _status.value != CameraStatus.READY || _merging.value) return
        selfTimerJob = viewModelScope.launch {
            try {
                for (left in seconds downTo 1) {
                    _selfTimerLeft.value = left
                    delay(1000)
                }
            } finally {
                _selfTimerLeft.value = null
            }
            selfTimerJob = null
            shootNow()
        }
    }

    /** Takes a raw now; it is developed into a JPEG in the background. */
    private fun shootNow() {
        if (!resumed || _status.value != CameraStatus.READY || _merging.value) return
        if (_videoMode.value) {
            toggleRecording()
            return
        }
        val settings = _settings.value
        val hiRes = info?.hiRes == true
        val flash = settings.flash.takeIf { info?.hasFlash == true } ?: FlashMode.OFF
        // The selfie camera: the screen's frame is the light, the shot itself is an ordinary one exposed by AE.
        val screenFlash = settings.flash != FlashMode.OFF && _screenFlashCamera.value
        // Flash and maximum-resolution shots are single frames (CameraController.captureDng).
        val longExposure = settings.longExposureSpec(sceneKey()).takeIf { !hiRes && !screenFlash && flash == FlashMode.OFF }
        val burstFrames = if (hiRes || screenFlash || longExposure != null) 1 else settings.burstFrames(lowLight.value)
        // A long exposure holds the shutter like a merging burst does (the stack and its DNG write).
        val burst = (burstFrames > 1 || longExposure != null) && flash == FlashMode.OFF
        // Debug note for the saved files' ImageDescription (CameraController.captureDng adds the frames actually merged).
        val mergeNote = "mode=${settings.burstMode.name.lowercase()} lowLight=${if (lowLight.value) 1 else 0}" +
            when {
                burstFrames > 1 -> ""
                settings.burstMode == BurstMode.OFF -> " reason=mode-off"
                hiRes -> " reason=max-res"
                screenFlash -> " reason=screen-flash"
                else -> " reason=not-low-light"
            }
        // A flash shot's raw is lit by the flash, the viewfinder wasn't: no calibration from it.
        // A long exposure's raw is lifted away from what the viewfinder predicted for a still: it must not calibrate the preview.
        val viewfinderKey = if (flash == FlashMode.OFF && !screenFlash && longExposure == null) live?.stats?.key else null
        val mayHaveFace = info?.hasFaceDetection != true || controller.frames.value?.faces?.isNotEmpty() != false
        controller.frames.value?.let { f ->
            Log.d(TAG, "shutter ${settings.lensKey(hiRes)}: preview ISO ${f.iso.toInt()}, ${f.exposureNs / 1000} µs, boost ${f.postRawBoost}, " +
                "tonemap ${f.tonemapMode}, viewfinder key $viewfinderKey, preview scale ${settings.previewScale(hiRes)}, " +
                "colour ${f.previewColor?.joinToString(" ") { "%.3f".format(it) } ?: "sRGB"}, " +
                "wb ${live?.defaults?.let { "${it.temperature.toInt()}K/${it.tint.toInt()}" }} -> " +
                "${live?.auto?.let { "${it.temperature.toInt()}K/${it.tint.toInt()}" }}")
        }
        val shotId = ShotSaver.beginCapture(app)
        activeCaptures++
        _capturing.value = activeCaptures
        if (burst) {
            _merging.value = true
            ShotSaver.beginMerge()
        }
        if (longExposure != null) _longExposing.value = true
        // Runs in ShotSaver.scope so finishing the lock screen camera never cancels an in-flight capture.
        ShotSaver.scope.launch {
            try {
                if (screenFlash) {
                    // Light the frame and let the screen and AE come up before the exposure.
                    _screenFlashLit.value = true
                    delay(SCREEN_FLASH_SETTLE_MS)
                }
                val shot = capture(shotId, settings, hiRes, viewfinderKey, flash, burstFrames, screenFlash, mergeNote, longExposure).copy(mayHaveFace = mayHaveFace)
                ShotSaver.enqueue(app, shot)
            } catch (e: Throwable) {
                Log.w(TAG, "capture", e)
                if (e !is CancellationException) {
                    _message.value = "Capture failed: ${e.message ?: e.javaClass.simpleName}"
                }
                ShotSaver.cancelCapture()
            } finally {
                _screenFlashLit.value = false
                _longExposing.value = false
                if (burst) {
                    _merging.value = false
                    ShotSaver.endMerge()
                }
                activeCaptures--
                captureEndedAt = SystemClock.uptimeMillis()
                if (activeCaptures == 0) {
                    if (!resumed) stopCamera() else if (restartAfterCapture) restartCamera()
                }
                _capturing.value = activeCaptures
            }
        }
    }

    /** As the request goes to the camera: the click (if on, or required here) and the UI's shutter feedback. */
    private fun onShutter(screenFlash: Boolean = false) {
        if (_settings.value.shutterSound || shutterSoundRequired) shutterSound.play()
        _shutterEvents.tryEmit(Unit)
        // The exposure runs right after the request goes out: keep the frame lit through it, then switch it off.
        if (screenFlash) viewModelScope.launch {
            delay(SCREEN_FLASH_HOLD_MS)
            _screenFlashLit.value = false
        }
    }

    /** Captures a raw and saves it as DNG (in Pictures/<Edition.FOLDER>/RAW, or a temporary file). */
    private suspend fun capture(shotId: Long, settings: CameraSettings, hiRes: Boolean, viewfinderKey: Float?, flash: FlashMode, burstFrames: Int, screenFlash: Boolean = false, mergeNote: String = "", longExposure: app.rawboy.camera.capture.LongExposure? = null): Shot {
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
                    val result = out.buffered(1 shl 20).use { controller.captureDng(orientation, it, flash, settings.flashGuide(hiRes), burstFrames, fix, longExposure, mergeNote) { onShutter(screenFlash) } }
                    fix?.let { addGps(uri, it) }
                    MediaStoreOutput.publish(resolver, uri)
                    result
                }
            } catch (t: Throwable) {
                withContext(Dispatchers.IO + NonCancellable) { resolver.delete(uri, null, null) }
                throw t
            }
            Log.d(TAG, "$name: capture + DNG write ${(System.nanoTime() - dngStart) / 1_000_000} ms")
            Shot(shotId, uri, name, null, settings, viewfinderKey, isoOf(result.result), flashGuide = result.flashGuide, flashDistanceKnown = result.distanceKnown, meter = meter, effectiveFrames = result.effectiveFrames, hiRes = hiRes, compensationEv = result.compensationEv, description = result.description)
        } else {
            val file = File(app.cacheDir, "$baseName-$shotId.dng")
            val result = try {
                withContext(Dispatchers.IO) {
                    val result = file.outputStream().buffered(1 shl 20).use { controller.captureDng(orientation, it, flash, settings.flashGuide(hiRes), burstFrames, fix, longExposure, mergeNote) { onShutter(screenFlash) } }
                    fix?.let { addGps(Uri.fromFile(file), it) }
                    result
                }
            } catch (t: Throwable) {
                file.delete()
                throw t
            }
            Shot(shotId, Uri.fromFile(file), "$baseName.dng", file, settings, viewfinderKey, isoOf(result.result), flashGuide = result.flashGuide, flashDistanceKnown = result.distanceKnown, meter = meter, effectiveFrames = result.effectiveFrames, hiRes = hiRes, compensationEv = result.compensationEv, description = result.description)
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
        trackExecutor.shutdown()
        ShotSaver.detachView()
    }

    companion object {
        private const val TAG = "RawBoyCamera"
        internal const val TILT_ALPHA = 0.3f
        internal const val TILT_DEADBAND = 0.4f
        private const val DNG_MIME = "image/x-adobe-dng"
        private const val SAVE_DELAY_MS = 500L

        /** Screen flash: how long the frame is lit before the shot (screen at full brightness, AE caught up), and after the request. */
        private const val SCREEN_FLASH_SETTLE_MS = 450L
        private const val SCREEN_FLASH_HOLD_MS = 250L
        /** After a lens's first analysed viewfinder frame, how long AE gets to settle before its raw is metered. */
        private const val RAW_METER_DELAY_MS = 300L
        /** Smallest move of a tracked subject (share of the frame) that moves the focus point. */
        private const val MIN_FOCUS_MOVE = 0.004f
        /** At most this often a tracked subject's move goes to the camera as a new AF region. */
        private const val FOCUS_MOVE_INTERVAL_MS = 100L
        /** Most the live develop's exposure moves per update (~3 a second), EV. */
        /** After a shot the viewfinder's frames are still the exposure's manual ones for a moment: don't meter the scene from them. */
        /** The most the viewfinder's gain moves per analysed frame (about every 300 ms): 0.25 EV, so a stop takes over a second. */
        private val SCALE_FADE_STEP = 2f.pow(0.25f)
        private const val SCENE_KEY_SETTLE_MS = 2000L
        private const val MAX_EV_STEP = 0.3f

        const val MIN_ZOOM = 1f

        /** Far-away viewing: 10x of the frame (digital, on top of the lens). */
        const val MAX_ZOOM = 10f

        /** Video: the most the viewfinder's exposure moves per update (~3 a second), so about 0.15 EV a second. */
        private const val VIDEO_EV_STEP = 0.05f

        /** Exposure is metered on the middle half of the frame's width and height (owner's choice), unless tapped. */
        internal val METER_CENTRE = MeterArea.Centre(0.5f)

        /** Camera grain is twice as fine as the film-scaled default (owner's preference). */
        internal const val GRAIN_SIZE_SCALE = 0.5f

        /** Long side of the live histogram's copy: enough pixels for 64 bins, cheap every update. */
        private const val HISTOGRAM_SIZE = 128

        /**
         * Half-size grain partly averages out when the photo is saved at 3000 px (area downscale ×1.36): measured
         * std 0.83 -> 0.62 (simulation of the shader's grain), so it's raised to look as strong as before.
         * At full size each pixel is a point sample: no loss. B&W mode has [MONO_GRAIN] times the grain, and
         * [FILM_MONO_GRAIN] times that with Film on too.
         */
        internal fun grainStrength(s: CameraSettings) = (if (s.smallExport) 1.34f else 1f) *
            (if (s.monoMode) MONO_GRAIN else 1f) * (if (s.filmMono) FILM_MONO_GRAIN else 1f)

        /** B&W mode's grain on top of the mono stock's (owner's choice, 2026-10-31: the looks' own read too clean). */
        internal const val MONO_GRAIN = 3f

        /** Film + B&W: [MONO_GRAIN] times this (owner's choice, 2026-10-31: grainier than plain B&W). */
        internal const val FILM_MONO_GRAIN = 1.5f

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

/**
 * Smooths device tilt readings ([degrees] clockwise from upright portrait, 0..359, or null when flat) into a
 * continuous angle in degrees (tenths of a degree, snapped within [deadband] of each 90° upright) without wrapping
 * modulo 90° or jumping across 360°.
 */
internal class TiltFilter(
    private val alpha: Float = CameraViewModel.TILT_ALPHA,
    private val deadband: Float = CameraViewModel.TILT_DEADBAND,
) {
    private var sinSum = Float.NaN
    private var cosSum = 0f
    private var last = 0f

    fun reset() {
        sinSum = Float.NaN
    }

    fun update(degrees: Int?): Float? {
        if (degrees == null) {
            reset()
            return null
        }
        // Low-pass the raw angle as a unit vector (so 359 -> 1 degrees doesn't average through 180): an exponential
        // filter, alpha 0.3 per ~60 ms sensor step (about a 0.2 s time constant): steady, still follows a turn.
        val r = Math.toRadians(degrees.toDouble())
        if (sinSum.isNaN()) {
            sinSum = sin(r).toFloat()
            cosSum = cos(r).toFloat()
        } else {
            sinSum += alpha * (sin(r).toFloat() - sinSum)
            cosSum += alpha * (cos(r).toFloat() - cosSum)
        }
        val smooth = Math.toDegrees(atan2(sinSum.toDouble(), cosSum.toDouble())).toFloat()
        val nearest = (smooth / 90f).roundToInt() * 90f
        // Deadband: a hair either side of straight reads as straight, so the line doesn't tremble at zero.
        val snapped = if (abs(smooth - nearest) < deadband) nearest else smooth
        var delta = (snapped - last) % 360f
        if (delta > 180f) delta -= 360f else if (delta <= -180f) delta += 360f
        // Tenths of a degree: the screen isn't redrawn for sensor noise below that.
        val next = ((last + delta) * 10f).roundToInt() / 10f
        last = next
        return next
    }
}
