package app.rawboy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.rawboy.develop.CurveChannel
import app.rawboy.develop.CurvePoint
import app.rawboy.develop.ToneCurves
import kotlin.math.abs
import kotlin.math.roundToInt

/** Finger distance that grabs a point or the curve; touches farther away scroll the panel instead. */
private val GRAB_RADIUS = 24.dp
private const val DOUBLE_TAP_MS = 350L
/** The curve box: width / height, and its widest (web's styles.css on phones and iOS match). */
private const val ASPECT = 2f
private val MAX_WIDTH = 400.dp
/** Margin between the box's edge and the curve area, so the end points sit inside the box, clear of the panel's edges (web: styles.css). */
private val INSET = 14.dp

@Composable
private fun curveColor(c: CurveChannel): Color = when (c) {
    CurveChannel.RGB -> MaterialTheme.colorScheme.onSurface
    CurveChannel.RED -> Color(0xFFFF5A5A)
    CurveChannel.GREEN -> Color(0xFF5AD46A)
    CurveChannel.BLUE -> Color(0xFF5A9CFF)
}

/**
 * Curves in the Light tab (web: CurvesPanel.tsx, iOS: CurvesPanel.swift): a channel picker and a point-curve editor
 * twice as wide as tall, so it leaves the short panel under the photo room for the rest. Touch the curve to add a point on it, drag a point to move it, double-tap a point to remove it. Touches
 * elsewhere in the box aren't consumed, so they scroll the panel. The curve area sits [INSET] inside the box, outlined,
 * so the end points can be grabbed without reaching for the panel's edge.
 */
@Composable
internal fun CurvesPanel(curves: ToneCurves, onChange: (ToneCurves) -> Unit) {
    var channel by rememberSaveable { mutableStateOf(CurveChannel.RGB) }
    var selected by remember { mutableIntStateOf(-1) }
    val current by rememberUpdatedState(curves)
    val change by rememberUpdatedState(onChange)
    val points = curves[channel]
    val color = curveColor(channel)
    val grid = MaterialTheme.colorScheme.outlineVariant
    val fill = MaterialTheme.colorScheme.surface
    val accent = MaterialTheme.colorScheme.primary

    Column {
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (c in CurveChannel.entries) {
                FilterChip(
                    selected = c == channel,
                    onClick = {
                        channel = c
                        selected = -1
                    },
                    label = { Text(if (ToneCurves.isIdentity(curves[c])) c.label else "${c.label} •") },
                )
            }
            TextButton(onClick = { onChange(curves.with(channel, ToneCurves.IDENTITY)) }, enabled = !ToneCurves.isIdentity(points)) {
                Text("Reset")
            }
        }
        Canvas(
            Modifier
                // widthIn before fillMaxWidth: the other way round the full width overrides the cap.
                .widthIn(max = MAX_WIDTH)
                .fillMaxWidth()
                .aspectRatio(ASPECT)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
                .pointerInput(channel) {
                    var lastTapTime = 0L
                    var lastTapIndex = -1
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        val inset = INSET.toPx()
                        val w = (size.width - 2 * inset).coerceAtLeast(1f)
                        val h = (size.height - 2 * inset).coerceAtLeast(1f)
                        fun toCurve(o: Offset) = CurvePoint((o.x - inset) / w, 1f - (o.y - inset) / h)
                        val at = toCurve(down.position)
                        // The working copy: moves never act on a composition that hasn't caught up with the last change.
                        var pts = current[channel]
                        val grab = GRAB_RADIUS.toPx()
                        var index = ToneCurves.nearest(pts, at.x, at.y, grab / w, h / w)
                        if (index >= 0 && index == lastTapIndex && down.uptimeMillis - lastTapTime < DOUBLE_TAP_MS) {
                            lastTapIndex = -1
                            down.consume()
                            selected = -1
                            change(current.with(channel, ToneCurves.remove(pts, index)))
                            return@awaitEachGesture
                        }
                        if (index < 0) {
                            // Off the curve: leave the touch unconsumed so the panel's scroll takes it.
                            val onCurve = ToneCurves.evaluate(pts, at.x)
                            if (abs(onCurve - at.y) * h > grab) return@awaitEachGesture
                            val added = ToneCurves.add(pts, at.x, onCurve) ?: return@awaitEachGesture
                            pts = added.first
                            index = added.second
                            change(current.with(channel, pts))
                        }
                        lastTapTime = down.uptimeMillis
                        lastTapIndex = index
                        selected = index
                        down.consume()
                        drag(down.id) { move ->
                            val p = toCurve(move.position)
                            pts = ToneCurves.move(pts, index, p.x, p.y)
                            change(current.with(channel, pts))
                            move.consume()
                        }
                    }
                },
        ) {
            val inset = INSET.toPx()
            val w = size.width - 2 * inset
            val h = size.height - 2 * inset
            drawRect(grid, Offset(inset, inset), Size(w, h), style = Stroke(1f))
            for (g in listOf(0.25f, 0.5f, 0.75f)) {
                drawLine(grid, Offset(inset + g * w, inset), Offset(inset + g * w, inset + h), 1f)
                drawLine(grid, Offset(inset, inset + g * h), Offset(inset + w, inset + g * h), 1f)
            }
            drawLine(grid, Offset(inset, inset + h), Offset(inset + w, inset), 1f)
            val samples = ToneCurves.sample(points, 129)
            val path = Path()
            samples.forEachIndexed { i, v ->
                val x = inset + i / 128f * w
                val y = inset + (1f - v) * h
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, color, style = Stroke(2.dp.toPx()))
            val r = 6.dp.toPx()
            points.forEachIndexed { i, p ->
                val c = Offset(inset + p.x * w, inset + (1f - p.y) * h)
                drawCircle(if (i == selected) accent else fill, r, c)
                drawCircle(color, r, c, style = Stroke(2.dp.toPx()))
            }
        }
        val shown = points.getOrNull(selected)
        Text(
            if (shown != null) {
                "Input ${(shown.x * 255).roundToInt()} → output ${(shown.y * 255).roundToInt()}"
            } else {
                "Touch the curve to add a point and drag to shape it; double-tap a point to remove it."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
