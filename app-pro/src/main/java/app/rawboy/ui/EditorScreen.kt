@file:OptIn(ExperimentalMaterial3Api::class)

package app.rawboy.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import app.rawboy.develop.MaskShape
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.rawboy.develop.CropAspect
import app.rawboy.develop.CropMath
import app.rawboy.develop.Preset
import app.rawboy.develop.crop
import app.rawboy.develop.withCrop
import app.rawboy.develop.withoutCrop
import app.rawboy.gl.ShaderParams
import androidx.compose.ui.platform.LocalDensity
import app.rawboy.lut.LutRepository
import app.rawboy.view.DevelopPreview
import app.rawboy.view.HistogramView
import app.rawboy.view.ZOOM_HINT_TEXT
import app.rawboy.view.rememberZoomHint
import app.rawboy.session.SkinState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun EditorScreen(vm: EditorViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val preview by vm.preview.collectAsStateWithLifecycle()
    val exportSettings by vm.exportSettings.collectAsStateWithLifecycle()
    val zoomCenter by vm.zoomCenter.collectAsStateWithLifecycle()
    val detail by vm.detail.collectAsStateWithLifecycle()
    val lutData by vm.lutData.collectAsStateWithLifecycle()
    val filmData by vm.filmData.collectAsStateWithLifecycle()
    val lensInfo by vm.lensInfo.collectAsStateWithLifecycle()
    val base by vm.base.collectAsStateWithLifecycle()
    val bloomSources by vm.bloomSources.collectAsStateWithLifecycle()
    val skin by vm.skin.collectAsStateWithLifecycle()
    val blemish by vm.blemish.collectAsStateWithLifecycle()
    val skinMask = (skin as? SkinState.Ready)?.mask
    val luts by vm.luts.collectAsStateWithLifecycle()
    val presets by vm.presets.collectAsStateWithLifecycle()
    val histogram by vm.histogram.collectAsStateWithLifecycle()
    val clipWarning by vm.clipWarning.collectAsStateWithLifecycle()
    val presetImport = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(vm::importPresets)
    }
    // The presets an export picker was opened for (one, or all).
    var presetsToExport by remember { mutableStateOf<List<Preset>>(emptyList()) }
    val presetExport = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.exportPresets(uri, presetsToExport)
    }
    val presetActions = remember(vm) {
        PresetActions(
            apply = vm::applyPreset,
            save = vm::savePreset,
            update = { vm.updatePreset(it.id) },
            rename = { p, name -> vm.renamePreset(p.id, name) },
            delete = { vm.deletePreset(it.id) },
            export = { list ->
                presetsToExport = list
                presetExport.launch(if (list.size == 1) "${list[0].name}.rawboy.json" else "RawBoy presets.rawboy.json")
            },
            import = { presetImport.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) },
            sendToAuto = vm::sendPresetToAuto,
        )
    }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        tree?.let(vm::setUserLutFolder)
    }
    val scope = rememberCoroutineScope()
    val frameColor by vm.frameColor.collectAsStateWithLifecycle()
    val framePx = with(LocalDensity.current) { FRAME_WIDTH.roundToPx() }

    var showExport by remember { mutableStateOf(false) }
    var showOriginal by remember { mutableStateOf(false) }
    var mode by rememberSaveable { mutableStateOf(EditorMode.NONE) }
    val geometryMode = mode == EditorMode.GEOMETRY
    val presetsMode = mode == EditorMode.PRESETS
    val masksMode = mode == EditorMode.MASKS
    // The histogram sits above the slider tabs, so only while they show (the tools replace them).
    val histogramShown = state.hasImage && mode == EditorMode.NONE
    // White balance picker: armed from the Color tab, the next tap on the photo picks.
    var pickingWhite by remember { mutableStateOf(false) }
    LaunchedEffect(mode, state.fileName) { pickingWhite = false }
    // Masks (UI state; the layers themselves are in the params).
    var selectedLayer by rememberSaveable { mutableStateOf<String?>(null) }
    var maskTool by rememberSaveable { mutableStateOf(MaskTool.MOVE) }
    var showMask by rememberSaveable { mutableStateOf(false) }
    var paintAt by remember { mutableStateOf<Offset?>(null) }
    var sizeRing by remember { mutableStateOf(false) }
    var sizeRingAt by remember { mutableLongStateOf(0L) }
    LaunchedEffect(sizeRingAt) {
        if (sizeRingAt == 0L) return@LaunchedEffect
        sizeRing = true
        delay(SIZE_RING_MS)
        sizeRing = false
    }
    val brush by vm.brush.collectAsStateWithLifecycle()
    val layers = state.params.masks
    val selectedId = selectedLayer?.takeIf { id -> layers.any { it.id == id } } ?: layers.firstOrNull()?.id
    val marginPx = with(LocalDensity.current) { if (masksMode) MASK_MARGIN.roundToPx() else 0 }
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    // Crop shape lock (UI only; the crop itself is in the params). Portrait null = follow the frame.
    var cropAspect by rememberSaveable { mutableStateOf(CropAspect.FREE) }
    var cropPortrait by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(state.fileName) {
        cropAspect = CropAspect.FREE
        cropPortrait = null
        selectedLayer = null
    }
    val frame = vm.lensFor(state.params.withoutCrop())
    val portrait = cropPortrait ?: (frame.frameHeight > frame.frameWidth)
    val cropRatio = cropAspect.ratio(frame.frameWidth, frame.frameHeight, portrait)
    val snackbar = remember { SnackbarHostState() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(vm::open)
    }
    val openFile = { picker.launch(arrayOf("*/*")) } // raw MIME types are inconsistent across providers

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    Scaffold(
        topBar = {
            EditorTopBar(
                fileName = state.fileName,
                info = state.info,
                enabled = state.hasImage && !state.busy,
                mode = mode,
                onOpen = openFile,
                onMode = {
                    if (it == EditorMode.GEOMETRY) vm.exitZoom() // the crop tool works on the fit view
                    mode = it
                },
                onReset = vm::reset,
                onAuto = vm::applyAuto,
                canUndo = state.canUndo,
                canRedo = state.canRedo,
                onUndo = vm::undo,
                onRedo = vm::redo,
                onExport = { showExport = true },
                canOpen = !state.busy,
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color(0xFF121212))
                    .onSizeChanged {
                        viewSize = it
                        vm.setViewSize(it.width, it.height, framePx)
                    },
            ) {
                // Compare keeps the current rotation, flips and crop so the frame doesn't jump.
                val edited = if (showOriginal) {
                    state.defaults.copy(
                        rotation = state.params.rotation,
                        flipHorizontal = state.params.flipHorizontal,
                        flipVertical = state.params.flipVertical,
                        straighten = state.params.straighten,
                    ).withCrop(state.params.crop)
                } else {
                    state.params
                }
                // The crop tool shows the whole frame with the crop drawn over it.
                val shown = if (geometryMode) edited.withoutCrop() else edited
                val maskView = if (masksMode && showMask && !showOriginal) selectedId else null
                val shaderParams = remember(shown, state.defaults, lutData, filmData, lensInfo, base, bloomSources, skinMask, maskView, preview) {
                    ShaderParams.from(
                        shown, state.defaults, lutData, vm.lensFor(shown), base, bloomSources, skinMask,
                        maskView = maskView, brushFor = vm::brushRaster, film = filmData,
                    )
                }
                DevelopPreview(
                    preview, shaderParams, zoomCenter, detail, framePx, frameColor, Modifier.fillMaxSize(), marginPx,
                    clipWarning = clipWarning && histogramShown && !showOriginal,
                )
                // Histogram of the whole edit (crop applied, no mask view) from the 512 px base copy, once the
                // params rest for a moment: a slider drag would otherwise queue a render per step.
                val histogramBase = base.takeIf { histogramShown }
                LaunchedEffect(edited, state.defaults, lutData, filmData, lensInfo, histogramBase, bloomSources, skinMask) {
                    val b = histogramBase ?: return@LaunchedEffect
                    delay(HISTOGRAM_DELAY_MS)
                    val params = ShaderParams.from(
                        edited, state.defaults, lutData, vm.lensFor(edited), b, bloomSources, skinMask,
                        brushFor = vm::brushRaster, film = filmData,
                    )
                    vm.updateHistogram(params, b)
                }
                val maskGestures = rememberMaskGestures(
                    shaderParams.lens, layers, selectedId, framePx + marginPx, zoomCenter,
                    if (selectedId != null) maskTool else MaskTool.MOVE, brush,
                    MaskActions(
                        onSelect = { selectedLayer = it },
                        onChange = { id, shape -> vm.updateLayer(id) { it.copy(shape = shape) } },
                        onStrokeBegin = vm::beginStroke,
                        onStrokeExtend = vm::extendStroke,
                        onStrokeCancel = vm::cancelStroke,
                        onPan = vm::pan,
                    ),
                    onPaintAt = { paintAt = it },
                )

                // Double tap: 100% at that point / back to fit. Drag: pan at 100%.
                // Press and hold: compare with the as-shot render (delayed so taps
                // and drags don't flash it).
                Box(
                    Modifier
                        .matchParentSize()
                        .pointerInput(geometryMode, masksMode, marginPx) {
                            detectTapGestures(
                                // Zoom and frame colour work on the cropped view; the crop tool shows the whole frame.
                                // Masks zoom too (frame-colour taps stay off while masking).
                                onDoubleTap = { if (!geometryMode) vm.toggleZoom(it.x, it.y, marginPx) },
                                onTap = {
                                    when {
                                        geometryMode || masksMode -> {}
                                        pickingWhite -> {
                                            pickingWhite = false
                                            vm.pickWhite(it.x, it.y)
                                        }
                                        else -> vm.onPreviewTap(it.x, it.y)
                                    }
                                },
                                onPress = {
                                    val compare = scope.launch {
                                        delay(COMPARE_DELAY_MS)
                                        showOriginal = true
                                    }
                                    tryAwaitRelease()
                                    compare.cancel()
                                    showOriginal = false
                                },
                            )
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, drag ->
                                change.consume()
                                vm.pan(drag.x, drag.y)
                            }
                        }
                        // Last, so it sees each touch first and takes only handles and paint strokes.
                        .then(if (masksMode && preview != null) maskGestures else Modifier),
                )
                if (masksMode && preview != null && !showOriginal) {
                    MaskOverlay(
                        shaderParams.lens, layers, selectedId, framePx + marginPx, zoomCenter,
                        if (selectedId != null) maskTool else MaskTool.MOVE, brush, paintAt, sizeRing,
                        Modifier.matchParentSize(),
                    )
                }
                if (geometryMode && zoomCenter == null && preview != null) {
                    CropOverlay(
                        shaderParams.lens.outputWidth, shaderParams.lens.outputHeight, state.params.crop,
                        cropRatio, framePx, vm::setCrop, Modifier.matchParentSize(),
                    )
                }

                when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    preview == null -> Button(onClick = openFile, modifier = Modifier.align(Alignment.Center)) {
                        Text("Open a RAW file")
                    }
                }
                if ((zoomCenter != null || maskView != null) && !showOriginal) {
                    Text(
                        listOfNotNull("100%".takeIf { zoomCenter != null }, "Mask".takeIf { maskView != null }).joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .background(Color(0x99000000))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
                if (showOriginal && preview != null) {
                    Text(
                        "Original",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .background(Color(0x99000000))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
                // Zoom works on the cropped view only, so no hint while the crop tool is open.
                // Qualified: inside this Box the ColumnScope overload would win.
                androidx.compose.animation.AnimatedVisibility(
                    rememberZoomHint(preview, zoomCenter, !geometryMode),
                    Modifier.align(Alignment.BottomCenter),
                    enter = fadeIn(),
                    exit = fadeOut(),
                ) {
                    Text(
                        ZOOM_HINT_TEXT,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier
                            .padding(16.dp)
                            .background(Color(0x99000000))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
                if (state.exporting) {
                    LinearProgressIndicator(
                        progress = { state.exportProgress },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth(),
                    )
                }
            }

            if (state.hasImage && geometryMode) {
                GeometryPanel(
                    params = state.params,
                    onChange = vm::update,
                    onRotate = {
                        vm.rotate(it)
                        cropPortrait = cropPortrait?.not() // a locked shape turns with the picture
                    },
                    onFlip = vm::flip,
                    aspect = cropAspect,
                    portrait = portrait,
                    onAspect = { aspect, toPortrait ->
                        cropAspect = aspect
                        cropPortrait = toPortrait
                        val ratio = aspect.ratio(frame.frameWidth, frame.frameHeight, toPortrait)
                        vm.setCrop(CropMath.withAspect(state.params.crop, ratio, frame.frameWidth, frame.frameHeight))
                    },
                    onResetCrop = {
                        cropAspect = CropAspect.FREE
                        cropPortrait = null
                        vm.setCrop(CropMath.FULL)
                    },
                    onDone = { mode = EditorMode.NONE },
                )
            } else if (state.hasImage && masksMode) {
                MasksPanel(
                    layers = layers,
                    selectedId = selectedId,
                    tool = maskTool,
                    brush = brush,
                    showMask = showMask,
                    zoomed = zoomCenter != null,
                    actions = MaskPanelActions(
                        onSelect = { selectedLayer = it },
                        onAdd = { kind ->
                            vm.addLayer(kind)?.let { selectedLayer = it }
                            maskTool = if (kind == MaskShape.Brush) MaskTool.BRUSH else MaskTool.MOVE
                        },
                        onUpdate = vm::updateLayer,
                        onRemove = vm::removeLayer,
                        onTool = { maskTool = it },
                        onBrush = vm::setBrush,
                        onSizeChanging = { sizeRingAt = System.nanoTime() },
                        onShowMask = { showMask = it },
                        onUndoStroke = vm::undoStroke,
                        onClearBrush = vm::clearBrush,
                        onToggleZoom = {
                            if (zoomCenter != null) vm.exitZoom() else vm.toggleZoom(viewSize.width / 2f, viewSize.height / 2f, marginPx)
                        },
                        onDone = { mode = EditorMode.NONE },
                    ),
                    modifier = Modifier.heightIn(max = PANEL_MAX),
                )
            } else if (state.hasImage && presetsMode) {
                PresetsPanel(
                    presets = presets,
                    actions = presetActions,
                    onDone = { mode = EditorMode.NONE },
                    modifier = Modifier.heightIn(max = PANEL_MAX),
                    hasStrokes = layers.any { it.strokes.isNotEmpty() },
                )
            } else if (state.hasImage) {
                HistogramView(
                    histogram,
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                        .height(HISTOGRAM_HEIGHT),
                    active = clipWarning,
                    onClick = vm::toggleClipWarning,
                )
                ControlsPanel(
                    params = state.params,
                    defaults = state.defaults,
                    onChange = vm::update,
                    luts = luts,
                    lutLoading = state.params.lut != null && lutData?.id != state.params.lut,
                    filmLoading = state.params.film != null && filmData?.stock?.id != state.params.film,
                    onToneMapper = vm::setToneMapper,
                    onFilm = vm::useFilm,
                    onSelectFilm = vm::selectFilm,
                    onSelectLut = vm::selectLut,
                    onLutsTabShown = vm::refreshLuts,
                    onChooseLutFolder = { folderPicker.launch(LutRepository.suggestedFolder) },
                    lens = lensInfo,
                    skin = skin,
                    blemish = blemish,
                    modifier = Modifier.heightIn(max = PANEL_MAX),
                    pickingWhite = pickingWhite,
                    onPickWhite = { pickingWhite = !pickingWhite },
                )
            }
        }
    }

    if (showExport) {
        ExportDialog(
            initial = exportSettings,
            sourceName = state.fileName ?: "image",
            onDismiss = { showExport = false },
            onExport = { settings ->
                showExport = false
                vm.export(settings)
            },
        )
    }
}

private const val COMPARE_DELAY_MS = 250L

/** The histogram renders once the edit has rested this long. */
private const val HISTOGRAM_DELAY_MS = 150L

private val HISTOGRAM_HEIGHT = 56.dp

/** Slider panels' height cap: the rest of the screen goes to the photo. */
private val PANEL_MAX = 320.dp

/** Empty space around the frame while masking: handles can sit beyond the photo (portrait screens have more). */
private val MASK_MARGIN = 16.dp

/** How long the brush size shows over the photo after its slider moves. */
private const val SIZE_RING_MS = 900L

/** Frame around the photo in the fit view (tap outside the photo to change its colour). */
private val FRAME_WIDTH = 12.dp
