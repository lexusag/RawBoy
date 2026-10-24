package app.rawboy.ui

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.rawboy.auto.AutoAnalysis
import app.rawboy.auto.analysis.AutoTone
import app.rawboy.color.WhitePicker
import app.rawboy.develop.CropMath
import app.rawboy.develop.CropRect
import app.rawboy.develop.BrushRaster
import app.rawboy.develop.BrushStroke
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.Histogram
import app.rawboy.develop.LeakKind
import app.rawboy.develop.LightLeak
import app.rawboy.develop.LightLeaks
import app.rawboy.develop.MaskLayer
import app.rawboy.develop.MaskShape
import app.rawboy.develop.Masks
import app.rawboy.develop.Preset
import app.rawboy.develop.PresetGroup
import app.rawboy.develop.Presets
import app.rawboy.develop.ToneMapper
import app.rawboy.develop.crop
import app.rawboy.develop.withCrop
import app.rawboy.export.ExportSettings
import app.rawboy.export.ExportSettingsStore
import app.rawboy.film.FilmData
import app.rawboy.film.FilmStocks
import app.rawboy.gl.FrameColor
import app.rawboy.gl.PreviewImage
import app.rawboy.gl.ShaderParams
import app.rawboy.gl.ThumbnailRenderer
import app.rawboy.lens.LensTransform
import app.rawboy.lut.LutLibrary
import app.rawboy.lut.LutRepository
import app.rawboy.session.PhotoSession
import app.rawboy.view.EditHistory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/** RawBoy Auto's package: "Send to Auto" opens it with a preset file. */
private const val AUTO_PACKAGE = "app.rawboy.auto"

data class EditorState(
    val loading: Boolean = false,
    val exporting: Boolean = false,
    /** The Auto button is working out the auto develop. */
    val autoRunning: Boolean = false,
    val exportProgress: Float = 0f,
    val fileName: String? = null,
    val info: String? = null,
    val params: DevelopParams = DevelopParams(),
    /** As-shot defaults for the current image (reset target, WB reference). */
    val defaults: DevelopParams = DevelopParams(),
    val message: String? = null,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
) {
    val hasImage get() = fileName != null && !loading
    val busy get() = loading || exporting || autoRunning
}

class EditorViewModel(application: Application) : AndroidViewModel(application) {
    private val _state = MutableStateFlow(EditorState())
    val state = _state.asStateFlow()

    /** The open photo; the pipeline state below comes from it. */
    private val session = PhotoSession(
        application, viewModelScope, onMessage = { m -> _state.update { it.copy(message = m) } }, filmLoader = ::loadFilm,
    )

    /** Film stocks once loaded (two 33^3 LUTs each, under 1 MB); one load at a time (LutLoader is synchronized). */
    private val films = HashMap<String, FilmData>()
    private val filmLock = Mutex()

    private suspend fun loadFilm(id: String): FilmData = filmLock.withLock {
        films[id] ?: withContext(Dispatchers.IO) {
            val app = getApplication<Application>()
            val stock = FilmStocks.byId(app, id) ?: throw IllegalArgumentException("Unknown film stock $id")
            FilmStocks.load(app, stock)
        }.also { films[id] = it }
    }

    val preview = session.preview
    val base = session.base
    val skin = session.skin
    val blemish = session.blemish
    val bloomSources = session.bloomSources
    val bokehSource = session.bokehSource
    val zoomCenter = session.zoomCenter
    val detail = session.detail
    val lensInfo = session.lensInfo
    val lutData = session.lutData
    val filmData = session.filmData

    /** The histogram's small develop of the whole photo (its own GL context and thread). */
    private val histogramRenderer = ThumbnailRenderer()

    private val _histogram = MutableStateFlow<Histogram?>(null)
    /** RGB histogram of the current edit (whole photo, crop applied), updated by [updateHistogram]. */
    val histogram = _histogram.asStateFlow()

    private val _clipWarning = MutableStateFlow(false)
    /** The preview marks clipped highlights and crushed shadows (tap on the histogram); kept across photos. */
    val clipWarning = _clipWarning.asStateFlow()

    fun toggleClipWarning() = _clipWarning.update { !it }

    /**
     * Develops [base] (the session's 512 px copy) with [params] at [HISTOGRAM_SIZE] px and counts it. Suspends, so the
     * caller's debounce can cancel a stale one; failures keep the previous histogram.
     */
    suspend fun updateHistogram(params: ShaderParams, base: PreviewImage) {
        try {
            val bitmap = histogramRenderer.render(params, base, HISTOGRAM_SIZE)
            val pixels = IntArray(bitmap.width * bitmap.height)
            bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
            bitmap.recycle()
            _histogram.value = withContext(Dispatchers.Default) { Histogram.fromArgb(pixels) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("RawBoy", "Histogram failed", e)
        }
    }

    private val _exportSettings = MutableStateFlow(ExportSettingsStore.load(application))
    val exportSettings = _exportSettings.asStateFlow()

    private val _presets = MutableStateFlow<List<Preset>>(emptyList())
    val presets = _presets.asStateFlow()

    private val _luts = MutableStateFlow(LutLibrary())
    val luts = _luts.asStateFlow()

    private var sourceUri: Uri? = null

    /** This photo's edits, for Undo and Redo. */
    private val history = EditHistory<DevelopParams>()

    fun open(uri: Uri) {
        if (_state.value.busy) return
        _state.update { it.copy(loading = true) }
        viewModelScope.launch {
            try {
                val opened = session.open(uri) { defaults -> carryOverEdits(_state.value, defaults) }
                sourceUri = uri
                history.clear()
                _state.update {
                    it.copy(
                        loading = false,
                        fileName = displayName(uri),
                        info = opened.description,
                        params = opened.params,
                        defaults = opened.defaults,
                        canUndo = false,
                        canRedo = false,
                    )
                }
                // The Film tone mapper, carried over from the previous photo.
                loadSelectedFilm(opened.params.film)
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, message = e.message ?: "Could not open file") }
            } catch (e: OutOfMemoryError) {
                _state.update { it.copy(loading = false, message = "Not enough memory to open this file") }
            }
        }
    }

    /** Frame around the photo in the fit view; tap outside the photo to cycle it. Remembered. */
    private val _frameColor = MutableStateFlow(loadFrameColor())
    val frameColor = _frameColor.asStateFlow()

    init {
        loadPresets()
    }
    private var frameWidth = 0

    private fun loadFrameColor(): FrameColor = runCatching {
        FrameColor.valueOf(getApplication<Application>().getSharedPreferences("display", 0).getString("frame", null)!!)
    }.getOrDefault(FrameColor.GREY)

    /** Single tap in the preview: outside the photo (fit view) cycles the frame colour. */
    fun onPreviewTap(x: Float, y: Float) {
        if (zoomCenter.value != null || !session.hasImage) return
        if (session.fitToImage(x, y, frameWidth) != null) return
        val next = _frameColor.value.next()
        _frameColor.value = next
        getApplication<Application>().getSharedPreferences("display", 0).edit().putString("frame", next.name).apply()
    }

    fun setViewSize(width: Int, height: Int, frame: Int) {
        frameWidth = frame
        session.setViewSize(width, height)
    }

    /** Double tap: zoom to 100% at the tapped point of the fit view, or back out. [extra]: margin around the frame. */
    fun toggleZoom(viewX: Float, viewY: Float, extra: Int = 0) = session.toggleZoom(viewX, viewY, frameWidth + extra)

    /**
     * White balance picker: sets temperature and tint so the tapped spot of the preview (fit or 100% view) renders
     * neutral grey. [extra]: margin around the frame, as for [toggleZoom].
     */
    fun pickWhite(viewX: Float, viewY: Float, extra: Int = 0) {
        val s = _state.value
        if (!s.hasImage || s.busy) return
        viewModelScope.launch {
            val pick = try {
                session.pickWhite(viewX, viewY, frameWidth + extra, s.defaults)
            } catch (e: IllegalStateException) {
                null // the photo was closed meanwhile
            } ?: return@launch
            if (_state.value.fileName != s.fileName) return@launch
            when (pick) {
                is WhitePicker.Pick.White -> commit(_state.value.params.copy(temperature = pick.kelvin, tint = pick.tint), force = true)
                WhitePicker.Pick.Clipped -> _state.update { it.copy(message = "That spot is blown out: pick a grey that isn't clipped") }
                WhitePicker.Pick.NotNeutral -> _state.update { it.copy(message = "No white balance makes that spot grey") }
            }
        }
    }

    /** Drag in the 100% view; [dx], [dy] are screen pixels = full-resolution pixels. */
    fun pan(dx: Float, dy: Float) = session.pan(dx, dy)

    fun exitZoom() = session.exitZoom()

    /**
     * Edits from the previous file carry over to the next one. White balance only
     * carries over if the user changed it; otherwise the new file's as-shot WB is used.
     */
    private fun carryOverEdits(previous: EditorState, newDefaults: DevelopParams): DevelopParams {
        if (previous.fileName == null) return newDefaults
        // Rotation, flips, straightening, crop, masks and light leaks belong to one photo.
        val p = previous.params
            .copy(
                rotation = newDefaults.rotation,
                flipHorizontal = newDefaults.flipHorizontal,
                flipVertical = newDefaults.flipVertical,
                straighten = newDefaults.straighten,
                masks = newDefaults.masks,
                leaks = newDefaults.leaks,
            )
            .withCrop(newDefaults.crop)
        val wbEdited = p.temperature != previous.defaults.temperature || p.tint != previous.defaults.tint
        return if (wbEdited) p else p.copy(temperature = newDefaults.temperature, tint = newDefaults.tint)
    }

    /** A slider or drag: quick changes in a row are one undo step. */
    fun update(params: DevelopParams) = commit(params, force = false)

    /** Applies [params] as an edit; [force] makes it its own undo step (a button, not a drag). */
    private fun commit(params: DevelopParams, force: Boolean) {
        history.record(_state.value.params, force)
        show(params)
    }

    /** Shows [params], loading a LUT or film stock that changed. */
    private fun show(params: DevelopParams) {
        val before = _state.value.params
        _state.update { it.copy(params = params, canUndo = history.canUndo, canRedo = history.canRedo) }
        session.setParams(params)
        if (params.lut != before.lut) loadSelectedLut(params.lut)
        if (params.film != before.film) loadSelectedFilm(params.film)
    }

    fun undo() {
        if (_state.value.busy) return
        history.undo(_state.value.params)?.let(::show)
    }

    fun redo() {
        if (_state.value.busy) return
        history.redo(_state.value.params)?.let(::show)
    }

    fun reset() = commit(_state.value.defaults.copy(lut = null, film = null), force = true)

    /** The stock last chosen for the Film tone mapper, so switching back to Film brings it back. */
    private var lastFilm = "portra400"

    /** Tone mapper chips: AgX, Filmic or Sigmoid turn the film off; its stock is kept for next time. */
    fun setToneMapper(toneMapper: ToneMapper) {
        val p = _state.value.params
        p.film?.let { lastFilm = it }
        commit(p.copy(toneMapper = toneMapper, film = null), force = true)
    }

    /** The Film tone mapper with stock [id] (null = off); turning it on starts at full strength. */
    fun selectFilm(id: String?) {
        val p = _state.value.params
        if (id != null) lastFilm = id
        commit(p.copy(film = id, filmAmount = if (id != null && p.film == null) 100f else p.filmAmount), force = true)
    }

    /** Film chip: the last stock (Portra 400 at first). */
    fun useFilm() = selectFilm(_state.value.params.film ?: lastFilm)

    private fun loadSelectedFilm(id: String?) {
        session.selectFilm(id) { error ->
            _state.update {
                it.copy(params = if (it.params.film == id) it.params.copy(film = null) else it.params, message = error)
            }
        }
    }

    /**
     * Auto: RawBoy Auto's develop (exposure, tone, WB, saturation, denoise, sharpening) on the current edit,
     * without a look; the LUT and everything else the user set stay. Faces steer exposure, as in Auto.
     */
    fun applyAuto() {
        val base = base.value ?: return
        if (!_state.value.hasImage || _state.value.busy) return
        _state.update { it.copy(autoRunning = true) }
        viewModelScope.launch {
            try {
                val skin = session.skinMask()
                val defaults = _state.value.defaults
                val auto = withContext(Dispatchers.Default) {
                    AutoAnalysis.autoBase(base, skin, session.iso, defaults, session.cameraMetered, session.measureNoise())
                }
                _state.update { it.copy(autoRunning = false) }
                commit(AutoTone.applyTo(_state.value.params, auto), force = true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _state.update { it.copy(autoRunning = false, message = "Auto failed: ${e.message ?: e.javaClass.simpleName}") }
            }
        }
    }

    // Light leaks (see LightLeaks.kt).

    /** Adds a light leak (up to LightLeaks.MAX_LEAKS) in the middle; returns its id, or null when full. */
    fun addLeak(kind: LeakKind = LeakKind.STREAK): String? {
        val p = _state.value.params
        if (p.leaks.size >= LightLeaks.MAX_LEAKS) return null
        val leak = LightLeaks.newLeak(kind)
        commit(p.copy(leaks = p.leaks + leak), force = true)
        return leak.id
    }

    /** A leak's slider or drag; [force] for a button (new shape, show/hide). */
    fun updateLeak(id: String, force: Boolean = false, change: (LightLeak) -> LightLeak) {
        val p = _state.value.params
        commit(p.copy(leaks = p.leaks.map { if (it.id == id) change(it) else it }), force)
    }

    fun removeLeak(id: String) {
        val p = _state.value.params
        commit(p.copy(leaks = p.leaks.filter { it.id != id }), force = true)
    }

    // Mask layers (see Masks.kt).

    /** Each layer's painted mask, for the preview's ShaderParams. */
    fun brushRaster(layer: MaskLayer): BrushRaster? = session.brushRaster(layer)

    /** Adds a layer (up to Masks.MAX_LAYERS); returns its id, or null when full. */
    fun addLayer(kind: MaskShape): String? {
        val p = _state.value.params
        if (p.masks.size >= Masks.MAX_LAYERS) return null
        val name = "${Masks.name(kind)} ${p.masks.count { it.shape::class == kind::class } + 1}"
        val layer = when (kind) {
            is MaskShape.Linear -> Masks.newLinear(name)
            is MaskShape.Radial -> Masks.newRadial(name)
            MaskShape.Brush -> Masks.newBrush(name)
        }
        commit(p.copy(masks = p.masks + layer), force = true)
        return layer.id
    }

    /** A layer's slider or handle drag. */
    fun updateLayer(id: String, change: (MaskLayer) -> MaskLayer) = changeLayer(id, force = false, change)

    /** [force]: its own undo step (a button or a new stroke). */
    private fun changeLayer(id: String, force: Boolean, change: (MaskLayer) -> MaskLayer) {
        val p = _state.value.params
        commit(p.copy(masks = p.masks.map { if (it.id == id) change(it) else it }), force)
    }

    fun removeLayer(id: String) {
        val p = _state.value.params
        commit(p.copy(masks = p.masks.filter { it.id != id }), force = true)
        session.dropBrush(id)
    }

    fun beginStroke(layerId: String, stroke: BrushStroke) = changeLayer(layerId, force = true) { it.copy(strokes = it.strokes + stroke) }

    /** Part of the step [beginStroke] started, however slow the stroke. */
    fun extendStroke(layerId: String, strokeId: String, points: List<Float>) {
        val p = _state.value.params
        show(
            p.copy(
                masks = p.masks.map { l ->
                    if (l.id != layerId) l
                    else l.copy(strokes = l.strokes.map { if (it.id == strokeId) it.copy(points = it.points + points) else it })
                },
            ),
        )
    }

    /** A stroke that turned into a pinch: gone, with no Redo. */
    fun cancelStroke(@Suppress("UNUSED_PARAMETER") layerId: String) {
        history.drop()?.let(::show)
    }

    fun undoStroke(layerId: String) = changeLayer(layerId, force = true) { it.copy(strokes = it.strokes.dropLast(1)) }

    fun clearBrush(layerId: String) = changeLayer(layerId, force = true) { it.copy(strokes = emptyList()) }

    /** Brush settings for new strokes, remembered. */
    private val _brush = MutableStateFlow(loadBrush())
    val brush = _brush.asStateFlow()

    fun setBrush(b: BrushSettings) {
        _brush.value = b
        getApplication<Application>().getSharedPreferences("display", 0).edit()
            .putFloat("brushRadius", b.radius).putFloat("brushHardness", b.hardness)
            .putFloat("brushFlow", b.flow).putBoolean("brushAuto", b.auto).apply()
    }

    private fun loadBrush(): BrushSettings {
        val prefs = getApplication<Application>().getSharedPreferences("display", 0)
        val d = BrushSettings()
        return BrushSettings(
            prefs.getFloat("brushRadius", d.radius).coerceIn(Masks.MIN_BRUSH_RADIUS, Masks.MAX_BRUSH_RADIUS),
            prefs.getFloat("brushHardness", d.hardness).coerceIn(0f, 100f),
            prefs.getFloat("brushFlow", d.flow).coerceIn(1f, 100f),
            prefs.getBoolean("brushAuto", d.auto),
        )
    }

    fun rotate(quarterTurns: Int) {
        val p = _state.value.params
        commit(
            p.copy(rotation = ((p.rotation + quarterTurns) % 4 + 4) % 4)
                .withCrop(CropMath.rotate(p.crop, quarterTurns)), // the crop turns with the picture
            force = true,
        )
    }

    /** Mirrors the picture as shown, left-right or top-bottom ([vertical]); the crop and straighten mirror with it. */
    fun flip(vertical: Boolean) = commit(CropMath.flip(_state.value.params, vertical), force = true)

    fun setCrop(crop: CropRect) = update(_state.value.params.withCrop(crop))

    /** Lens geometry for [params] on the current image; cached while the lens sliders are unchanged. */
    fun lensFor(params: DevelopParams): LensTransform = session.lensFor(params)

    /** Rescans bundled LUTs and the user's LUT folder. */
    fun refreshLuts() {
        viewModelScope.launch {
            _luts.value = withContext(Dispatchers.IO) { LutRepository.library(getApplication()) }
        }
    }

    fun setUserLutFolder(tree: Uri) {
        runCatching { LutRepository.setUserFolder(getApplication(), tree) }
            .onFailure { _state.update { s -> s.copy(message = "Could not access that folder") } }
        refreshLuts()
    }

    /** null = "No LUT". */
    fun selectLut(id: String?) = commit(_state.value.params.copy(lut = id), force = true)

    private fun loadSelectedLut(id: String?) {
        session.selectLut(id) { error ->
            _state.update {
                it.copy(params = if (it.params.lut == id) it.params.copy(lut = null) else it.params, message = error)
            }
        }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    private fun loadPresets() {
        viewModelScope.launch {
            _presets.value = withContext(Dispatchers.IO) { PresetStore.load(getApplication()) }
        }
    }

    private fun setPresets(list: List<Preset>) {
        _presets.value = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { PresetStore.save(getApplication(), list) }
                .onFailure { _state.update { s -> s.copy(message = "Could not save presets") } }
        }
    }

    /** Saves the current edits of [groups] as a new preset. */
    fun savePreset(name: String, groups: Set<PresetGroup>) {
        setPresets(_presets.value + Presets.capture(name, _state.value.params, groups, lensInfo.value.lensName))
    }

    /**
     * Saves the Lens tab's settings as the lens preset called [name] for this photo's lens (replacing the one saved for it
     * before; with no lens name, as manual lenses record, the one of that name), so RawBoy Auto can correct every photo
     * taken with that lens, or the photos given the preset by name ([sendPresetToAuto]); returns the preset.
     */
    fun saveLensPreset(name: String = ""): Preset {
        val lensPreset = Presets.captureLens(_state.value.params, lensInfo.value.lensName, name)
        val list = Presets.putLensPreset(_presets.value, lensPreset)
        setPresets(list)
        _state.update { it.copy(message = "Saved lens preset ${lensPreset.name}") }
        return list.first { it.isLensPreset && it.lens == lensPreset.lens && it.name == lensPreset.name }
    }

    /** Overwrites [id]'s values with the current edits (same groups). */
    fun updatePreset(id: String) {
        setPresets(
            _presets.value.map {
                if (it.id == id) Presets.capture(it.name, _state.value.params, it.groups, it.lens ?: lensInfo.value.lensName).copy(id = id) else it
            },
        )
    }

    fun renamePreset(id: String, name: String) =
        setPresets(_presets.value.map { if (it.id == id) it.copy(name = name.trim()) else it })

    fun deletePreset(id: String) = setPresets(_presets.value.filterNot { it.id == id })

    /** Applies [preset]'s groups to the current photo; a LUT goes through [selectLut] (load, error message). */
    fun applyPreset(preset: Preset) {
        commit(Presets.apply(preset, _state.value.params), force = true)
        _state.update { it.copy(message = "Applied ${preset.name}") }
    }

    fun importPresets(uri: Uri) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val text = getApplication<Application>().contentResolver.openInputStream(uri)!!
                        .use { it.readBytes().decodeToString() }
                    Presets.decode(text)
                }
            }
            result.onSuccess { added ->
                setPresets(_presets.value + added)
                _state.update { it.copy(message = if (added.size == 1) "Imported ${added[0].name}" else "Imported ${added.size} presets") }
            }.onFailure {
                _state.update { s -> s.copy(message = "Not a RawBoy preset file") }
            }
        }
    }

    /** Writes [presets] (one, or all) to [uri] as a preset file. */
    fun exportPresets(uri: Uri, presets: List<Preset>) {
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    getApplication<Application>().contentResolver.openOutputStream(uri, "wt")!!
                        .use { it.write(Presets.encode(presets).toByteArray()) }
                }.isSuccess
            }
            _state.update { it.copy(message = if (ok) "Presets exported" else "Could not export presets") }
        }
    }

    /**
     * Opens RawBoy Auto with [preset] as a preset file (shared through this app's FileProvider); Auto applies it to every
     * photo of its batch.
     */
    fun sendPresetToAuto(preset: Preset) {
        viewModelScope.launch {
            val app = getApplication<Application>()
            val uri = runCatching {
                withContext(Dispatchers.IO) {
                    val dir = File(app.cacheDir, "presets").apply { mkdirs() }
                    // A safe file name: Auto shows the preset's own name, not this one.
                    val file = File(dir, preset.name.replace(Regex("[^A-Za-z0-9 _-]"), "_").ifBlank { "Preset" } + ".rawboy.json")
                    file.writeText(Presets.encode(listOf(preset)))
                    FileProvider.getUriForFile(app, "${app.packageName}.presets", file)
                }
            }.getOrElse {
                _state.update { it.copy(message = "Could not send the preset") }
                return@launch
            }
            val intent = Intent(Intent.ACTION_SEND)
                .setType("application/json")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .setPackage(AUTO_PACKAGE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                app.startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                _state.update { it.copy(message = "RawBoy Auto isn't installed") }
            }
        }
    }

    fun export(settings: ExportSettings) {
        if (!session.hasImage) return
        val current = _state.value
        if (current.busy) return
        _exportSettings.value = settings
        ExportSettingsStore.save(getApplication(), settings)
        _state.update { it.copy(exporting = true, exportProgress = 0f) }

        viewModelScope.launch {
            try {
                val name = session.export(
                    current.params, current.defaults, sourceUri, current.fileName ?: "image", settings,
                ) { p -> _state.update { it.copy(exportProgress = p) } }
                _state.update { it.copy(exporting = false, message = "Saved Pictures/RawBoy/$name") }
            } catch (e: Exception) {
                _state.update { it.copy(exporting = false, message = "Export failed: ${e.message}") }
            } catch (e: OutOfMemoryError) {
                _state.update { it.copy(exporting = false, message = "Export failed: not enough memory") }
            }
        }
    }

    private fun displayName(uri: Uri): String {
        val resolver = getApplication<Application>().contentResolver
        val fromProvider = runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull()
        return fromProvider ?: uri.lastPathSegment?.substringAfterLast('/') ?: "image"
    }

    override fun onCleared() {
        session.close()
        histogramRenderer.close()
    }
}

/** Long side of the histogram's develop: plenty for 64 bins, a few ms per render. */
private const val HISTOGRAM_SIZE = 256

/** Brush settings for new strokes ([radius]: fraction of the image's long side). */
data class BrushSettings(val radius: Float = 0.03f, val hardness: Float = 50f, val flow: Float = 100f, val auto: Boolean = false)
