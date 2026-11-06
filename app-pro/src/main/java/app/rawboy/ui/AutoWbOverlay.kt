package app.rawboy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.rawboy.develop.CropMath
import app.rawboy.develop.CropRect
import app.rawboy.gl.ZoomMath
import kotlin.math.roundToInt

/** Touch tolerance around the rectangle's edges and corners. */
private val GRAB = 24.dp

/** Android honours at most 200 dp of gesture exclusion per screen edge; stay under it. */
private val EXCLUSION_BUDGET = 190.dp

/**
 * Auto white balance draggable and extendable rectangle overlay:
 * dims what's outside, draws a border with corner and edge handles, and adjusts the area by dragging.
 */
@Composable
fun AutoWbOverlay(
    frameWidth: Int,
    frameHeight: Int,
    rect: CropRect,
    framePx: Int,
    onRectChange: (CropRect, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentRect by rememberUpdatedState(rect)
    val currentChange by rememberUpdatedState(onRectChange)
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    Box(modifier.onSizeChanged { viewSize = it }) {
        Canvas(
            Modifier.fillMaxSize().pointerInput(frameWidth, frameHeight, framePx) {
                val grab = GRAB.toPx()
                var start = currentRect
                var last = currentRect
                var handle: CropMath.Handle? = null
                var total = Offset.Zero
                detectDragGestures(
                    onDragStart = { p ->
                        val r = ZoomMath.fitRect(size.width, size.height, frameWidth, frameHeight, framePx)
                        start = currentRect
                        last = currentRect
                        total = Offset.Zero
                        handle = CropMath.handleAt(start, (p.x - r[0]) / r[2], (p.y - r[1]) / r[3], grab / r[2], grab / r[3])
                    },
                    onDragEnd = {
                        if (handle != null) {
                            currentChange(last, true)
                        }
                        handle = null
                    },
                    onDragCancel = { handle = null },
                ) { change, drag ->
                    val h = handle ?: return@detectDragGestures
                    change.consume()
                    total += drag
                    val r = ZoomMath.fitRect(size.width, size.height, frameWidth, frameHeight, framePx)
                    val next = CropMath.drag(start, h, total.x / r[2], total.y / r[3], null, frameWidth, frameHeight)
                    last = next
                    currentChange(next, false)
                }
            },
        ) {
            val r = ZoomMath.fitRect(size.width.toInt(), size.height.toInt(), frameWidth, frameHeight, framePx)
            val left = r[0] + rect.left * r[2]
            val top = r[1] + rect.top * r[3]
            val right = r[0] + rect.right * r[2]
            val bottom = r[1] + rect.bottom * r[3]
            val w = right - left
            val h = bottom - top

            // Dim what is outside the selection.
            val shade = Color.Black.copy(alpha = 0.35f)
            drawRect(shade, Offset(r[0], r[1]), Size(r[2], top - r[1]))
            drawRect(shade, Offset(r[0], bottom), Size(r[2], r[1] + r[3] - bottom))
            drawRect(shade, Offset(r[0], top), Size(left - r[0], h))
            drawRect(shade, Offset(right, top), Size(r[0] + r[2] - right, h))

            // Fine grid (thirds)
            val fine = Color.White.copy(alpha = 0.25f)
            val lines = 3
            for (i in 1 until lines) {
                val x = left + w * i / lines
                val y = top + h * i / lines
                drawLine(fine, Offset(x, top), Offset(x, bottom), strokeWidth = 1f)
                drawLine(fine, Offset(left, y), Offset(right, y), strokeWidth = 1f)
            }

            val border = 1.5.dp.toPx()
            drawRect(Color.White, Offset(left, top), Size(w, h), style = Stroke(border))

            // L-shaped corner handles and edge handles
            val len = minOf(20.dp.toPx(), w / 3, h / 3)
            val thick = 3.dp.toPx()
            for ((cx, dx) in listOf(left to 1f, right to -1f)) {
                for ((cy, dy) in listOf(top to 1f, bottom to -1f)) {
                    drawLine(Color.White, Offset(cx, cy), Offset(cx + dx * len, cy), strokeWidth = thick)
                    drawLine(Color.White, Offset(cx, cy), Offset(cx, cy + dy * len), strokeWidth = thick)
                }
            }
            val midX = (left + right) / 2
            val midY = (top + bottom) / 2
            drawLine(Color.White, Offset(midX - len / 2, top), Offset(midX + len / 2, top), strokeWidth = thick)
            drawLine(Color.White, Offset(midX - len / 2, bottom), Offset(midX + len / 2, bottom), strokeWidth = thick)
            drawLine(Color.White, Offset(left, midY - len / 2), Offset(left, midY + len / 2), strokeWidth = thick)
            drawLine(Color.White, Offset(right, midY - len / 2), Offset(right, midY + len / 2), strokeWidth = thick)
        }
        if (viewSize != IntSize.Zero) AutoWbGestureGuards(viewSize, frameWidth, frameHeight, rect, framePx)
    }
}

/**
 * Invisible boxes over the rectangle's left and right handles that opt them out of the system back gesture.
 */
@Composable
private fun AutoWbGestureGuards(viewSize: IntSize, frameWidth: Int, frameHeight: Int, rect: CropRect, framePx: Int) {
    val density = LocalDensity.current
    val grab = with(density) { GRAB.toPx() }
    val r = ZoomMath.fitRect(viewSize.width, viewSize.height, frameWidth, frameHeight, framePx)
    val left = r[0] + rect.left * r[2]
    val right = r[0] + rect.right * r[2]
    val top = r[1] + rect.top * r[3]
    val bottom = r[1] + rect.bottom * r[3]
    val mid = (top + bottom) / 2
    val spans = if (bottom - top + 2 * grab <= with(density) { EXCLUSION_BUDGET.toPx() }) {
        listOf(top - grab to bottom + grab)
    } else {
        listOf(top - grab to top + grab, mid - grab to mid + grab, bottom - grab to bottom + grab)
    }
    for (x in listOf(left, right)) {
        for ((y0, y1) in spans) {
            Box(
                Modifier
                    .offset { IntOffset((x - grab).roundToInt(), y0.roundToInt()) }
                    .size(with(density) { (2 * grab).toDp() }, with(density) { (y1 - y0).toDp() })
                    .systemGestureExclusion(),
            )
        }
    }
}
