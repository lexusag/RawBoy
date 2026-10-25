package app.rawboy.develop

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * What a light leak looks like, with the size, angle, softness and glow a new one starts with: a straight beam across
 * the photo, an ellipse, or a triangle (apex along its angle). [index] is the shader's kind number.
 */
enum class LeakKind(
    val label: String,
    val index: Int,
    val rx: Float,
    val ry: Float,
    val angle: Float,
    val softness: Float,
    val glow: Float,
) {
    STREAK("Streak", 1, 0.6f, 0.015f, -20f, 60f, 55f),
    GLOW("Glow", 0, 0.09f, 0.09f, 0f, 45f, 18f),
    TRIANGLE("Triangle", 2, 0.12f, 0.11f, -90f, 40f, 18f),
}

/**
 * A light leak (Pro; mirrored in web's LightLeaks.ts): film-style light over the finished picture, dragged into place
 * on the photo, made like a Photoshop light leak: a white shape, blurred, with an orange then a red outer glow, all in
 * Screen mode (shaders/light_leak.glsl). The photo shows through the glow; at full intensity the white core hides
 * what is under it, so a leak can tastefully cover part of a photo. The photo's grain lies over the leak.
 *
 * Geometry is a radial mask's ([MaskShape.Radial]): centre (cx, cy) in fractions of the decoded image, radii rx/ry as
 * fractions of its long side (a streak: half length, half width; a triangle: apex to base, half base), angle in
 * degrees (clockwise), so a leak stays on the same content through crop, rotation and lens corrections.
 * softness 0..100 = the core's blur; glow 0..100 = how far the coloured glow reaches; bend -100..100 curves the shape
 * along its length (100: its ends move one length radius sideways); taper -100..100 narrows it towards one end; warp
 * 0..100 makes its edge uneven (seed 0..1 picks how); intensity 0..100; hue in degrees, -40 (magenta-red) .. 0 (red)
 * .. 37 (orange) .. 60 (yellow), the outer glow 37° redder.
 *
 * Leaks belong to one photo's content: they reset for each new photo and presets don't keep them.
 */
data class LightLeak(
    val id: String,
    val enabled: Boolean = true,
    val kind: LeakKind = LeakKind.STREAK,
    val cx: Float,
    val cy: Float,
    val rx: Float = kind.rx,
    val ry: Float = kind.ry,
    val angle: Float = kind.angle,
    val softness: Float = kind.softness,
    val glow: Float = kind.glow,
    val bend: Float = 0f,
    val taper: Float = 0f,
    val warp: Float = 0f,
    val intensity: Float = 100f,
    val hue: Float = LightLeaks.HUE,
    val seed: Float = 0f,
) {
    val isIdentity: Boolean get() = !enabled || intensity <= 0f

    /**
     * The same leak as a radial mask shape (the overlay draws and drags it as one); its feather ring marks where the
     * blurred core is fully white (the shader's blur, 0.03 + 0.6 x softness, in shape radii).
     */
    val shape: MaskShape.Radial get() = MaskShape.Radial(cx, cy, rx, ry, angle, 3f + 0.6f * softness)

    fun withShape(s: MaskShape.Radial) = copy(cx = s.cx, cy = s.cy, rx = s.rx, ry = s.ry, angle = s.angle)

    /** This leak turned into [k], with that kind's size, angle, softness and glow; place, bend, colour and intensity stay. */
    fun withKind(k: LeakKind) =
        if (k == kind) this else copy(kind = k, rx = k.rx, ry = k.ry, angle = k.angle, softness = k.softness, glow = k.glow)
}

object LightLeaks {
    /** Uniform arrays in the shader are this long. */
    const val MAX_LEAKS = 4

    const val HUE_MIN = -40f
    const val HUE_MAX = 60f

    /** The default hue: Photoshop's (255, 156, 0) orange. */
    const val HUE = 37f

    /** The outer glow's hue is this much redder: (255, 5, 5) beside that orange. */
    private const val OUTER_SHIFT = 37f

    /** The leak triangle's inradius in shape radii (base 2, height 2). */
    private const val TRIANGLE_INRADIUS = 0.618f

    fun newSeed(): Float = (Random.nextFloat() * 1000f).roundToInt() / 1000f

    /** A warm orange leak, solid enough to cover what is under its core. */
    fun newLeak(kind: LeakKind = LeakKind.STREAK, cx: Float = 0.5f, cy: Float = 0.5f) =
        LightLeak(Masks.newId(), kind = kind, cx = cx, cy = cy, seed = newSeed())

    // A photo's edits ([Edits]; the same JSON as web's LightLeaks.ts: kind "streak", "glow" or "triangle").

    fun toJson(leaks: List<LightLeak>): JSONArray = JSONArray(
        leaks.map { l ->
            JSONObject().apply {
                put("enabled", l.enabled); put("kind", l.kind.name.lowercase())
                put("cx", num(l.cx)); put("cy", num(l.cy)); put("rx", num(l.rx)); put("ry", num(l.ry))
                put("angle", num(l.angle)); put("softness", num(l.softness)); put("glow", num(l.glow))
                put("bend", num(l.bend)); put("taper", num(l.taper)); put("warp", num(l.warp))
                put("intensity", num(l.intensity)); put("hue", num(l.hue)); put("seed", num(l.seed))
            }
        },
    )

    /** Leaks from untrusted JSON, each with a fresh id: invalid ones are dropped, ranges clamped, at most [MAX_LEAKS]. */
    fun parseLeaks(v: Any?): List<LightLeak> {
        val a = v as? JSONArray ?: return emptyList()
        return (0 until a.length()).mapNotNull { parseLeak(a.opt(it)) }.take(MAX_LEAKS)
    }

    private fun parseLeak(v: Any?): LightLeak? {
        val o = v as? JSONObject ?: return null
        fun f(k: String, min: Float, max: Float) = (o.opt(k) as? Number)?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(min, max)
        val kind = when (o.optString("kind")) {
            "streak" -> LeakKind.STREAK
            "triangle" -> LeakKind.TRIANGLE
            else -> LeakKind.GLOW // leaks saved before streaks were glows
        }
        return LightLeak(
            id = Masks.newId(),
            enabled = o.opt("enabled") as? Boolean ?: true,
            kind = kind,
            cx = f("cx", -1f, 2f) ?: return null,
            cy = f("cy", -1f, 2f) ?: return null,
            rx = f("rx", 0.002f, 3f) ?: return null,
            ry = f("ry", 0.002f, 3f) ?: return null,
            angle = f("angle", -360f, 360f) ?: 0f,
            softness = f("softness", 0f, 100f) ?: kind.softness,
            glow = f("glow", 0f, 100f) ?: kind.glow,
            bend = f("bend", -100f, 100f) ?: 0f,
            taper = f("taper", -100f, 100f) ?: 0f,
            warp = f("warp", 0f, 100f) ?: 0f,
            intensity = f("intensity", 0f, 100f) ?: 100f,
            hue = f("hue", HUE_MIN, HUE_MAX) ?: HUE,
            seed = f("seed", 0f, 1f) ?: 0f,
        )
    }

    /** Floats via their shortest decimal, so 0.1 is written as 0.1. */
    private fun num(f: Float): Double = f.toString().toDouble()

    /** Fully saturated light of [hue] (display RGB 0..1), hue 0 = red, negative hues lean to magenta. */
    private fun hueColor(hue: Float): FloatArray {
        val deg = ((hue % 360f) + 360f) % 360f
        fun f(n: Int): Float {
            val k = (n + deg / 60f) % 6f
            return 1f - max(0f, min(min(k, 4f - k), 1f))
        }
        return floatArrayOf(f(5), f(3), f(1))
    }

    /** The inner glow colour for [hue] (display RGB 0..1). */
    fun color(hue: Float): FloatArray = hueColor(hue.coerceIn(HUE_MIN, HUE_MAX))

    /** The outer glow colour for [hue]: the same light, redder. */
    fun outerColor(hue: Float): FloatArray = hueColor(hue.coerceIn(HUE_MIN, HUE_MAX) - OUTER_SHIFT)

    /** The glow slider 0..100 as the shader's glow reach, in shape radii. */
    fun glowReach(glow: Float): Float = 0.03f + glow.coerceIn(0f, 100f) / 100f * 3f

    /** The bend slider as the axis's curvature in 1/px for a length radius of [rxPx] pixels: v = k u². */
    fun bendCurvature(bend: Float, rxPx: Float): Float = (bend / 100f).coerceIn(-1f, 1f) / max(rxPx, 1f)

    /** The taper's width factor at [qx] (-1..1 along the length). */
    fun taperWidth(taper: Float, qx: Float): Float = max(1f + taper / 100f * qx.coerceIn(-1f, 1f), 0.05f)

    /**
     * Signed edge distance in shape radii (0 on the outline, negative inside) of a point (qx, qy) in the shape's own
     * frame after bend and taper (the shader's leakEdge, without the warp). Triangle: apex (1, 0), base corners
     * (-1, ±1), exact distance outside, inside scaled by its inradius so the middle is -1 as for the other shapes.
     */
    fun edge(kind: LeakKind, qx: Float, qy: Float): Float = when (kind) {
        LeakKind.STREAK -> abs(qy) - 1f
        LeakKind.GLOW -> hypot(qx, qy) - 1f
        LeakKind.TRIANGLE -> {
            fun segment(ax: Float, ay: Float, bx: Float, by: Float): Float {
                val ex = bx - ax
                val ey = by - ay
                val t = (((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey)).coerceIn(0f, 1f)
                return hypot(qx - ax - ex * t, qy - ay - ey * t)
            }
            val d = min(min(segment(1f, 0f, -1f, 1f), segment(-1f, 1f, -1f, -1f)), segment(-1f, -1f, 1f, 0f))
            if (qx > -1f && qx + 2f * abs(qy) < 1f) -d / TRIANGLE_INRADIUS else d
        }
    }

    /** Packs the leaks that show; positions go from image fractions to full-resolution image pixels. */
    fun pack(leaks: List<LightLeak>, imageWidth: Int, imageHeight: Int): LeakUniforms {
        val used = leaks.filter { !it.isIdentity }.take(MAX_LEAKS)
        if (used.isEmpty()) return LeakUniforms.NONE
        val u = LeakUniforms.empty(used.size)
        val long = max(imageWidth, imageHeight).toFloat()
        used.forEachIndexed { i, l ->
            val o = i * 4
            val a = l.angle * PI.toFloat() / 180f
            val rxPx = max(l.rx * long, 1f)
            floatArrayOf(l.cx * imageWidth, l.cy * imageHeight, 1f / rxPx, 1f / max(l.ry * long, 1f)).copyInto(u.geom, o)
            floatArrayOf(cos(a), sin(a), (l.softness / 100f).coerceIn(0f, 1f), glowReach(l.glow)).copyInto(u.shape, o)
            val c = color(l.hue)
            floatArrayOf(c[0], c[1], c[2], (l.intensity / 100f).coerceIn(0f, 1f)).copyInto(u.color, o)
            val oc = outerColor(l.hue)
            floatArrayOf(oc[0], oc[1], oc[2], l.seed).copyInto(u.outer, o)
            floatArrayOf(
                l.kind.index.toFloat(), bendCurvature(l.bend, rxPx), (l.warp / 100f).coerceIn(0f, 1f),
                (l.taper / 100f).coerceIn(-1f, 1f),
            ).copyInto(u.form, o)
        }
        return u
    }
}

/** Leaks packed for the shader's uniform arrays (see shaders/light_leak.glsl), MAX_LEAKS x vec4 each. */
class LeakUniforms(
    val count: Int,
    val geom: FloatArray,
    val shape: FloatArray,
    val color: FloatArray,
    val outer: FloatArray,
    val form: FloatArray,
) {
    companion object {
        private const val N = LightLeaks.MAX_LEAKS * 4

        fun empty(count: Int) = LeakUniforms(count, FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N))

        val NONE = empty(0)
    }
}
