package app.rawboy.auto.ui

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.rawboy.auto.AutoPhoto
import app.rawboy.auto.AutoViewModel
import app.rawboy.auto.LookMode
import app.rawboy.auto.UndoState
import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.Look
import app.rawboy.auto.looks.LookApplier
import app.rawboy.auto.looks.Looks
import app.rawboy.develop.CropMath
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.crop
import app.rawboy.gl.ShaderParams
import app.rawboy.session.SkinState
import app.rawboy.view.CompactSlider
import app.rawboy.view.DevelopPreview
import app.rawboy.view.HelpButton
import app.rawboy.view.RedoIcon
import app.rawboy.view.UndoIcon
import app.rawboy.view.ZOOM_HINT_TEXT
import app.rawboy.view.rememberZoomHint
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(vm: AutoViewModel, id: String, snackbar: SnackbarHostState) {
    val photos by vm.photos.collectAsStateWithLifecycle()
    val photo = photos.firstOrNull { it.id == id } ?: return
    val analysis = photo.analysis ?: return
    val export by vm.export.collectAsStateWithLifecycle()
    val exportSettings by vm.exportSettings.collectAsStateWithLifecycle()
    var exportSheet by remember { mutableStateOf(false) }
    val ready by vm.sessionReady.collectAsStateWithLifecycle()
    val cached by vm.cachedPreview.collectAsStateWithLifecycle()
    val session = vm.session
    val preview by session.preview.collectAsStateWithLifecycle()
    val zoomCenter by session.zoomCenter.collectAsStateWithLifecycle()
    val detail by session.detail.collectAsStateWithLifecycle()
    val lutData by session.lutData.collectAsStateWithLifecycle()
    val filmData by session.filmData.collectAsStateWithLifecycle()
    val lensInfo by session.lensInfo.collectAsStateWithLifecycle()
    val base by session.base.collectAsStateWithLifecycle()
    val bloomSources by session.bloomSources.collectAsStateWithLifecycle()
    val bokehSource by session.bokehSource.collectAsStateWithLifecycle()
    val skin by session.skin.collectAsStateWithLifecycle()
    val skinMask = (skin as? SkinState.Ready)?.mask
    val undoStates by vm.undoStates.collectAsStateWithLifecycle()
    val frameColor by vm.frameColor.collectAsStateWithLifecycle()
    val framePx = with(LocalDensity.current) { FRAME_WIDTH.roundToPx() }
    val scope = rememberCoroutineScope()
    var showAuto by remember { mutableStateOf(false) }
    val loaded = ready == id
    // Photos that can be opened, in grid order.
    val pages = remember(photos) { photos.filter { it.analysis != null } }
    // The pager reads pages through this state: its page count and keys update at different times as photos finish
    // analysing, so a captured list can be shorter than the count it is asked for.
    val currentPages by rememberUpdatedState(pages)
    val pagerState = rememberPagerState(pages.indexOfFirst { it.id == id }.coerceAtLeast(0)) { currentPages.size }
    val currentId by rememberUpdatedState(id)
    // A swipe opens its photo once it settles, so passing photos aren't decoded.
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.settledPage }.collect { page ->
            currentPages.getOrNull(page)?.id?.let { if (it != currentId) vm.openDetail(it) }
        }
    }
    // Keep the pager on the selected photo (e.g. when photos before it finish analysing).
    LaunchedEffect(id, pages) {
        val index = pages.indexOfFirst { it.id == id }
        if (index >= 0 && index != pagerState.currentPage && !pagerState.isScrollInProgress) {
            pagerState.scrollToPage(index)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = vm::closeDetail) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Column {
                        Text(photo.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val index = pages.indexOfFirst { it.id == id }
                        if (pages.size > 1 && index >= 0) {
                            Text(
                                "${index + 1} / ${pages.size}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    val undo = undoStates[id] ?: UndoState()
                    IconButton(onClick = { vm.undo(id) }, enabled = export == null && undo.canUndo) {
                        Icon(UndoIcon, contentDescription = "Undo")
                    }
                    IconButton(onClick = { vm.redo(id) }, enabled = export == null && undo.canRedo) {
                        Icon(RedoIcon, contentDescription = "Redo")
                    }
                    // Apply to all and Remove share a menu: the bar is full on phones and the name needs the room.
                    var menu by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Apply to all") },
                                onClick = { menu = false; vm.applyLookToAll(id) },
                                enabled = export == null && photos.size > 1,
                            )
                            DropdownMenuItem(
                                text = { Text("Remove from batch") },
                                onClick = { menu = false; vm.removeOpened(id) },
                                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                enabled = export == null,
                            )
                        }
                    }
                    Button(onClick = { exportSheet = true }, enabled = loaded && export == null) { Text("Export") }
                    HelpButton("RawBoy Auto", AUTO_HELP, licences = true)
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            // Swipe between the batch's photos. Only the shown photo is decoded (one GL surface);
            // neighbours show their grid thumbnails until they settle and open.
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color(0xFF121212))
                    .onSizeChanged { session.setViewSize(it.width, it.height, framePx) },
            ) {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                    // Drags pan the 100% view; an export holds the photo still.
                    userScrollEnabled = zoomCenter == null && export == null,
                    key = { currentPages.getOrNull(it)?.id ?: it },
                ) { page ->
                    val pagePhoto = currentPages.getOrNull(page) ?: return@HorizontalPager
                    // Until the raw is decoded, the photo's cached preview shows its develop (no 100% view yet).
                    val cachedImage = cached?.takeIf { pagePhoto.id == id && !loaded && it.first == id }?.second
                    val shownParams = if (showAuto && loaded) analysis.autoBase else photo.params ?: analysis.autoBase
                    val cachedParams by produceState<ShaderParams?>(null, cachedImage, shownParams) {
                        value = cachedImage?.let { vm.cachedShaderParams(id, shownParams) }
                    }
                    Box(Modifier.fillMaxSize()) {
                        val live = pagePhoto.id == id && loaded
                        val quickParams = cachedParams.takeIf { cachedImage != null }
                        if (live || quickParams != null) {
                            // One call site for both, so the GL view stays when the decoded preview replaces the cached one.
                            val shaderParams = if (live) {
                                // Press and hold shows the auto develop without the look.
                                val shown = shownParams
                                remember(shown, lutData, filmData, lensInfo, base, bloomSources, bokehSource, skinMask) {
                                    session.shaderParams(
                                        shown, analysis.defaults, lutData.takeIf { shown.lut != null },
                                        film = filmData.takeIf { shown.film != null },
                                    )
                                }
                            } else {
                                quickParams!!
                            }
                            DevelopPreview(
                                if (live) preview else cachedImage, shaderParams, zoomCenter.takeIf { live }, detail.takeIf { live },
                                framePx, frameColor, Modifier.fillMaxSize(),
                            )
                        }
                        if (!live && quickParams != null) {
                            CircularProgressIndicator(
                                Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(12.dp)
                                    .size(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else if (live) {
                            val zoomed = zoomCenter != null
                            Box(
                                Modifier
                                    .matchParentSize()
                                    .pointerInput(framePx) {
                                        detectTapGestures(
                                            onDoubleTap = { session.toggleZoom(it.x, it.y, framePx) },
                                            onTap = { vm.onPreviewTap(it.x, it.y, framePx) },
                                            onPress = {
                                                val compare = scope.launch {
                                                    delay(COMPARE_DELAY_MS)
                                                    showAuto = true
                                                }
                                                tryAwaitRelease()
                                                compare.cancel()
                                                showAuto = false
                                            },
                                        )
                                    }
                                    .pointerInput(zoomed) {
                                        // Only while zoomed: otherwise the drag belongs to the pager.
                                        if (zoomed) {
                                            detectDragGestures { change, drag ->
                                                change.consume()
                                                session.pan(drag.x, drag.y)
                                            }
                                        }
                                    },
                            )
                            if (showAuto || zoomed) {
                                Label(
                                    when {
                                        !showAuto -> "100%"
                                        photo.edits != null -> "Without edits"
                                        photo.preset != null -> "Without preset"
                                        else -> "Without look"
                                    },
                                    Modifier.align(Alignment.TopStart),
                                )
                            }
                            // Qualified: inside this Box the ColumnScope overload would win.
                            androidx.compose.animation.AnimatedVisibility(
                                rememberZoomHint(preview, zoomCenter),
                                Modifier.align(Alignment.BottomCenter),
                                enter = fadeIn(),
                                exit = fadeOut(),
                            ) {
                                Label(ZOOM_HINT_TEXT, Modifier)
                            }
                        } else {
                            // Until the raw is decoded, show the grid thumbnail.
                            pagePhoto.thumbnail?.let {
                                // Inset by the frame so the photo doesn't move when the decoded preview replaces it,
                                // and framed as the preview will be, so the frame doesn't blink out while it renders.
                                Box(Modifier.fillMaxSize().padding(FRAME_WIDTH), contentAlignment = Alignment.Center) {
                                    Image(
                                        it.asImageBitmap(), pagePhoto.name,
                                        Modifier
                                            .aspectRatio(it.width.toFloat() / it.height)
                                            .drawBehind {
                                                val f = framePx.toFloat()
                                                drawRect(
                                                    Color(frameColor.level, frameColor.level, frameColor.level),
                                                    topLeft = Offset(-f, -f), size = Size(size.width + 2 * f, size.height + 2 * f),
                                                )
                                            },
                                        contentScale = ContentScale.Fit,
                                    )
                                }
                            }
                            if (pagePhoto.id == id) CircularProgressIndicator(Modifier.align(Alignment.Center))
                        }
                    }
                }
                export?.let { e ->
                    LinearProgressIndicator(
                        progress = { e.current },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth(),
                    )
                }
            }

            val preset = photo.preset
            if (photo.edits != null) {
                // RawBoy's own develop of this photo, crop, masks and light leaks included, in place of the look strip.
                ReplacedLook(AutoPhoto.EDITS_NAME, "Sent from RawBoy · ${editsSummary(photo.edits)}") {
                    TextButton(onClick = { vm.removeEdits(id) }, enabled = export == null) { Text("Use a look") }
                }
            } else if (preset != null) {
                // A RawBoy preset develops this photo in place of the look strip.
                ReplacedLook(preset.name, "RawBoy preset · ${groupSummary(preset)}") {
                    TextButton(onClick = { vm.removePhotoPreset(id) }, enabled = export == null) { Text("Use a look") }
                }
            } else {
                // Each photo keeps one pick per mode.
                ModeSwitch(
                    photo.mode, { vm.setMode(id, it) },
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp, end = 12.dp, top = 8.dp),
                )
                LookStrip(vm, photo)
            }
            // Look: the look and the two everyday controls; Adjust: every adjustment (those two again, then the offsets from the auto develop).
            // The tab stays when swiping to another photo.
            var tab by rememberSaveable { mutableIntStateOf(0) }
            // Copy previous sits at the tabs' end, by the controls it changes (the top bar is full on phones).
            Row(verticalAlignment = Alignment.CenterVertically) {
                PrimaryTabRow(selectedTabIndex = tab, modifier = Modifier.weight(1f)) {
                    SmallTab("Look", tab == 0) { tab = 0 }
                    SmallTab("Adjust", tab == 1) { tab = 1 }
                }
                TextButton(
                    onClick = { vm.copyPrevious(id) },
                    enabled = export == null && vm.previousPhoto(id) != null,
                    modifier = Modifier.height(36.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) { Text("Copy previous", style = MaterialTheme.typography.labelLarge) }
            }
            // Room for three sliders (the Look tab); Adjust scrolls. The photo keeps the rest of the screen.
            val scrollStates = List(2) { rememberScrollState() }
            Column(
                Modifier
                    .navigationBarsPadding()
                    .height(SLIDER_ROW * 3 + 8.dp)
                    .verticalScroll(scrollStates[tab])
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                val a = photo.adjust
                if (tab == 0) {
                    if (preset == null && photo.edits == null) {
                        AutoSlider("Strength", photo.strength, 0f..100f, LookApplier.DEFAULT_STRENGTH) { vm.setStrength(id, it) }
                    }
                    AutoSlider("Brightness", a.brightness, -100f..100f, 0f) { v -> vm.setAdjust(id) { it.copy(brightness = v) } }
                    AutoSlider("Warmth", a.warmth, -100f..100f, 0f) { v -> vm.setAdjust(id) { it.copy(warmth = v) } }
                } else {
                    // Light and colour in pairs, side by side.
                    SliderPair(
                        { m -> AutoSlider("Brightness", a.brightness, -100f..100f, 0f, m) { v -> vm.setAdjust(id) { it.copy(brightness = v) } } },
                        { m -> AutoSlider("Contrast", a.contrast, -50f..50f, 0f, m) { v -> vm.setAdjust(id) { it.copy(contrast = v) } } },
                    )
                    SliderPair(
                        { m -> AutoSlider("Warmth", a.warmth, -100f..100f, 0f, m) { v -> vm.setAdjust(id) { it.copy(warmth = v) } } },
                        { m -> AutoSlider("Tint", a.tint, -50f..50f, 0f, m) { v -> vm.setAdjust(id) { it.copy(tint = v) } } },
                    )
                    AutoSlider("Saturation", a.saturation, -100f..100f, 0f) { v -> vm.setAdjust(id) { it.copy(saturation = v) } }
                    AutoSlider("Grain", a.grain, -50f..50f, 0f) { v -> vm.setAdjust(id) { it.copy(grain = v) } }
                    AutoSlider("Denoise", a.denoise, -100f..100f, 0f) { v -> vm.setAdjust(id) { it.copy(denoise = v) } }
                }
            }
        }
    }

    if (exportSheet) {
        ExportSheet(
            count = 1,
            settings = exportSettings,
            onChange = vm::setExportSettings,
            onDismiss = { exportSheet = false },
            onExport = {
                exportSheet = false
                vm.exportSelected()
            },
        )
    }
}

/** What develops the photo in place of the look strip (a RawBoy preset or RawBoy edits): [name], [detail], and [action]. */
@Composable
private fun ReplacedLook(name: String, detail: String, action: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 8.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.small)
            .padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        action()
    }
}

/** The photo-specific parts RawBoy edits carry, for the edits card ("crop, 2 masks, 1 light leak"). */
private fun editsSummary(e: DevelopParams): String {
    fun count(n: Int, one: String) = if (n == 1) "1 $one" else "$n ${one}s"
    val parts = buildList {
        if (e.crop != CropMath.FULL || e.straighten != 0f) add("crop")
        val masks = e.masks.count { !it.isIdentity && it.hasMask }
        if (masks > 0) add(count(masks, "mask"))
        if (e.masks.any { it.enabled && it.opacity > 0f && it.adjust.lensBlur > 0f }) add("lens blur")
        val leaks = e.leaks.count { !it.isIdentity }
        if (leaks > 0) add(count(leaks, "light leak"))
    }
    return parts.joinToString().ifEmpty { "every slider as set there" }
}

@Composable
private fun LookStrip(vm: AutoViewModel, photo: AutoPhoto) {
    val state = rememberLazyListState()
    val looks = if (photo.mode == LookMode.FILM) FilmLooks.ALL else Looks.ALL
    LaunchedEffect(photo.id, photo.mode) {
        state.scrollToItem(looks.indexOf(photo.activeLook).coerceAtLeast(0))
    }
    LazyRow(
        state = state,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(looks, key = { it.id }) { look ->
            LookChip(vm, photo, look)
        }
    }
}

@Composable
private fun LookChip(vm: AutoViewModel, photo: AutoPhoto, look: Look) {
    // Keeps showing the previous thumbnail while a slider moves; re-renders once it rests.
    val thumb by produceState<Bitmap?>(null, photo.id, look.id, photo.adjust) {
        if (!vm.hasCurrentLookThumbnail(photo.id, look)) delay(400)
        value = vm.lookThumbnail(photo.id, look)
    }
    val selected = photo.activeLook.id == look.id
    Column(
        Modifier
            .width(LOOK_SIZE)
            .clickable { vm.setLook(photo.id, look) },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(LOOK_SIZE)
                .background(Color(0xFF1E1E1E))
                .border(
                    if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else BorderStroke(0.dp, Color.Transparent),
                ),
            contentAlignment = Alignment.Center,
        ) {
            thumb?.let { Image(it.asImageBitmap(), look.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            val suggested = if (photo.mode == LookMode.FILM) photo.suggestedFilm else photo.suggested
            if (suggested.id == look.id) {
                Text(
                    "Suggested",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.85f))
                        .padding(vertical = 1.dp),
                    maxLines = 1,
                )
            }
        }
        // Two lines, so long stock names ("Double-X 5222") aren't cut off; always two so the strip doesn't jump.
        Text(
            look.name,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            minLines = 2,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Slider with its value; double-tap the slider or tap the value to reset. */
@Composable
private fun AutoSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    default: Float,
    pair: Modifier? = null,
    onChange: (Float) -> Unit,
) = if (pair != null) {
    CompactSlider(label, value, range, default, pair, rowHeight = SLIDER_PAIR_ROW, stacked = true, onChange = onChange)
} else {
    CompactSlider(label, value, range, default, rowHeight = SLIDER_ROW, labelWidth = 88.dp, valueWidth = 44.dp, onChange = onChange)
}

/** Two stacked sliders side by side; each gets the modifier that gives it half the row. */
@Composable
private fun SliderPair(left: @Composable (Modifier) -> Unit, right: @Composable (Modifier) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        left(Modifier.weight(1f))
        right(Modifier.weight(1f))
    }
}

@Composable
private fun SmallTab(text: String, selected: Boolean, onClick: () -> Unit) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.height(36.dp),
        text = { Text(text, style = MaterialTheme.typography.labelLarge) },
    )
}

@Composable
private fun Label(text: String, modifier: Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        modifier = modifier
            .padding(12.dp)
            .background(Color(0x99000000))
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

/** The frame around the photo in the fit view, as RawBoy's (grey, white or black: tap outside the photo). */
private val FRAME_WIDTH = 12.dp
private val LOOK_SIZE = 64.dp
private val SLIDER_ROW = 40.dp
private val SLIDER_PAIR_ROW = 48.dp
private const val COMPARE_DELAY_MS = 250L
