package app.rawboy.view

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import kotlin.math.roundToInt

/**
 * Pan and pinch for the preview's gesture layer (RawBoy and Auto). One finger drags ([onPan], past the touch slop;
 * only with [oneFinger], else the drag is left to a parent such as Auto's pager); two fingers pan with their middle
 * and zoom around it ([onZoomBy]: view position, factor), and the finger left after a pinch keeps panning.
 * Touches another gesture consumed first (a mask handle, a brush stroke) are left alone. What it uses it consumes,
 * so a tap detector earlier in the chain drops press-and-hold compare and taps as soon as a second finger lands.
 * The inputs are read fresh for every event, so a pinch out of the fit view isn't restarted when the view zooms.
 */
@Composable
fun rememberPanAndPinch(
    oneFinger: Boolean,
    onPan: (Float, Float) -> Unit,
    onZoomBy: (Float, Float, Float) -> Unit,
): Modifier {
    val single by rememberUpdatedState(oneFinger)
    val pan by rememberUpdatedState(onPan)
    val zoomBy by rememberUpdatedState(onZoomBy)
    return Modifier.pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var dragging = false
            var pinched = false
            var travel = Offset.Zero
            while (true) {
                val ev = awaitPointerEvent()
                val pressed = ev.changes.filter { it.pressed }
                if (pressed.isEmpty()) break
                if (ev.changes.any { it.isConsumed }) continue
                if (pressed.size >= 2) {
                    pinched = true
                    val move = ev.calculatePan()
                    val factor = ev.calculateZoom()
                    val centre = ev.calculateCentroid(useCurrent = true)
                    if (move != Offset.Zero) pan(move.x, move.y)
                    if (factor != 1f && centre != Offset.Unspecified) zoomBy(centre.x, centre.y, factor)
                    ev.changes.forEach { it.consume() }
                    continue
                }
                if (!single && !pinched) continue
                val c = pressed[0]
                val delta = c.positionChange()
                if (!dragging && !pinched) {
                    travel += delta
                    if (travel.getDistance() < viewConfiguration.touchSlop) continue
                    dragging = true
                }
                if (delta != Offset.Zero) pan(delta.x, delta.y)
                c.consume()
            }
        }
    }
}

/** The zoomed view's label: "100%", or a pinch's scale. */
fun zoomLabel(scale: Float) = "${(scale * 100).roundToInt()}%"
