package app.rawboy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.rawboy.develop.BrushStroke
import app.rawboy.develop.LeakKind
import app.rawboy.develop.LightLeaks
import app.rawboy.develop.MaskLayer
import app.rawboy.develop.MaskShape
import app.rawboy.develop.Masks
import app.rawboy.gl.ZoomMath
import app.rawboy.lens.LensTransform
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

enum class MaskTool { MOVE, BRUSH, ERASE }

/** Points per drawn line or ellipse (they bend with the lens correction, as in the shader). */
private const val STEPS = 48
/** Rotation knob distance beyond the ellipse, as a fraction of its vertical radius. */
private const val KNOB = 1.3f
/** Curvature handle on a linear mask's centre line: this fraction of the long side from the middle. */
private const val CURVE_HANDLE = 0.22f
/** A new stroke point after the finger moved this fraction of the brush radius. */
private const val POINT_STEP = 0.15f
/** A second finger this soon after the first turns the touch into a pan and drops the stroke just started. */
private const val PAN_GRACE_MS = 150L

private enum class Handle { MOVE, START, END, RX, RY, ROTATE, CURVE, BEND, PIN }

/** A light leak's form, for a radial shape that is one (rx, ry = its length and width radii). */
data class LeakForm(val kind: LeakKind, val bend: Float, val taper: Float)

/**
 * Where masks sit on screen: image pixels (display orientation, full resolution) <-> preview pixels, through the
 * lens transform and the fit or zoomed placement the renderer uses. Port of web's MaskOverlay geometry.
 */
private class MaskGeometry(
    val lens: LensTransform, val view: IntSize, frame: Int, zoomFrame: Int, zoomCenter: Pair<Float, Float>?, zoomScale: Float,
) {
    val r: FloatArray = if (zoomCenter != null) {
        ZoomMath.zoomedRect(
            zoomCenter.first, zoomCenter.second, view.width, view.height, lens.outputWidth, lens.outputHeight, zoomScale, zoomFrame,
        )
    } else {
        ZoomMath.fitRect(view.width, view.height, lens.outputWidth, lens.outputHeight, frame)
    }
    val w = lens.width.toFloat()
    val h = lens.height.toFloat()
    val long = max(w, h)

    fun toScreen(x: Float, y: Float): Offset {
        val o = lens.output(x.toDouble(), y.toDouble())
        return Offset(r[0] + (o[0] / lens.outputWidth * r[2]).toFloat(), r[1] + (o[1] / lens.outputHeight * r[3]).toFloat())
    }

    fun toImage(p: Offset): Offset {
        val s = lens.source(((p.x - r[0]) / r[2] * lens.outputWidth).toDouble(), ((p.y - r[1]) / r[3] * lens.outputHeight).toDouble())
        return Offset(s[0].toFloat(), s[1].toFloat())
    }

    class Axes(val p0: Offset, val mid: Offset, val dir: Offset, val perp: Offset, val len: Float)

    fun axes(s: MaskShape.Linear): Axes {
        val dx = (s.x1 - s.x0) * w
        val dy = (s.y1 - s.y0) * h
        val len = max(hypot(dx, dy), 1e-6f)
        return Axes(
            Offset(s.x0 * w, s.y0 * h), Offset((s.x0 + s.x1) / 2 * w, (s.y0 + s.y1) / 2 * h),
            Offset(dx / len, dy / len), Offset(-dy / len, dx / len), len,
        )
    }

    /** Image-pixel corners of the whole preview (photo, frame and the space around), without lens distortion. */
    private fun viewCorners(): List<Offset> {
        val m = lens.outToImage
        return listOf(Offset(0f, 0f), Offset(view.width.toFloat(), 0f), Offset(0f, view.height.toFloat()), Offset(view.width.toFloat(), view.height.toFloat()))
            .map {
                val ox = ((it.x - r[0]) / r[2] * lens.outputWidth).toDouble()
                val oy = ((it.y - r[1]) / r[3] * lens.outputHeight).toDouble()
                Offset((m[0] * ox + m[1] * oy + m[2]).toFloat(), (m[3] * ox + m[4] * oy + m[5]).toFloat())
            }
    }

    sealed interface Shape { val pin: Offset? }
    class LinearShape(val start: List<Offset>, val centre: List<Offset>, val end: List<Offset>, override val pin: Offset, val curve: Offset) : Shape
    class RadialShape(
        val outer: List<Offset>, val inner: List<Offset>, override val pin: Offset,
        val rx: List<Offset>, val ry: List<Offset>, val knob: Offset, val knobBase: Offset, val bend: Offset? = null,
    ) : Shape
    class BrushShape(override val pin: Offset?) : Shape

    /** [leak]: a radial shape drawn as that light leak's outline (glow, streak or triangle, bent and tapered like the shader). */
    fun shape(l: MaskLayer, leak: LeakForm? = null): Shape = when (val s = l.shape) {
        MaskShape.Brush -> {
            val p = l.strokes.firstOrNull()?.points
            BrushShape(if (p != null && p.size >= 2) toScreen(p[0] * w, p[1] * h) else null)
        }
        is MaskShape.Linear -> {
            val a = axes(s)
            fun at(along: Float, across: Float): Offset {
                val t = along - Masks.curveOffset(s.curve, across, long)
                return toScreen(a.p0.x + a.dir.x * t + a.perp.x * across, a.p0.y + a.dir.y * t + a.perp.y * across)
            }
            // Across the whole preview: the perpendicular extent of its corners.
            val across = viewCorners().map { (it.x - a.p0.x) * a.perp.x + (it.y - a.p0.y) * a.perp.y }
            val lo = across.min()
            val hi = across.max()
            val n = STEPS * 2
            fun line(along: Float) = List(n + 1) { at(along, lo + (hi - lo) * it / n) }
            LinearShape(line(0f), line(a.len / 2), line(a.len), toScreen(a.mid.x, a.mid.y), at(a.len / 2, CURVE_HANDLE * long))
        }
        is MaskShape.Radial -> {
            val ang = Math.toRadians(s.angle.toDouble())
            val c = cos(ang).toFloat()
            val sn = sin(ang).toFloat()
            val rx = s.rx * long
            val ry = s.ry * long
            val cx = s.cx * w
            val cy = s.cy * h
            fun at(u: Float, v: Float) = toScreen(cx + c * u - sn * v, cy + sn * u + c * v)
            val k = if (leak != null) LightLeaks.bendCurvature(leak.bend, rx) else 0f
            // A point in the leak's own frame (q: 1 = its radii) through its taper and bend, like the shader.
            fun atQ(qx: Float, qy: Float): Offset {
                val u = qx * rx
                return at(u, qy * ry * (if (leak != null) LightLeaks.taperWidth(leak.taper, qx) else 1f) + k * u * u)
            }
            fun polygon(corners: List<Pair<Float, Float>>, n: Int) = corners.indices.flatMap { i ->
                val (ax, ay) = corners[i]
                val (bx, by) = corners[(i + 1) % corners.size]
                List(n) { j -> atQ(ax + (bx - ax) * j / n, ay + (by - ay) * j / n) }
            }
            fun outline(sc: Float) = when (leak?.kind) {
                LeakKind.STREAK -> polygon(listOf(1f to sc, -1f to sc, -1f to -sc, 1f to -sc), STEPS) // edges at sc x the half width
                LeakKind.TRIANGLE -> polygon(listOf(sc to 0f, -sc to sc, -sc to -sc), STEPS)
                else -> List(STEPS) {
                    val t = it.toFloat() / STEPS * 2 * Math.PI.toFloat()
                    atQ(sc * cos(t), sc * sin(t))
                }
            }
            // A thin leak's knob keeps clear of its width handles.
            val knob = if (leak != null) max(ry * KNOB, ry + 0.06f * long) else ry * KNOB
            RadialShape(
                outline(1f), outline(1f - (s.feather / 100f).coerceIn(0.01f, 0.95f)), at(0f, 0f),
                listOf(atQ(1f, 0f), atQ(-1f, 0f)),
                // A triangle's width handles: its base corners.
                if (leak?.kind == LeakKind.TRIANGLE) listOf(atQ(-1f, 1f), atQ(-1f, -1f)) else listOf(at(0f, ry), at(0f, -ry)),
                at(0f, -knob), at(0f, -ry),
                if (leak != null) atQ(0.5f, 0f) else null,
            )
        }
    }

    /** The bend (-100..100) that puts a leak's axis through image point [to], or null too near its middle. */
    fun bendAt(s: MaskShape, to: Offset): Float? {
        if (s !is MaskShape.Radial) return null
        val a = Math.toRadians(s.angle.toDouble())
        val dx = to.x - s.cx * w
        val dy = to.y - s.cy * h
        val rx = s.rx * long
        val u = (cos(a) * dx + sin(a) * dy).toFloat()
        val v = (-sin(a) * dx + cos(a) * dy).toFloat()
        if (abs(u) < rx * 0.15f) return null
        // v = k u², k = bend / 100 / rx.
        return ((100f * v * rx / (u * u)).coerceIn(-100f, 100f) * 10).roundToInt() / 10f
    }

    /** The shape after dragging [handle] from image point [from] to [to]. */
    fun drag(s: MaskShape, handle: Handle, from: Offset, to: Offset): MaskShape {
        val dx = (to.x - from.x) / w
        val dy = (to.y - from.y) / h
        return when (s) {
            MaskShape.Brush -> s
            is MaskShape.Linear -> when (handle) {
                Handle.CURVE -> {
                    // The bend that puts the centre line through the finger.
                    val a = axes(s)
                    val vx = to.x - a.mid.x
                    val vy = to.y - a.mid.y
                    val across = vx * a.perp.x + vy * a.perp.y
                    if (abs(across) < long * 0.02f) return s
                    val along = vx * a.dir.x + vy * a.dir.y
                    val curve = -along * long * 100f / (Masks.CURVE_SCALE * 4f * across * across)
                    s.copy(curve = (curve.coerceIn(-100f, 100f) * 10).roundToInt() / 10f)
                }
                Handle.START -> s.copy(x0 = s.x0 + dx, y0 = s.y0 + dy)
                Handle.END -> s.copy(x1 = s.x1 + dx, y1 = s.y1 + dy)
                else -> s.copy(x0 = s.x0 + dx, y0 = s.y0 + dy, x1 = s.x1 + dx, y1 = s.y1 + dy)
            }
            is MaskShape.Radial -> {
                if (handle == Handle.MOVE) return s.copy(cx = s.cx + dx, cy = s.cy + dy)
                val vx = to.x - s.cx * w
                val vy = to.y - s.cy * h
                val a = Math.toRadians(s.angle.toDouble())
                if (handle == Handle.ROTATE) {
                    var deg = Math.toDegrees(atan2(vy.toDouble(), vx.toDouble())) + 90
                    if (deg > 180) deg -= 360
                    return s.copy(angle = (deg * 10).roundToInt() / 10f)
                }
                // Radius along the ellipse's own (rotated) axis.
                val u = abs(cos(a) * vx + sin(a) * vy).toFloat()
                val v = abs(-sin(a) * vx + cos(a) * vy).toFloat()
                if (handle == Handle.RX) s.copy(rx = max(0.01f, u / long)) else s.copy(ry = max(0.01f, v / long))
            }
        }
    }

    /** Brush radius on screen: one radius along x from the image point under [p]. */
    fun brushRadiusOnScreen(p: Offset, radius: Float): Float {
        val c = toImage(p)
        val e = toScreen(c.x + radius * long, c.y)
        return max(2f, hypot(e.x - p.x, e.y - p.y))
    }
}

private fun dist2ToSegment(p: Offset, a: Offset, b: Offset): Float {
    val dx = b.x - a.x
    val dy = b.y - a.y
    val len2 = dx * dx + dy * dy
    val t = if (len2 > 0) (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).coerceIn(0f, 1f) else 0f
    val x = a.x + t * dx - p.x
    val y = a.y + t * dy - p.y
    return x * x + y * y
}

private fun nearLine(p: Offset, line: List<Offset>, d: Float) = (1 until line.size).any { dist2ToSegment(p, line[it - 1], line[it]) < d * d }
private fun near(p: Offset, q: Offset, d: Float) = (p - q).getDistanceSquared() < d * d

/** Preview point [p] lies inside a radial shape's outer ellipse (a leak: its outline). */
private fun inside(g: MaskGeometry, l: MaskLayer, p: Offset, leak: LeakForm?): Boolean {
    val s = l.shape as? MaskShape.Radial ?: return false
    val q = g.toImage(p)
    val a = Math.toRadians(s.angle.toDouble())
    val dx = q.x - s.cx * g.w
    val dy = q.y - s.cy * g.h
    val rx = s.rx * g.long
    val pu = (cos(a) * dx + sin(a) * dy).toFloat()
    var pv = (-sin(a) * dx + cos(a) * dy).toFloat()
    if (leak == null) return (pu / rx) * (pu / rx) + (pv / (s.ry * g.long)) * (pv / (s.ry * g.long)) < 1
    pv -= LightLeaks.bendCurvature(leak.bend, rx) * pu * pu
    val qx = pu / rx
    val qy = pv / (s.ry * g.long * LightLeaks.taperWidth(leak.taper, qx))
    return LightLeaks.edge(leak.kind, qx, qy) < 0 && (leak.kind != LeakKind.STREAK || abs(qx) < 1)
}

/**
 * [grabInside]: a touch anywhere inside a radial shape grabs it (light leaks), not only its centre pin. [leaks]: the
 * forms of radial shapes that are light leaks, by id.
 */
private fun hit(
    g: MaskGeometry, layers: List<MaskLayer>, selectedId: String?, p: Offset, grab: Float, grabInside: Boolean = false,
    leaks: Map<String, LeakForm> = emptyMap(),
): Pair<String, Handle>? {
    val selected = layers.firstOrNull { it.id == selectedId }
    if (selected != null) {
        when (val s = g.shape(selected, leaks[selected.id])) {
            is MaskGeometry.RadialShape -> {
                if (near(p, s.knob, grab)) return selected.id to Handle.ROTATE
                if (s.bend != null && near(p, s.bend, grab)) return selected.id to Handle.BEND
                if (s.rx.any { near(p, it, grab) }) return selected.id to Handle.RX
                if (s.ry.any { near(p, it, grab) }) return selected.id to Handle.RY
                if (near(p, s.pin, grab * 1.5f)) return selected.id to Handle.MOVE
                if (grabInside && inside(g, selected, p, leaks[selected.id])) return selected.id to Handle.MOVE
            }
            is MaskGeometry.LinearShape -> {
                if (near(p, s.curve, grab)) return selected.id to Handle.CURVE
                if (nearLine(p, s.start, grab)) return selected.id to Handle.START
                if (nearLine(p, s.end, grab)) return selected.id to Handle.END
                if (nearLine(p, s.centre, grab)) return selected.id to Handle.MOVE
            }
            is MaskGeometry.BrushShape -> Unit
        }
    }
    for (l in layers) {
        if (l.id == selectedId) continue
        val pin = g.shape(l, leaks[l.id]).pin ?: continue
        if (near(p, pin, grab)) return l.id to Handle.PIN
    }
    if (grabInside) {
        // Topmost (last drawn in the shader) first; a touch inside another shape selects it and starts moving it.
        layers.lastOrNull { it.id != selectedId && inside(g, it, p, leaks[it.id]) }?.let { return it.id to Handle.MOVE }
    }
    return null
}

/** What the mask gestures report (all on the UI thread). */
class MaskActions(
    val onSelect: (String) -> Unit,
    val onChange: (String, MaskShape) -> Unit,
    val onStrokeBegin: (String, BrushStroke) -> Unit,
    val onStrokeExtend: (String, String, List<Float>) -> Unit,
    /** The stroke just begun turned out to be a two-finger pan: drop it. */
    val onStrokeCancel: (String) -> Unit,
    val onPan: (Float, Float) -> Unit,
    /** Two fingers while painting pinch too: zoom by a factor around a view position. */
    val onZoomBy: (Float, Float, Float) -> Unit = { _, _, _ -> },
)

/**
 * Mask gestures for the preview's gesture layer: apply the returned modifier **last** in that layer's chain so it
 * sees each touch first. Move: a finger on a handle drags it (or on another layer's pin selects it); anywhere else
 * nothing is consumed, so double-tap zoom, pan, pinch and press-and-hold compare keep working; a second finger
 * during a handle drag puts the shape back and leaves both fingers to the pinch. Brush / Erase: one finger paints,
 * two fingers pan and pinch-zoom the view. [onPaintAt] gets the finger while painting (for the brush circle).
 * The inputs are read fresh for every touch, so the modifier is never restarted mid-gesture. [grabInside]: a finger
 * anywhere inside a radial shape moves it (the light leaks tool, which shows its leaks as radial shapes); [leaks]:
 * their forms by id; [onBend] gets a leak's bend handle.
 */
@Composable
fun rememberMaskGestures(
    lens: LensTransform,
    layers: List<MaskLayer>,
    selectedId: String?,
    frame: Int,
    zoomFrame: Int,
    zoomCenter: Pair<Float, Float>?,
    tool: MaskTool,
    brush: BrushSettings,
    actions: MaskActions,
    onPaintAt: (Offset?) -> Unit,
    grabInside: Boolean = false,
    leaks: Map<String, LeakForm> = emptyMap(),
    onBend: (String, Float) -> Unit = { _, _ -> },
    zoomScale: Float = 1f,
): Modifier {
    val grab = with(LocalDensity.current) { 24.dp.toPx() }
    val current = rememberUpdatedState(
        GestureInputs(lens, layers, selectedId, frame, zoomFrame, zoomCenter, zoomScale, tool, brush, actions, onPaintAt, grabInside, leaks, onBend),
    )
    return Modifier.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val inp = current.value
            val g = MaskGeometry(inp.lens, size, inp.frame, inp.zoomFrame, inp.zoomCenter, inp.zoomScale)
            if (inp.tool == MaskTool.MOVE) {
                val (id, handle) = hit(g, inp.layers, inp.selectedId, down.position, grab, inp.grabInside, inp.leaks) ?: return@awaitEachGesture
                down.consume()
                if (handle == Handle.PIN) {
                    inp.actions.onSelect(id)
                    return@awaitEachGesture
                }
                if (id != inp.selectedId) inp.actions.onSelect(id)
                val start = inp.layers.firstOrNull { it.id == id }?.shape ?: return@awaitEachGesture
                val from = g.toImage(down.position)
                while (true) {
                    val ev = awaitPointerEvent()
                    val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                    if (!c.pressed) break
                    if (ev.changes.count { it.pressed } >= 2) {
                        // A pinch, not a drag: put the shape back and leave the fingers to the preview's pinch.
                        inp.actions.onChange(id, start)
                        break
                    }
                    c.consume()
                    if (handle == Handle.BEND) {
                        g.bendAt(start, g.toImage(c.position))?.let { inp.onBend(id, it) }
                        continue
                    }
                    inp.actions.onChange(id, g.drag(start, handle, from, g.toImage(c.position)))
                }
                return@awaitEachGesture
            }
            val layer = inp.layers.firstOrNull { it.id == inp.selectedId } ?: return@awaitEachGesture
            down.consume()
            val start = g.toImage(down.position)
            val stroke = BrushStroke(
                id = Masks.newId(),
                erase = inp.tool == MaskTool.ERASE,
                auto = inp.brush.auto,
                radius = inp.brush.radius,
                hardness = inp.brush.hardness,
                flow = inp.brush.flow,
                points = fraction(start, g),
            )
            inp.actions.onStrokeBegin(layer.id, stroke)
            inp.onPaintAt(down.position)
            var last = start
            var panning = false
            while (true) {
                val ev = awaitPointerEvent()
                val pressed = ev.changes.filter { it.pressed }
                if (pressed.isEmpty()) break
                if (pressed.size >= 2 || panning) {
                    if (!panning) {
                        panning = true
                        inp.onPaintAt(null)
                        if (ev.changes[0].uptimeMillis - down.uptimeMillis < PAN_GRACE_MS) inp.actions.onStrokeCancel(layer.id)
                    }
                    if (pressed.size >= 2) {
                        val move = ev.calculatePan()
                        val factor = ev.calculateZoom()
                        val centre = ev.calculateCentroid(useCurrent = true)
                        if (move != Offset.Zero) inp.actions.onPan(move.x, move.y)
                        if (factor != 1f && centre != Offset.Unspecified) inp.actions.onZoomBy(centre.x, centre.y, factor)
                    } else {
                        // The finger left after a pinch keeps panning.
                        val c = pressed[0]
                        inp.actions.onPan(c.position.x - c.previousPosition.x, c.position.y - c.previousPosition.y)
                    }
                    ev.changes.forEach { it.consume() }
                    continue
                }
                val c = pressed[0]
                c.consume()
                inp.onPaintAt(c.position)
                val img = g.toImage(c.position)
                if (hypot(img.x - last.x, img.y - last.y) < max(0.5f, inp.brush.radius * g.long * POINT_STEP)) continue
                last = img
                inp.actions.onStrokeExtend(layer.id, stroke.id, fraction(img, g))
            }
            inp.onPaintAt(null)
        }
    }
}

private class GestureInputs(
    val lens: LensTransform,
    val layers: List<MaskLayer>,
    val selectedId: String?,
    val frame: Int,
    val zoomFrame: Int,
    val zoomCenter: Pair<Float, Float>?,
    val zoomScale: Float,
    val tool: MaskTool,
    val brush: BrushSettings,
    val actions: MaskActions,
    val onPaintAt: (Offset?) -> Unit,
    val grabInside: Boolean,
    val leaks: Map<String, LeakForm>,
    val onBend: (String, Float) -> Unit,
)

/** Image point -> stroke point (image fractions, rounded: strokes stay small in memory). */
private fun fraction(p: Offset, g: MaskGeometry) = listOf((p.x / g.w * 1e5f).roundToInt() / 1e5f, (p.y / g.h * 1e5f).roundToInt() / 1e5f)

/**
 * Draws the masks over the preview (fit or 100% view), Capture One style. Linear: the full-effect, centre and
 * no-effect lines across the whole preview, the curvature square; radial: the ellipse, its feather ring, centre,
 * radius dots and rotation knob; other layers: a pin. While painting the shapes are dimmed and a circle follows the
 * finger; [sizeRing] shows the brush size in the middle (while its slider moves). [leaks]: forms of radial shapes
 * that are light leaks, by id (drawn as their outlines, with a bend square).
 */
@Composable
fun MaskOverlay(
    lens: LensTransform,
    layers: List<MaskLayer>,
    selectedId: String?,
    frame: Int,
    zoomFrame: Int,
    zoomCenter: Pair<Float, Float>?,
    tool: MaskTool,
    brush: BrushSettings,
    paintAt: Offset?,
    sizeRing: Boolean,
    modifier: Modifier = Modifier,
    leaks: Map<String, LeakForm> = emptyMap(),
    zoomScale: Float = 1f,
) {
    val density = LocalDensity.current
    Canvas(modifier) {
        val g = MaskGeometry(lens, IntSize(size.width.roundToInt(), size.height.roundToInt()), frame, zoomFrame, zoomCenter, zoomScale)
        val px = density.density
        val dim = if (tool == MaskTool.MOVE) 1f else 0.4f
        for (l in layers) {
            val s = g.shape(l, leaks[l.id])
            if (l.id != selectedId) {
                s.pin?.let { dot(it, 6 * px, filled = false, alpha = if (l.enabled) dim else dim * 0.5f) }
                continue
            }
            when (s) {
                is MaskGeometry.LinearShape -> {
                    line(s.start, 1.5f * px, dim)
                    line(s.centre, 2.5f * px, dim)
                    line(s.end, 1.5f * px, dim, dashed = true)
                    dot(s.pin, 6 * px, filled = true, alpha = dim)
                    val half = 6 * px
                    drawRect(Color.Black.copy(alpha = 0.35f * dim), Offset(s.curve.x - half, s.curve.y - half), Size(2 * half, 2 * half))
                    drawRect(Color.White.copy(alpha = dim), Offset(s.curve.x - half, s.curve.y - half), Size(2 * half, 2 * half), style = Stroke(1.5f * px))
                }
                is MaskGeometry.RadialShape -> {
                    line(s.outer, 2 * px, dim, closed = true)
                    line(s.inner, 1.2f * px, dim, dashed = true, closed = true)
                    line(listOf(s.knobBase, s.knob), 1.2f * px, dim)
                    dot(s.knob, 7 * px, filled = false, alpha = dim)
                    (s.rx + s.ry).forEach { dot(it, 6 * px, filled = true, alpha = dim) }
                    s.bend?.let {
                        val half = 6 * px
                        drawRect(Color.Black.copy(alpha = 0.35f * dim), Offset(it.x - half, it.y - half), Size(2 * half, 2 * half))
                        drawRect(Color.White.copy(alpha = dim), Offset(it.x - half, it.y - half), Size(2 * half, 2 * half), style = Stroke(1.5f * px))
                    }
                    dot(s.pin, 8 * px, filled = true, alpha = dim)
                }
                is MaskGeometry.BrushShape -> Unit
            }
        }
        if (tool != MaskTool.MOVE) {
            paintAt?.let { ring(it, g.brushRadiusOnScreen(it, brush.radius), brush.hardness, px) }
            if (sizeRing) {
                val c = Offset(size.width / 2, size.height / 2)
                ring(c, g.brushRadiusOnScreen(c, brush.radius), brush.hardness, px)
            }
        }
    }
}

private fun DrawScope.line(pts: List<Offset>, width: Float, alpha: Float, dashed: Boolean = false, closed: Boolean = false) {
    if (pts.size < 2) return
    val path = Path().apply {
        moveTo(pts[0].x, pts[0].y)
        for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
        if (closed) close()
    }
    val effect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(6 * width / 1.5f, 5 * width / 1.5f)) else null
    drawPath(path, Color.Black.copy(alpha = 0.45f * alpha), style = Stroke(width + 2f * density, pathEffect = effect))
    drawPath(path, Color.White.copy(alpha = alpha), style = Stroke(width, pathEffect = effect))
}

private fun DrawScope.dot(p: Offset, radius: Float, filled: Boolean, alpha: Float) {
    drawCircle(if (filled) Color.White.copy(alpha = alpha) else Color.Black.copy(alpha = 0.35f * alpha), radius, p)
    drawCircle(Color.White.copy(alpha = alpha), radius, p, style = Stroke(1.5f * density))
}

private fun DrawScope.ring(c: Offset, r: Float, hardness: Float, px: Float) {
    drawCircle(Color.Black.copy(alpha = 0.5f), r, c, style = Stroke(3 * px))
    drawCircle(Color.White, r, c, style = Stroke(1.2f * px))
    if (hardness > 0) {
        drawCircle(
            Color.White, r * hardness / 100f * 0.95f, c,
            style = Stroke(1 * px, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3 * px, 3 * px))),
        )
    }
}
