package app.rawboy.develop

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilmLeaksTest {
    @Test
    fun deterministicParityWithWebGenerator() {
        val a = FilmLeaks.random(type = null, aspect = 1.5f, seed = 0.123456)
        assertEquals(FilmLeakType.BLOB, a.type)
        assertEquals(FilmPalette.MAGENTA, a.palette)
        assertEquals(0, a.turn)
        assertTrue(a.mirror)
        assertEquals(0.64161602f, a.seed, 1e-6f)
        assertEquals(0.3313671f, a.cx, 1e-5f)
        assertEquals(0.24500187f, a.cy, 1e-5f)
        assertEquals(0.7027342f, a.w, 1e-5f)
        assertEquals(0.9239125f, a.h, 1e-5f)
        assertEquals(68f, a.intensity, 0f)
        assertEquals(31f, a.softness, 0f)
        assertEquals(79f, a.texture, 0f)
        assertEquals(45f, a.amount, 0f)
        assertEquals(11f, a.variant, 0f)
        assertEquals(34f, a.warmth, 0f)
        assertEquals(3f, a.tint, 0f)
        assertEquals(29f, a.fade, 0f)
        assertEquals(-7f, a.contrast, 0f)

        val b = FilmLeaks.random(type = FilmLeakType.SCRATCHES, aspect = 0.667f, seed = 0.777, grade = false)
        assertEquals(FilmLeakType.SCRATCHES, b.type)
        assertEquals(FilmPalette.MONO, b.palette)
        assertEquals(1, b.turn)
        assertFalse(b.mirror)
        assertEquals(0.50736765f, b.seed, 1e-6f)
        assertEquals(0.5f, b.cx, 1e-6f)
        assertEquals(0.5f, b.cy, 1e-6f)
        assertEquals(1.0f, b.w, 1e-6f)
        assertEquals(1.0f, b.h, 1e-6f)
        assertEquals(75f, b.intensity, 0f)
        assertEquals(71f, b.softness, 0f)
        assertEquals(71f, b.texture, 0f)
        assertEquals(79f, b.amount, 0f)
        assertEquals(80f, b.variant, 0f)
        assertEquals(0f, b.warmth, 0f)
        assertEquals(0f, b.tint, 0f)
        assertEquals(0f, b.fade, 0f)
        assertEquals(0f, b.contrast, 0f)

        val roll = FilmLeaks.randomRoll(aspect = 1.5f, seed = 0.42)
        assertEquals(2, roll.size)
        assertEquals(FilmLeakType.BLOB, roll[0].type)
        assertEquals(FilmPalette.RED, roll[0].palette)
        assertEquals(3, roll[0].turn)
        assertEquals(72f, roll[0].intensity, 0f)
        assertEquals(FilmLeakType.REBATE, roll[1].type)
        assertEquals(FilmPalette.RED, roll[1].palette)
        assertEquals(2, roll[1].turn)
        assertEquals(81f, roll[1].intensity, 0f)
    }

    @Test
    fun cameraRandomOnlyUsesAllowedTypes() {
        val allowed = FilmLeaks.CAMERA_TYPES.toSet()
        assertEquals(
            setOf(
                FilmLeakType.EDGE,
                FilmLeakType.BLOB,
                FilmLeakType.SPROCKET,
                FilmLeakType.REBATE,
                FilmLeakType.FLARE,
                FilmLeakType.START,
            ),
            allowed,
        )
        for (i in 0 until 100) {
            val l = FilmLeaks.randomForCamera(aspect = 1.333f, seed = i / 100.0)
            assertTrue("Unexpected camera type ${l.type}", l.type in allowed)
        }
    }

    @Test
    fun parsePackEditsAndPresets() {
        val raw = JSONArray().apply {
            put(
                JSONObject().apply {
                    put("type", "scratches")
                    put("cx", 0.5)
                    put("cy", 0.5)
                    put("w", 1.0)
                    put("h", 1.0)
                    put("turn", -1)
                    put("palette", "cool")
                    put("intensity", 120.0)
                },
            )
            put(JSONObject().apply { put("cx", 0.5) }) // invalid
            put(
                JSONObject().apply {
                    put("type", "edge")
                    put("cx", 0.2)
                    put("cy", 0.5)
                    put("w", 0.4)
                    put("h", 1.0)
                    put("enabled", false)
                    put("intensity", 50.0)
                },
            )
        }
        val parsed = FilmLeaks.parseLeaks(raw)
        assertEquals(2, parsed.size)
        assertEquals(3, parsed[0].turn)
        assertEquals(100f, parsed[0].intensity, 0f)
        assertEquals(FilmPalette.COOL, parsed[0].palette)
        assertTrue(FilmLeaks.isIdentity(parsed[1]))

        val u = FilmLeaks.pack(parsed, 1000, 800)
        assertEquals(1, u.count)
        assertEquals(500f, u.box[0], 1e-4f)
        assertEquals(400f, u.box[1], 1e-4f)
        assertEquals(FilmLeakType.SCRATCHES.shaderId, u.form[0], 0f)
        assertEquals(3f, u.form[1], 0f)

        val params = DevelopParams(filmLeaks = listOf(parsed[0]))
        val encoded = Edits.encode(params, DevelopParams())
        assertNotNull(encoded)
        val decoded = Edits.decode(encoded!!, DevelopParams())
        assertNotNull(decoded)
        assertEquals(1, decoded!!.filmLeaks.size)
        assertEquals(FilmLeakType.SCRATCHES, decoded.filmLeaks[0].type)
        assertEquals(FilmPalette.COOL, decoded.filmLeaks[0].palette)

        assertFalse(PresetGroup.LEAKS in PresetGroup.DEFAULT)
        val preset = Presets.capture("LeakTest", params, setOf(PresetGroup.LEAKS))
        val json = Presets.encode(listOf(preset))
        val loaded = Presets.decode(json).first()
        val applied = Presets.apply(loaded, DevelopParams())
        assertEquals(1, applied.filmLeaks.size)
        assertNotEquals(params.filmLeaks[0].id, applied.filmLeaks[0].id)
        assertEquals(FilmLeakType.SCRATCHES, applied.filmLeaks[0].type)
    }
}
