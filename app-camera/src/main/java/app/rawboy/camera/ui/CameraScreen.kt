package app.rawboy.camera.ui

import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    openPhoto: (Uri) -> Unit,
    openQr: (QrPayload) -> Unit,
) {
    val status by vm.status.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val frame by vm.frame.collectAsStateWithLifecycle()
    val params by vm.shaderParams.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val merging by vm.merging.collectAsStateWithLifecycle()
    val lastShot by vm.lastShot.collectAsStateWithLifecycle()
    val compare by vm.compare.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val lenses by vm.lenses.collectAsStateWithLifecycle()
    val frontAvailable by vm.frontAvailable.collectAsStateWithLifecycle()
    val focusPoint by vm.focusPoint.collectAsStateWithLifecycle()
    val dragPoint by vm.dragPoint.collectAsStateWithLifecycle()
    val focusSize by vm.controller.focusSize.collectAsStateWithLifecycle()
    val flashAvailable by vm.flashAvailable.collectAsStateWithLifecycle()
    val histogram by vm.histogram.collectAsStateWithLifecycle()
    val lowLight by vm.lowLight.collectAsStateWithLifecycle()
    val qrCode by vm.qrCode.collectAsStateWithLifecycle()
    // Only the AF state of the camera's per-frame metadata, so the screen doesn't recompose 30 times a second.
    val afState by remember(vm) { vm.controller.frames.map { it?.afState }.distinctUntilChanged() }
        .collectAsStateWithLifecycle(null)
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }
    val appName = remember { context.applicationInfo.loadLabel(context.packageManager).toString() }
    var showHelp by remember { mutableStateOf(false) }
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
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    when {
                        merging -> "Merging frames…"
                        pending > 0 -> "Saving $pending…"
                        else -> ""
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 12.dp),
                )
                RawButton(settings.keepDng) { vm.setKeepDng(!settings.keepDng) }
                BurstButton(settings.burstMode, lowLight) { vm.setBurstMode(settings.burstMode.next()) }
                if (flashAvailable) FlashButton(settings.flash, vm::cycleFlash)
                HelpButton(appName, CAMERA_HELP, onOpenChange = { showHelp = it })
                IconButton(onClick = { showSettings = true }) {
                    Icon(Icons.Filled.Settings, contentDescription = "Settings")
                }
            }

            // Viewfinder, at the raw's aspect ratio, in whatever height the controls leave.
            val f = frame
            var viewSize by remember { mutableStateOf(IntSize.Zero) }
            val density = LocalDensity.current
            // While the focus ring is dragged it shows there, with a loupe; it focuses on release.
            val shownFocus = dragPoint ?: focusPoint
            val loupe = dragPoint?.let { (x, y) ->
                with(density) { loupeAt(x, y, viewSize, LOUPE_SIZE.toPx(), LOUPE_GAP.toPx()) }
            }
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
            Box(
                Modifier
                    .aspectRatio(f?.let { it.fullWidth.toFloat() / it.fullHeight } ?: (3f / 4f))
                    .background(Color(0xFF0A0A0A))
                    .onSizeChanged { viewSize = it },
                contentAlignment = Alignment.Center,
            ) {
                Viewfinder(
                    f, params, vm::onSurfaceTexture, vm::onViewfinderBase, Modifier.fillMaxSize(), loupe,
                    onLuma = if (settings.scanQr) vm::onViewfinderLuma else null,
                )
                Box(
                    Modifier
                        .matchParentSize()
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
                when (status) {
                    CameraStatus.NEEDS_PERMISSION -> Button(onClick = requestPermission) { Text("Allow camera") }
                    CameraStatus.OPENING -> CircularProgressIndicator()
                    CameraStatus.FAILED -> Text("Camera unavailable", color = MaterialTheme.colorScheme.error)
                    CameraStatus.READY -> if (params == null) CircularProgressIndicator()
                }
                if (lenses.size > 1) {
                    LensSelector(
                        labels = lenses.map { it.label },
                        selected = settings.lens,
                        onSelect = vm::selectLens,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 16.dp),
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
                            .padding(start = 16.dp, end = 16.dp, bottom = if (lenses.size > 1) 84.dp else 16.dp),
                    )
                }
                shownFocus?.let { (x, y) -> FocusRing(x, y, if (dragPoint != null) null else afState, focusSize) }
                loupe?.let { LoupeFrame(it, focusSize) }
                if (focusPoint != null) {
                    Text(
                        "AF LOCK  ✕",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.Black,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 12.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFFFD54F))
                            .clickable { vm.releaseFocus() }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
                // Shutter blink over the viewfinder.
                if (blink.value > 0f) {
                    Box(
                        Modifier
                            .matchParentSize()
                            .background(Color.Black.copy(alpha = blink.value)),
                    )
                }
                // Top right: "Without look" takes the left corner and AF LOCK the middle.
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
                            .align(Alignment.TopStart)
                            .padding(12.dp)
                            .background(Color(0x99000000))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
            }

            // A menu instead of a strip of chips, and one thin row per slider: the viewfinder keeps the screen.
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp)) {
                LookDropdown(
                    label = "Look",
                    looks = Edition.looks,
                    selected = Edition.looks.firstOrNull { it.id == settings.lookId },
                    onSelect = { vm.setLook(it.id) },
                    labelWidth = 88.dp,
                )
                LookSlider("Strength", settings.strength, 0f..100f, LookApplier.DEFAULT_STRENGTH, vm::setStrength)
                LookSlider("Brightness", settings.brightness, -100f..100f, 0f, vm::setBrightness)
                LookSlider("Warmth", settings.warmth, -100f..100f, 0f, vm::setWarmth)
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
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
                Spacer(Modifier.weight(1f))
                Shutter(
                    enabled = status == CameraStatus.READY && !merging,
                    onClick = vm::shutter,
                    modifier = Modifier.graphicsLayer {
                        scaleX = shutterScale.value
                        scaleY = shutterScale.value
                    },
                )
                Spacer(Modifier.weight(1f))
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
        }
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

/** UW · W · T, as Google Camera shows them: the selected lens in a filled circle. */
@Composable
private fun LensSelector(labels: List<String>, selected: String, onSelect: (String) -> Unit, modifier: Modifier) {
    Row(
        modifier
            .clip(RoundedCornerShape(28.dp))
            .background(Color(0x99000000))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (label in labels) {
            val isSelected = label == selected
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (isSelected) Color(0xFFD0D0D0) else Color.Transparent)
                    .clickable { onSelect(label) },
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
private fun Shutter(enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val ring = if (enabled) Color.White else Color.Gray
    Box(
        modifier
            .size(76.dp)
            .border(BorderStroke(4.dp, ring), CircleShape)
            .padding(8.dp)
            .clip(CircleShape)
            .background(ring)
            .clickable(enabled = enabled, onClick = onClick),
    )
}

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
    Column(
        Modifier
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("JPEG quality", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text("${settings.jpegQuality}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
        }
        Slider(
            value = settings.jpegQuality.toFloat(),
            onValueChange = { vm.setJpegQuality(it.roundToInt()) },
            valueRange = CameraSettings.MIN_QUALITY.toFloat()..100f,
            steps = 100 - CameraSettings.MIN_QUALITY - 1,
        )
        Text(
            "Encoded with jpegli, full-resolution colour (4:4:4). Default 95.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Keep raw (DNG)", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Saved to Pictures/${Edition.FOLDER}/RAW",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = settings.keepDng, onCheckedChange = vm::setKeepDng)
        }
        Spacer(Modifier.height(16.dp))
        SettingSwitch(
            title = "Smaller photos",
            subtitle = "${CameraSettings.SMALL_LONG_SIDE} px on the long side; off saves full resolution",
            checked = settings.smallExport,
            onChange = vm::setSmallExport,
        )
        Spacer(Modifier.height(16.dp))
        Text("Merge ${CameraSettings.BURST_FRAMES} frames", style = MaterialTheme.typography.bodyMedium)
        Text(
            "Each shot takes ${CameraSettings.BURST_FRAMES} raws and merges them into one: less noise, takes a little " +
                "longer to save. Auto does it in low light only. Hold still; not used with flash",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            for (m in listOf(BurstMode.ON, BurstMode.AUTO, BurstMode.OFF)) {
                FilterChip(
                    selected = settings.burstMode == m,
                    onClick = { vm.setBurstMode(m) },
                    label = { Text(m.name.lowercase().replaceFirstChar { it.uppercase() }) },
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        // Where the law requires the click, Android plays it anyway: shown on and locked.
        SettingSwitch(
            title = "Shutter sound",
            subtitle = if (vm.shutterSoundRequired) "Required by law in this region; always on" else "A click on each shot",
            checked = settings.shutterSound || vm.shutterSoundRequired,
            enabled = !vm.shutterSoundRequired,
            onChange = vm::setShutterSound,
        )
        Spacer(Modifier.height(16.dp))
        SettingSwitch(
            title = "Geotag",
            subtitle = "Save where each photo was taken (GPS) in the JPEG and DNG. Asks for location access",
            checked = settings.geotag,
            onChange = { on -> if (on && !vm.hasLocationPermission) requestLocation() else vm.setGeotag(on) },
        )
        Spacer(Modifier.height(16.dp))
        SettingSwitch(
            title = "QR codes",
            subtitle = "Show what a QR code in the viewfinder holds; tap to open the link, join the Wi-Fi or copy the text",
            checked = settings.scanQr,
            onChange = vm::setScanQr,
        )
        Spacer(Modifier.height(16.dp))
        SettingSwitch(
            title = "Histogram",
            subtitle = "A live RGB histogram in a corner of the viewfinder",
            checked = settings.showHistogram,
            onChange = vm::setShowHistogram,
        )
        Spacer(Modifier.height(16.dp))
        DefaultCameraChoice(
            MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA,
            title = "Unlocked camera",
            whenSet = "The power button's double press opens RawBoy Camera",
            whenNotSet = "Choose RawBoy Camera, then Always, so the power button's double press opens it",
        )
        Spacer(Modifier.height(16.dp))
        DefaultCameraChoice(
            MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA_SECURE,
            title = "Lock screen camera",
            whenSet = "The power button's double press opens RawBoy Camera on a locked phone",
            whenNotSet = "Choose RawBoy Camera, then Always, so a double press on a locked phone opens it without the passcode",
        )
        Spacer(Modifier.height(16.dp))
        SettingSwitch(
            title = "Remember camera & settings",
            subtitle = "Otherwise each start uses W, Yellow Portrait 400 and default sliders",
            checked = settings.rememberLast,
            onChange = vm::setRememberLast,
        )
        for (line in Edition.credits) {
            Spacer(Modifier.height(8.dp))
            Text(line, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        var showLicences by remember { mutableStateOf(false) }
        TextButton(onClick = { showLicences = true }) { Text("Open-source licences") }
        if (showLicences) LicensesDialog(onDismiss = { showLicences = false })
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
 * shot (On, or Auto in low light), gray otherwise; Auto carries a small "A".
 */
@Composable
private fun BurstButton(mode: BurstMode, lowLight: Boolean, onClick: () -> Unit) {
    val active = mode.merges(lowLight)
    val state = when (mode) {
        BurstMode.ON -> "On"
        BurstMode.AUTO -> if (active) "Auto, merging (low light)" else "Auto, not merging (enough light)"
        BurstMode.OFF -> "Off"
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

/** Off <-> Focus-flash (the bolt with "AF": the light comes on to focus and meter first, then the flash fires). */
@Composable
private fun FlashButton(mode: FlashMode, onClick: () -> Unit) {
    val description = when (mode) {
        FlashMode.OFF -> "Flash off"
        FlashMode.FOCUS_FLASH -> "Flash with focus light"
    }
    IconButton(onClick = onClick) {
        Box {
            Icon(
                if (mode == FlashMode.OFF) FlashOffIcon else FlashOnIcon,
                contentDescription = description,
                tint = if (mode == FlashMode.OFF) LocalContentColor.current else MaterialTheme.colorScheme.primary,
            )
            if (mode == FlashMode.FOCUS_FLASH) {
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
    Row(verticalAlignment = Alignment.CenterVertically) {
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
private fun SettingSwitch(title: String, subtitle: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

private const val COMPARE_DELAY_MS = 250L

/** Grab area around the focus ring (the ring is 72 dp). */
private val FOCUS_HANDLE_SIZE = 96.dp

/** Focus loupe: its side, its distance from the point (clear of the finger) and its magnification. */
private val LOUPE_SIZE = 128.dp
private val LOUPE_GAP = 64.dp
private const val LOUPE_ZOOM = 3f
