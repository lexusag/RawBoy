package app.rawboy.camera.ui

import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.unit.Dp
import app.rawboy.view.formatSliderValue
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import app.rawboy.camera.capture.FlashMode
import app.rawboy.camera.qr.QrPayload
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.style.TextOverflow
import app.rawboy.view.HistogramView
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import androidx.lifecycle.compose.LifecycleResumeEffect
import android.hardware.camera2.CameraMetadata
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.State
import kotlinx.coroutines.coroutineScope
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.runtime.rememberUpdatedState
import app.rawboy.auto.analysis.MeterArea
import app.rawboy.gl.ViewfinderRenderer
import kotlin.math.min
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.rawboy.auto.looks.LookApplier
import app.rawboy.color.BwFilter
import app.rawboy.camera.BurstMode
import app.rawboy.camera.CameraSettings
import app.rawboy.camera.CameraStatus
import app.rawboy.camera.CameraViewModel
import app.rawboy.camera.Edition
import app.rawboy.view.LicensesDialog
import app.rawboy.view.CompactSlider
import app.rawboy.view.HelpButton
import app.rawboy.view.LookDropdown
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Viewfinder with the look controls, shutter and the last photo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CameraScreen(
    vm: CameraViewModel,
    requestPermission: () -> Unit,
    requestLocation: () -> Unit,
    requestAudio: () -> Unit,
    openPhoto: (Uri) -> Unit,
    openQr: (QrPayload) -> Unit,
) {
    val status by vm.status.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val frame by vm.frame.collectAsStateWithLifecycle()
    val params by vm.shaderParams.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val merging by vm.merging.collectAsStateWithLifecycle()
    val selfTimerLeft by vm.selfTimerLeft.collectAsStateWithLifecycle()
    val longExposing by vm.longExposing.collectAsStateWithLifecycle()
    val longProgress by vm.longExposureProgress.collectAsStateWithLifecycle()
    val lastShot by vm.lastShot.collectAsStateWithLifecycle()
    val compare by vm.compare.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val lenses by vm.lenses.collectAsStateWithLifecycle()
    val frontAvailable by vm.frontAvailable.collectAsStateWithLifecycle()
    val focusPoint by vm.focusPoint.collectAsStateWithLifecycle()
    val zoom by vm.zoom.collectAsStateWithLifecycle()
    val dragPoint by vm.dragPoint.collectAsStateWithLifecycle()
    val tracking by vm.tracking.collectAsStateWithLifecycle()
    val focusSize by vm.controller.focusSize.collectAsStateWithLifecycle()
    val flashAvailable by vm.flashAvailable.collectAsStateWithLifecycle()
    val screenFlashCamera by vm.screenFlashCamera.collectAsStateWithLifecycle()
    val screenFlashLit by vm.screenFlashLit.collectAsStateWithLifecycle()
    val hiRes by vm.hiRes.collectAsStateWithLifecycle()
    val histogram by vm.histogram.collectAsStateWithLifecycle()
    val tilt by vm.tilt.collectAsStateWithLifecycle()
    val lowLight by vm.lowLight.collectAsStateWithLifecycle()
    val qrCode by vm.qrCode.collectAsStateWithLifecycle()
    val videoMode by vm.videoMode.collectAsStateWithLifecycle()
    val recordingMs by vm.recordingMs.collectAsStateWithLifecycle()
    val videoSink by vm.videoSink.collectAsStateWithLifecycle()
    // Only the AF state of the camera's per-frame metadata, so the screen doesn't recompose 30 times a second.
    val afState by remember(vm) { vm.controller.frames.map { it?.afState }.distinctUntilChanged() }
        .collectAsStateWithLifecycle(null)
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }
    val appName = remember { context.applicationInfo.loadLabel(context.packageManager).toString() }
    var showHelp by remember { mutableStateOf(false) }
    // Landscape: what the tall slider changes (S, B, W/F); Brightness first.
    var adjust by rememberSaveable { mutableStateOf(Adjust.BRIGHTNESS) }
    // Turned sideways the UI turns with the window, the viewfinder picture stays put on the glass.
    val displayRotation = rememberDisplayRotation()
    val turns = viewfinderTurns(displayRotation)
    // Video wants the microphone: asked when the mode is first switched on.
    LaunchedEffect(videoMode) { if (videoMode && !vm.hasAudioPermission()) requestAudio() }
    // The volume keys don't shoot while a sheet is open.
    LaunchedEffect(showSettings, showHelp) { vm.settingsOpen = showSettings || showHelp }

    // Shutter feedback: the viewfinder blinks dark, the shutter button dips, and a haptic tick.
    val blink = remember { Animatable(0f) }
    val shutterScale = remember { Animatable(1f) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(vm) {
        vm.shutterEvents.collect {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            launch {
                shutterScale.snapTo(0.85f)
                shutterScale.animateTo(1f, tween(220))
            }
            blink.snapTo(0f)
            blink.animateTo(0.85f, tween(60))
            blink.animateTo(0f, tween(160))
        }
    }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    // A Surface, so text and icons get the theme's light content colour on black.
    Surface(color = Color.Black, contentColor = Color.White) {
    Box(Modifier.fillMaxSize()) {
        ScreenFlashEffect(screenFlashLit)
        // Portrait: the bar, viewfinder, controls and shutter row stacked. Landscape (the phone turned sideways):
        // the bar's buttons in a column at the left, the viewfinder, then the S/B/W picker with one tall slider and
        // the shutter column at the right edge, all under the right thumb.
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout)),
        ) {
        val landscape = maxWidth > maxHeight
        val statusText = when {
            recordingMs != null -> "● " + formatRecordingTime(recordingMs ?: 0L)
            longExposing -> "Long exposure " + ((longProgress ?: 0f) * 100).toInt() + "% · tap to stop"
            selfTimerLeft != null -> "Timer · tap to cancel"
            merging -> "Merging frames…"
            pending > 0 -> "Saving $pending…"
            else -> ""
        }
        val barButtons = @Composable {
            if (!videoMode) {
                RawButton(settings.keepDng) { vm.setKeepDng(!settings.keepDng) }
                BurstButton(settings.burstMode, lowLight, hiRes, flashAvailable && settings.flash != FlashMode.OFF) { vm.setBurstMode(settings.burstMode.next()) }
                if (flashAvailable) FlashButton(settings.flash, screenFlashCamera, vm::cycleFlash)
            }
            HelpButton(appName, CAMERA_HELP, onOpenChange = { showHelp = it })
            IconButton(onClick = { showSettings = true }) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings")
            }
        }
        // Next to the shutter, under the thumb: the Photo / Video switch, with the experimental timer and long exposure beside it.
        val extras = @Composable {
            if (!videoMode && settings.experimental) {
                TimerButton(settings.selfTimer) { vm.cycleSelfTimer() }
                LongExposureButton(settings.longExposure, settings.longExposureLighten, hiRes) { vm.cycleLongExposure() }
            }
        }
        val lastPhoto = @Composable {
            Box(Modifier.size(56.dp)) {
                lastShot?.let { shot ->
                    Image(
                        shot.thumbnail.asImageBitmap(),
                        contentDescription = "Last photo",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { openPhoto(shot.uri) },
                    )
                }
            }
        }
        val shutterButton = @Composable {
            Shutter(
                enabled = status == CameraStatus.READY && (!merging || longExposing),
                video = videoMode,
                recording = recordingMs != null,
                onClick = vm::shutter,
                modifier = Modifier.graphicsLayer {
                    scaleX = shutterScale.value
                    scaleY = shutterScale.value
                },
            )
        }
        val switchButton = @Composable {
            Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                if (frontAvailable) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Color(0xFF2A2A2A))
                            .clickable(enabled = status != CameraStatus.OPENING) { vm.switchFacing() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            CameraSwitchIcon,
                            contentDescription = if (settings.front) "Back camera" else "Selfie camera",
                        )
                    }
                }
            }
        }
        // B&W mode lists only the mono stocks (Film on or not) and has Filter where Warmth is. Film mode lists the film stocks.
        val looks = when {
            settings.monoMode -> Edition.monoLooks
            settings.filmMode -> Edition.filmLooks
            else -> Edition.looks
        }
        // The Film and B&W toggles side by side in the label's place, each on or off by itself; B&W wins while on.
        val lookRow = @Composable { toggleWidth: Dp ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.width(toggleWidth), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilmToggle(settings.film, vm::setFilm)
                    if (Edition.monoLooks.isNotEmpty()) MonoToggle(settings.monoMode, vm::setMono)
                }
                LookDropdown(
                    label = "",
                    looks = looks,
                    selected = looks.firstOrNull { it.id == settings.look.id },
                    onSelect = { vm.setLook(it.id) },
                    labelWidth = 0.dp,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        CameraLayout(
            landscape = landscape,
            controlsWidth = LANDSCAPE_CONTROLS_WIDTH,
            bar = {
                if (landscape) {
                    Column(
                        Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.SpaceEvenly,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) { barButtons() }
                } else {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            statusText,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .weight(1f)
                                .padding(start = 12.dp),
                        )
                        barButtons()
                    }
                }
            },
            viewfinder = {
                // Viewfinder, at the raw's aspect ratio, in whatever height the controls leave.
                val f = frame
                val uprightAspect = f?.let { it.fullWidth.toFloat() / it.fullHeight } ?: (3f / 4f)
                var viewSize by remember { mutableStateOf(IntSize.Zero) }
                val density = LocalDensity.current
                // While the focus ring is dragged it shows there, with a loupe; it focuses on release.
                val shownFocus = dragPoint ?: focusPoint
                val loupe = dragPoint?.let { (x, y) ->
                    with(density) { loupeAt(x, y, viewSize, LOUPE_SIZE.toPx(), LOUPE_GAP.toPx()) }
                }
                Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                Box(
                    Modifier
                        .aspectRatio(uprightAspect.let { if (turns % 2 == 1) 1f / it else it })
                        .background(Color(0xFF0A0A0A)),
                    contentAlignment = Alignment.Center,
                ) {
                    Viewfinder(
                        f, params, vm::onSurfaceTexture, vm::onViewfinderBase, Modifier.fillMaxSize(), loupe,
                        onLuma = if (settings.scanQr) vm::onViewfinderLuma else null,
                        // Only while a tap's focus may be tracked: the copies cost nothing otherwise.
                        onTrackLuma = if (settings.trackFocus && focusPoint != null) vm::onTrackLuma else null,
                        turns = turns,
                        zoom = zoom,

                        videoSink = videoSink,
                        videoMode = videoMode,
                    )
                    // The self-timer's countdown, big and upright over the picture.
                    selfTimerLeft?.let { left ->
                        Text(
                            left.toString(),
                            style = MaterialTheme.typography.displayLarge.copy(fontSize = 120.sp, fontWeight = FontWeight.Light),
                            color = Color.White.copy(alpha = 0.9f),
                        )
                    }
                    // A long exposure's progress along the bottom of the picture.
                    if (longExposing) {
                        LinearProgressIndicator(
                            progress = { longProgress ?: 0f },
                            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp),
                        )
                    }
                    // Video is a 16:9 (or 9:16) slice of the 4:3 viewfinder: shade what the file will not have.
                    if (videoMode) VideoFrameMask(if (turns % 2 == 1) 16f / 9f else 9f / 16f)
                    // Taps, the focus handle, ring and loupe work in the upright picture's coordinates, turned with it.
                    Box(
                        Modifier
                            .matchParentSize()
                            .turned(turns)
                            .onSizeChanged { viewSize = it },
                    ) {
                        Box(
                            Modifier
                                .matchParentSize()
                                // Pinch: two fingers zoom (the tap and hold below only see a single finger).
                                .pointerInput(Unit) {
                                    awaitEachGesture {
                                        awaitFirstDown(requireUnconsumed = false)
                                        do {
                                            val event = awaitPointerEvent()
                                            if (event.changes.count { it.pressed } >= 2) {
                                                val change = event.calculateZoom()
                                                if (change != 1f) vm.setZoom(vm.zoom.value * change)
                                                event.changes.forEach { it.consume() }
                                            }
                                        } while (event.changes.any { it.pressed })
                                    }
                                }
                                .pointerInput(Unit) {
                                    detectTapGestures(
                                        // Tap: focus lock at that point (a new tap moves it; the AF LOCK badge releases it).
                                        onTap = { vm.focusAt(it.x / size.width, it.y / size.height) },
                                        onLongPress = {}, // a hold compares (onPress); it mustn't also focus on release
                                        onPress = {
                                            // Press and hold: the auto develop without the look.
                                            val hold = scope.launch {
                                                delay(COMPARE_DELAY_MS)
                                                vm.setCompare(true)
                                            }
                                            tryAwaitRelease()
                                            hold.cancel()
                                            if (vm.compare.value) vm.setCompare(false)
                                        },
                                    )
                                },
                        )
                        // Over the tap area, under the lens selector and the AF LOCK badge.
                        shownFocus?.let { (x, y) -> FocusHandle(x, y, viewSize, vm::focusAt, vm::dragFocus, vm::endDragFocus) }
                    }
                    when (status) {
                        CameraStatus.NEEDS_PERMISSION -> Button(onClick = requestPermission) { Text("Allow camera") }
                        CameraStatus.OPENING -> CircularProgressIndicator()
                        CameraStatus.FAILED -> Text("Camera unavailable", color = MaterialTheme.colorScheme.error)
                        CameraStatus.READY -> if (params == null) CircularProgressIndicator()
                    }
                    // Landscape has them beside the S/B/W buttons, under the thumb.
                    if (lenses.size > 1 && !landscape) {
                        LensSelector(
                            labels = lenses.map { it.label },
                            selected = settings.lens,
                            onSelect = vm::selectLens,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(bottom = 16.dp),
                        )
                    }
                    // A narrow column in the bottom right corner, beside the lens selector.
                    if (settings.showZoomControl) {
                        ZoomControl(
                            zoom = zoom,
                            onZoom = vm::setZoom,
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(end = 8.dp, bottom = 16.dp),
                        )
                    }
                    // Above the lens selector, out of the way of the focus ring and the top badges.
                    qrCode?.let { code ->
                        QrChip(
                            code,
                            onOpen = { openQr(code) },
                            onDismiss = vm::dismissQr,
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(start = 16.dp, end = 16.dp, bottom = if (lenses.size > 1 && !landscape) 84.dp else 16.dp),
                        )
                    }
                    Box(Modifier.matchParentSize().turned(turns)) {
                        shownFocus?.let { (x, y) -> FocusRing(x, y, if (dragPoint != null) null else afState, focusSize) }
                        loupe?.let { LoupeFrame(it, focusSize) }
                    }
                    // Top left, stacked: the histogram has the top right, and the chips are wider than they look.
                    Column(
                        Modifier.align(Alignment.TopStart).padding(start = 8.dp, top = 4.dp),
                        horizontalAlignment = Alignment.Start,
                    ) {
                        if (focusPoint != null) {
                            Text(
                                if (tracking) "TRACKING  ✕" else "AF LOCK  ✕",
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                color = Color.Black,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(Color(0xFFFFD54F))
                                    .clickable { vm.releaseFocus() }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                        if (videoMode) {
                            val aeLocked by vm.exposureLocked.collectAsStateWithLifecycle()
                            Text(
                                if (aeLocked) "AE LOCK  ✕" else "AE LOCK",
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                color = if (aeLocked) Color.Black else Color.White,
                                modifier = Modifier
                                    .padding(top = if (focusPoint != null) 6.dp else 0.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(if (aeLocked) Color(0xFFFFD54F) else Color(0x66000000))
                                    .clickable { vm.setExposureLock(!aeLocked) }
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                    if (settings.showGrid) GridOverlay(Modifier.matchParentSize())
                    if (settings.showLevel) LevelOverlay(tilt, Modifier.matchParentSize())
                    // Shutter blink over the viewfinder.
                    if (blink.value > 0f) {
                        Box(
                            Modifier
                                .matchParentSize()
                                .background(Color.Black.copy(alpha = blink.value)),
                        )
                    }
                    // Top right; the lock chips stack at the top left.
                    if (settings.showHistogram && params != null) {
                        HistogramView(
                            histogram,
                            Modifier
                                .align(Alignment.TopEnd)
                                .padding(8.dp)
                                .size(width = 120.dp, height = 48.dp),
                            background = Color(0x99000000),
                        )
                    }
                    if (compare) {
                        Text(
                            "Without look",
                            style = MaterialTheme.typography.labelMedium,
                            modifier = Modifier
                                .align(Alignment.BottomStart)
                                .padding(12.dp)
                                .background(Color(0x99000000))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                }
                }
            },
            controls = {
                if (landscape) {
                    LandscapeControls(
                        settings = settings,
                        status = statusText,
                        adjust = adjust,
                        onAdjust = { adjust = it },
                        lensColumn = if (lenses.size > 1) {
                            {
                                LensSelector(
                                    labels = lenses.map { it.label },
                                    selected = settings.lens,
                                    onSelect = vm::selectLens,
                                    modifier = Modifier,
                                    vertical = true,
                                )
                            }
                        } else {
                            null
                        },
                        // The stock menu across the column, the Film and B&W buttons under it.
                        lookRow = {
                            Column(horizontalAlignment = Alignment.End) {
                                LookDropdown(
                                    label = "",
                                    looks = looks,
                                    selected = looks.firstOrNull { it.id == settings.look.id },
                                    onSelect = { vm.setLook(it.id) },
                                    labelWidth = 0.dp,
                                    alignEnd = true,
                                )
                                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    FilmToggle(settings.film, vm::setFilm)
                                    if (Edition.monoLooks.isNotEmpty()) MonoToggle(settings.monoMode, vm::setMono)
                                }
                            }
                        },
                        vm = vm,
                    )
                } else {
                    // A menu instead of a strip of chips, and one thin row per slider: the viewfinder keeps the screen.
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp)) {
                        lookRow(88.dp)
                        LookSlider("Brightness", settings.brightness, -100f..100f, 0f, vm::setBrightness)
                        if (settings.monoMode) {
                            FilterRow(settings.filter, vm::setFilter)
                        } else {
                            LookSlider("Warmth", settings.warmth, -100f..100f, 0f, vm::setWarmth)
                        }
                    }
                }
            },
            shutter = {
                if (landscape) {
                    // The switch above, the shutter at the middle of the edge, the last photo below.
                    Column(
                        Modifier.padding(start = 8.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.SpaceEvenly,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        extras()
                        ModeSwitch(videoMode, enabled = recordingMs == null, vertical = true) { vm.setVideoMode(it) }
                        switchButton()
                        shutterButton()
                        lastPhoto()
                    }
                } else {
                    // Swiping sideways anywhere on the shutter area switches too: left for video, right back to photo.
                    Column(
                        Modifier.pointerInput(recordingMs == null) {
                            if (recordingMs != null) return@pointerInput
                            var drag = 0f
                            detectHorizontalDragGestures(
                                onDragStart = { drag = 0f },
                                onDragEnd = {
                                    if (drag < -48.dp.toPx()) vm.setVideoMode(true) else if (drag > 48.dp.toPx()) vm.setVideoMode(false)
                                },
                                onHorizontalDrag = { _, d -> drag += d },
                            )
                        },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                                if (!videoMode && settings.experimental) TimerButton(settings.selfTimer) { vm.cycleSelfTimer() }
                            }
                            ModeSwitch(videoMode, enabled = recordingMs == null) { vm.setVideoMode(it) }
                            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                                if (!videoMode && settings.experimental) {
                                    LongExposureButton(settings.longExposure, settings.longExposureLighten, hiRes) { vm.cycleLongExposure() }
                                }
                            }
                        }
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            lastPhoto()
                            Spacer(Modifier.weight(1f))
                            shutterButton()
                            Spacer(Modifier.weight(1f))
                            switchButton()
                        }
                    }
                }
            },
        )
        }
        // Screen flash (selfie camera): the lit frame over the whole screen, under the snackbar.
        if (screenFlashLit) ScreenFlashFrame(Modifier.matchParentSize())
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }) {
            SettingsContent(settings, vm, requestLocation)
        }
    }
}

/**
 * A QR code the viewfinder sees, as Google Camera shows it: what it holds and what a tap does ("example.com  Open"),
 * with ✕ to hide it until the code leaves the view.
 */
@Composable
private fun QrChip(code: QrPayload, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier) {
    Row(
        modifier
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(Color(0xCC000000))
            .clickable(onClick = onOpen)
            .padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(QrCodeIcon, contentDescription = "QR code", modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            code.label,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(10.dp))
        Text(code.verb, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        Box(
            Modifier
                .size(44.dp)
                .clickable(onClick = onDismiss)
                .semantics { contentDescription = "Hide QR code" },
            contentAlignment = Alignment.Center,
        ) {
            Text("✕", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.7f))
        }
    }
}

/**
 * Digital zoom 1-10x for seeing something far away, as one narrow column: + on top, the zoom in the middle (a tap goes
 * to the next of 1x, 2x, 5x, 10x, then back to 1x), − below; 48 dp touch targets, holding + or − zooms smoothly.
 * Pinching the viewfinder zooms too.
 */
@Composable
private fun ZoomControl(zoom: Float, onZoom: (Float) -> Unit, modifier: Modifier = Modifier) {
    val current = rememberUpdatedState(zoom)
    val setZoom = rememberUpdatedState(onZoom)
    val label = zoomLabel(zoom)
    val next = ZOOM_PRESETS.firstOrNull { it > zoom + 0.05f } ?: ZOOM_PRESETS.first()
    Column(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color(0x99000000)).padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        ZoomStepButton("+", "Zoom in", 1, current, setZoom)
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(if (zoom > 1.05f) Color(0xFFD0D0D0) else Color.Transparent)
                .clickable(role = Role.Button, onClickLabel = "Zoom ${zoomLabel(next)} times") { onZoom(next) }
                .semantics { contentDescription = "Zoom $label times"; stateDescription = "$label times" },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label + "×",
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                color = if (zoom > 1.05f) Color.Black else Color.White,
                maxLines = 1,
            )
        }
        ZoomStepButton("−", "Zoom out", -1, current, setZoom)
    }
}

/** − or +: a tap zooms by [ZOOM_TAP_FACTOR], holding keeps zooming smoothly. */
@Composable
private fun ZoomStepButton(
    text: String,
    description: String,
    direction: Int,
    current: State<Float>,
    onZoom: State<(Float) -> Unit>,
) {
    Box(
        Modifier
            .size(48.dp)
            .clip(CircleShape)
            .pointerInput(direction) {
                detectTapGestures(
                    onPress = {
                        val factor = if (direction > 0) ZOOM_TAP_FACTOR else 1f / ZOOM_TAP_FACTOR
                        onZoom.value(current.value * factor)
                        coroutineScope {
                            val hold = launch {
                                delay(ZOOM_HOLD_DELAY_MS)
                                while (true) {
                                    onZoom.value(current.value * if (direction > 0) ZOOM_HOLD_FACTOR else 1f / ZOOM_HOLD_FACTOR)
                                    delay(ZOOM_HOLD_TICK_MS)
                                }
                            }
                            tryAwaitRelease()
                            hold.cancel()
                        }
                    },
                )
            }
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = description
                onClick(label = description) { onZoom.value(current.value * if (direction > 0) ZOOM_TAP_FACTOR else 1f / ZOOM_TAP_FACTOR); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.titleLarge, color = Color.White)
    }
}

/** "1", "2.5", "10": one decimal below 10x. */
private fun zoomLabel(zoom: Float): String =
    if (zoom >= 9.95f) "10" else String.format(java.util.Locale.US, "%.1f", zoom).removeSuffix(".0")

private val ZOOM_PRESETS = listOf(1f, 2f, 5f, 10f)
private const val ZOOM_TAP_FACTOR = 1.25f
private const val ZOOM_HOLD_FACTOR = 1.04f
private const val ZOOM_HOLD_DELAY_MS = 300L
private const val ZOOM_HOLD_TICK_MS = 30L

/** UW · W · T, as Google Camera shows them: the selected lens in a filled circle. */
@Composable
private fun LensSelector(
    labels: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier,
    vertical: Boolean = false,
) {
    val buttons = @Composable {
        // Upright: the longest lens at the top, as zooming in goes up.
        for (label in if (vertical) labels.asReversed() else labels) {
            val isSelected = label == selected
            Box(
                Modifier
                    .size(if (vertical) 44.dp else 48.dp)
                    .clip(CircleShape)
                    .background(if (isSelected) Color(0xFFD0D0D0) else Color.Transparent)
                    .clickable(role = Role.Button) { onSelect(label) }
                    .semantics { this.selected = isSelected },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.titleSmall,
                    color = if (isSelected) Color.Black else Color.White,
                )
            }
        }
    }
    val shape = modifier
        .clip(RoundedCornerShape(28.dp))
        .background(if (vertical) Color(0xFF1C1C1C) else Color(0x99000000))
        .padding(4.dp)
    if (vertical) {
        Column(shape, verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.CenterHorizontally) { buttons() }
    } else {
        Row(shape, horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) { buttons() }
    }
}

/**
 * Focus lock ring at ([x], [y]) of the viewfinder (normalised): pulsing while focusing, white once
 * focus is locked, red when the camera couldn't find focus there. The ring is about the metered spot; the square
 * inside it is the AF box ([focusSize] of the short side); a dot once AF falls back to the ring's area.
 */
@Composable
private fun BoxScope.FocusRing(x: Float, y: Float, afState: Int?, focusSize: Float) {
    val scanning = afState == CameraMetadata.CONTROL_AF_STATE_ACTIVE_SCAN || afState == CameraMetadata.CONTROL_AF_STATE_PASSIVE_SCAN
    val pulse by rememberInfiniteTransition(label = "focus").animateFloat(
        initialValue = 0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(350), RepeatMode.Reverse),
        label = "focus pulse",
    )
    // The small box's miss isn't shown: CameraController retries with the spot first.
    val failed = afState == CameraMetadata.CONTROL_AF_STATE_NOT_FOCUSED_LOCKED && focusSize >= MeterArea.SPOT_SIZE
    val color = if (failed) Color(0xFFFF5252) else Color.White
    val ringSize = 72.dp
    Canvas(
        Modifier
            .matchParentSize()
            .graphicsLayer { alpha = if (scanning) pulse else 1f },
    ) {
        val radius = ringSize.toPx() / 2
        val center = Offset(x * size.width, y * size.height)
        drawCircle(color, radius, center, style = Stroke(width = 2.dp.toPx()))
        if (focusSize < MeterArea.SPOT_SIZE) {
            val box = focusSize * min(size.width, size.height)
            drawRect(color, center - Offset(box / 2, box / 2), Size(box, box), style = Stroke(width = 1.5.dp.toPx()))
        } else {
            drawCircle(color, 3.dp.toPx(), center) // AF uses the ring's area
        }
    }
}

/**
 * Where the focus ring can be grabbed, around ([x], [y]) of a [view]-sized viewfinder (normalised): a drag moves the
 * point ([onDrag], then [onDragEnd] focuses there), a tap focuses at the tap as anywhere else ([onTap]). It sits above
 * the viewfinder's own gestures, so a drag here doesn't also start the press-and-hold comparison.
 */
@Composable
private fun BoxScope.FocusHandle(
    x: Float,
    y: Float,
    view: IntSize,
    onTap: (Float, Float) -> Unit,
    onDrag: (Float, Float) -> Unit,
    onDragEnd: () -> Unit,
) {
    // The gesture code outlives recompositions: it reads the latest point and size.
    val point by rememberUpdatedState(x to y)
    val viewNow by rememberUpdatedState(view)
    val half = with(LocalDensity.current) { FOCUS_HANDLE_SIZE.toPx() / 2 }
    if (view.width == 0 || view.height == 0) return
    Box(
        Modifier
            .align(Alignment.TopStart)
            .offset { IntOffset((x * view.width - half).roundToInt(), (y * view.height - half).roundToInt()) }
            .size(FOCUS_HANDLE_SIZE)
            .pointerInput(Unit) {
                // Summed from the drag's start: several moves can come before the point recomposes.
                var start = point
                var moved = Offset.Zero
                detectDragGestures(
                    onDragStart = {
                        start = point
                        moved = Offset.Zero
                    },
                    onDragEnd = onDragEnd,
                    onDragCancel = onDragEnd,
                ) { change, amount ->
                    change.consume()
                    moved += amount
                    onDrag(start.first + moved.x / viewNow.width, start.second + moved.y / viewNow.height)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures { o ->
                    val (px, py) = point
                    onTap(px + (o.x - half) / viewNow.width, py + (o.y - half) / viewNow.height)
                }
            },
    )
}

/** The loupe's frame (the renderer draws the image inside it), with the AF box magnified at its centre. */
@Composable
private fun BoxScope.LoupeFrame(l: ViewfinderRenderer.Loupe, focusSize: Float) {
    Canvas(Modifier.matchParentSize()) {
        val side = l.size * size.width
        val center = Offset(l.centerX * size.width, l.centerY * size.height)
        drawRect(Color.White, center - Offset(side / 2, side / 2), Size(side, side), style = Stroke(width = 2.dp.toPx()))
        val box = focusSize * min(size.width, size.height) * l.zoom
        drawRect(Color.White, center - Offset(box / 2, box / 2), Size(box, box), style = Stroke(width = 1.dp.toPx()))
    }
}

/**
 * The loupe for a drag at ([x], [y]) of a [view]-sized viewfinder: a [side] px square [gap] px above the point (under
 * the finger otherwise), or below it near the top, kept inside the view.
 */
private fun loupeAt(x: Float, y: Float, view: IntSize, side: Float, gap: Float): ViewfinderRenderer.Loupe? {
    if (view.width == 0 || view.height == 0) return null
    val w = view.width.toFloat()
    val h = view.height.toFloat()
    val s = min(side, min(w, h))
    val above = y * h - gap - s / 2
    val cy = if (above >= s / 2) above else y * h + gap + s / 2
    val cx = (x * w).coerceIn(s / 2, w - s / 2)
    return ViewfinderRenderer.Loupe(x, y, cx / w, cy.coerceIn(s / 2, h - s / 2) / h, s / w, LOUPE_ZOOM)
}

@Composable
private fun Shutter(enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, video: Boolean = false, recording: Boolean = false) {
    val ring = if (enabled) Color.White else Color.Gray
    // Video: a red dot, which becomes a red square while recording.
    val fill = if (!video) ring else if (enabled) Color(0xFFE53935) else Color.Gray
    val shape = if (recording) RoundedCornerShape(8.dp) else CircleShape
    Box(
        modifier
            .size(76.dp)
            .border(BorderStroke(4.dp, ring), CircleShape)
            .padding(if (recording) 20.dp else 8.dp)
            .clip(shape)
            .background(fill)
            .clickable(
                enabled = enabled,
                onClickLabel = if (!video) "Take a photo" else if (recording) "Stop recording" else "Start recording",
                role = Role.Button,
                onClick = onClick,
            )
            .semantics { contentDescription = if (video) "Record" else "Shutter" },
    )
}

/** Dims the parts of the viewfinder outside the video's [target] aspect (width / height as the window shows it). */
@Composable
private fun VideoFrameMask(target: Float) {
    androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
        val shade = Color.Black.copy(alpha = 0.55f)
        val a = size.width / size.height
        if (a > target) {
            val bar = (size.width - size.height * target) / 2f
            drawRect(shade, androidx.compose.ui.geometry.Offset.Zero, androidx.compose.ui.geometry.Size(bar, size.height))
            drawRect(shade, androidx.compose.ui.geometry.Offset(size.width - bar, 0f), androidx.compose.ui.geometry.Size(bar, size.height))
        } else {
            val bar = (size.height - size.width / target) / 2f
            drawRect(shade, androidx.compose.ui.geometry.Offset.Zero, androidx.compose.ui.geometry.Size(size.width, bar))
            drawRect(shade, androidx.compose.ui.geometry.Offset(0f, size.height - bar), androidx.compose.ui.geometry.Size(size.width, bar))
        }
    }
}

/**
 * Photo / Video pill under the viewfinder, by the shutter (as Google Camera has it): the active side is filled. Vertical in
 * landscape, where the shutter has its own column. Locked while recording.
 */
@Composable
private fun ModeSwitch(video: Boolean, enabled: Boolean, vertical: Boolean = false, onSelect: (Boolean) -> Unit) {
    val item = @Composable { label: String, selected: Boolean, target: Boolean ->
        Text(
            label,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp),
            color = if (selected) Color.Black else Color.White.copy(alpha = if (enabled) 0.8f else 0.4f),
            modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                .clickable(enabled = enabled && !selected) { onSelect(target) }
                .semantics { stateDescription = if (selected) "Selected" else "Not selected" }
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
    val shape = RoundedCornerShape(20.dp)
    val mod = Modifier.clip(shape).background(Color(0xFF2A2A2A)).padding(3.dp)
    if (vertical) {
        Column(mod, horizontalAlignment = Alignment.CenterHorizontally) { item("PHOTO", !video, false); item("VIDEO", video, true) }
    } else {
        Row(mod) { item("PHOTO", !video, false); item("VIDEO", video, true) }
    }
}

private fun formatRecordingTime(ms: Long): String {
    val total = ms / 1000
    return "%02d:%02d".format(total / 60, total % 60)
}

/**
 * Colour / black and white switch: "B&W", filled while B&W mode is on. B&W mode keeps its own stock and filter, and
 * colour mode its look and warmth, so the two can be swapped back and forth.
 */
@Composable
private fun MonoToggle(on: Boolean, onChange: (Boolean) -> Unit) {
    Box(
        Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) Color.White else Color(0xFF2A2A2A))
            // A switch for TalkBack (checkable, on/off), named on the node that takes the tap.
            .semantics { contentDescription = "Black and white" }
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange),
        contentAlignment = Alignment.Center,
    ) {
        Text("B&W", style = MaterialTheme.typography.labelMedium, color = if (on) Color.Black else Color.White)
    }
}

/**
 * The Film toggle (a film strip, filled while Film mode is on): the film stocks or the LUT looks. Each mode keeps its own
 * pick, so the two can be swapped back and forth. It sits next to B&W, left of the Look menu; turning it on in B&W mode
 * leaves B&W.
 */
@Composable
private fun FilmToggle(on: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) Color.White else Color(0xFF2A2A2A))
            // A switch for TalkBack (checkable, on/off), named on the node that takes the tap.
            .semantics { contentDescription = "Film stocks" }
            .toggleable(value = on, role = Role.Switch, onValueChange = onChange),
        contentAlignment = Alignment.Center,
    ) {
        Icon(FilmIcon, contentDescription = null, tint = if (on) Color.Black else Color.White, modifier = Modifier.size(22.dp))
    }
}

/**
 * B&W mode's colour filter, upright: a menu like the Look pill above it (the chips ran off the edge on 360-411 dp
 * phones). The pill and each item show a dot of the filter's colour before its name. Turned sideways, [FilterColumn]
 * shows them all.
 */
@Composable
private fun FilterRow(selected: BwFilter, onSelect: (BwFilter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.height(36.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Filter", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(88.dp))
        Box {
            OutlinedButton(
                onClick = { open = true },
                contentPadding = PaddingValues(start = 16.dp, end = 8.dp),
                modifier = Modifier
                    .heightIn(min = 32.dp)
                    .semantics { contentDescription = "Filter, ${selected.label}" },
            ) {
                FilterDot(selected)
                Text(selected.label)
                Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                for (f in BwFilter.entries) {
                    val isSelected = f == selected
                    DropdownMenuItem(
                        leadingIcon = { FilterDot(f, Modifier.padding(start = 4.dp)) },
                        text = {
                            Text(
                                f.label,
                                fontWeight = if (isSelected) FontWeight.Bold else null,
                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            )
                        },
                        onClick = {
                            open = false
                            onSelect(f)
                        },
                        modifier = Modifier.semantics { this.selected = isSelected },
                    )
                }
            }
        }
    }
}

/** The filter's colour as a small dot (an empty space of the same size for None, so names line up in the menu). */
@Composable
private fun FilterDot(f: BwFilter, modifier: Modifier = Modifier) {
    val dot = FILTER_COLORS[f]
    Box(
        modifier
            .padding(end = 8.dp)
            .size(8.dp)
            .then(if (dot != null) Modifier.clip(CircleShape).background(dot) else Modifier),
    )
}

private val FILTER_COLORS = mapOf(
    BwFilter.YELLOW to Color(0xFFE8C400),
    BwFilter.ORANGE to Color(0xFFF08A00),
    BwFilter.RED to Color(0xFFD22222),
    BwFilter.GREEN to Color(0xFF22AA22),
)

/** Slider with its value; double-tap the slider or tap the value to reset. */
@Composable
private fun LookSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    default: Float,
    onChange: (Float) -> Unit,
) = CompactSlider(label, value, range, default, rowHeight = 36.dp, labelWidth = 88.dp, valueWidth = 44.dp, onChange = onChange)

@Composable
private fun SettingsContent(settings: CameraSettings, vm: CameraViewModel, requestLocation: () -> Unit) {
    val maxResMp by vm.maxResMp.collectAsState()
    Column(
        Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.titleMedium)

        SettingsSection("Photo", first = true)
        // One row each; double-tap a slider to reset it.
        CompactSlider(
            "JPEG quality", settings.jpegQuality.toFloat(), CameraSettings.MIN_QUALITY.toFloat()..100f, 95f,
            rowHeight = 40.dp, labelWidth = 104.dp, valueWidth = 44.dp,
            format = { it.roundToInt().toString() },
            onChange = { vm.setJpegQuality(it.roundToInt()) },
        )
        CompactSlider(
            "Look strength", settings.strength, 0f..100f, LookApplier.DEFAULT_STRENGTH,
            rowHeight = 40.dp, labelWidth = 104.dp, valueWidth = 44.dp,
            format = { it.roundToInt().toString() },
            onChange = { vm.setStrength(it.roundToInt().toFloat()) },
        )
        SettingSwitch(
            title = "Smaller photos",
            subtitle = "${CameraSettings.SMALL_LONG_SIDE} px long side; off saves full size",
            checked = settings.smallExport,
            onChange = vm::setSmallExport,
        )
        if (maxResMp > 0) {
            SettingSwitch(
                title = "$maxResMp MP",
                subtitle = "Full sensor size: slower, no merging, viewfinder pauses",
                checked = settings.maxRes,
                onChange = vm::setMaxRes,
            )
        }
        SettingSwitch(
            title = "Keep raw (DNG)",
            subtitle = "Saved to Pictures/${Edition.FOLDER}/RAW",
            checked = settings.keepDng,
            onChange = vm::setKeepDng,
        )
        if (settings.keepDng) {
            SettingSwitch(
                title = "Lossy JPEG XL DNG",
                subtitle = "Much smaller, visually lossless; saving takes longer",
                checked = settings.lossyDng,
                onChange = vm::setLossyDng,
                indent = true,
            )
        }
        SettingSwitch(
            title = "HDR gain map",
            subtitle = "Ultra HDR JPEGs with extra highlight range",
            checked = settings.hdrGainMap,
            onChange = vm::setHdrGainMap,
        )

        SettingsSection("Capture")
        SettingChoice(
            title = "Merge ${CameraSettings.BURST_FRAMES} frames",
            subtitle = "Less noise; hold still. Auto: low light only. Not with flash",
            options = listOf(BurstMode.ON, BurstMode.AUTO, BurstMode.OFF),
            selected = settings.burstMode,
            label = { it.name.lowercase().replaceFirstChar { c -> c.uppercase() } },
            onSelect = vm::setBurstMode,
        )
        // Where the law requires the click, Android plays it anyway: shown on and locked.
        SettingSwitch(
            title = "Shutter sound",
            subtitle = if (vm.shutterSoundRequired) "Required by law in this region" else null,
            checked = settings.shutterSound || vm.shutterSoundRequired,
            enabled = !vm.shutterSoundRequired,
            onChange = vm::setShutterSound,
        )
        SettingSwitch(
            title = "Geotag",
            subtitle = "GPS position in the JPEG and DNG",
            checked = settings.geotag,
            onChange = { on -> if (on && !vm.hasLocationPermission) requestLocation() else vm.setGeotag(on) },
        )
        SettingSwitch(
            title = "Track subject after tap",
            subtitle = "Focus follows what you tapped",
            checked = settings.trackFocus,
            onChange = vm::setTrackFocus,
        )
        SettingSwitch(
            title = "QR codes",
            subtitle = "Tap to open a link, join Wi-Fi or copy",
            checked = settings.scanQr,
            onChange = vm::setScanQr,
        )

        SettingsSection("Video")
        SettingSwitch(
            title = "Flat video for grading",
            subtitle = "No look: Apple Log, to grade on the web video page",
            checked = settings.flatVideo,
            onChange = vm::setFlatVideo,
        )
        SettingSwitch(
            title = "Optical stabilization",
            subtitle = "The lens's own; no crop, gentler than software",
            checked = settings.videoStabilization,
            onChange = vm::setVideoStabilization,
        )

        SettingsSection("Viewfinder")
        SettingSwitch("Zoom buttons", null, settings.showZoomControl, onChange = vm::setShowZoomControl)
        SettingSwitch("Grid", null, settings.showGrid, onChange = vm::setShowGrid)
        SettingSwitch("Level", null, settings.showLevel, onChange = vm::setShowLevel)
        SettingSwitch("Histogram", null, settings.showHistogram, onChange = vm::setShowHistogram)

        SettingsSection("Opening the camera")
        DefaultCameraChoice(
            MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA,
            title = "Unlocked camera",
            whenSet = "Power button double press opens RawBoy Camera",
            whenNotSet = "Choose RawBoy Camera, then Always",
        )
        DefaultCameraChoice(
            MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA_SECURE,
            title = "Lock screen camera",
            whenSet = "Works on a locked phone",
            whenNotSet = "Choose RawBoy Camera, then Always",
        )
        SettingSwitch(
            title = "Remember camera & settings",
            subtitle = "Off: each start uses W, Yellow Portrait 400, default sliders",
            checked = settings.rememberLast,
            onChange = vm::setRememberLast,
        )

        // Experimental sits last: its extra controls open below the switch.
        SettingsSection("Experimental")
        SettingSwitch(
            title = "Self-timer and long exposure",
            subtitle = "Two buttons beside the Photo / Video switch",
            checked = settings.experimental,
            accent = EXPERIMENTAL_ORANGE,
            onChange = vm::setExperimental,
        )
        if (settings.experimental) {
            SettingChoice(
                title = "Long exposure stacks as",
                subtitle = "5 to 60 s; use a tripod; not with flash or full sensor size. Timer: 2, 5 or 10 s",
                options = listOf(false, true),
                selected = settings.longExposureLighten,
                label = { if (it) "Lighten (trails)" else "Average (water)" },
                onSelect = vm::setLongExposureLighten,
                indent = true,
            )
        }

        Spacer(Modifier.height(16.dp))
        for (line in Edition.credits) {
            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
        }
        var showLicences by remember { mutableStateOf(false) }
        TextButton(onClick = { showLicences = true }, contentPadding = PaddingValues(0.dp)) { Text("Open-source licences") }
        if (showLicences) LicensesDialog(onDismiss = { showLicences = false })
    }
}

/** A group heading in Settings: amber, small, with room above to separate it from the group before. */
@Composable
private fun SettingsSection(title: String, first: Boolean = false) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = if (first) 12.dp else 24.dp, bottom = 4.dp),
    )
}

/** A row with a title, an optional one-line hint and a segmented choice under them. */
@Composable
private fun <T> SettingChoice(
    title: String,
    subtitle: String?,
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    indent: Boolean = false,
) {
    Column(Modifier.padding(start = if (indent) 16.dp else 0.dp, top = 8.dp, bottom = 8.dp)) {
        Text(title, style = MaterialTheme.typography.bodyMedium)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(
            Modifier
                .padding(top = 8.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        ) {
            for (o in options) {
                val on = o == selected
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 40.dp)
                        .padding(2.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (on) MaterialTheme.colorScheme.primary else Color.Transparent)
                        .clickable { onSelect(o) }
                        .semantics { stateDescription = if (on) "Selected" else "Not selected" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label(o),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/** Keep the DNG next to the JPEG (the same setting as in Settings): "RAW" lit when on, dimmed and struck through when off. */
@Composable
private fun RawButton(keep: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.semantics { stateDescription = if (keep) "On" else "Off" }) {
        Text(
            "RAW",
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = FontWeight.Bold,
                textDecoration = if (keep) null else TextDecoration.LineThrough,
            ),
            color = if (keep) MaterialTheme.colorScheme.primary else LocalContentColor.current.copy(alpha = 0.6f),
            modifier = Modifier.semantics { contentDescription = "Keep RAW (DNG)" },
        )
    }
}

/**
 * Merge 8 frames, cycling On -> Auto -> Off (the same setting as in Settings). Coloured while it will merge the next
 * shot (On, or Auto in low light; never with the flash or at full sensor resolution), gray otherwise; Auto carries a
 * small "A".
 */
@Composable
private fun BurstButton(mode: BurstMode, lowLight: Boolean, hiRes: Boolean, flash: Boolean, onClick: () -> Unit) {
    val active = !hiRes && !flash && mode.merges(lowLight)
    val state = when {
        hiRes -> "Inactive (full sensor resolution)"
        flash -> "Inactive (flash)"
        mode == BurstMode.ON -> "On"
        mode == BurstMode.AUTO -> if (active) "Auto, merging (low light)" else "Auto, not merging (enough light)"
        else -> "Off"
    }
    val tint = if (active) MaterialTheme.colorScheme.primary else LocalContentColor.current.copy(alpha = 0.6f)
    IconButton(onClick = onClick, modifier = Modifier.semantics { stateDescription = state }) {
        Box {
            Icon(BurstIcon, contentDescription = "Merge 8 frames", tint = tint)
            if (mode == BurstMode.AUTO) {
                Text(
                    "A",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold),
                    color = tint,
                    modifier = Modifier.align(Alignment.BottomEnd).offset(x = 5.dp, y = 2.dp),
                )
            }
        }
    }
}

/** Self-timer (Experimental), cycling Off, 2, 5, 10 s: the seconds in a badge when set. */
@Composable
private fun TimerButton(seconds: Int, onClick: () -> Unit) {
    val on = seconds > 0
    val tint = if (on) MaterialTheme.colorScheme.primary else LocalContentColor.current.copy(alpha = 0.6f)
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(40.dp).semantics { stateDescription = if (on) "$seconds seconds" else "Off" },
    ) {
        Box {
            Icon(TimerIcon, contentDescription = "Self-timer", tint = tint)
            if (on) {
                Text(
                    seconds.toString(),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold),
                    color = tint,
                    modifier = Modifier.align(Alignment.BottomEnd).offset(x = 2.dp, y = 2.dp)
                        .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(3.dp)).padding(horizontal = 1.dp),
                )
            }
        }
    }
}

/**
 * Long exposure (Experimental), cycling Off, 5, 10, 30, 60 s of stacked frames. A small "A" (average) or "L" (lighten,
 * for light trails) shows the stacking while on; the choice is in Settings. Inactive at full sensor resolution.
 */
@Composable
private fun LongExposureButton(seconds: Int, lighten: Boolean, hiRes: Boolean, onClick: () -> Unit) {
    val on = seconds > 0
    val tint = if (on && !hiRes) MaterialTheme.colorScheme.primary else LocalContentColor.current.copy(alpha = 0.6f)
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(40.dp).semantics {
            stateDescription = when {
                !on -> "Off"
                hiRes -> "$seconds seconds, inactive (full sensor resolution)"
                else -> "$seconds seconds, ${if (lighten) "light trails" else "average"}"
            }
        },
    ) {
        Box {
            Icon(HourglassIcon, contentDescription = "Long exposure", tint = tint)
            if (on) {
                Text(
                    seconds.toString() + if (lighten) "L" else "",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, lineHeight = 9.sp, fontWeight = FontWeight.Bold),
                    color = tint,
                    // Inside the button's bounds, which clip: "30L" is the widest label.
                    modifier = Modifier.align(Alignment.BottomEnd).offset(x = 2.dp, y = 2.dp)
                        .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(3.dp)).padding(horizontal = 1.dp),
                )
            }
        }
    }
}

/**
 * Off <-> Focus-flash (the bolt with "AF": the light comes on to focus and meter first, then the flash fires). On the
 * selfie camera, which has no flash unit: Off <-> screen flash (the bolt alone; the screen's frame lights for the shot).
 */
@Composable
private fun FlashButton(mode: FlashMode, screen: Boolean, onClick: () -> Unit) {
    val description = when {
        mode == FlashMode.OFF -> "Flash off"
        screen -> "Screen flash"
        else -> "Flash with focus light"
    }
    IconButton(onClick = onClick) {
        Box {
            Icon(
                if (mode == FlashMode.OFF) FlashOffIcon else FlashOnIcon,
                contentDescription = description,
                tint = if (mode == FlashMode.OFF) LocalContentColor.current else MaterialTheme.colorScheme.primary,
            )
            if (mode == FlashMode.FOCUS_FLASH && !screen) {
                Text(
                    "AF",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 8.sp),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.align(Alignment.BottomEnd).offset(x = 8.dp),
                )
            }
        }
    }
}

private fun icon(name: String, path: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
    .addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
    .build()

/** Material "theaters" icon (Apache 2.0): a film strip, the Film toggle (iOS: SF Symbol "film"). */
private val FilmIcon: ImageVector by lazy {
    icon(
        "Film",
        "M18,3v2h-2L16,3L8,3v2L6,5L6,3L4,3v18h2v-2h2v2h8v-2h2v2h2L20,3h-2zM8,17L6,17v-2h2v2zM8,13L6,13v-2h2v2zM8,9L6,9L6,7h2v2zM18,17h-2v-2h2v2zM18,13h-2v-2h2v2zM18,9h-2L16,7h2v2z",
    )
}

/** Material "videocam" icon (Apache 2.0): a movie camera, the Video mode button in the top bar. */
private val VideocamIcon: ImageVector by lazy {
    icon("Videocam", "M17,10.5V7c0,-0.55 -0.45,-1 -1,-1H4c-0.55,0 -1,0.45 -1,1v10c0,0.55 0.45,1 1,1h12c0.55,0 1,-0.45 1,-1v-3.5l4,4v-11l-4,4z")
}

/** Material "flash_on" icon (Apache 2.0), built here because it isn't in material-icons-core. */
private val FlashOnIcon: ImageVector by lazy { icon("FlashOn", "M7,2v11h3v9l7,-12h-4l4,-8z") }

/**
 * Material "cameraswitch" icon (Apache 2.0): a camera between two turning arrows, as Google Camera's switch.
 * Refresh (the circular arrows alone) read as reset.
 */
private val CameraSwitchIcon: ImageVector by lazy {
    icon(
        "CameraSwitch",
        "M16,7h-1l-1,-1h-4L9,7H8C6.9,7 6,7.9 6,9v6c0,1.1 0.9,2 2,2h8c1.1,0 2,-0.9 2,-2V9C18,7.9 17.1,7 16,7z" +
            "M12,14c-1.1,0 -2,-0.9 -2,-2c0,-1.1 0.9,-2 2,-2s2,0.9 2,2C14,13.1 13.1,14 12,14z" +
            "M8.57,0.51l4.48,4.48V2.04c4.72,0.47 8.48,4.23 8.95,8.95c0,0 2,0 2,0C23.34,3.02 15.49,-1.59 8.57,0.51z" +
            "M10.95,21.96C6.23,21.49 2.47,17.73 2,13.01c0,0 -2,0 -2,0c0.66,7.97 8.51,12.58 15.43,10.48l-4.48,-4.48V21.96z",
    )
}

/** Material "timer" icon (Apache 2.0). */
private val TimerIcon: ImageVector by lazy {
    icon(
        "Timer",
        "M15,1H9v2h6V1zM11,14h2V8h-2V14zM19.03,7.39l1.42,-1.42c-0.43,-0.51 -0.9,-0.99 -1.41,-1.41l-1.42,1.42" +
            "C16.07,4.74 14.12,4 12,4c-4.97,0 -9,4.03 -9,9c0,4.97 4.02,9 9,9s9,-4.03 9,-9C21,10.88 20.26,8.93 19.03,7.39z" +
            "M12,20c-3.87,0 -7,-3.13 -7,-7c0,-3.87 3.13,-7 7,-7s7,3.13 7,7C19,16.87 15.87,20 12,20z",
    )
}

/** Material "hourglass_empty" icon (Apache 2.0). */
private val HourglassIcon: ImageVector by lazy {
    icon(
        "Hourglass",
        "M6,2v6h0.01L6,8.01 10,12l-4,4 0.01,0.01H6V22h12v-5.99h-0.01L18,16l-4,-4 4,-3.99 -0.01,-0.01H18V2H6z" +
            "M16,16.5V20H8v-3.5l4,-4 4,4zM12,11.5l-4,-4V4h8v3.5l-4,4z",
    )
}

/** Material "burst_mode" icon (Apache 2.0): a stack of frames. */
private val BurstIcon: ImageVector by lazy {
    icon(
        "BurstMode",
        "M1,5h2v14H1zM5,5h2v14H5zM22,5H10c-0.55,0 -1,0.45 -1,1v12c0,0.55 0.45,1 1,1h12c0.55,0 1,-0.45 1,-1V6" +
            "c0,-0.55 -0.45,-1 -1,-1zM11,17l2.5,-3.15L15.29,16l2.5,-3.22L21,17H11z",
    )
}

/** Material "qr_code" icon (Apache 2.0). */
private val QrCodeIcon: ImageVector by lazy {
    icon(
        "QrCode",
        "M3,11h8V3H3V11zM5,5h4v4H5V5zM3,21h8v-8H3V21zM5,15h4v4H5V15zM13,3v8h8V3H13zM19,9h-4V5h4V9z" +
            "M19,19h2v2h-2V19zM13,13h2v2h-2V13zM15,15h2v2h-2V15zM13,17h2v2h-2V17zM15,19h2v2h-2V19z" +
            "M17,17h2v2h-2V17zM17,13h2v2h-2V13zM19,15h2v2h-2V15z",
    )
}

/** Material "flash_off" icon (Apache 2.0). */
private val FlashOffIcon: ImageVector by lazy {
    icon("FlashOff", "M3.27,3L2,4.27l5,5V13h3v9l3.58,-6.14L17.73,20 19,18.73 3.27,3zM17,10h-4l4,-8H7v2.18l8.46,8.46L17,10z")
}

/**
 * The power button's double press opens the default handler of the still-camera action, and on a locked phone that
 * of the *secure* one, a separate choice: while none is set there, Android asks for the passcode first. Enabling or
 * installing another camera app clears both. "Choose" fires the action on the unlocked phone, so Android's chooser
 * can set RawBoy Camera with Always.
 */
@Composable
private fun DefaultCameraChoice(action: String, title: String, whenSet: String, whenNotSet: String) {
    val context = LocalContext.current
    val intent = remember(action) { Intent(action) }
    var isDefault by remember { mutableStateOf(false) }
    // Re-checked whenever the sheet comes back from the chooser.
    LifecycleResumeEffect(action) {
        isDefault = context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName == context.packageName
        onPauseOrDispose {}
    }
    Row(Modifier.heightIn(min = 48.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(
                if (isDefault) whenSet else whenNotSet,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!isDefault) TextButton(onClick = { runCatching { context.startActivity(intent) } }) { Text("Choose") }
    }
}

@Composable
private fun SettingSwitch(
    title: String,
    subtitle: String?,
    checked: Boolean,
    enabled: Boolean = true,
    accent: Color? = null,
    indent: Boolean = false,
    onChange: (Boolean) -> Unit,
) {
    // The whole row toggles, not just the switch; a hint is one line, so rows stay close to the 48 dp minimum.
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange)
            .padding(start = if (indent) 16.dp else 0.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = accent ?: Color.Unspecified)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = if (accent == null) SwitchDefaults.colors() else SwitchDefaults.colors(checkedTrackColor = accent, checkedThumbColor = Color.White),
        )
    }
}

/** Experimental features stand out in Settings: bright orange. */
private val EXPERIMENTAL_ORANGE = Color(0xFFFF9100)

private const val COMPARE_DELAY_MS = 250L

/** Grab area around the focus ring (the ring is 72 dp). */
private val FOCUS_HANDLE_SIZE = 96.dp

/** Focus loupe: its side, its distance from the point (clear of the finger) and its magnification. */
private val LOUPE_SIZE = 128.dp
private val LOUPE_GAP = 64.dp
private const val LOUPE_ZOOM = 3f

/** Width of the landscape controls column (look menu, S/B/W picker and the tall slider) beside the shutter column. */
private val LANDSCAPE_CONTROLS_WIDTH = 216.dp

/** What the landscape slider changes: Brightness or Warmth (Filter in B&W mode). */
private enum class Adjust { BRIGHTNESS, WARMTH }

/**
 * Landscape controls, all within the right thumb's reach: the status line and the look row on top; below, the lens
 * buttons in a column, then round B / W chips (F, the filter, in B&W mode) pick what the tall slider beside the shutter changes. With F picked the
 * filters stand there instead of the slider. A double tap on a chip or the slider resets that setting.
 */
@Composable
private fun LandscapeControls(
    settings: CameraSettings,
    status: String,
    adjust: Adjust,
    onAdjust: (Adjust) -> Unit,
    lensColumn: (@Composable () -> Unit)?,
    lookRow: @Composable () -> Unit,
    vm: CameraViewModel,
) {
    val mono = settings.monoMode
    // Packed against the shutter column: everything right-aligned, the chips right beside the slider.
    Column(
        Modifier.fillMaxSize().padding(start = 4.dp, top = 4.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Text(
            status,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            modifier = Modifier.height(16.dp),
        )
        lookRow()
        Row(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // The lenses in the black space left of the picker, still under the thumb.
            lensColumn?.let {
                it()
                Spacer(Modifier.width(2.dp))
            }
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                AdjustChip("B", "Brightness", formatSliderValue(settings.brightness, -100f..100f), adjust == Adjust.BRIGHTNESS,
                    onSelect = { onAdjust(Adjust.BRIGHTNESS) }, onReset = { vm.setBrightness(0f) })
                if (mono) {
                    AdjustChip("F", "Filter", settings.filter.label, adjust == Adjust.WARMTH,
                        onSelect = { onAdjust(Adjust.WARMTH) }, onReset = { vm.setFilter(BwFilter.NONE) })
                } else {
                    AdjustChip("W", "Warmth", formatSliderValue(settings.warmth, -100f..100f), adjust == Adjust.WARMTH,
                        onSelect = { onAdjust(Adjust.WARMTH) }, onReset = { vm.setWarmth(0f) })
                }
            }
            val primary = MaterialTheme.colorScheme.primary
            val track = Color(0xFF555555)
            when {
                adjust == Adjust.WARMTH && mono -> FilterColumn(settings.filter, vm::setFilter)
                else -> {
                    val (value, range, default, set) = when (adjust) {
                        Adjust.BRIGHTNESS -> SliderSpec(settings.brightness, -100f..100f, 0f, vm::setBrightness)
                        Adjust.WARMTH -> SliderSpec(settings.warmth, -100f..100f, 0f, vm::setWarmth)
                    }
                    VerticalSlider(
                        value, range, default, set,
                        label = when (adjust) {
                            Adjust.BRIGHTNESS -> "Brightness"
                            Adjust.WARMTH -> "Warmth"
                        },
                        modifier = Modifier
                            .width(40.dp)
                            .fillMaxHeight(),
                        color = primary,
                        trackColor = track,
                    )
                }
            }
        }
    }
}

private data class SliderSpec(
    val value: Float,
    val range: ClosedFloatingPointRange<Float>,
    val default: Float,
    val onChange: (Float) -> Unit,
)

/** A round picker chip: the setting's letter with its value under it; filled while its setting is on the slider. */
@Composable
private fun AdjustChip(letter: String, name: String, value: String, selected: Boolean, onSelect: () -> Unit, onReset: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (selected) primary else Color(0xFF2A2A2A))
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onSelect() },
                    onDoubleTap = {
                        onSelect()
                        onReset()
                    },
                )
            }
            // TalkBack: the setting's name and value, a tap puts it on the slider, an action resets it (the double tap).
            .clearAndSetSemantics {
                contentDescription = name
                stateDescription = value
                role = Role.Button
                this.selected = selected
                onClick(label = "Put on the slider") {
                    onSelect()
                    true
                }
                customActions = listOf(
                    CustomAccessibilityAction("Reset") {
                        onSelect()
                        onReset()
                        true
                    },
                )
            },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val ink = if (selected) Color.Black else Color.White
        Text(letter, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold), color = ink)
        Text(value, style = MaterialTheme.typography.labelSmall, color = ink.copy(alpha = 0.8f), maxLines = 1)
    }
}

/** B&W filters as a column beside the shutter (landscape's F): a dot of each filter's colour before its name. */
@Composable
private fun FilterColumn(selected: BwFilter, onSelect: (BwFilter) -> Unit) {
    Column(
        Modifier.width(96.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
    ) {
        for (f in BwFilter.entries) {
            val dot = FILTER_COLORS[f]
            FilterChip(
                selected = f == selected,
                onClick = { onSelect(f) },
                label = { Text(f.label) },
                leadingIcon = if (dot == null) null else {
                    { Box(Modifier.size(8.dp).clip(CircleShape).background(dot)) }
                },
                modifier = Modifier.height(32.dp).fillMaxWidth(),
            )
        }
    }
}

/**
 * Screen flash for the selfie camera: while [lit], the window goes to full brightness (see [ScreenFlashFrame], drawn on
 * top by [CameraScreen]).
 */
@Composable
private fun ScreenFlashEffect(lit: Boolean) {
    val activity = LocalContext.current.findActivity() ?: return
    androidx.compose.runtime.DisposableEffect(lit) {
        val attrs = activity.window.attributes
        val before = attrs.screenBrightness
        if (lit) activity.window.attributes = attrs.apply { screenBrightness = 1f }
        onDispose { if (lit) activity.window.attributes = activity.window.attributes.apply { screenBrightness = before } }
    }
}

private tailrec fun android.content.Context.findActivity(): android.app.Activity? = when (this) {
    is android.app.Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** The lit frame of the screen flash: warm white all around the screen edge, the viewfinder showing through the middle. */
@Composable
private fun ScreenFlashFrame(modifier: Modifier = Modifier) {
    androidx.compose.foundation.Canvas(modifier) {
        val t = min(size.width, size.height) * SCREEN_FLASH_FRAME_SHARE
        val c = SCREEN_FLASH_COLOUR
        drawRect(c, topLeft = androidx.compose.ui.geometry.Offset.Zero, size = Size(size.width, t))
        drawRect(c, topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - t), size = Size(size.width, t))
        drawRect(c, topLeft = androidx.compose.ui.geometry.Offset(0f, t), size = Size(t, size.height - 2 * t))
        drawRect(c, topLeft = androidx.compose.ui.geometry.Offset(size.width - t, t), size = Size(t, size.height - 2 * t))
    }
}

/** Frame width as a share of the screen's short side; a wide frame is the light, the middle is still enough to compose. */
private const val SCREEN_FLASH_FRAME_SHARE = 0.2f
private val SCREEN_FLASH_COLOUR = Color(0xFFFFF4E6)

/** Thin lines at the thirds of the viewfinder; they take no touches. */
@Composable
private fun GridOverlay(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val line = Color.White.copy(alpha = 0.45f)
        val w = 1.dp.toPx()
        for (i in 1..2) {
            drawLine(line, Offset(size.width * i / 3f, 0f), Offset(size.width * i / 3f, size.height), w)
            drawLine(line, Offset(0f, size.height * i / 3f), Offset(size.width, size.height * i / 3f), w)
        }
    }
}

/**
 * A horizon line through the middle of the viewfinder, turned against the phone's tilt ([tilt] degrees clockwise from
 * upright, null when flat: nothing is drawn). Yellow within [LEVEL_TOLERANCE] degrees of straight, with a short fixed
 * mark each side to compare it with.
 */
@Composable
private fun LevelOverlay(tilt: Float?, modifier: Modifier = Modifier) {
    if (tilt == null) return
    Canvas(modifier) {
        val level = kotlin.math.abs(tilt) <= LEVEL_TOLERANCE
        val colour = if (level) Color(0xFFFFD54F) else Color.White.copy(alpha = 0.7f)
        val c = Offset(size.width / 2f, size.height / 2f)
        val half = minOf(size.width, size.height) * 0.22f
        val w = 2.dp.toPx()
        // Fixed marks at the sides, the line itself turns.
        drawLine(colour.copy(alpha = 0.5f), Offset(c.x - half * 1.5f, c.y), Offset(c.x - half * 1.25f, c.y), w)
        drawLine(colour.copy(alpha = 0.5f), Offset(c.x + half * 1.25f, c.y), Offset(c.x + half * 1.5f, c.y), w)
        rotate(-tilt, c) { drawLine(colour, Offset(c.x - half, c.y), Offset(c.x + half, c.y), w) }
    }
}

private const val LEVEL_TOLERANCE = 1f
