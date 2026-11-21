package app.rawboy.develop

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.max
import kotlin.random.Random

/**
 * Film leaks (Pro, Auto, Camera; generated): procedural film light and damage, made by a generator rather than drawn
 * by hand (shaders/film_leak.glsl). Port of web/src/engine/develop/FilmLeaks.ts.
 */
enum class FilmLeakType(val key: String, val label: String, val shaderId: Float) {
    EDGE("edge", "Edge burn", 0f),
    BLOB("blob", "Blob", 1f),
    STREAK("streak", "Streak", 2f),
    SPROCKET("sprocket", "Sprocket holes", 3f),
    FOG("fog", "Fog", 4f),
    REBATE("rebate", "Rebate glow", 5f),
    FLARE("flare", "Flare", 6f),
    START("start", "Start of roll", 7f),
    END("end", "End of roll", 8f),
    TEAR("tear", "Film tear", 9f),
    DUST("dust", "Dust & scratches", 10f),
    STAIN("stain", "Chemical stain", 11f),
    SCRATCHES("scratches", "Scratches", 12f),
    ;

    companion object {
        fun ofKey(key: String?): FilmLeakType? = entries.firstOrNull { it.key == key }
    }
}

enum class FilmPalette(
    val key: String,
    val label: String,
    val a: FloatArray,
    val b: FloatArray,
    val rgb: Long,
) {
    WARM("warm", "Warm", floatArrayOf(1.0f, 0.55f, 0.18f), floatArrayOf(1.0f, 0.25f, 0.08f), 0xFFFF8C2EL),
    AMBER("amber", "Amber", floatArrayOf(1.0f, 0.82f, 0.28f), floatArrayOf(1.0f, 0.55f, 0.18f), 0xFFFFD147L),
    RED("red", "Red", floatArrayOf(1.0f, 0.22f, 0.08f), floatArrayOf(1.0f, 0.15f, 0.35f), 0xFFFF3814L),
    MAGENTA("magenta", "Magenta", floatArrayOf(1.0f, 0.25f, 0.6f), floatArrayOf(1.0f, 0.22f, 0.08f), 0xFFFF4099L),
    COOL("cool", "Cool", floatArrayOf(0.25f, 0.65f, 1.0f), floatArrayOf(0.3f, 0.95f, 1.0f), 0xFF40A6FFL),
    GREEN("green", "Green", floatArrayOf(0.45f, 1.0f, 0.5f), floatArrayOf(0.8f, 1.0f, 0.3f), 0xFF73FF80L),
    MONO("mono", "Mono", floatArrayOf(1.0f, 0.95f, 0.88f), floatArrayOf(1.0f, 0.92f, 0.82f), 0xFFFFF2E0L),
    ;

    companion object {
        fun ofKey(key: String?): FilmPalette? = entries.firstOrNull { it.key == key }
    }
}

data class FilmLeak(
    val id: String = Masks.newId(),
    val enabled: Boolean = true,
    val type: FilmLeakType = FilmLeakType.EDGE,
    val seed: Float = 0f,
    val cx: Float = 0.5f,
    val cy: Float = 0.5f,
    val w: Float = 1.04f,
    val h: Float = 1.04f,
    val turn: Int = 0,
    val mirror: Boolean = false,
    val palette: FilmPalette = FilmPalette.WARM,
    val intensity: Float = 80f,
    val softness: Float = 50f,
    val texture: Float = 65f,
    val amount: Float = 55f,
    val variant: Float = 50f,
    val warmth: Float = 0f,
    val tint: Float = 0f,
    val fade: Float = 0f,
    val contrast: Float = 0f,
)

class FilmLeakUniforms(
    val count: Int,
    val box: FloatArray,
    val form: FloatArray,
    val tint: FloatArray,
    val tint2: FloatArray,
    val look: FloatArray,
    val grade: FloatArray,
) {
    companion object {
        private const val N = FilmLeaks.MAX_LEAKS * 4
        val NONE = FilmLeakUniforms(
            0, FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N), FloatArray(N),
        )
    }
}

object FilmLeaks {
    const val MAX_LEAKS = 4

    /** Types allowed for Android Camera's "Random light leak" setting. */
    val CAMERA_TYPES: List<FilmLeakType> = listOf(
        FilmLeakType.EDGE,
        FilmLeakType.BLOB,
        FilmLeakType.SPROCKET,
        FilmLeakType.REBATE,
        FilmLeakType.FLARE,
        FilmLeakType.START,
    )

    fun isIdentity(l: FilmLeak): Boolean =
        !l.enabled || (l.intensity <= 0f && l.warmth == 0f && l.tint == 0f && l.fade == 0f && l.contrast == 0f)

    fun newSeed(): Double = Random.nextDouble()

    private class Mulberry32(seed: Int) {
        private var s = seed
        fun next(): Double {
            s += 0x6d2b79f5
            var t = s
            t = (t xor (t ushr 15)) * (t or 1)
            t = t xor (t + ((t xor (t ushr 7)) * (t or 61)))
            val u = (t xor (t ushr 14)).toLong() and 0xffffffffL
            return u.toDouble() / 4294967296.0
        }
    }

    private fun seedBits(seed: Double): Int =
        floor(seed.coerceIn(0.0, 1.0) * 4294967296.0).toLong().toInt()

    private fun between(r: Mulberry32, lo: Double, hi: Double): Double = lo + (hi - lo) * r.next()

    private fun <T> pick(r: Mulberry32, weights: List<Pair<T, Double>>): T {
        val total = weights.sumOf { it.second }
        var x = r.next() * total
        for ((v, w) in weights) {
            x -= w
            if (x < 0) return v
        }
        return weights.last().first
    }

    private val TYPE_WEIGHTS: List<Pair<FilmLeakType, Double>> = listOf(
        FilmLeakType.EDGE to 24.0,
        FilmLeakType.BLOB to 17.0,
        FilmLeakType.STREAK to 9.0,
        FilmLeakType.SPROCKET to 7.0,
        FilmLeakType.FOG to 8.0,
        FilmLeakType.REBATE to 5.0,
        FilmLeakType.FLARE to 6.0,
        FilmLeakType.START to 7.0,
        FilmLeakType.END to 5.0,
        FilmLeakType.TEAR to 3.0,
        FilmLeakType.STAIN to 3.0,
        FilmLeakType.DUST to 3.0,
        FilmLeakType.SCRATCHES to 3.0,
    )

    private fun paletteWeights(t: FilmLeakType): List<Pair<FilmPalette, Double>> = when (t) {
        FilmLeakType.EDGE -> listOf(
            FilmPalette.WARM to 45.0, FilmPalette.AMBER to 20.0, FilmPalette.RED to 20.0,
            FilmPalette.COOL to 8.0, FilmPalette.MAGENTA to 7.0,
        )
        FilmLeakType.BLOB -> listOf(
            FilmPalette.RED to 45.0, FilmPalette.WARM to 30.0, FilmPalette.MAGENTA to 12.0, FilmPalette.COOL to 13.0,
        )
        FilmLeakType.STREAK -> listOf(
            FilmPalette.WARM to 40.0, FilmPalette.MONO to 25.0, FilmPalette.AMBER to 20.0, FilmPalette.RED to 15.0,
        )
        FilmLeakType.SPROCKET -> listOf(FilmPalette.WARM to 50.0, FilmPalette.RED to 30.0, FilmPalette.MONO to 20.0)
        FilmLeakType.FOG -> listOf(FilmPalette.MONO to 45.0, FilmPalette.WARM to 30.0, FilmPalette.COOL to 25.0)
        FilmLeakType.REBATE -> listOf(FilmPalette.RED to 70.0, FilmPalette.WARM to 30.0)
        FilmLeakType.FLARE -> listOf(FilmPalette.WARM to 100.0)
        FilmLeakType.START -> listOf(FilmPalette.WARM to 40.0, FilmPalette.AMBER to 35.0, FilmPalette.RED to 25.0)
        FilmLeakType.END -> listOf(FilmPalette.WARM to 70.0, FilmPalette.RED to 30.0)
        FilmLeakType.TEAR -> listOf(FilmPalette.MONO to 100.0)
        FilmLeakType.DUST -> listOf(FilmPalette.MONO to 100.0)
        FilmLeakType.STAIN -> listOf(FilmPalette.MAGENTA to 35.0, FilmPalette.AMBER to 35.0, FilmPalette.GREEN to 30.0)
        FilmLeakType.SCRATCHES -> listOf(FilmPalette.MONO to 100.0)
    }

    private enum class SidePref { SHORT, LONG, ANY }

    private fun sidePref(t: FilmLeakType): SidePref = when (t) {
        FilmLeakType.EDGE, FilmLeakType.STREAK, FilmLeakType.START, FilmLeakType.END, FilmLeakType.TEAR -> SidePref.SHORT
        FilmLeakType.SPROCKET -> SidePref.LONG
        FilmLeakType.BLOB, FilmLeakType.FOG, FilmLeakType.REBATE, FilmLeakType.FLARE,
        FilmLeakType.DUST, FilmLeakType.STAIN, FilmLeakType.SCRATCHES,
        -> SidePref.ANY
    }

    private fun sideFor(r: Mulberry32, t: FilmLeakType, aspect: Double, shortSideSprockets: Boolean = false): Int {
        val shortSides = if (aspect >= 1) intArrayOf(0, 2) else intArrayOf(1, 3)
        val longSides = if (aspect >= 1) intArrayOf(1, 3) else intArrayOf(0, 2)
        if (t == FilmLeakType.SPROCKET) {
            val pool = if (shortSideSprockets) intArrayOf(0, 1, 2, 3) else longSides
            return pool[floor(r.next() * pool.size).toInt()]
        }
        val pref = sidePref(t)
        val pool = when {
            pref == SidePref.ANY -> intArrayOf(0, 1, 2, 3)
            r.next() < 0.85 -> if (pref == SidePref.SHORT) shortSides else longSides
            else -> if (pref == SidePref.SHORT) longSides else shortSides
        }
        return pool[floor(r.next() * pool.size).toInt()]
    }

    private data class Box(val cx: Double, val cy: Double, val w: Double, val h: Double)

    private fun sideBox(turn: Int, depth: Double, along: Double, offset: Double = 0.5, over: Double = 0.02): Box {
        val near = depth / 2.0 - over
        return when (turn) {
            1 -> Box(offset, near, along, depth)
            2 -> Box(1.0 - near, offset, depth, along)
            3 -> Box(offset, 1.0 - near, along, depth)
            else -> Box(near, offset, depth, along)
        }
    }

    private fun jsRound(v: Double): Float = floor(v + 0.5).toFloat()

    fun random(
        type: FilmLeakType? = null,
        aspect: Float,
        seed: Double,
        grade: Boolean = true,
        shortSideSprockets: Boolean = false,
    ): FilmLeak {
        val asp = max(aspect.toDouble(), 0.01)
        val r = Mulberry32(seedBits(seed))
        val t = type ?: pick(r, TYPE_WEIGHTS)
        val turn = sideFor(r, t, asp, shortSideSprockets)
        val palette = pick(r, paletteWeights(t))
        var box = Box(0.5, 0.5, 1.04, 1.04)
        var amount = between(r, 30.0, 80.0)
        var intensity = between(r, 65.0, 100.0)
        val variant = between(r, 0.0, 100.0)

        when (t) {
            FilmLeakType.EDGE -> {
                box = sideBox(turn, between(r, 0.3, 0.8), 1.04)
                amount = between(r, 55.0, 85.0)
            }
            FilmLeakType.START -> {
                box = sideBox(turn, between(r, 0.45, 0.95), 1.04)
                amount = between(r, 45.0, 80.0)
            }
            FilmLeakType.END -> {
                box = sideBox(turn, between(r, 0.3, 0.7), 1.04)
                amount = between(r, 50.0, 80.0)
                intensity = 100.0
            }
            FilmLeakType.TEAR -> {
                box = sideBox(turn, between(r, 0.14, 0.36), 1.04)
                amount = between(r, 20.0, 65.0)
                intensity = 100.0
            }
            FilmLeakType.SPROCKET -> {
                box = sideBox(turn, between(r, 0.15, 0.4), 1.04)
                amount = between(r, 30.0, 80.0)
            }
            FilmLeakType.REBATE -> {
                box = sideBox(turn, between(r, 0.06, 0.15), 1.04, 0.5, 0.0)
                amount = between(r, 20.0, 70.0)
            }
            FilmLeakType.BLOB -> {
                box = sideBox(turn, between(r, 0.5, 1.0), between(r, 0.6, 1.1), between(r, 0.2, 0.8))
                amount = between(r, 30.0, 70.0)
            }
            FilmLeakType.FLARE -> {
                box = sideBox(turn, between(r, 0.6, 1.0), between(r, 0.6, 1.0), between(r, 0.15, 0.85))
                amount = between(r, 20.0, 60.0)
            }
            FilmLeakType.STREAK -> {
                val thick = between(r, 0.15, 0.45)
                val pos = between(r, 0.2, 0.8)
                box = if (turn % 2 == 0) Box(0.5, pos, 1.1, thick) else Box(pos, 0.5, thick, 1.1)
                amount = between(r, 15.0, 60.0)
            }
            FilmLeakType.FOG -> intensity = between(r, 40.0, 80.0)
            FilmLeakType.DUST -> {
                box = Box(0.5, 0.5, 1.0, 1.0)
                amount = between(r, 35.0, 85.0)
                intensity = between(r, 65.0, 95.0)
            }
            FilmLeakType.SCRATCHES -> {
                box = Box(0.5, 0.5, 1.0, 1.0)
                amount = between(r, 35.0, 85.0)
                intensity = between(r, 65.0, 95.0)
            }
            FilmLeakType.STAIN -> {
                val s = between(r, 0.35, 0.8)
                box = Box(between(r, 0.25, 0.75), between(r, 0.25, 0.75), s, s * asp * between(r, 0.7, 1.3))
                intensity = between(r, 50.0, 90.0)
            }
        }

        val warmBias = when (palette) {
            FilmPalette.COOL -> -1.0
            FilmPalette.MONO, FilmPalette.GREEN -> 0.0
            else -> 1.0
        }
        val layerSeed = r.next().toFloat()
        val mirror = r.next() < 0.5
        val softness = jsRound(if (t == FilmLeakType.TEAR) between(r, 5.0, 28.0) else between(r, 25.0, 75.0))
        val texture = jsRound(between(r, 40.0, 90.0))
        val warmth = if (grade) jsRound(warmBias * between(r, 5.0, 35.0) + between(r, -8.0, 8.0)) else 0f
        val tint = if (grade) jsRound(between(r, -15.0, 15.0)) else 0f
        val fade = if (grade) jsRound(between(r, 0.0, 35.0)) else 0f
        val contrast = if (grade) jsRound(between(r, -25.0, 5.0)) else 0f

        return FilmLeak(
            id = Masks.newId(),
            enabled = true,
            type = t,
            seed = layerSeed,
            cx = box.cx.toFloat(),
            cy = box.cy.toFloat(),
            w = box.w.toFloat(),
            h = box.h.toFloat(),
            turn = turn,
            mirror = mirror,
            palette = palette,
            intensity = jsRound(intensity),
            softness = softness,
            texture = texture,
            amount = jsRound(amount),
            variant = jsRound(variant),
            warmth = warmth,
            tint = tint,
            fade = fade,
            contrast = contrast,
        )
    }

    fun randomRoll(aspect: Float, seed: Double, shortSideSprockets: Boolean = false): List<FilmLeak> {
        val r = Mulberry32(seedBits(seed) xor 0x9e3779b9.toInt())
        val main = random(null, aspect, r.next(), grade = true, shortSideSprockets = shortSideSprockets)
        val out = mutableListOf(main)
        if (main.type != FilmLeakType.DUST && main.type != FilmLeakType.SCRATCHES && r.next() < 0.3) {
            val dmgType = if (r.next() < 0.45) FilmLeakType.SCRATCHES else FilmLeakType.DUST
            out += random(dmgType, aspect, r.next(), grade = false, shortSideSprockets = shortSideSprockets)
        }
        if (main.type != FilmLeakType.REBATE && main.type != FilmLeakType.END && r.next() < 0.15) {
            val rebate = random(FilmLeakType.REBATE, aspect, r.next(), grade = false, shortSideSprockets = shortSideSprockets)
            out += rebate.copy(palette = if (main.palette == FilmPalette.COOL) FilmPalette.RED else main.palette)
        }
        if ((main.type == FilmLeakType.EDGE || main.type == FilmLeakType.BLOB) && r.next() < 0.2) {
            val second = random(main.type, aspect, r.next(), grade = false)
            out += sideMove(second, (main.turn + 2) % 4).copy(
                palette = main.palette,
                intensity = jsRound(second.intensity * 0.6),
            )
        }
        return out.take(MAX_LEAKS)
    }

    /** Completely random single leak from [CAMERA_TYPES] for Android Camera's "Random light leak" setting. */
    fun randomForCamera(aspect: Float, seed: Double, shortSideSprockets: Boolean = false): FilmLeak {
        val r = Mulberry32(seedBits(seed))
        val type = CAMERA_TYPES[floor(r.next() * CAMERA_TYPES.size).toInt()]
        return random(type = type, aspect = aspect, seed = r.next(), grade = true, shortSideSprockets = shortSideSprockets)
    }

    fun newVariation(l: FilmLeak, seed: Float): FilmLeak = l.copy(seed = seed)

    fun sideMove(l: FilmLeak, turn: Int): FilmLeak {
        val t = Math.floorMod(turn, 4)
        val depth = if (l.turn % 2 == 0) l.w.toDouble() else l.h.toDouble()
        val along = if (l.turn % 2 == 0) l.h.toDouble() else l.w.toDouble()
        val offset = if (l.turn % 2 == 0) l.cy.toDouble() else l.cx.toDouble()
        val hugs = l.type !in setOf(
            FilmLeakType.STREAK, FilmLeakType.FOG, FilmLeakType.DUST, FilmLeakType.STAIN, FilmLeakType.SCRATCHES,
        )
        if (!hugs) return l.copy(turn = t)
        val box = sideBox(t, depth, along, offset, if (l.type == FilmLeakType.REBATE) 0.0 else 0.02)
        return l.copy(
            turn = t,
            cx = box.cx.toFloat(),
            cy = box.cy.toFloat(),
            w = box.w.toFloat(),
            h = box.h.toFloat(),
        )
    }

    fun pack(leaks: List<FilmLeak>, width: Int, height: Int): FilmLeakUniforms {
        val on = leaks.filter { !isIdentity(it) }.take(MAX_LEAKS)
        if (on.isEmpty()) return FilmLeakUniforms.NONE
        val n = MAX_LEAKS * 4
        val box = FloatArray(n)
        val form = FloatArray(n)
        val tint = FloatArray(n)
        val tint2 = FloatArray(n)
        val look = FloatArray(n)
        val grade = FloatArray(n)
        val w = width.toFloat()
        val h = height.toFloat()
        on.forEachIndexed { i, l ->
            val o = i * 4
            box[o] = l.cx * w
            box[o + 1] = l.cy * h
            box[o + 2] = 2f / max(l.w * w, 1f)
            box[o + 3] = 2f / max(l.h * h, 1f)
            form[o] = l.type.shaderId
            form[o + 1] = Math.floorMod(l.turn, 4).toFloat()
            form[o + 2] = if (l.mirror) 1f else 0f
            form[o + 3] = l.seed
            tint[o] = l.palette.a[0]
            tint[o + 1] = l.palette.a[1]
            tint[o + 2] = l.palette.a[2]
            tint[o + 3] = l.intensity / 100f
            tint2[o] = l.palette.b[0]
            tint2[o + 1] = l.palette.b[1]
            tint2[o + 2] = l.palette.b[2]
            tint2[o + 3] = l.variant / 100f
            look[o] = l.softness / 100f
            look[o + 1] = l.texture / 100f
            look[o + 2] = l.amount / 100f
            look[o + 3] = 0f
            grade[o] = l.warmth / 100f
            grade[o + 1] = l.tint / 100f
            grade[o + 2] = l.fade / 100f
            grade[o + 3] = l.contrast / 100f
        }
        return FilmLeakUniforms(on.size, box, form, tint, tint2, look, grade)
    }

    private fun num(v: Any?, min: Float, max: Float): Float? =
        (v as? Number)?.toFloat()?.takeIf { it.isFinite() }?.coerceIn(min, max)

    fun parseLeak(raw: Any?): FilmLeak? {
        val s = raw as? JSONObject ?: return null
        val cx = num(s.opt("cx"), -1f, 2f) ?: return null
        val cy = num(s.opt("cy"), -1f, 2f) ?: return null
        val w = num(s.opt("w"), 0.01f, 4f) ?: return null
        val h = num(s.opt("h"), 0.01f, 4f) ?: return null
        val type = FilmLeakType.ofKey(s.opt("type") as? String) ?: FilmLeakType.EDGE
        val palette = FilmPalette.ofKey(s.opt("palette") as? String) ?: FilmPalette.WARM
        val turnRaw = num(s.opt("turn"), -16f, 16f) ?: 0f
        val turn = Math.floorMod(Math.round(turnRaw), 4)
        return FilmLeak(
            id = Masks.newId(),
            enabled = s.opt("enabled") as? Boolean ?: true,
            type = type,
            seed = num(s.opt("seed"), 0f, 1f) ?: 0f,
            cx = cx,
            cy = cy,
            w = w,
            h = h,
            turn = turn,
            mirror = s.opt("mirror") as? Boolean ?: false,
            palette = palette,
            intensity = num(s.opt("intensity"), 0f, 100f) ?: 80f,
            softness = num(s.opt("softness"), 0f, 100f) ?: 50f,
            texture = num(s.opt("texture"), 0f, 100f) ?: 65f,
            amount = num(s.opt("amount"), 0f, 100f) ?: 55f,
            variant = num(s.opt("variant"), 0f, 100f) ?: 50f,
            warmth = num(s.opt("warmth"), -100f, 100f) ?: 0f,
            tint = num(s.opt("tint"), -100f, 100f) ?: 0f,
            fade = num(s.opt("fade"), 0f, 100f) ?: 0f,
            contrast = num(s.opt("contrast"), -100f, 100f) ?: 0f,
        )
    }

    fun parseLeaks(raw: Any?): List<FilmLeak> {
        val a = raw as? JSONArray ?: return emptyList()
        return (0 until a.length()).mapNotNull { parseLeak(a.opt(it)) }.take(MAX_LEAKS)
    }

    fun toJson(leaks: List<FilmLeak>): JSONArray = JSONArray().apply {
        for (l in leaks) {
            put(
                JSONObject().apply {
                    put("enabled", l.enabled)
                    put("type", l.type.key)
                    put("seed", l.seed.toString().toDouble())
                    put("cx", l.cx.toString().toDouble())
                    put("cy", l.cy.toString().toDouble())
                    put("w", l.w.toString().toDouble())
                    put("h", l.h.toString().toDouble())
                    put("turn", l.turn)
                    put("mirror", l.mirror)
                    put("palette", l.palette.key)
                    put("intensity", l.intensity.toString().toDouble())
                    put("softness", l.softness.toString().toDouble())
                    put("texture", l.texture.toString().toDouble())
                    put("amount", l.amount.toString().toDouble())
                    put("variant", l.variant.toString().toDouble())
                    put("warmth", l.warmth.toString().toDouble())
                    put("tint", l.tint.toString().toDouble())
                    put("fade", l.fade.toString().toDouble())
                    put("contrast", l.contrast.toString().toDouble())
                },
            )
        }
    }
}
