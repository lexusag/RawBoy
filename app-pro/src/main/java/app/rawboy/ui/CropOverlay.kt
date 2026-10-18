package app.rawboy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.rawboy.develop.CropMath
import app.rawboy.develop.CropRect
import app.rawboy.gl.ZoomMath

/**
 * Crop frame over the aspect-fit picture of the whole (uncropped) frame of [frameWidth] x [frameHeight]:
 * dims what's cut, draws a grid for straightening, and edits [crop] by dragging corners, edges or the inside.
 * [ratio] (width / height in pixels) locks the shape; null = free.
 */
@Composable
fun CropOverlay(
    frameWidth: Int,
    frameHeight: Int,
    crop: CropRect,
    ratio: Double?,
    framePx: Int,
    onCropChange: (CropRect) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentCrop by rememberUpdatedState(crop)
    val currentRatio by rememberUpdatedState(ratio)
    val currentChange by rememberUpdatedState(onCropChange)
    Canvas(
        modifier.pointerInput(frameWidth, frameHeight, framePx) {
            val grab = 24.dp.toPx()
            var start = currentCrop
            var handle: CropMath.Handle? = null
            var total = Offset.Zero
            detectDragGestures(
                onDragStart = { p ->
                    val r = ZoomMath.fitRect(size.width, size.height, frameWidth, frameHeight, framePx)
                    start = currentCrop
                    total = Offset.Zero
                    handle = CropMath.handleAt(start, (p.x - r[0]) / r[2], (p.y - r[1]) / r[3], grab / r[2], grab / r[3])
                },
                onDragEnd = { handle = null },
                onDragCancel = { handle = null },
            ) { change, drag ->
                val h = handle ?: return@detectDragGestures
                change.consume()
                total += drag
                val r = ZoomMath.fitRect(size.width, size.height, frameWidth, frameHeight, framePx)
                currentChange(CropMath.drag(start, h, total.x / r[2], total.y / r[3], currentRatio, frameWidth, frameHeight))
            }
        },
    ) {
        val r = ZoomMath.fitRect(size.width.toInt(), size.height.toInt(), frameWidth, frameHeight, framePx)
        val left = r[0] + crop.left * r[2]
        val top = r[1] + crop.top * r[3]
        val right = r[0] + crop.right * r[2]
        val bottom = r[1] + crop.bottom * r[3]
        val w = right - left
        val h = bottom - top

        // Dim what the crop cuts away.
        val shade = Color.Black.copy(alpha = 0.55f)
        drawRect(shade, Offset(r[0], r[1]), Size(r[2], top - r[1]))
        drawRect(shade, Offset(r[0], bottom), Size(r[2], r[1] + r[3] - bottom))
        drawRect(shade, Offset(r[0], top), Size(left - r[0], h))
        drawRect(shade, Offset(right, top), Size(r[0] + r[2] - right, h))

        // Fine grid to line up horizons and verticals, thirds slightly stronger.
        val fine = Color.White.copy(alpha = 0.22f)
        val thirds = Color.White.copy(alpha = 0.5f)
        val lines = 9
        for (i in 1 until lines) {
            val color = if (i % 3 == 0) thirds else fine
            val x = left + w * i / lines
            val y = top + h * i / lines
            drawLine(color, Offset(x, top), Offset(x, bottom), strokeWidth = 1f)
            drawLine(color, Offset(left, y), Offset(right, y), strokeWidth = 1f)
        }

        val border = 1.5.dp.toPx()
        drawRect(Color.White, Offset(left, top), Size(w, h), style = Stroke(border))

        // L-shaped corner handles and short edge handles.
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
}
