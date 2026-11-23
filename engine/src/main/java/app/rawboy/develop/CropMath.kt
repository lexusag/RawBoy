package app.rawboy.develop

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * User crop: edges as fractions (0..1) of the rotated + straightened frame, i.e. the whole picture the
 * Crop & rotate tool shows. The crop is the last geometry step and never changes lens correction or the
 * straighten auto crop, which always work on the full frame.
 */
/** Which edges of the frame the crop may reach past (Extend canvas, chosen per side). */
data class ExtendSides(val left: Boolean = false, val top: Boolean = false, val right: Boolean = false, val bottom: Boolean = false) {
    val any: Boolean get() = left || top || right || bottom

    fun union(o: ExtendSides) = ExtendSides(left || o.left, top || o.top, right || o.right, bottom || o.bottom)

    /** The sides as four bits (left 1, top 2, right 4, bottom 8), for state that survives a rotation. */
    val bits: Int get() = (if (left) 1 else 0) or (if (top) 2 else 0) or (if (right) 4 else 0) or (if (bottom) 8 else 0)

    companion object {
        val NONE = ExtendSides()
        val ALL = ExtendSides(left = true, top = true, right = true, bottom = true)
        fun fromBits(b: Int) = ExtendSides(b and 1 != 0, b and 2 != 0, b and 4 != 0, b and 8 != 0)
    }
}

/**
 * How far the crop's edges are drawn to the photo's own edges while dragging (Extend canvas): [photo] is the photo's
 * rectangle in the same fractions as the crop, [tolX] / [tolY] the pull in those fractions (a few screen pixels).
 */
data class CropSnap(val photo: CropRect, val tolX: Float, val tolY: Float)

data class CropRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val isFull: Boolean get() = left == 0f && top == 0f && right == 1f && bottom == 1f

    /** True when the crop reaches past the frame, so part of the output is canvas to fill. */
    val extendsFrame: Boolean get() = left < 0f || top < 0f || right > 1f || bottom > 1f

    /** The sides the crop reaches past the frame. */
    val sides: ExtendSides get() = ExtendSides(left < 0f, top < 0f, right > 1f, bottom > 1f)
}

val DevelopParams.crop: CropRect get() = CropRect(cropLeft, cropTop, cropRight, cropBottom)

fun DevelopParams.withCrop(r: CropRect): DevelopParams =
    copy(cropLeft = r.left, cropTop = r.top, cropRight = r.right, cropBottom = r.bottom)

/** The same edit on the whole frame: what the Crop & rotate tool shows while it is open. */
fun DevelopParams.withoutCrop(): DevelopParams = withCrop(CropMath.FULL)

/** Crop aspect ratios offered by the tool, as long side : short side (orientation is chosen separately). */
enum class CropAspect(
    private val long: Double,
    private val short: Double,
    private val longLabel: String = "",
    private val shortLabel: String = "",
) {
    FREE(0.0, 0.0),
    ORIGINAL(0.0, 0.0),
    SQUARE(1.0, 1.0),
    R5_4(5.0, 4.0, "5", "4"),
    R4_3(4.0, 3.0, "4", "3"),
    R3_2(3.0, 2.0, "3", "2"),
    R16_9(16.0, 9.0, "16", "9"),
    R2_1(2.0, 1.0, "2", "1"),
    R2_39(2.39, 1.0, "2.39", "1"),
    ;

    fun label(portrait: Boolean): String = when (this) {
        FREE -> "Free"
        ORIGINAL -> "Original"
        SQUARE -> "1:1"
        else -> if (portrait) "$shortLabel:$longLabel" else "$longLabel:$shortLabel"
    }

    /** Width / height in pixels, or null for free. */
    fun ratio(frameWidth: Int, frameHeight: Int, portrait: Boolean): Double? = when (this) {
        FREE -> null
        ORIGINAL -> {
            val a = frameWidth.toDouble() / frameHeight
            if (portrait) min(a, 1 / a) else max(a, 1 / a)
        }
        else -> if (portrait) short / long else long / short
    }
}

/** Pure crop geometry shared by the Pro UI (and mirrored in web's CropMath.ts). */
object CropMath {
    val FULL = CropRect(0f, 0f, 1f, 1f)

    /** How far a crop may reach past each edge of the frame (fraction of that side); the canvas there is filled. */
    const val MAX_EXTEND = 0.3f

    /** Screen pixels the crop sticks to a photo edge. */
    const val SNAP_DP = 8

    /**
     * The canvas the crop tool shows while extending: the frame plus [MAX_EXTEND] past each chosen edge, as a crop of
     * the frame. [toView] / [fromView] map a crop to and from fractions of that canvas, so the tool's frame, grid and
     * drags work as on the plain frame, and a side that is not extended ends at the photo's edge.
     */
    fun extendedView(s: ExtendSides) = CropRect(
        if (s.left) -MAX_EXTEND else 0f, if (s.top) -MAX_EXTEND else 0f,
        1f + if (s.right) MAX_EXTEND else 0f, 1f + if (s.bottom) MAX_EXTEND else 0f,
    )

    fun toView(r: CropRect, s: ExtendSides = ExtendSides.ALL): CropRect {
        val v = extendedView(s)
        return CropRect((r.left - v.left) / v.width, (r.top - v.top) / v.height, (r.right - v.left) / v.width, (r.bottom - v.top) / v.height)
    }

    fun fromView(c: CropRect, s: ExtendSides = ExtendSides.ALL): CropRect {
        val v = extendedView(s)
        return CropRect(c.left * v.width + v.left, c.top * v.height + v.top, c.right * v.width + v.left, c.bottom * v.height + v.top)
    }

    /** [r] with each edge held to the canvas of [s]: the frame, plus [MAX_EXTEND] past the chosen sides (turning a side off). */
    fun within(r: CropRect, s: ExtendSides): CropRect {
        val v = extendedView(s)
        return CropRect(r.left.coerceIn(v.left, v.right), r.top.coerceIn(v.top, v.bottom), r.right.coerceIn(v.left, v.right), r.bottom.coerceIn(v.top, v.bottom))
    }

    /** [r] pulled back inside the frame (turning Extend off). */
    fun insideFrame(r: CropRect) = within(r, ExtendSides.NONE)

    /** Smallest crop side in frame pixels. */
    const val MIN_PIXELS = 64

    enum class Handle { MOVE, LEFT, TOP, RIGHT, BOTTOM, TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT }

    /** The crop after turning the picture by [quarterTurns] clockwise quarter turns. */
    fun rotate(r: CropRect, quarterTurns: Int): CropRect {
        var c = r
        repeat(((quarterTurns % 4) + 4) % 4) {
            // Clockwise: frame point (x, y) moves to (1 - y, x).
            c = CropRect(1f - c.bottom, c.left, 1f - c.top, c.right)
        }
        return c
    }

    /**
     * [p] with the picture as shown mirrored left-right ([vertical] false) or top-bottom. The flips are stored on the
     * unturned photo, so a sideways turn swaps the axis; the straighten angle and the crop mirror with the picture.
     */
    fun flip(p: DevelopParams, vertical: Boolean): DevelopParams {
        val f = if (vertical != (p.rotation % 2 != 0)) p.copy(flipVertical = !p.flipVertical) else p.copy(flipHorizontal = !p.flipHorizontal)
        val r = p.crop
        val crop = if (vertical) r.copy(top = 1f - r.bottom, bottom = 1f - r.top) else r.copy(left = 1f - r.right, right = 1f - r.left)
        // The keystone mirrors too: a left-right mirror turns the horizontal tilt the other way, top-bottom the vertical one.
        val g = if (vertical) {
            f.copy(perspectiveVertical = if (p.perspectiveVertical == 0f) 0f else -p.perspectiveVertical)
        } else {
            f.copy(perspectiveHorizontal = if (p.perspectiveHorizontal == 0f) 0f else -p.perspectiveHorizontal)
        }
        return g.copy(straighten = if (p.straighten == 0f) 0f else -p.straighten).withCrop(crop)
    }

    /**
     * [p]'s perspective sliders after turning the picture by [quarterTurns] clockwise quarter turns, so the keystone
     * stays on the same edges of the picture: clockwise, the vertical tilt becomes the horizontal one and the
     * horizontal the vertical (exact for one slider; with both set the two tilts apply in the other order).
     */
    fun rotatePerspective(p: DevelopParams, quarterTurns: Int): DevelopParams {
        var v = p.perspectiveVertical
        var h = p.perspectiveHorizontal
        repeat(((quarterTurns % 4) + 4) % 4) {
            val nv = h
            h = if (v == 0f) 0f else -v
            v = nv
        }
        return p.copy(perspectiveVertical = v, perspectiveHorizontal = h)
    }

    /**
     * [r] reshaped to [ratio] (width / height in pixels) with about the same area, around the same
     * centre, inside the frame. Null ratio = free: [r] unchanged.
     */
    fun withAspect(r: CropRect, ratio: Double?, frameWidth: Int, frameHeight: Int, sides: ExtendSides = ExtendSides.NONE): CropRect {
        if (ratio == null) return r
        val fw = frameWidth.toDouble()
        val fh = frameHeight.toDouble()
        val area = r.width * fw * r.height * fh
        var w = sqrt(area * ratio)
        var h = w / ratio
        val v = extendedView(sides)
        val fit = min(1.0, min(v.width * fw / w, v.height * fh / h))
        w *= fit
        h *= fit
        val cx = ((r.left + r.right) / 2 * fw).coerceIn(v.left * fw + w / 2, v.right * fw - w / 2)
        val cy = ((r.top + r.bottom) / 2 * fh).coerceIn(v.top * fh + h / 2, v.bottom * fh - h / 2)
        return fromPixels(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, fw, fh, sides)
    }

    /**
     * [start] after dragging [handle] by ([dx], [dy]) in frame fractions, kept inside the frame, at least
     * [MIN_PIXELS] wide and high, and at [ratio] (width / height in pixels) when not null. With [snap], an edge that
     * comes within its pull of the photo's edge lands on it (dragging on past the pull lets go).
     */
    fun drag(
        start: CropRect, handle: Handle, dx: Float, dy: Float,
        ratio: Double?, frameWidth: Int, frameHeight: Int, extend: Boolean = false, snap: CropSnap? = null,
    ): CropRect {
        val fw = frameWidth.toDouble()
        val fh = frameHeight.toDouble()
        // Bounds of the canvas the crop may use: the frame, plus MAX_EXTEND past each edge when extending.
        val ex = if (extend) MAX_EXTEND.toDouble() else 0.0
        val x0 = 0.0 - ex * fw // not -0.0
        val x1 = (1 + ex) * fw
        val y0 = 0.0 - ex * fh
        val y1 = (1 + ex) * fh
        val minW = min(MIN_PIXELS.toDouble(), fw)
        val minH = min(MIN_PIXELS.toDouble(), fh)
        val l = start.left * fw
        val t = start.top * fh
        val r = start.right * fw
        val b = start.bottom * fh
        var mx = dx * fw
        var my = dy * fh

        if (snap != null) {
            val all = handle == Handle.MOVE
            val xs = ArrayList<Double>(2)
            val ys = ArrayList<Double>(2)
            if (all || handle == Handle.LEFT || handle == Handle.TOP_LEFT || handle == Handle.BOTTOM_LEFT) xs += snap.photo.left * fw - l
            if (all || handle == Handle.RIGHT || handle == Handle.TOP_RIGHT || handle == Handle.BOTTOM_RIGHT) xs += snap.photo.right * fw - r
            if (all || handle == Handle.TOP || handle == Handle.TOP_LEFT || handle == Handle.TOP_RIGHT) ys += snap.photo.top * fh - t
            if (all || handle == Handle.BOTTOM || handle == Handle.BOTTOM_LEFT || handle == Handle.BOTTOM_RIGHT) ys += snap.photo.bottom * fh - b
            mx = pull(mx, xs, snap.tolX * fw)
            my = pull(my, ys, snap.tolY * fh)
        }

        if (handle == Handle.MOVE) {
            val ox = mx.coerceIn(x0 - l, x1 - r)
            val oy = my.coerceIn(y0 - t, y1 - b)
            return fromPixels(l + ox, t + oy, r + ox, b + oy, fw, fh, if (extend) ExtendSides.ALL else ExtendSides.NONE)
        }

        val movesLeft = handle == Handle.LEFT || handle == Handle.TOP_LEFT || handle == Handle.BOTTOM_LEFT
        val movesRight = handle == Handle.RIGHT || handle == Handle.TOP_RIGHT || handle == Handle.BOTTOM_RIGHT
        val movesTop = handle == Handle.TOP || handle == Handle.TOP_LEFT || handle == Handle.TOP_RIGHT
        val movesBottom = handle == Handle.BOTTOM || handle == Handle.BOTTOM_LEFT || handle == Handle.BOTTOM_RIGHT

        if (ratio == null) {
            val nl = if (movesLeft) (l + mx).coerceIn(x0, r - minW) else l
            val nr = if (movesRight) (r + mx).coerceIn(l + minW, x1) else r
            val nt = if (movesTop) (t + my).coerceIn(y0, b - minH) else t
            val nb = if (movesBottom) (b + my).coerceIn(t + minH, y1) else b
            return fromPixels(nl, nt, nr, nb, fw, fh, if (extend) ExtendSides.ALL else ExtendSides.NONE)
        }

        val horizontal = movesLeft || movesRight
        val vertical = movesTop || movesBottom
        // Anchor: the opposite edge (or corner); a single edge keeps the other axis centred.
        val ax = if (movesLeft) r else if (movesRight) l else (l + r) / 2
        val ay = if (movesTop) b else if (movesBottom) t else (t + b) / 2
        val wantW = if (horizontal) abs((if (movesLeft) l + mx else r + mx) - ax) else 0.0
        val wantH = if (vertical) abs((if (movesTop) t + my else b + my) - ay) else 0.0
        var w = max(wantW, wantH * ratio)
        // Room around the anchor, per axis (both halves when that axis stays centred).
        val roomW = when {
            movesLeft -> ax - x0
            movesRight -> x1 - ax
            else -> 2 * min(ax - x0, x1 - ax)
        }
        val roomH = when {
            movesTop -> ay - y0
            movesBottom -> y1 - ay
            else -> 2 * min(ay - y0, y1 - ay)
        }
        w = min(w, min(roomW, roomH * ratio))
        w = max(w, max(minW, minH * ratio)).coerceAtMost(min(roomW, roomH * ratio))
        val h = w / ratio
        val nl = when {
            movesLeft -> ax - w
            movesRight -> ax
            else -> ax - w / 2
        }
        val nt = when {
            movesTop -> ay - h
            movesBottom -> ay
            else -> ay - h / 2
        }
        return fromPixels(nl, nt, nl + w, nt + h, fw, fh, if (extend) ExtendSides.ALL else ExtendSides.NONE)
    }

    /**
     * The handle under frame point ([x], [y]) (fractions), with grab distances [tolX], [tolY] in fractions:
     * corners first, then edges, then inside = move. Null outside the crop.
     */
    fun handleAt(r: CropRect, x: Float, y: Float, tolX: Float, tolY: Float): Handle? {
        val nearL = abs(x - r.left) <= tolX
        val nearR = abs(x - r.right) <= tolX
        val nearT = abs(y - r.top) <= tolY
        val nearB = abs(y - r.bottom) <= tolY
        val inX = x >= r.left - tolX && x <= r.right + tolX
        val inY = y >= r.top - tolY && y <= r.bottom + tolY
        if (!inX || !inY) return null
        return when {
            nearT && nearL -> Handle.TOP_LEFT
            nearT && nearR -> Handle.TOP_RIGHT
            nearB && nearL -> Handle.BOTTOM_LEFT
            nearB && nearR -> Handle.BOTTOM_RIGHT
            nearL -> Handle.LEFT
            nearR -> Handle.RIGHT
            nearT -> Handle.TOP
            nearB -> Handle.BOTTOM
            else -> Handle.MOVE
        }
    }

    /** The offset among [offsets] that puts an edge on the photo's edge, when [want] is within [tol] of one; else [want]. */
    private fun pull(want: Double, offsets: List<Double>, tol: Double): Double {
        var best = want
        var gap = tol
        for (o in offsets) {
            if (abs(o - want) <= gap) {
                best = o
                gap = abs(o - want)
            }
        }
        return best
    }

    private fun fromPixels(l: Double, t: Double, r: Double, b: Double, fw: Double, fh: Double, sides: ExtendSides = ExtendSides.NONE): CropRect {
        val v = extendedView(sides)
        return CropRect(
            (l / fw).toFloat().coerceIn(v.left, v.right), (t / fh).toFloat().coerceIn(v.top, v.bottom),
            (r / fw).toFloat().coerceIn(v.left, v.right), (b / fh).toFloat().coerceIn(v.top, v.bottom),
        )
    }
}
