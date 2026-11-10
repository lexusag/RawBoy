package app.rawboy.develop

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

private typealias Pt = DoubleArray

/** What a light effect draws; [index] order is the JSON order of web's FX_KINDS. */
enum class FxKind(
    val label: String,
    val angle: Float,
    val amount: Float,
    val thickness: Float,
    val glow: Float,
    val hue: Float,
    val spread: Float,
    /** How much the shader bends the lines with fine noise (lightning and the sparks' arcs crackle; trails and swirls stay smooth). */
    val wobble: Float,
) {
    LIGHTNING("Lightning", 0f, 50f, 50f, 50f, 222f, 10f, 1f),
    SPARKS("Sparks", 0f, 50f, 50f, 55f, 235f, 70f, 0.6f),
    TRAILS("Trails", 0f, 50f, 50f, 45f, 285f, 45f, 0f),
    SWIRL("Swirl", 0f, 40f, 50f, 50f, 190f, 35f, 0f),
}

/**
 * A light ("lomo") effect (Pro; mirrored in web's LightEffects.ts): procedural light drawn over the finished picture
 * like a double exposure on film: lightning bolts, electric spark clusters, light-trail streaks and neon swirls, as a
 * white-hot core, a coloured glow and a wide soft halo (shaders/light_fx.glsl), exposed into the picture per channel.
 *
 * Geometry is a radial mask's ([MaskShape.Radial]): centre (cx, cy) in fractions of the decoded image, rx/ry the half
 * extent along and across as fractions of its long side, angle in degrees (clockwise). The pattern lives in its own
 * frame (-1..1 on both axes), so stretching the box stretches the pattern, while line widths and glows scale with the
 * box's mean size. amount 0..100 = how much there is (lightning branches, sparks, strands); thickness 0..100 = line
 * width (50 = as generated); glow 0..100 = how far the glow and halo reach; intensity 0..100; hue in degrees
 * (0..360); spread 0..100 = how far each line's colour may drift from it.
 *
 * The pattern is generated from [seed] + [amount] with the same generator as the web's, so a saved effect looks the
 * same on every platform. [seed] is a Double: 0..1 with 9 decimals, and a Float would pick another pattern.
 *
 * Effects belong to one photo's content, like leaks: they reset for each new photo and presets don't keep them.
 */
data class LightEffect(
    val id: String,
    val enabled: Boolean = true,
    val kind: FxKind = FxKind.LIGHTNING,
    val cx: Float = 0.5f,
    val cy: Float = 0.5f,
    val rx: Float,
    val ry: Float,
    val angle: Float = kind.angle,
    val seed: Double = 0.0,
    val amount: Float = kind.amount,
    val thickness: Float = kind.thickness,
    val glow: Float = kind.glow,
    val intensity: Float = 100f,
    val hue: Float = kind.hue,
    val spread: Float = kind.spread,
) {
    val isIdentity: Boolean get() = !enabled || intensity <= 0f

    /** The same effect as a radial mask shape (the overlay draws and drags it as one). */
    val shape: MaskShape.Radial get() = MaskShape.Radial(cx, cy, rx, ry, angle, 1f)

    fun withShape(s: MaskShape.Radial) = copy(cx = s.cx, cy = s.cy, rx = s.rx, ry = s.ry, angle = s.angle)

    /** This effect turned into [k] with that kind's amount, colour and widths; place, size, angle, intensity and seed stay. */
    fun withKind(k: FxKind) =
        if (k == kind) this else copy(kind = k, amount = k.amount, thickness = k.thickness, glow = k.glow, hue = k.hue, spread = k.spread)
}

/** One glowing line piece: from (x0, y0) to (x1, y1), half widths w0 → w1, brightness b, colour offset h (-1..1). */
class FxSegment(
    val x0: Double, val y0: Double, val x1: Double, val y1: Double,
    val w0: Double, val w1: Double, val b: Double, val h: Double,
)

/** The segments of all shown effects as the shader's RGBA32F data texture: [LightEffects.ROW] texels wide, [rows] tall. */
class FxData(val rows: Int, val data: FloatArray)

/** Effects packed for the shader's uniform arrays (see shaders/light_fx.glsl), MAX_EFFECTS x vec4 each. */
class FxUniforms(
    val count: Int,
    val geom: FloatArray,
    val shape: FloatArray,
    val color: FloatArray,
    val range: FloatArray,
    /** null when no effect shows. */
    val data: FxData?,
) {
    companion object {
        private const val N = LightEffects.MAX_EFFECTS * 4

        fun empty(count: Int, data: FxData? = null) = FxUniforms(count, FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N), data)

        val NONE = empty(0)
    }
}

object LightEffects {
    /** Uniform arrays in the shader are this long. */
    const val MAX_EFFECTS = 4

    /** A new effect's box is this many times the photo, so most of the pattern sits outside the frame. */
    const val START_SCALE = 1.75f

    /** At most this many segments per effect. */
    const val MAX_SEGMENTS = 1280

    /** Segments per chunk: a chunk's bounding box lets the shader skip it where none of its light reaches. */
    const val CHUNK = 16

    /** Texels per chunk row of the data texture: the chunk's bounding box, then two per segment. */
    const val ROW = 1 + 2 * CHUNK

    /** The box a new effect starts in (radii as fractions of the photo's long side): [START_SCALE] times a photo of [aspect] = width / height. */
    fun coverSize(aspect: Float): Pair<Float, Float> {
        val h = 0.5f * START_SCALE
        return if (aspect >= 1f) h to h / aspect else h * aspect to h
    }

    /** A seed 0..1 (9 decimals, like the web's); the generator turns it into 32 bits. */
    fun newSeed(): Double = floor(Random.nextDouble() * 1e9) / 1e9

    /** A new random effect of [kind] covering the whole photo of [aspect], centred at ([cx], [cy]). */
    fun newEffect(kind: FxKind = FxKind.LIGHTNING, cx: Float = 0.5f, cy: Float = 0.5f, aspect: Float = 1.5f): LightEffect {
        val (rx, ry) = coverSize(aspect)
        return LightEffect(Masks.newId(), kind = kind, cx = cx, cy = cy, rx = rx, ry = ry, seed = newSeed())
    }

    /** CSS-like colour of a hue at full light, for swatches (display RGB 0..1). */
    fun color(hue: Float): FloatArray {
        val h = (((hue % 360f) + 360f) % 360f) / 60f
        fun f(n: Int): Float {
            val k = (n + h) % 6f
            return 1f - 0.8f * max(0f, min(min(k, 4f - k), 1f))
        }
        return floatArrayOf(f(5), f(3), f(1))
    }

    // ---- Generation: segments in the effect's own frame (-1..1), widths in its mean radius. Same random calls in the
    // same order as web's LightEffects.ts, so a seed gives the same pattern.

    /** A small, fast deterministic PRNG (mulberry32): the same pattern for the same seed everywhere. */
    class Rng(seed: Double) {
        private var a: Int = (floor(seed * 4294967296.0).toLong() and 0xFFFFFFFFL).toInt()

        fun next(): Double {
            a += 0x6d2b79f5
            var t = a
            t = (t xor (t ushr 15)) * (t or 1)
            t = t xor (t + (t xor (t ushr 7)) * (t or 61))
            return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
        }
    }

    private fun Rng.range(a: Double, b: Double) = a + (b - a) * next()

    /** Roughly normal, mean 0, sd 1. */
    private fun Rng.gauss() = (next() + next() + next() + next() - 2) * 1.732

    private fun jsRound(v: Double) = floor(v + 0.5).toInt()

    /** Points of a jagged bolt from a to b: midpoint displacement, [levels] times, sideways by [rough] x the piece's length. */
    private fun jagged(r: Rng, a: Pt, b: Pt, levels: Int, rough: Double): List<Pt> {
        var pts = listOf(a, b)
        var amp = rough
        for (l in 0 until levels) {
            val next = ArrayList<Pt>(pts.size * 2)
            next.add(pts[0])
            for (i in 1 until pts.size) {
                val (x0, y0) = pts[i - 1]
                val (x1, y1) = pts[i]
                val dx = x1 - x0
                val dy = y1 - y0
                val len = hypot(dx, dy)
                val off = r.gauss() * 0.5 * amp * len
                val along = (r.next() - 0.5) * 0.2
                val l1 = if (len == 0.0) 1.0 else len
                next.add(doubleArrayOf(x0 + dx * (0.5 + along) - (dy / l1) * off, y0 + dy * (0.5 + along) + (dx / l1) * off))
                next.add(pts[i])
            }
            pts = next
            amp *= 0.92 // keeps fine kinks at every scale: real lightning is jagged all the way down
        }
        return pts
    }

    /** Segments along [pts], half width w0 → w1 and brightness b0 → b1 from start to end, flickering a little. */
    private fun polyline(
        out: MutableList<FxSegment>, r: Rng, pts: List<Pt>, w0: Double, w1: Double, b0: Double, b1: Double, h: Double, flicker: Double = 0.15,
    ) {
        val n = pts.size - 1
        var i = 0
        while (i < n && out.size < MAX_SEGMENTS) {
            val t0 = i.toDouble() / n
            val t1 = (i + 1).toDouble() / n
            val fl = 1 - flicker * r.next()
            out.add(
                FxSegment(
                    pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                    w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1,
                    max(0.001, (b0 + (b1 - b0) * (t0 + t1) * 0.5) * fl), h,
                ),
            )
            ++i
        }
    }

    /** A lightning bolt from top to bottom with forks: branches leave the channel at shallow angles and branch again. */
    private fun lightning(r: Rng, amount: Int): List<FxSegment> {
        val out = ArrayList<FxSegment>()
        val density = amount / 100.0
        fun branch(from: Pt, dir: Double, len: Double, level: Int, w: Double, b: Double) {
            val to = doubleArrayOf(from[0] + cos(dir) * len, from[1] + sin(dir) * len)
            val pts = jagged(r, from, to, if (level == 0) 8 else if (level == 1) 6 else 5, if (level == 0) 0.42 else 0.5)
            polyline(
                out, r, pts, w, w * (if (level == 0) 0.55 else 0.2), b, b * (if (level == 0) 0.8 else 0.35), (r.next() - 0.5) * 0.6, 0.25,
            )
            if (level >= 2) return
            // Forks: more near the bottom of a channel; each heads off 15..55° to one side, its length a part of what's left.
            val forks = jsRound((if (level == 0) 2 + 9 * density else 0.5 + 3 * density) * r.range(0.7, 1.3))
            var f = 0
            while (f < forks && out.size < MAX_SEGMENTS - 100) {
                val t = if (level == 0) 0.12 + 0.8 * sqrt(r.next()) else 0.15 + 0.7 * r.next()
                val k = min(pts.size - 2, max(1, floor(t * (pts.size - 1)).toInt()))
                val (px, py) = pts[k]
                val local = atan2(pts[k + 1][1] - pts[k - 1][1], pts[k + 1][0] - pts[k - 1][0])
                val side = if (r.next() < 0.5) -1 else 1
                val turn = side * r.range(0.26, 0.95)
                val left = len * (1 - t)
                branch(
                    doubleArrayOf(px, py), local * 0.4 + dir * 0.6 + turn, left * r.range(0.3, 0.75), level + 1,
                    w * r.range(0.4, 0.6), b * r.range(0.45, 0.7),
                )
                ++f
            }
        }
        val x0 = r.range(-0.25, 0.25)
        val x1 = x0 + r.range(-0.35, 0.35)
        val len = hypot(x1 - x0, 1.9)
        branch(doubleArrayOf(x0, -0.95), atan2(1.9, x1 - x0), len, 0, 0.006, 1.0)
        return out
    }

    /**
     * An electric spark cluster: a hot centre, short crackling arcs out of it, and many sparks around it, most of them
     * tiny, some flying outwards as short streaks; colours spread so blue, violet and green sit together.
     */
    private fun sparks(r: Rng, amount: Int): List<FxSegment> {
        val out = ArrayList<FxSegment>()
        val density = amount / 100.0
        val arcs = jsRound(3 + 6 * density * r.range(0.6, 1.4))
        for (a in 0 until arcs) {
            val dir = r.next() * PI * 2
            val len = r.range(0.25, 0.75)
            val from = doubleArrayOf(r.gauss() * 0.04, r.gauss() * 0.04)
            val pts = jagged(r, from, doubleArrayOf(from[0] + cos(dir) * len, from[1] + sin(dir) * len), 5, 0.55)
            polyline(out, r, pts, 0.006, 0.0015, 0.9, 0.25, r.gauss() * 0.35, 0.3)
            // One small fork per arc, sometimes.
            if (r.next() < 0.6) {
                val k = 2 + floor(r.next() * (pts.size - 4)).toInt()
                val fd = dir + (if (r.next() < 0.5) -1 else 1) * r.range(0.4, 1.0)
                val fl = len * r.range(0.2, 0.4)
                val fork = jagged(r, pts[k], doubleArrayOf(pts[k][0] + cos(fd) * fl, pts[k][1] + sin(fd) * fl), 3, 0.6)
                polyline(out, r, fork, 0.003, 0.001, 0.5, 0.15, r.gauss() * 0.35, 0.3)
            }
        }
        // The hot centre: a few overlapping bright dots.
        for (i in 0 until 3) {
            val x = r.gauss() * 0.02
            val y = r.gauss() * 0.02
            out.add(FxSegment(x, y, x, y, 0.02, 0.02, 1.4, r.gauss() * 0.2))
        }
        val particles = ArrayList<FxSegment>()
        // A few soft orbs of light around the cluster, out of focus like bokeh.
        val orbs = jsRound(3 + 8 * density * r.next())
        for (i in 0 until orbs) {
            val dir = r.next() * PI * 2
            val dist = r.range(0.15, 0.85)
            val x = cos(dir) * dist
            val y = sin(dir) * dist
            val w = r.range(0.012, 0.03)
            val b = r.range(0.12, 0.3)
            val h = r.next() * 2 - 1
            particles.add(FxSegment(x, y, x, y, w, w, b, h))
        }
        val n = jsRound(80 + 520 * density)
        for (i in 0 until n) {
            val dir = r.next() * PI * 2
            val dist = min(1.0, abs(r.gauss()) * 0.45 + 0.03)
            val x = cos(dir) * dist
            val y = sin(dir) * dist
            val big = r.next().pow(6) // most sparks are tiny, a few large
            val w = 0.0025 + 0.012 * big
            val b = r.range(0.35, 1.1) * (1.15 - dist * 0.6)
            val h = r.next() * 2 - 1
            if (r.next() < 0.35) {
                // A flying spark: a short streak outwards, thinning towards its tail.
                val len = r.range(0.03, 0.16) * (0.4 + dist)
                particles.add(FxSegment(x, y, x + cos(dir) * len, y + sin(dir) * len, w * 0.9, w * 0.25, b, h))
            } else {
                particles.add(FxSegment(x, y, x, y, w, w, b, h))
            }
        }
        // Spatial order, so each chunk's bounding box stays small and the shader can skip far chunks.
        fun morton(s: FxSegment): Int {
            val qx = min(63, max(0, floor((s.x0 + 1) * 32).toInt()))
            val qy = min(63, max(0, floor((s.y0 + 1) * 32).toInt()))
            var m = 0
            for (bit in 0 until 6) m = m or (((qx shr bit) and 1) shl (2 * bit)) or (((qy shr bit) and 1) shl (2 * bit + 1))
            return m
        }
        for (p in particles.sortedBy { morton(it) }) if (out.size < MAX_SEGMENTS) out.add(p)
        return out
    }

    /** Smooth 1D noise (-1..1) from a few random sines: wobble for trails and swirls. */
    private fun wobble(r: Rng): (Double) -> Double {
        val f = DoubleArray(3)
        val p = DoubleArray(3)
        val a = DoubleArray(3)
        for (i in 0 until 3) {
            f[i] = r.range(1.5, 4.0) * (i + 1)
            p[i] = r.next() * PI * 2
            a[i] = 1 / (i + 1.5)
        }
        return { t ->
            var s = 0.0
            for (i in 0 until 3) s += a[i] * sin(f[i] * t + p[i])
            s / 1.2
        }
    }

    /** Light trails: a few long, nearly parallel streaks of moving light, like a long exposure, flickering along their length. */
    private fun trails(r: Rng, amount: Int): List<FxSegment> {
        val out = ArrayList<FxSegment>()
        val strands = jsRound(2 + 5 * (amount / 100.0) * r.range(0.7, 1.3))
        val bow = r.range(-0.5, 0.5)
        for (s in 0 until strands) {
            val y0 = (if (strands == 1) 0.0 else (s.toDouble() / (strands - 1)) * 1.3 - 0.65) + r.gauss() * 0.08
            val amp = r.range(0.04, 0.2)
            val wob = wobble(r)
            val flick = wobble(r)
            val xs = r.range(-1.0, -0.75)
            val xe = r.range(0.75, 1.0)
            val w = r.range(0.004, 0.011)
            val b = r.range(0.55, 1.1)
            val h = s.toDouble() / max(1, strands - 1) * 2 - 1 + r.gauss() * 0.2
            val n = 128
            val pts = ArrayList<Pt>(n + 1)
            for (i in 0..n) {
                val t = i.toDouble() / n
                val x = xs + (xe - xs) * t
                pts.add(doubleArrayOf(x, y0 + bow * (x * x - 0.5) * 0.6 + amp * wob(t * 3)))
            }
            var i = 0
            while (i < n && out.size < MAX_SEGMENTS) {
                val t = (i + 0.5) / n
                val fade = min(1.0, min(t / 0.15, (1 - t) / 0.12)) // trails fade in and out at their ends
                val level = max(0.0, 0.65 + 0.45 * flick(t * 4))
                out.add(
                    FxSegment(
                        pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                        w * (0.7 + 0.3 * level), w * (0.7 + 0.3 * level), max(0.001, b * fade * level), h,
                    ),
                )
                ++i
            }
        }
        return out
    }

    /** Neon swirls: one to four loose spirals of light winding round the centre, wobbling, fading at their ends. */
    private fun swirl(r: Rng, amount: Int): List<FxSegment> {
        val out = ArrayList<FxSegment>()
        val strands = jsRound(1 + 3 * (amount / 100.0) * r.range(0.7, 1.3))
        for (s in 0 until strands) {
            val turns = r.range(1.2, 2.6)
            val r0 = r.range(0.08, 0.35)
            val r1 = r.range(0.7, 1.0)
            val tilt = r.range(0.55, 1.0) // an ellipse seen at an angle
            val rot = r.next() * PI * 2
            val th0 = r.next() * PI * 2
            val dir = if (r.next() < 0.5) -1 else 1
            val wob = wobble(r)
            val w = r.range(0.004, 0.009)
            val b = r.range(0.7, 1.1)
            val h = r.gauss() * 0.5
            val n = min(320, (MAX_SEGMENTS - out.size) / max(1, strands - s) - 1)
            if (n < 8) break
            val pts = ArrayList<Pt>(n + 1)
            for (i in 0..n) {
                val t = i.toDouble() / n
                val th = th0 + dir * turns * 2 * PI * t
                val rr = (r0 + (r1 - r0) * t) * (1 + 0.12 * wob(t * 5))
                val ex = cos(th) * rr
                val ey = sin(th) * rr * tilt
                pts.add(doubleArrayOf(ex * cos(rot) - ey * sin(rot), ex * sin(rot) + ey * cos(rot)))
            }
            for (i in 0 until n) {
                val t = (i + 0.5) / n
                val fade = min(1.0, min(t / 0.2, (1 - t) / 0.25))
                out.add(FxSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, w, max(0.001, b * fade), h))
            }
        }
        return out
    }

    /** The effect's segments, freshly generated ([segments] caches them). */
    fun generate(kind: FxKind, seed: Double, amount: Int): List<FxSegment> {
        val a = amount.coerceIn(0, 100)
        val r = Rng(seed)
        val all = when (kind) {
            FxKind.LIGHTNING -> lightning(r, a)
            FxKind.SPARKS -> sparks(r, a)
            FxKind.TRAILS -> trails(r, a)
            FxKind.SWIRL -> swirl(r, a)
        }
        return all.take(MAX_SEGMENTS)
    }

    private fun amountOf(amount: Float) = floor(amount.coerceIn(0f, 100f) + 0.5f).toInt()

    private val generated = object : LinkedHashMap<String, List<FxSegment>>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<FxSegment>>) = size > 32
    }

    /** The effect's segments (cached: the same kind, seed and amount always give the same pattern). */
    @Synchronized
    fun segments(e: LightEffect): List<FxSegment> {
        val amount = amountOf(e.amount)
        return generated.getOrPut("${e.kind}:${e.seed}:$amount") { generate(e.kind, e.seed, amount) }
    }

    // ---- A photo's edits ([Edits]; the same JSON as web's LightEffects.ts: kind "lightning", "sparks", "trails" or "swirl").

    fun toJson(effects: List<LightEffect>): JSONArray = JSONArray(
        effects.map { e ->
            JSONObject().apply {
                put("enabled", e.enabled); put("kind", e.kind.name.lowercase())
                put("cx", num(e.cx)); put("cy", num(e.cy)); put("rx", num(e.rx)); put("ry", num(e.ry))
                put("angle", num(e.angle)); put("seed", e.seed); put("amount", num(e.amount))
                put("thickness", num(e.thickness)); put("glow", num(e.glow)); put("intensity", num(e.intensity))
                put("hue", num(e.hue)); put("spread", num(e.spread))
            }
        },
    )

    /** Effects from untrusted JSON, each with a fresh id: invalid ones are dropped, ranges clamped, at most [MAX_EFFECTS]. */
    fun parseEffects(v: Any?): List<LightEffect> {
        val a = v as? JSONArray ?: return emptyList()
        return (0 until a.length()).mapNotNull { parseEffect(a.opt(it)) }.take(MAX_EFFECTS)
    }

    private fun parseEffect(v: Any?): LightEffect? {
        val o = v as? JSONObject ?: return null
        fun f(k: String, min: Float, max: Float) = (o.opt(k) as? Number)?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(min, max)
        val kind = FxKind.entries.firstOrNull { it.name.lowercase() == o.opt("kind") } ?: return null
        return LightEffect(
            id = Masks.newId(),
            enabled = o.opt("enabled") as? Boolean ?: true,
            kind = kind,
            cx = f("cx", -1f, 2f) ?: return null,
            cy = f("cy", -1f, 2f) ?: return null,
            rx = f("rx", 0.005f, 3f) ?: return null,
            ry = f("ry", 0.005f, 3f) ?: return null,
            angle = f("angle", -360f, 360f) ?: 0f,
            seed = (o.opt("seed") as? Number)?.toDouble()?.takeIf { it.isFinite() }?.coerceIn(0.0, 1.0) ?: 0.0,
            amount = f("amount", 0f, 100f) ?: kind.amount,
            thickness = f("thickness", 0f, 100f) ?: kind.thickness,
            glow = f("glow", 0f, 100f) ?: kind.glow,
            intensity = f("intensity", 0f, 100f) ?: 100f,
            hue = f("hue", 0f, 360f) ?: kind.hue,
            spread = f("spread", 0f, 100f) ?: kind.spread,
        )
    }

    /** Floats via their shortest decimal, so 0.1 is written as 0.1. */
    private fun num(f: Float): Double = f.toString().toDouble()

    // ---- Packing.

    /** The thickness slider as a width factor: 1/4 .. 1 (at 50) .. 4. */
    fun thicknessFactor(t: Float): Float = 4f.pow((t.coerceIn(0f, 100f) - 50f) / 50f)

    /** The glow slider as the glow's radius in core half widths. */
    fun glowRadius(g: Float): Float = 2f + g.coerceIn(0f, 100f) / 100f * 8f

    /** The glow slider as the halo's radius in the effect's mean radius. */
    fun haloRadius(g: Float): Float = 0.02f + g.coerceIn(0f, 100f) / 100f * 0.16f

    private class Packed(val data: FxData, val first: IntArray, val rows: IntArray)

    private fun packData(lists: List<List<FxSegment>>): Packed {
        val rowsOf = IntArray(lists.size) { (lists[it].size + CHUNK - 1) / CHUNK }
        val total = max(1, rowsOf.sum())
        val data = FloatArray(total * ROW * 4)
        val first = IntArray(lists.size)
        var row = 0
        lists.forEachIndexed { i, segs ->
            first[i] = row
            for (c in 0 until rowsOf[i]) {
                var minX = Double.POSITIVE_INFINITY
                var minY = Double.POSITIVE_INFINITY
                var maxX = Double.NEGATIVE_INFINITY
                var maxY = Double.NEGATIVE_INFINITY
                for (k in 0 until CHUNK) {
                    val s = segs.getOrNull(c * CHUNK + k) ?: break
                    minX = min(minX, min(s.x0, s.x1)); minY = min(minY, min(s.y0, s.y1))
                    maxX = max(maxX, max(s.x0, s.x1)); maxY = max(maxY, max(s.y0, s.y1))
                    val o = (row * ROW + 1 + 2 * k) * 4
                    doubleArrayOf(s.x0, s.y0, s.x1, s.y1, s.w0, s.w1, s.b, s.h).forEachIndexed { j, v -> data[o + j] = v.toFloat() }
                }
                val o = row * ROW * 4
                data[o] = minX.toFloat(); data[o + 1] = minY.toFloat(); data[o + 2] = maxX.toFloat(); data[o + 3] = maxY.toFloat()
                ++row
            }
        }
        return Packed(FxData(total, data), first, rowsOf)
    }

    private var last: Pair<String, Packed>? = null

    /**
     * Packs the effects that show; positions go from image fractions to full-resolution image pixels. The data
     * texture is reused (same object) while only placement, size or colour change, so dragging never re-uploads it.
     */
    @Synchronized
    fun pack(effects: List<LightEffect>, imageWidth: Int, imageHeight: Int): FxUniforms {
        val used = effects.filter { !it.isIdentity }.take(MAX_EFFECTS)
        if (used.isEmpty()) return FxUniforms.NONE
        val lists = used.map { segments(it) }
        val key = used.joinToString("|") { "${it.kind}:${it.seed}:${amountOf(it.amount)}" }
        val packed = last?.takeIf { it.first == key }?.second ?: packData(lists).also { last = key to it }
        val u = FxUniforms.empty(used.size, packed.data)
        val long = max(imageWidth, imageHeight).toFloat()
        used.forEachIndexed { i, e ->
            val o = i * 4
            val a = e.angle * PI.toFloat() / 180f
            val rxPx = max(e.rx * long, 1f)
            val ryPx = max(e.ry * long, 1f)
            val mean = sqrt(rxPx * ryPx)
            floatArrayOf(e.cx * imageWidth, e.cy * imageHeight, rxPx, ryPx).copyInto(u.geom, o)
            floatArrayOf(cos(a), sin(a), mean * thicknessFactor(e.thickness), glowRadius(e.glow)).copyInto(u.shape, o)
            floatArrayOf(
                ((e.hue % 360f) + 360f) % 360f / 360f, (e.spread / 100f).coerceIn(0f, 1f), (e.intensity / 100f).coerceIn(0f, 1f),
                mean * haloRadius(e.glow),
            ).copyInto(u.color, o)
            // How far the effect's light reaches beyond its lines: past it, the shader skips a chunk.
            val widest = lists[i].fold(0.0) { m, s -> max(m, max(s.w0, s.w1)) }.toFloat() * u.shape[o + 2]
            // Far enough out that a segment's glow, halo and crackle are all within it (the crackle bends a line by up to ~2% of the size).
            val reach = 3.2f * max(u.color[o + 3], widest * u.shape[o + 3]) + 2f + 0.02f * mean * e.kind.wobble
            floatArrayOf(packed.first[i].toFloat(), packed.rows[i].toFloat(), reach, e.kind.wobble).copyInto(u.range, o)
        }
        return u
    }
}
