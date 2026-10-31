package app.rawboy.camera.ui

import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The display's rotation from its natural orientation (`Surface.ROTATION_*`, 0..3), kept up to date. A display
 * listener, because a turn from one landscape to the other (90 <-> 270) is no configuration change.
 */
@Composable
fun rememberDisplayRotation(): Int {
    val view = LocalView.current
    val context = LocalContext.current
    var rotation by remember { mutableIntStateOf(view.display?.rotation ?: Surface.ROTATION_0) }
    // Portrait <-> landscape recomposes with a new configuration: read it again then too.
    val configuration = LocalConfiguration.current
    DisposableEffect(view, configuration) {
        view.display?.let { rotation = it.rotation }
        val manager = context.getSystemService(DisplayManager::class.java)
        val listener = object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = Unit
            override fun onDisplayRemoved(displayId: Int) = Unit
            override fun onDisplayChanged(displayId: Int) {
                val d = view.display ?: return
                if (d.displayId == displayId) rotation = d.rotation
            }
        }
        manager.registerDisplayListener(listener, Handler(Looper.getMainLooper()))
        onDispose { manager.unregisterDisplayListener(listener) }
    }
    return rotation
}

/**
 * Clockwise quarter turns from the upright viewfinder picture (as the portrait screen shows it) to the window, for a
 * window turned by [displayRotation] (`Surface.ROTATION_*`). The camera turns with the phone, so the picture must
 * stay put on the glass while the UI turns: ROTATION_90 (phone turned anticlockwise) turns it back anticlockwise (3).
 * The selfie picture turns the same way (turning it the other way showed it upside down on the Pixel 9 Pro).
 */
fun viewfinderTurns(displayRotation: Int): Int {
    val r = ((displayRotation % 4) + 4) % 4
    return (4 - r) % 4
}

/**
 * Lays the content out at this element's size turned by [turns] clockwise quarter turns and turns it: in its own
 * coordinates the content stays upright-portrait, so the viewfinder's tap points, focus ring and loupe need no
 * change. Compose maps touches through the layer's rotation.
 */
fun Modifier.turned(turns: Int): Modifier {
    val k = ((turns % 4) + 4) % 4
    if (k == 0) return this
    return layout { measurable, constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val inner = if (k % 2 == 1) Constraints.fixed(h, w) else Constraints.fixed(w, h)
        val p = measurable.measure(inner)
        layout(w, h) {
            p.placeWithLayer((w - p.width) / 2, (h - p.height) / 2) { rotationZ = 90f * k }
        }
    }
}

/**
 * The camera screen's parts in one layout, so the viewfinder's GL view stays when the phone turns. Portrait: [bar]
 * on top, then the [viewfinder] in the height the others leave, [controls] and [shutter] under it. Landscape: [bar]
 * a column at the left edge, the viewfinder, [controls] a [controlsWidth] column and [shutter] a column at the right
 * edge, where the right thumb is.
 */
@Composable
fun CameraLayout(
    landscape: Boolean,
    controlsWidth: Dp,
    modifier: Modifier = Modifier,
    bar: @Composable () -> Unit,
    viewfinder: @Composable () -> Unit,
    controls: @Composable () -> Unit,
    shutter: @Composable () -> Unit,
) {
    Layout(contents = listOf(bar, viewfinder, controls, shutter), modifier) { (b, v, c, s), constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val barM = b.firstOrNull()
        val vfM = v.firstOrNull()
        val ctlM = c.firstOrNull()
        val shM = s.firstOrNull()
        if (landscape) {
            val column = Constraints(maxWidth = w, minHeight = h, maxHeight = h)
            val barP = barM?.measure(column)
            val shP = shM?.measure(column)
            val cw = min(controlsWidth.roundToPx(), (w * 0.3f).roundToInt())
            val ctlP = ctlM?.measure(Constraints.fixed(cw, h))
            val left = barP?.width ?: 0
            val right = (shP?.width ?: 0) + (ctlP?.width ?: 0)
            val vfP = vfM?.measure(Constraints.fixed((w - left - right).coerceAtLeast(0), h))
            layout(w, h) {
                barP?.place(0, 0)
                vfP?.place(left, 0)
                ctlP?.place(w - right, 0)
                shP?.place(w - (shP.width), 0)
            }
        } else {
            val row = Constraints(minWidth = w, maxWidth = w, maxHeight = h)
            val barP = barM?.measure(row)
            val shP = shM?.measure(row.copy(maxHeight = (h - (barP?.height ?: 0)).coerceAtLeast(0)))
            val top = barP?.height ?: 0
            val ctlP = ctlM?.measure(row.copy(maxHeight = (h - top - (shP?.height ?: 0)).coerceAtLeast(0)))
            val bottom = (ctlP?.height ?: 0) + (shP?.height ?: 0)
            val vfP = vfM?.measure(Constraints.fixed(w, (h - top - bottom).coerceAtLeast(0)))
            layout(w, h) {
                barP?.place(0, 0)
                vfP?.place(0, top)
                ctlP?.place(0, h - bottom)
                shP?.place(0, h - (shP.height))
            }
        }
    }
}

/**
 * A tall slider for the thumb: dragging moves the value by the distance dragged (it doesn't jump to where the finger
 * lands), a double tap resets it to [default]. A signed range fills from 0, as [app.rawboy.view.CompactSlider] does.
 */
@Composable
fun VerticalSlider(
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    default: Float,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color,
    trackColor: Color,
    thumbSize: Dp = 24.dp,
) {
    val current by rememberUpdatedState(value)
    val change by rememberUpdatedState(onChange)
    val reset by rememberUpdatedState(default)
    val span = range.endInclusive - range.start
    Canvas(
        modifier
            .pointerInput(range) {
                val travel = (size.height - thumbSize.toPx()).coerceAtLeast(1f)
                var dragged = 0f
                detectVerticalDragGestures(onDragStart = { dragged = current }) { c, dy ->
                    c.consume()
                    dragged = (dragged - dy / travel * span).coerceIn(range)
                    change(dragged.roundToInt().toFloat())
                }
            }
            .pointerInput(Unit) { detectTapGestures(onDoubleTap = { change(reset) }) },
    ) {
        val thumb = thumbSize.toPx()
        val track = 6.dp.toPx()
        val x = size.width / 2
        val top = thumb / 2
        val travel = (size.height - thumb).coerceAtLeast(1f)
        fun yOf(v: Float) = top + travel * (1f - (v - range.start) / span)
        drawRoundRect(trackColor, Offset(x - track / 2, top), Size(track, travel), CornerRadius(track / 2))
        val y = yOf(value.coerceIn(range))
        val from = if (range.start < 0f && range.endInclusive > 0f) yOf(0f) else yOf(range.start)
        drawRect(color, Offset(x - track / 2, min(y, from)), Size(track, abs(from - y)))
        if (range.start < 0f && range.endInclusive > 0f) {
            drawRect(Color.White.copy(alpha = 0.6f), Offset(x - track, from - 1.dp.toPx()), Size(track * 2, 2.dp.toPx()))
        }
        drawCircle(color, thumb / 2, Offset(x, y))
    }
}
