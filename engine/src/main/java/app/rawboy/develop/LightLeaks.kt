package app.rawboy.develop

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/** What a light leak looks like: a straight beam across the photo, or an uneven elliptical blob. */
enum class LeakKind(val label: String, val rx: Float, val ry: Float, val softness: Float) {
    STREAK("Streak", 0.5f, 0.05f, 60f),
    GLOW("Glow", 0.16f, 0.11f, 50f),
}

/**
 * A light leak (Pro; mirrored in web's LightLeaks.ts): film-style warm light over the finished picture, dragged into
 * place on the photo. At full intensity its core replaces what is under it, so it can tastefully cover part of a
 * photo (shaders/light_leak.glsl). A [LeakKind.STREAK] is a straight beam (white-hot middle line, coloured edges,
 * fading out past its ends), a [LeakKind.GLOW] an uneven elliptical blob.
 *
 * Geometry is a radial mask's ([MaskShape.Radial]): centre (cx, cy) in fractions of the decoded image, radii rx/ry as
 * fractions of its long side (a streak: half length, half width), angle in degrees (clockwise), so a leak stays on the
 * same content through crop, rotation and lens corrections. softness 0..100 = the outer part of the radius (a
 * streak's width) over which the light fades (the rest is its solid core); intensity 0..100 (glow up to ~60, then it also covers: fully in the core at 100); hue in
 * degrees, -40 (magenta-red) .. 0 (red) .. 30 (orange) .. 60 (yellow); seed 0..1 picks the rim's uneven shape.
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
    val angle: Float = -20f,
    val softness: Float = kind.softness,
    val intensity: Float = 100f,
    val hue: Float = 22f,
    val seed: Float = 0f,
) {
    val isIdentity: Boolean get() = !enabled || intensity <= 0f

    /** The same leak as a radial mask shape (the overlay draws and drags it as one); feather = softness. */
    val shape: MaskShape.Radial get() = MaskShape.Radial(cx, cy, rx, ry, angle, max(1f, softness))

    fun withShape(s: MaskShape.Radial) = copy(cx = s.cx, cy = s.cy, rx = s.rx, ry = s.ry, angle = s.angle)

    /** This leak turned into [k], with that kind's size and softness; place, angle, colour and intensity stay. */
    fun withKind(k: LeakKind) = if (k == kind) this else copy(kind = k, rx = k.rx, ry = k.ry, softness = k.softness)
}

object LightLeaks {
    /** Uniform arrays in the shader are this long. */
    const val MAX_LEAKS = 4

    const val HUE_MIN = -40f
    const val HUE_MAX = 60f

    fun newSeed(): Float = (Random.nextFloat() * 1000f).roundToInt() / 1000f

    /** A warm orange leak, solid enough to cover what is under its core. */
    fun newLeak(kind: LeakKind = LeakKind.STREAK, cx: Float = 0.5f, cy: Float = 0.5f) =
        LightLeak(Masks.newId(), kind = kind, cx = cx, cy = cy, seed = newSeed())

    // A photo's edits ([Edits]; the same JSON as web's LightLeaks.ts: kind "streak" or "glow").

    fun toJson(leaks: List<LightLeak>): JSONArray = JSONArray(
        leaks.map { l ->
            JSONObject().apply {
                put("enabled", l.enabled); put("kind", l.kind.name.lowercase())
                put("cx", num(l.cx)); put("cy", num(l.cy)); put("rx", num(l.rx)); put("ry", num(l.ry))
                put("angle", num(l.angle)); put("softness", num(l.softness)); put("intensity", num(l.intensity))
                put("hue", num(l.hue)); put("seed", num(l.seed))
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
        val kind = if (o.optString("kind") == "streak") LeakKind.STREAK else LeakKind.GLOW // leaks saved before streaks were glows
        return LightLeak(
            id = Masks.newId(),
            enabled = o.opt("enabled") as? Boolean ?: true,
            kind = kind,
            cx = f("cx", -1f, 2f) ?: return null,
            cy = f("cy", -1f, 2f) ?: return null,
            rx = f("rx", 0.005f, 3f) ?: return null,
            ry = f("ry", 0.005f, 3f) ?: return null,
            angle = f("angle", -360f, 360f) ?: 0f,
            softness = f("softness", 0f, 100f) ?: 50f,
            intensity = f("intensity", 0f, 100f) ?: 100f,
            hue = f("hue", HUE_MIN, HUE_MAX) ?: 22f,
            seed = f("seed", 0f, 1f) ?: 0f,
        )
    }

    /** Floats via their shortest decimal, so 0.1 is written as 0.1. */
    private fun num(f: Float): Double = f.toString().toDouble()

    /** The rim colour for [hue] (display RGB 0..1): fully saturated warm light, brightest at yellow. */
    fun color(hue: Float): FloatArray {
        val h = hue.coerceIn(HUE_MIN, HUE_MAX)
        // HSV with value 1 and saturation 0.92, hue 0 = red; negative hues lean to magenta.
        val deg = (h + 360f) % 360f
        fun f(n: Int): Float {
            val k = (n + deg / 60f) % 6f
            return 1f - 0.92f * max(0f, min(min(k, 4f - k), 1f))
        }
        return floatArrayOf(f(5), f(3), f(1))
    }

    /** Packs the leaks that show; positions go from image fractions to full-resolution image pixels. */
    fun pack(leaks: List<LightLeak>, imageWidth: Int, imageHeight: Int): LeakUniforms {
        val used = leaks.filter { !it.isIdentity }.take(MAX_LEAKS)
        if (used.isEmpty()) return LeakUniforms.NONE
        val geom = FloatArray(MAX_LEAKS * 4)
        val shape = FloatArray(MAX_LEAKS * 4)
        val color = FloatArray(MAX_LEAKS * 4)
        val long = max(imageWidth, imageHeight).toFloat()
        used.forEachIndexed { i, l ->
            val o = i * 4
            val a = l.angle * PI.toFloat() / 180f
            floatArrayOf(l.cx * imageWidth, l.cy * imageHeight, 1f / max(l.rx * long, 1f), 1f / max(l.ry * long, 1f)).copyInto(geom, o)
            floatArrayOf(cos(a), sin(a), (l.softness / 100f).coerceIn(0f, 1f), l.seed + if (l.kind == LeakKind.STREAK) 2f else 0f).copyInto(shape, o)
            val c = color(l.hue)
            floatArrayOf(c[0], c[1], c[2], (l.intensity / 100f).coerceIn(0f, 1f)).copyInto(color, o)
        }
        return LeakUniforms(used.size, geom, shape, color)
    }
}

/** Leaks packed for the shader's uniform arrays (see shaders/light_leak.glsl). */
class LeakUniforms(val count: Int, val geom: FloatArray, val shape: FloatArray, val color: FloatArray) {
    companion object {
        val NONE = LeakUniforms(0, FloatArray(16), FloatArray(16), FloatArray(16))
    }
}
