package app.rawboy.auto

import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.rawboy.auto.looks.Adjustments
import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.Look
import app.rawboy.auto.looks.LookApplier
import app.rawboy.auto.looks.LookSuggester
import app.rawboy.auto.looks.Looks
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.Edits
import app.rawboy.develop.MaskLayer
import app.rawboy.develop.BrushRaster
import app.rawboy.develop.Preset
import app.rawboy.develop.Presets
import app.rawboy.export.ExportFormat
import app.rawboy.export.ExportSettings
import app.rawboy.export.Exporter
import app.rawboy.export.OutputNaming
import app.rawboy.film.FilmData
import app.rawboy.film.FilmStocks
import app.rawboy.gl.FrameColor
import app.rawboy.gl.PreviewImage
import app.rawboy.gl.ShaderParams
import app.rawboy.gl.ThumbnailRenderer
import app.rawboy.lens.LensTransform
import app.rawboy.lut.LutData
import app.rawboy.lut.LutLoader
import app.rawboy.raw.RawImage
import app.rawboy.session.PhotoSession
import app.rawboy.view.EditHistory
import app.rawboy.session.blemishesToHeal
import app.rawboy.session.brushLookup
import app.rawboy.session.editTexturesOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import java.io.File

/** Where a photo is in the batch. */
enum class PhotoStatus { QUEUED, ANALYZING, READY, FAILED, EXPORTING, EXPORTED }

/** Which strip the Look tab shows: the LUT looks ([Looks]) or film stocks rendered as negative + print ([FilmLooks]). */
enum class LookMode { LOOKS, FILM }

/**
 * One photo of the batch. Only small whole-image copies are kept (about 3 MB);
 * the full-resolution raw is decoded again for the detail view and for export.
 */
data class AutoPhoto(
    val uri: Uri,
    val name: String,
    /** When it was shot, else the file's date, as an EXIF date ([CaptureDate]); null if unknown. Orders the batch. */
    val date: String? = null,
    val status: PhotoStatus = PhotoStatus.QUEUED,
    val error: String? = null,
    val analysis: Analysis? = null,
    val look: Look = Looks.NATURAL,
    val suggested: Look = Looks.NATURAL,
    /** The look applied: [look] in Looks mode, [filmLook] in Film mode; each mode keeps its own pick. */
    val mode: LookMode = LookMode.LOOKS,
    val filmLook: Look = FilmLooks.PORTRA_400,
    val suggestedFilm: Look = FilmLooks.PORTRA_400,
    val strength: Float = LookApplier.DEFAULT_STRENGTH,
    val adjust: Adjustments = Adjustments.NONE,
    /** A RawBoy preset developing the photo in place of its look (see [LookApplier.applyPreset]), or null. */
    val preset: Preset? = null,
    /**
     * The develop RawBoy sent with the photo ("Send to Auto", [Edits]) in place of its look or preset, with the
     * adjustments on top (see [LookApplier.applyEdits]); null = none. The look and preset stay for when it's removed.
     */
    val edits: DevelopParams? = null,
    /** RawBoy edits ([Edits] JSON) received before the analysis: decoded against its as-shot defaults once it's in. */
    val pendingEdits: String? = null,
    /** Which lens preset the photo gets (see [Presets.chosenLensPreset]): null = by its lens, else a pick. */
    val lensChoice: String? = null,
    /** The lens preset [lensChoice] gives, on top of the look or preset; null = none. */
    val lensPreset: Preset? = null,
    /** True once "Apply to all" gave the photo its looks: its analysis then keeps them instead of the suggestions. */
    val looksApplied: Boolean = false,
    val thumbnail: Bitmap? = null,
) {
    val id: String get() = uri.toString()

    val activeLook: Look get() = if (mode == LookMode.FILM) filmLook else look

    /** What develops the photo, for labels: RawBoy edits, the preset's name, else the active look's. */
    val lookName: String get() = if (edits != null) EDITS_NAME else preset?.name ?: activeLook.name

    /** The develop settings for the current RawBoy edits, look (or preset) and controls (null until analysed). */
    val params: DevelopParams?
        get() = analysis?.let { a ->
            edits?.let { LookApplier.applyEdits(it, adjust) }
                ?: LookApplier.develop(a.autoBase, activeLook, strength, adjust, a.stats.hasFace, preset, lensPreset)
        }

    companion object {
        /** Label of RawBoy edits ([edits]) in place of a look. */
        const val EDITS_NAME = "RawBoy edits"
    }
}

/** The photo with the auto develop's denoise, colour denoise and sharpening in its RawBoy edits (itself without either). */
private fun AutoPhoto.withAutoNoise(): AutoPhoto {
    val e = edits ?: return this
    val auto = analysis?.autoBase ?: return this
    val noise = e.copy(denoise = auto.denoise, colorDenoise = auto.colorDenoise, sharpening = auto.sharpening)
    return if (noise == e) this else copy(edits = noise)
}

/** A photo's edits, as Undo and Redo bring them back. */
private data class Develop(
    val look: Look,
    val mode: LookMode,
    val filmLook: Look,
    val strength: Float,
    val adjust: Adjustments,
    val preset: Preset?,
    val edits: DevelopParams?,
    val looksApplied: Boolean,
)

private val AutoPhoto.develop get() = Develop(look, mode, filmLook, strength, adjust, preset, edits, looksApplied)

private fun AutoPhoto.withDevelop(d: Develop) = copy(
    look = d.look, mode = d.mode, filmLook = d.filmLook, strength = d.strength, adjust = d.adjust, preset = d.preset,
    edits = d.edits, looksApplied = d.looksApplied,
)

/**
 * The look (or preset), strength, warmth, tint, contrast, saturation and grain of [source] ("Apply to all", "Copy previous"); brightness,
 * denoise and rotation stay (they follow this photo's exposure, noise and framing). RawBoy edits aren't copied (they
 * hold the source's crop, masks and light leaks); this photo's own are replaced by the look.
 */
private fun AutoPhoto.withLookOf(source: AutoPhoto): AutoPhoto {
    val s = source.adjust
    return copy(
        look = source.look,
        mode = source.mode,
        filmLook = source.filmLook,
        strength = source.strength,
        preset = source.preset,
        edits = null,
        looksApplied = true,
        adjust = adjust.copy(warmth = s.warmth, tint = s.tint, contrast = s.contrast, saturation = s.saturation, grain = s.grain),
    )
}

/** Whether the photo view's Undo and Redo have something to do. */
data class UndoState(val canUndo: Boolean = false, val canRedo: Boolean = false)

/** Progress of "Export all". */
/** Progress of "Export all"; [stopping]: Stop was pressed, the photo being exported finishes and the rest are left. */
data class BatchExport(
    val done: Int,
    val total: Int,
    val failed: Int,
    val current: Float = 0f,
    val stopping: Boolean = false,
    /**
     * "Export all": the photos not yet done, the one being exported included. The grid shows them desaturated, so the
     * batch can be followed as each turns to colour once saved.
     */
    val waiting: Set<String> = emptySet(),
)

class AutoViewModel(application: Application) : AndroidViewModel(application) {
    private val _photos = MutableStateFlow<List<AutoPhoto>>(emptyList())
    val photos = _photos.asStateFlow()

    private val _export = MutableStateFlow<BatchExport?>(null)
    val export = _export.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    /** The mode photos are added in (Looks or Film), chosen in the grid before importing; remembered. */
    private val prefs = application.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val _importMode = MutableStateFlow(
        runCatching { LookMode.valueOf(prefs.getString(KEY_IMPORT_MODE, null)!!) }.getOrDefault(LookMode.LOOKS),
    )
    val importMode = _importMode.asStateFlow()

    /** Format, JPEG quality, TIFF bit depth and size of exports, chosen in the grid; remembered. */
    private val _exportSettings = MutableStateFlow(
        SETTINGS.copy(
            format = runCatching { ExportFormat.valueOf(prefs.getString(KEY_EXPORT_FORMAT, null)!!) }.getOrDefault(SETTINGS.format),
            jpegQuality = prefs.getInt(KEY_EXPORT_QUALITY, SETTINGS.jpegQuality).coerceIn(1, 100),
            tiffBits = if (prefs.getInt(KEY_EXPORT_BITS, SETTINGS.tiffBits) == 8) 8 else 16,
            maxLongSide = prefs.getInt(KEY_EXPORT_SIZE, 0).takeIf { it in EXPORT_SIZES },
        ),
    )
    val exportSettings = _exportSettings.asStateFlow()

    /** Frame around the photo in the detail view's fit view (as RawBoy's); tap outside the photo to cycle it. Remembered. */
    private val _frameColor = MutableStateFlow(
        runCatching { FrameColor.valueOf(prefs.getString(KEY_FRAME, null)!!) }.getOrDefault(FrameColor.GREY),
    )
    val frameColor = _frameColor.asStateFlow()

    /** The RawBoy preset applied to the whole batch, which photos added later get too; null = looks. */
    private val _preset = MutableStateFlow<Preset?>(null)
    val preset = _preset.asStateFlow()

    /**
     * Lens presets ([Preset.isLensPreset]) from RawBoy: each photo taken with a preset's lens gets its lens corrections
     * on top of its look or preset. Kept for later batches ([LensPresetStore]).
     */
    private val _lensPresets = MutableStateFlow(LensPresetStore.load(application))
    val lensPresets = _lensPresets.asStateFlow()

    /** The lens preset choice for the whole batch, which photos added later get too (null = by lens). */
    private val _lensChoice = MutableStateFlow<String?>(null)
    val lensChoice = _lensChoice.asStateFlow()

    /** Presets of an opened file that held several, to pick one from; empty when no choice is pending. */
    private val _presetChoices = MutableStateFlow<List<Preset>>(emptyList())
    val presetChoices = _presetChoices.asStateFlow()
    /** The photos [presetChoices] are for: null = the whole batch. */
    private var presetTarget: Set<String>? = null

    /** Photo shown in the detail view, or null for the grid. */
    private val _selected = MutableStateFlow<String?>(null)
    val selected = _selected.asStateFlow()

    /** A waiting photo tapped in the grid: analysed next, ahead of the rest, then opened (null: none). */
    private val _opening = MutableStateFlow<String?>(null)
    val opening = _opening.asStateFlow()

    /** The detail view's photo, decoded at full resolution (preview, 100% view, single export). */
    val session = PhotoSession(
        application, viewModelScope, onMessage = { _message.value = it }, lutLoader = ::loadLut, filmLoader = ::loadFilm,
    )
    private val _sessionReady = MutableStateFlow<String?>(null)
    /** Id of the photo [session] holds, once it has loaded. */
    val sessionReady = _sessionReady.asStateFlow()

    /** Each analysed photo's detail preview, so a photo shows at once while [session] decodes it. */
    private val previews = PreviewCache(File(application.cacheDir, "auto-previews"))
    private val _cachedPreview = MutableStateFlow<Pair<String, PreviewImage>?>(null)
    /** The selected photo's cached preview (photo id to image) while [session] is still decoding it; else null. */
    val cachedPreview = _cachedPreview.asStateFlow()

    /** Single tap in the detail preview: outside the photo (fit view, [frameWidth] in pixels) cycles the frame colour. */
    fun onPreviewTap(x: Float, y: Float, frameWidth: Int) {
        if (session.zoomCenter.value != null || !session.hasImage) return
        if (session.fitToImage(x, y, frameWidth) != null) return
        val next = _frameColor.value.next()
        _frameColor.value = next
        prefs.edit().putString(KEY_FRAME, next.name).apply()
    }

    private val thumbnails = ThumbnailRenderer()
    /**
     * Look-strip thumbnails: the latest one per photo and look, with the adjustments it was
     * rendered at (slider drags would otherwise pile up one bitmap per value).
     */
    private class LookThumb(val adjust: Adjustments, val lensPreset: Preset?, val bitmap: Bitmap)
    private val lookThumbs = HashMap<Pair<String, String>, LookThumb>()

    /** Every bundled look's LUT stays loaded once used: about 3 MB each in native memory. */
    private val luts = HashMap<String, LutData>()
    /** Film stocks likewise (two 33^3 LUTs each, under 1 MB); LutLoader is synchronized, so they share the lock. */
    private val films = HashMap<String, FilmData>()
    private val lutLock = Mutex()

    /**
     * Full-resolution decodes (analysis, detail view, export) take hundreds of MB each; one at a
     * time keeps a batch from stacking them up.
     */
    private val decodeLock = Mutex()

    private var analysisJob: Job? = null
    private var exportJob: Job? = null
    private val thumbJobs = HashMap<String, Job>()

    /** Each photo's edits, for Undo and Redo in the photo view. */
    private val histories = HashMap<String, EditHistory<Develop>>()
    private val _undo = MutableStateFlow<Map<String, UndoState>>(emptyMap())
    val undoStates = _undo.asStateFlow()

    /** How the batch is ordered: by shoot date (the default) or file name; remembered. */
    private val _sort = MutableStateFlow(
        runCatching { PhotoSort.valueOf(prefs.getString(KEY_SORT, null)!!) }.getOrDefault(PhotoSort.DATE),
    )
    val sort = _sort.asStateFlow()

    private fun sorted(photos: List<AutoPhoto>) =
        photos.sortedWith(PhotoOrder.comparator(_sort.value, AutoPhoto::date, AutoPhoto::name))

    /** Orders the batch by [sort] from now on. */
    fun setSort(sort: PhotoSort) {
        _sort.value = sort
        prefs.edit().putString(KEY_SORT, sort.name).apply()
        _photos.update { sorted(it) }
    }

    /**
     * Adds photos from the picker or an intent; already listed ones are skipped. They join the batch once their dates are
     * read (a few small reads each), so it never reorders under the user's finger.
     */
    fun add(uris: List<Uri>, edits: Map<Uri, String> = emptyMap()) {
        val known = _photos.value.map { it.id }.toSet()
        val wanted = uris.distinct().filter { it.toString() !in known }
        if (wanted.isEmpty()) return
        val mode = _importMode.value
        val preset = _preset.value
        val lensChoice = _lensChoice.value
        viewModelScope.launch {
            val app = getApplication<Application>()
            val read = withContext(Dispatchers.IO) {
                wanted.map { uri ->
                    // Picker grants survive process restarts only when persisted; shares can't be (and needn't be).
                    runCatching { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                    AutoPhoto(
                        uri = uri, name = displayName(uri), date = CaptureDate.read(app, uri), mode = mode, preset = preset,
                        lensChoice = lensChoice, pendingEdits = edits[uri],
                    )
                }
            }
            val now = _photos.value.map { it.id }.toSet()
            val fresh = read.filter { it.id !in now }
            if (fresh.isEmpty()) return@launch
            _photos.update { sorted(it + fresh) }
            nonRawNote(fresh.map { it.name })?.let { _message.value = it }
            fresh.singleOrNull { it.pendingEdits != null }?.let { _message.value = "${it.name} added with its RawBoy edits" }
            processQueue()
        }
    }

    /**
     * RawBoy's "Send to Auto" for one photo: develops [uri]'s photo with the edits in [editsUri] ([Edits] JSON) in place
     * of its look or preset, Auto's controls back at zero (the edits already hold what they did), as one undo step, and
     * opens it. A photo not in the batch joins it and gets them once analysed. Not while exporting.
     */
    fun receiveEdits(uri: Uri, editsUri: Uri) {
        if (_export.value != null) {
            _message.value = "Auto is exporting; send the photo again when it has finished"
            return
        }
        viewModelScope.launch {
            val text = runCatching {
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(editsUri)!!.use { it.readBytes().decodeToString() }
                }
            }.getOrNull()
            if (text == null || Edits.decode(text, DevelopParams()) == null) {
                _message.value = "Could not read the RawBoy edits"
                return@launch
            }
            val p = photo(uri.toString())
            if (p == null) return@launch add(listOf(uri), mapOf(uri to text))
            val a = p.analysis
            if (a == null) {
                updatePhoto(p.id) { it.copy(pendingEdits = text) }
                _message.value = "${p.name} gets its RawBoy edits once analysed"
                return@launch
            }
            changeDevelop(p.id, force = true) { it.copy(edits = Edits.decode(text, a.defaults), adjust = Adjustments.NONE) }
            if (_selected.value != p.id) openDetail(p.id)
            _message.value = "${p.name} developed with its RawBoy edits"
        }
    }

    /** Takes the RawBoy edits off one photo, back to its preset or look. */
    fun removeEdits(id: String) = changeDevelop(id, force = true) { it.copy(edits = null) }

    /** Mode for photos added from now on; photos already in the batch keep theirs. */
    fun setImportMode(mode: LookMode) {
        _importMode.value = mode
        prefs.edit().putString(KEY_IMPORT_MODE, mode.name).apply()
    }

    /**
     * Reads a RawBoy preset file (.rawboy.json, as RawBoy exports or sends it, also from RawBoy Web) and applies it
     * to the batch, or to the photos in [ids] (the grid's selection) when given; a file with several presets asks
     * which one ([presetChoices]).
     */
    fun openPresetFile(uri: Uri, ids: Set<String>? = null) {
        viewModelScope.launch {
            val presets = runCatching {
                withContext(Dispatchers.IO) {
                    val text = getApplication<Application>().contentResolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() }
                    Presets.decode(text)
                }
            }.getOrNull()
            when {
                presets.isNullOrEmpty() -> _message.value = "Not a RawBoy preset file"
                presets.all { it.isLensPreset } -> addLensPresets(presets)
                presets.size == 1 -> applyPreset(presets[0], ids)
                else -> {
                    presetTarget = ids
                    _presetChoices.value = presets
                }
            }
        }
    }

    /** Applies one of [presetChoices] (null = cancel). */
    fun choosePreset(preset: Preset?) {
        _presetChoices.value = emptyList()
        preset?.let { applyPreset(it, presetTarget) }
        presetTarget = null
    }

    private fun applyPreset(preset: Preset, ids: Set<String>?) = when {
        preset.isLensPreset -> addLensPresets(listOf(preset))
        ids == null -> applyPresetToAll(preset)
        else -> applyPresetTo(preset, ids)
    }

    /**
     * Keeps [presets] (lens presets) in place of those for the same lenses; photos taken with those lenses get their lens
     * corrections on top of their look or preset, now and in later batches.
     */
    private fun addLensPresets(presets: List<Preset>) {
        setLensPresets(presets.fold(_lensPresets.value, Presets::putLensPreset))
        val name = if (presets.size == 1) "Lens preset ${presets[0].name}" else "${presets.size} lens presets"
        if (presets.all { it.lens.isNullOrBlank() }) {
            _message.value = "$name saved: pick ${if (presets.size == 1) "it" else "them"} under Lens presets"
            return
        }
        val lenses = presets.mapNotNull { it.lens?.trim()?.lowercase() }.toSet()
        val matched = _photos.value.count { p -> p.lensPreset?.let { it.lens?.trim()?.lowercase() in lenses } == true }
        val photos = if (matched == 1) "1 photo" else "$matched photos"
        _message.value = "$name saved for photos taken with ${if (presets.size == 1) "that lens" else "those lenses"} ($photos here)"
    }

    /** Forgets lens preset [id]; photos that picked it go back to matching by lens. */
    fun removeLensPreset(id: String) {
        if (_lensChoice.value == id) _lensChoice.value = null
        _photos.value.filter { it.lensChoice == id }.forEach { p -> updatePhoto(p.id) { it.copy(lensChoice = null) } }
        setLensPresets(_lensPresets.value.filterNot { it.id == id })
    }

    /**
     * Gives the photos in [ids], or the whole batch and photos added later when null, the lens preset [choice] (see
     * [Presets.chosenLensPreset]): manual lenses record no lens name, so their presets are picked by hand.
     */
    fun chooseLensPreset(choice: String?, ids: Set<String>? = null) {
        if (_export.value != null) return
        if (ids == null) _lensChoice.value = choice
        val photos = _photos.value.filter { ids == null || it.id in ids }
        photos.forEach { p ->
            val preset = p.analysis?.let { Presets.chosenLensPreset(_lensPresets.value, choice, it.lens.lensName) }
            changeDevelop(p.id, force = null) { it.copy(lensChoice = choice, lensPreset = preset) }
        }
        val what = when (choice) {
            null -> "Lens presets by lens"
            Presets.NO_LENS_PRESET -> "No lens preset"
            else -> _lensPresets.value.firstOrNull { it.id == choice }?.name ?: return
        }
        _message.value = "$what for ${if (ids == null) "all photos" else if (photos.size == 1) "1 photo" else "${photos.size} photos"}"
    }

    private fun setLensPresets(list: List<Preset>) {
        _lensPresets.value = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { LensPresetStore.save(getApplication(), list) }.onFailure { _message.value = "Could not save lens presets" }
        }
        _photos.value.forEach { p ->
            val lens = p.analysis?.lens?.lensName ?: return@forEach
            val next = Presets.chosenLensPreset(list, p.lensChoice, lens)
            if (next != p.lensPreset) changeDevelop(p.id, force = null) { it.copy(lensPreset = next) }
        }
    }

    /**
     * Develops every photo, and those added later, with [preset] in place of its look: all the preset holds, lens
     * corrections included, on top of each photo's auto develop. Each photo keeps its look for when the preset is removed.
     */
    fun applyPresetToAll(preset: Preset) {
        if (_export.value != null) return
        _preset.value = preset
        // A preset develops in place of RawBoy edits too, as in place of a look.
        _photos.value.forEach { p -> changeDevelop(p.id, force = true) { it.copy(preset = preset, edits = null) } }
        _message.value = "${preset.name} applied to all photos"
    }

    /**
     * Develops only the photos in [ids] (the grid's selection, e.g. one scene) with [preset], so one batch can hold a
     * preset per scene. The batch preset, which photos added later get, stays as it is.
     */
    fun applyPresetTo(preset: Preset, ids: Set<String>) {
        if (_export.value != null) return
        val photos = _photos.value.filter { it.id in ids }
        photos.forEach { p -> changeDevelop(p.id, force = true) { it.copy(preset = preset, edits = null) } }
        _message.value = "${preset.name} applied to ${if (photos.size == 1) "1 photo" else "${photos.size} photos"}"
    }

    /**
     * Takes the batch preset off the photos it develops (and photos added later): each goes back to its look. Photos
     * given another preset on a selection keep theirs.
     */
    fun removePreset() {
        val batch = _preset.value
        if (_export.value != null || batch == null) return
        _preset.value = null
        _photos.value.filter { it.preset == batch }.forEach { p -> changeDevelop(p.id, force = true) { it.copy(preset = null) } }
    }

    /** Takes the preset off one photo, back to its look; the batch preset stays for photos added later. */
    fun removePhotoPreset(id: String) = changeDevelop(id, force = true) { it.copy(preset = null) }

    /** Format, quality, bit depth and size for the next exports (maxLongSide null = full resolution). */
    fun setExportSettings(settings: ExportSettings) {
        _exportSettings.value = settings
        prefs.edit()
            .putString(KEY_EXPORT_FORMAT, settings.format.name)
            .putInt(KEY_EXPORT_QUALITY, settings.jpegQuality)
            .putInt(KEY_EXPORT_BITS, settings.tiffBits)
            .putInt(KEY_EXPORT_SIZE, settings.maxLongSide ?: 0)
            .apply()
    }

    /**
     * Takes photos out of the batch (not while exporting). Nothing is deleted from storage. A photo
     * that is being analysed finishes in the background and is then dropped.
     */
    fun remove(ids: Set<String>) {
        if (ids.isEmpty() || _export.value != null) return
        if (_selected.value in ids) closeDetail()
        if (_sessionReady.value in ids) {
            session.close() // frees the full-resolution image
            _sessionReady.value = null
        }
        val resolver = getApplication<Application>().contentResolver
        _photos.value.filter { it.id in ids }.forEach { p ->
            runCatching { resolver.releasePersistableUriPermission(p.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        }
        _photos.update { list -> list.filterNot { it.id in ids } }
        if (_opening.value in ids) _opening.value = null
        ids.forEach { id -> thumbJobs.remove(id)?.cancel() }
        ids.forEach(previews::remove)
        if (_cachedPreview.value?.first in ids) _cachedPreview.value = null
        lookThumbs.keys.removeAll { it.first in ids }
        histories.keys.removeAll(ids)
        smallBrushes.keys.removeAll(ids)
        _undo.update { it - ids }
    }

    /**
     * Takes the detail view's photo [id] out of the batch (nothing is deleted from storage) and opens the next analysed
     * photo, or the one before it at the batch's end; back to the grid when it was the last one.
     */
    fun removeOpened(id: String) {
        val p = photo(id) ?: return
        if (_export.value != null) return
        val pages = _photos.value.filter { it.analysis != null }
        val index = pages.indexOfFirst { it.id == id }
        val next = if (index < 0) null else pages.getOrNull(index + 1) ?: pages.getOrNull(index - 1)
        remove(setOf(id))
        next?.let { openDetail(it.id) }
        _message.value = "${p.name} removed from the batch"
    }

    /** Analyses queued photos one at a time (each decode needs the full raw in memory). */
    private fun processQueue() {
        if (analysisJob?.isActive == true) return
        analysisJob = viewModelScope.launch {
            while (true) {
                val next = nextQueued() ?: break
                updatePhoto(next.id) { it.copy(status = PhotoStatus.ANALYZING) }
                try {
                    val analysis = decodeLock.withLock {
                        withContext(Dispatchers.Default) { AutoAnalysis.analyze(getApplication(), next.uri) { previews.put(next.id, it) } }
                    }
                    if (photo(next.id) == null) previews.remove(next.id) // removed while it was analysed
                    val look = LookSuggester.suggest(analysis.stats, analysis.defaults.temperature)
                    val film = LookSuggester.suggestFilm(analysis.stats, analysis.defaults.temperature)
                    updatePhoto(next.id) {
                        it.copy(
                            status = PhotoStatus.READY, analysis = analysis, suggested = look, suggestedFilm = film,
                            lensPreset = Presets.chosenLensPreset(_lensPresets.value, it.lensChoice, analysis.lens.lensName),
                            look = if (it.looksApplied) it.look else look,
                            filmLook = if (it.looksApplied) it.filmLook else film,
                            // RawBoy edits sent with the photo: absolute values against this file's as-shot defaults.
                            edits = it.pendingEdits?.let { e -> Edits.decode(e, analysis.defaults) } ?: it.edits,
                            adjust = if (it.pendingEdits != null) Adjustments.NONE else it.adjust,
                            pendingEdits = null,
                        )
                    }
                    refreshThumbnail(next.id, immediate = true)
                    openIfWaiting(next.id)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    // OutOfMemoryError and native failures too: mark this photo and go on with the rest.
                    val reason = if (e is OutOfMemoryError) "Not enough memory" else e.message ?: e.javaClass.simpleName
                    updatePhoto(next.id) { it.copy(status = PhotoStatus.FAILED, error = reason) }
                    if (_opening.value == next.id) _opening.value = null
                }
            }
        }
    }

    /** The photo to analyse next: the one tapped to open ([opening]) if it's still waiting, else the first waiting. */
    private fun nextQueued(): AutoPhoto? =
        _opening.value?.let(::photo)?.takeIf { it.status == PhotoStatus.QUEUED }
            ?: _photos.value.firstOrNull { it.status == PhotoStatus.QUEUED }

    /** Opens photo [id] now that it's analysed, if it was tapped while waiting and the grid is still showing. */
    private suspend fun openIfWaiting(id: String) {
        if (_opening.value != id) return
        _opening.value = null
        if (_selected.value != null) return
        openDetail(id)
        yield() // its decode takes the lock before the next analysis
    }

    private fun updatePhoto(id: String, change: (AutoPhoto) -> AutoPhoto) =
        _photos.update { list -> list.map { if (it.id == id) change(it) else it } }

    private fun photo(id: String): AutoPhoto? = _photos.value.firstOrNull { it.id == id }

    // ---- Look and controls ----

    /** Sets the look of the photo's current mode (a film look in Film mode, a LUT look otherwise). */
    fun setLook(id: String, look: Look) =
        changeDevelop(id, force = true) { if (it.mode == LookMode.FILM) it.copy(filmLook = look) else it.copy(look = look) }

    fun setMode(id: String, mode: LookMode) = changeDevelop(id, force = true) { it.copy(mode = mode) }

    fun setStrength(id: String, strength: Float) = changeDevelop(id) { it.copy(strength = strength) }

    /** Sliders (a drag is one undo step). */
    fun setAdjust(id: String, change: (Adjustments) -> Adjustments) = changeDevelop(id) { it.copy(adjust = change(it.adjust)) }

    /** Takes photo [id]'s last edit back (not while exporting). */
    fun undo(id: String) = restore(id) { h, d -> h.undo(d) }

    fun redo(id: String) = restore(id) { h, d -> h.redo(d) }

    private fun restore(id: String, step: (EditHistory<Develop>, Develop) -> Develop?) {
        val p = photo(id) ?: return
        val h = histories[id] ?: return
        if (_export.value != null) return
        val d = step(h, p.develop) ?: return
        changeDevelop(id, force = null) { it.withDevelop(d) }
    }

    /** Turns the analysed photos among [ids] by [quarterTurns] clockwise quarter turns (negative = left); not while exporting. */
    fun rotate(ids: Set<String>, quarterTurns: Int) {
        if (_export.value != null) return
        _photos.value.filter { it.id in ids && it.analysis != null }.forEach { p ->
            changeDevelop(p.id, force = true) { q -> q.copy(adjust = q.adjust.copy(rotation = Math.floorMod(q.adjust.rotation + quarterTurns, 4))) }
        }
    }

    /**
     * Gives every photo of the batch the look (or preset), strength, warmth, tint, contrast, saturation and grain of [id], including
     * photos still being analysed (they keep it rather than their suggestion); brightness and denoise stay per photo (they follow
     * each photo's exposure and noise). Not while exporting.
     */
    fun applyLookToAll(id: String) {
        if (_export.value != null) return
        val source = photo(id) ?: return
        _photos.value.filter { it.id != id }.forEach { p -> changeDevelop(p.id, force = true) { it.withLookOf(source) } }
        _message.value = "${source.lookName} applied to all photos"
    }

    /** The analysed photo before [id] in the batch (the one Swipe and Backspace go back to), for "Copy previous". */
    fun previousPhoto(id: String): AutoPhoto? {
        val pages = _photos.value.filter { it.analysis != null }
        val index = pages.indexOfFirst { it.id == id }
        return if (index > 0) pages[index - 1] else null
    }

    /**
     * Gives photo [id] what "Apply to all" copies, from the photo before it ([previousPhoto]): look (or preset), strength,
     * brightness, warmth, tint, contrast, saturation and grain, as one undo step (a neighbouring shot of the same scene usually wants its
     * brightness too, unlike Apply to all); denoise and rotation stay. Not while exporting.
     */
    fun copyPrevious(id: String) {
        if (_export.value != null) return
        val source = previousPhoto(id) ?: return
        changeDevelop(id, force = true) { p ->
            p.withLookOf(source).let { it.copy(adjust = it.adjust.copy(brightness = source.adjust.brightness)) }
        }
        _message.value = "Copied from ${source.name}"
    }

    /**
     * "Auto denoise all", for a batch that's otherwise done: every photo gets the denoise, colour denoise and sharpening
     * the auto develop measured on it (presets never override those here), so the Denoise slider goes back to 0 and
     * RawBoy edits take the measured values in place of their own (those of photos still being analysed stay); looks,
     * presets, lens corrections and the other sliders stay. One undo step per photo. [ids] (the grid's selection): only
     * those photos. Not while exporting.
     */
    fun autoDenoiseAll(ids: Set<String>? = null) {
        if (_export.value != null) return
        val changed = _photos.value.filter { p ->
            (ids == null || p.id in ids) && (p.adjust.denoise != 0f || p.withAutoNoise().edits != p.edits)
        }
        changed.forEach { p -> changeDevelop(p.id, force = true) { it.withAutoNoise().copy(adjust = it.adjust.copy(denoise = 0f)) } }
        _message.value = when (changed.size) {
            0 -> when {
                ids == null -> "Every photo already has its auto denoise"
                ids.size == 1 -> "This photo already has its auto denoise"
                else -> "These photos already have their auto denoise"
            }
            1 -> "Auto denoise on 1 photo"
            else -> "Auto denoise on ${changed.size} photos"
        }
    }

    /** [force]: its own undo step (false: a slider, coalesced; null: Undo or Redo itself, not recorded). */
    private fun changeDevelop(id: String, force: Boolean? = false, change: (AutoPhoto) -> AutoPhoto) {
        val old = photo(id)
        val before = old?.params
        val h = histories.getOrPut(id) { EditHistory() }
        if (old != null && force != null) h.record(old.develop, force)
        _undo.update { it + (id to UndoState(h.canUndo, h.canRedo)) }
        updatePhoto(id, change)
        val p = photo(id) ?: return
        if (_sessionReady.value == id) {
            p.params?.let(session::setParams)
            // Only a look change (or Strength reaching 0) changes the LUT or stock; slider drags must not reload them.
            if (p.params?.lut != before?.lut) session.selectLut(p.params?.lut) { _message.value = it }
            if (p.params?.film != before?.film) session.selectFilm(p.params?.film) { _message.value = it }
        }
        refreshThumbnail(id, immediate = false)
    }

    /** Re-renders the grid thumbnail; slider drags are debounced. */
    private fun refreshThumbnail(id: String, immediate: Boolean) {
        thumbJobs[id]?.cancel()
        thumbJobs[id] = viewModelScope.launch {
            if (!immediate) delay(250)
            val p = photo(id) ?: return@launch
            val bitmap = try {
                render(p, p.params ?: return@launch, GRID_THUMBNAIL)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                return@launch // keep the old thumbnail
            }
            updatePhoto(id) { it.copy(thumbnail = bitmap) }
        }
    }

    /** [look] on photo [id] at the default strength with its adjustments, small, for the look strip. */
    suspend fun lookThumbnail(id: String, look: Look): Bitmap? {
        val p = photo(id) ?: return null
        val key = id to thumbKey(look)
        lookThumbs[key]?.let { if (it.adjust == p.adjust && it.lensPreset == p.lensPreset) return it.bitmap }
        val a = p.analysis ?: return null
        val params = LookApplier.develop(a.autoBase, look, LookApplier.DEFAULT_STRENGTH, p.adjust, a.stats.hasFace, null, p.lensPreset)
        val bitmap = runCatching { render(p, params, LOOK_THUMBNAIL) }.getOrNull() ?: return null
        lookThumbs[key] = LookThumb(p.adjust, p.lensPreset, bitmap)
        return bitmap
    }

    /** True when the look-strip thumbnail of [look] on [id] matches the photo's current settings. */
    fun hasCurrentLookThumbnail(id: String, look: Look): Boolean {
        val p = photo(id) ?: return false
        val t = lookThumbs[id to thumbKey(look)] ?: return false
        return t.adjust == p.adjust && t.lensPreset == p.lensPreset
    }

    /** Film stocks share ids with the LUT looks of the same name (portra400...), so their thumbnails get their own keys. */
    private fun thumbKey(look: Look) = look.film?.let { "film:$it" } ?: look.id

    private suspend fun render(p: AutoPhoto, params: DevelopParams, size: Int): Bitmap {
        val a = p.analysis ?: throw IllegalStateException("not analysed")
        val lut = params.lut?.let { loadLut(it) }
        val film = params.film?.let { loadFilm(it) }
        return thumbnails.render(smallShader(p.id, a, params, lut, film), a.base, size)
    }

    /** Painted masks of each photo's RawBoy edits on its 512 px base, for the mask list they were made for. */
    private val smallBrushes = HashMap<String, Pair<List<MaskLayer>, (MaskLayer) -> BrushRaster?>>()

    /**
     * Uniforms for [params] on the analysis's small copies (thumbnails, the cached preview): RawBoy edits' painted masks
     * are rasterised on the 512 px base (once per edit) and their lens blur starts from the boosted bloom copy, so a
     * thumbnail shows them as the export will, only coarser.
     */
    private fun smallShader(id: String, a: Analysis, params: DevelopParams, lut: LutData?, film: FilmData?): ShaderParams {
        val brushFor: (MaskLayer) -> BrushRaster? = if (params.masks.none { it.strokes.isNotEmpty() }) {
            { null }
        } else {
            smallBrushes[id]?.takeIf { it.first === params.masks }?.second
                ?: brushLookup(a.base, params.masks).also { smallBrushes[id] = params.masks to it }
        }
        return ShaderParams.from(
            params, a.defaults, lut, LensTransform(a.lens, params), a.base, a.bloom, a.skin, film = film, brushFor = brushFor,
            bokehSource = a.bloom.halo,
        )
    }

    private suspend fun loadLut(id: String): LutData = lutLock.withLock {
        luts[id] ?: withContext(Dispatchers.IO) { LutLoader.load(getApplication(), id) }.also { luts[id] = it }
    }

    private suspend fun loadFilm(id: String): FilmData = lutLock.withLock {
        films[id] ?: withContext(Dispatchers.IO) {
            val app = getApplication<Application>()
            val stock = FilmStocks.byId(app, id) ?: throw IllegalArgumentException("Unknown film stock $id")
            FilmStocks.load(app, stock)
        }.also { films[id] = it }
    }

    // ---- Detail view ----

    /**
     * A photo tapped in the grid: opens it if it's analysed; one still waiting (or being analysed) is analysed next,
     * ahead of the rest, and opens when that's done.
     */
    fun openFromGrid(id: String) {
        val p = photo(id) ?: return
        if (_export.value != null) return
        if (p.analysis != null) {
            openDetail(id)
        } else if (p.status == PhotoStatus.QUEUED || p.status == PhotoStatus.ANALYZING) {
            _opening.value = id
        }
    }

    fun openDetail(id: String) {
        val p = photo(id) ?: return
        if (p.analysis == null || _export.value != null) return
        _selected.value = id
        if (_sessionReady.value == id) return
        _sessionReady.value = null
        if (_cachedPreview.value?.first != id) {
            _cachedPreview.value = null
            viewModelScope.launch {
                val cached = withContext(Dispatchers.IO) { previews.get(id) } ?: return@launch
                if (_selected.value == id && _sessionReady.value != id) _cachedPreview.value = id to cached
            }
        }
        viewModelScope.launch {
            try {
                // Photos swiped past while an earlier decode ran are skipped: each decode takes seconds.
                val opened = decodeLock.withLock {
                    if (_selected.value != id) return@withLock false
                    session.open(p.uri) { photo(id)?.params ?: it }
                    true
                }
                if (!opened || _selected.value != id) return@launch
                session.selectLut(photo(id)?.params?.lut) { _message.value = it }
                session.selectFilm(photo(id)?.params?.film) { _message.value = it }
                _sessionReady.value = id
                _cachedPreview.value = null
            } catch (e: Exception) {
                _message.value = e.message ?: "Could not open ${p.name}"
                _selected.value = null
            } catch (e: OutOfMemoryError) {
                _message.value = "Not enough memory to open ${p.name}"
                _selected.value = null
            }
        }
    }

    fun closeDetail() {
        session.exitZoom()
        _selected.value = null
        _cachedPreview.value = null
    }

    /**
     * Uniforms for showing [params] on photo [id]'s cached preview: the analysis's small copies, skin mask and lens
     * stand in for the session's (made from the same decode, so the develop matches). Null if it isn't analysed.
     */
    suspend fun cachedShaderParams(id: String, params: DevelopParams): ShaderParams? {
        val a = photo(id)?.analysis ?: return null
        val lut = params.lut?.let { runCatching { loadLut(it) }.getOrNull() }
        val film = params.film?.let { runCatching { loadFilm(it) }.getOrNull() }
        return smallShader(id, a, params, lut, film)
    }

    fun consumeMessage() {
        _message.value = null
    }

    // ---- Export ----

    /** Exports the detail view's photo from the already decoded image. */
    fun exportSelected() {
        val id = _sessionReady.value ?: return
        val p = photo(id) ?: return
        val a = p.analysis ?: return
        val params = p.params ?: return
        if (_export.value != null) return
        _export.value = BatchExport(done = 0, total = 1, failed = 0)
        val settings = _exportSettings.value
        exportJob = viewModelScope.launch {
            updatePhoto(id) { it.copy(status = PhotoStatus.EXPORTING) }
            val ok = try {
                val name = decodeLock.withLock { session.export(params, a.defaults, p.uri, p.name, settings, NAMING) { f ->
                    _export.update { it?.copy(current = f) }
                } }
                _message.value = "Saved Pictures/${NAMING.folder}/$name"
                true
            } catch (e: Exception) {
                _message.value = "Export failed: ${e.message}"
                false
            } catch (e: OutOfMemoryError) {
                _message.value = "Export failed: not enough memory"
                false
            }
            updatePhoto(id) { it.copy(status = if (ok) PhotoStatus.EXPORTED else PhotoStatus.READY) }
            _export.value = null
        }
    }

    /**
     * Exports every analysed photo in turn (only those in [ids] when given: the grid's selection), decoding each again;
     * a failure skips to the next.
     */
    fun exportAll(ids: Set<String>? = null) {
        if (_export.value != null) return
        val todo = _photos.value.filter { it.analysis != null && (ids == null || it.id in ids) }
        if (todo.isEmpty()) return
        closeDetail()
        // The detail view's full-resolution image would double the memory each export needs.
        session.close()
        _sessionReady.value = null
        _export.value = BatchExport(done = 0, total = todo.size, failed = 0, waiting = todo.map { it.id }.toSet())
        val settings = _exportSettings.value
        exportJob = viewModelScope.launch {
            var failed = 0
            var attempted = 0
            var stopped = false
            for ((index, photo) in todo.withIndex()) {
                if (_export.value?.stopping == true) { stopped = true; break }
                val p = photo(photo.id) ?: continue // removed meanwhile
                updatePhoto(p.id) { it.copy(status = PhotoStatus.EXPORTING) }
                attempted++
                val ok = try {
                    decodeLock.withLock { exportOne(p, settings) { f -> _export.update { it?.copy(current = f) } } }
                    true
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    failed++
                    updatePhoto(p.id) { it.copy(error = if (e is OutOfMemoryError) "Not enough memory" else e.message) }
                    false
                }
                updatePhoto(p.id) { it.copy(status = if (ok) PhotoStatus.EXPORTED else PhotoStatus.FAILED) }
                _export.update { it?.copy(done = index + 1, failed = failed, current = 0f, waiting = it.waiting - p.id) }
            }
            val saved = attempted - failed
            _message.value = buildString {
                // Photos finished before Stop are already in Pictures and stay there.
                if (stopped) append("Stopped · ")
                append("Saved $saved ${if (saved == 1) "photo" else "photos"} to Pictures/${NAMING.folder}")
                if (failed > 0) append(" · $failed failed")
            }
            _export.value = null
        }
    }

    /** Stops "Export all" after the photo being exported; photos already saved stay. */
    fun stopExport() {
        _export.update { e -> if (e != null && e.total > 1) e.copy(stopping = true) else e }
    }

    private suspend fun exportOne(p: AutoPhoto, settings: ExportSettings, onProgress: (Float) -> Unit) {
        val a = p.analysis ?: return
        val params = p.params ?: return
        val lut = params.lut?.let { loadLut(it) }
        val film = params.film?.let { loadFilm(it) }
        withContext(Dispatchers.Default) {
            RawImage.open(getApplication(), p.uri).use { img ->
                // A preset's Blemish removal heals the full-resolution image, as the detail view does.
                val skin = a.skin
                if (params.blemishRemoval > 0f && skin != null && skin.hasSkin) {
                    img.healBlemishes(blemishesToHeal(img.detectBlemishes(skin), params.blemishRemoval))
                }
                // RawBoy edits' painted masks and lens blur, made from the healed image as the detail view makes them.
                val textures = editTexturesOf(img, params)
                // The stored 512/128 px copies were made from this same file, so they match.
                val shader = ShaderParams.from(
                    params, a.defaults, lut, LensTransform(img.lens, params), a.base, a.bloom, a.skin, film = film,
                    brushFor = textures.brushFor, bokehSource = textures.bokehSource,
                )
                Exporter(getApplication()).export(img, p.uri, p.name, shader, settings, NAMING, onProgress = onProgress)
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
        thumbnails.close()
        previews.clear()
    }

    companion object {
        val NAMING = OutputNaming(folder = "RawBoy Auto", suffix = "auto")
        /** Defaults of [exportSettings]: JPEG 92, 16-bit TIFF, full size. */
        val SETTINGS = ExportSettings(format = ExportFormat.JPEG, jpegQuality = 92, tiffBits = 16)
        /** Export sizes offered (long side in pixels; null = full resolution). */
        val EXPORT_SIZES = listOf(null, 5600, 4096, 2048, 1080)
        const val GRID_THUMBNAIL = 512
        const val LOOK_THUMBNAIL = 192
        private const val PREFS = "auto"
        private const val KEY_IMPORT_MODE = "importMode"
        private const val KEY_EXPORT_FORMAT = "exportFormat"
        private const val KEY_EXPORT_SIZE = "exportMaxLongSide"
        private const val KEY_EXPORT_QUALITY = "exportJpegQuality"
        private const val KEY_EXPORT_BITS = "exportTiffBits"
        private const val KEY_FRAME = "frame"
        private const val KEY_SORT = "sort"
    }
}

/** File types Auto opens besides raws: already processed by the camera, so they give lower-quality results. */
private val NON_RAW_EXTENSIONS = setOf("jpg", "jpeg", "heic", "heif", "png", "tif", "tiff")

/** The note shown when an import includes non-raw photos, or null. */
internal fun nonRawNote(names: List<String>): String? {
    val n = names.count { it.substringAfterLast('.', "").lowercase() in NON_RAW_EXTENSIONS }
    if (n == 0) return null
    val which = if (n == 1) "1 photo isn't RAW" else "$n photos aren't RAW"
    return "$which: JPEG, HEIC, PNG and TIFF are already processed by the camera, " +
        "so results are lower quality than from RAW"
}
