package app.rawboy.develop

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Light effects: the generators must give web's patterns (fixtures printed by web's generateFx for the same seeds). */
class LightEffectsTest {
    private class Fixture(val kind: FxKind, val seed: Double, val amount: Int, val count: Int, val sum: Double, val mid: List<Double>)

    private val fixtures = listOf(
        Fixture(FxKind.LIGHTNING, 0.123456789, 50, 1216, 10886.784548, listOf(0.153890, 0.818387, 0.152923, 0.818436, 0.001027, 0.259327, 0.071573)),
        Fixture(FxKind.LIGHTNING, 0.987654321, 100, 1184, 7214.455287, listOf(-0.229461, 0.672842, -0.233325, 0.680763, 0.000902, 0.201966, -0.187595)),
        Fixture(FxKind.SPARKS, 0.123456789, 50, 605, 4382.312778, listOf(-0.256598, -0.156621, -0.256598, -0.156621, 0.002524, 0.516785, 0.016944)),
        Fixture(FxKind.SPARKS, 0.987654321, 100, 970, 7490.978020, listOf(-0.044105, -0.074243, -0.044105, -0.074243, 0.002505, 0.576007, 0.286204)),
        Fixture(FxKind.TRAILS, 0.123456789, 50, 640, 3667.019914, listOf(0.012969, -0.002565, 0.025738, -0.006254, 0.004946, 0.535224, 0.103361)),
        Fixture(FxKind.TRAILS, 0.987654321, 100, 1024, 7175.851702, listOf(-0.889021, 0.006033, -0.875036, 0.009390, 0.005800, 0.011021, 0.272486)),
        Fixture(FxKind.SWIRL, 0.123456789, 50, 960, 7088.557648, listOf(-0.272729, -0.272823, -0.289430, -0.264122, 0.005650, 0.761837, -0.783217)),
        Fixture(FxKind.SWIRL, 0.987654321, 100, 1278, 29238.808171, listOf(-0.188635, 0.080000, -0.189565, 0.092034, 0.005807, 0.018966, 1.227260)),
    )

    @Test
    fun generatesTheSamePatternsAsTheWeb() {
        for (f in fixtures) {
            val s = LightEffects.generate(f.kind, f.seed, f.amount)
            assertEquals("${f.kind} count", f.count, s.size)
            val sum = s.sumOf { it.x0 + 2 * it.y0 + 3 * it.x1 + 5 * it.y1 + 7 * it.w0 + 11 * it.w1 + 13 * it.b + 17 * it.h }
            assertEquals("${f.kind} checksum", f.sum, sum, 2e-6)
            val g = s[s.size / 2]
            val mid = listOf(g.x0, g.y0, g.x1, g.y1, g.w0, g.b, g.h)
            mid.forEachIndexed { i, v -> assertEquals("${f.kind} mid $i", f.mid[i], v, 1e-6) }
        }
    }

    @Test
    fun packsShownEffectsIntoImagePixelsAndChunkRowsSkippingHiddenOnes() {
        val a = LightEffects.newEffect(FxKind.LIGHTNING, 0.25f, 0.5f).copy(rx = 0.2f, ry = 0.1f, angle = 90f, intensity = 80f, hue = 180f, spread = 50f)
        val hidden = LightEffects.newEffect(FxKind.SPARKS).copy(enabled = false)
        val u = LightEffects.pack(listOf(hidden, a), 4000, 3000)
        assertEquals(1, u.count)
        assertEquals(1000f, u.geom[0], 1e-3f)
        assertEquals(1500f, u.geom[1], 1e-3f)
        assertEquals(800f, u.geom[2], 1e-3f)
        assertEquals(400f, u.geom[3], 1e-3f)
        assertEquals(0f, u.shape[0], 1e-6f)
        assertEquals(1f, u.shape[1], 1e-6f)
        assertEquals(0.5f, u.color[0], 1e-6f) // hue 180 degrees
        assertEquals(0.8f, u.color[2], 1e-6f)
        val data = u.data!!
        assertEquals(LightEffects.ROW * 4 * data.rows, data.data.size)
        assertEquals(0f, u.range[0], 0f)
        assertTrue(u.range[1] >= 1f)
        // The same pattern while only the placement changes: the very same data object, so dragging never re-uploads it.
        assertTrue(LightEffects.pack(listOf(a.copy(cx = 0.4f)), 4000, 3000).data === data)
        assertEquals(0, LightEffects.pack(emptyList(), 4000, 3000).count)
        assertEquals(0, LightEffects.pack(listOf(a.copy(intensity = 0f)), 4000, 3000).count)
    }

    @Test
    fun aNewEffectCoversTheScaledPhoto() {
        val (rx, ry) = LightEffects.coverSize(1.5f)
        assertEquals(0.5f * LightEffects.START_SCALE, rx, 1e-6f)
        assertEquals(0.5f * LightEffects.START_SCALE / 1.5f, ry, 1e-6f)
        val (px, py) = LightEffects.coverSize(0.5f)
        assertEquals(0.5f * LightEffects.START_SCALE * 0.5f, px, 1e-6f)
        assertEquals(0.5f * LightEffects.START_SCALE, py, 1e-6f)
    }

    @Test
    fun editsKeepEffectsAndTheSeedSurvivesTheRoundTrip() {
        val e = LightEffects.newEffect(FxKind.SPARKS, 0.3f, 0.6f, 1.5f).copy(seed = 0.123456789, hue = 100f)
        val text = LightEffects.toJson(listOf(e)).toString()
        val back = LightEffects.parseEffects(JSONArray(text))
        assertEquals(1, back.size)
        assertEquals(e.copy(id = back[0].id), back[0])
        assertNotNull(back[0].id)
        assertEquals(0, LightEffects.parseEffects(JSONArray("""[{"kind":"nope","cx":0,"cy":0,"rx":1,"ry":1}]""")).size)
        // Web edits clamp out-of-range values.
        val clamped = LightEffects.parseEffects(JSONArray("""[{"kind":"swirl","cx":0.5,"cy":0.5,"rx":0.9,"ry":0.9,"intensity":900,"hue":-5}]"""))
        assertEquals(100f, clamped[0].intensity, 0f)
        assertEquals(0f, clamped[0].hue, 0f)
    }

    @Test
    fun withKindKeepsPlaceSizeAndSeed() {
        val e = LightEffects.newEffect(FxKind.LIGHTNING).copy(angle = 33f, intensity = 70f)
        val s = e.withKind(FxKind.SPARKS)
        assertEquals(FxKind.SPARKS.hue, s.hue, 0f)
        assertEquals(33f, s.angle, 0f)
        assertEquals(e.seed, s.seed, 0.0)
        assertEquals(e.rx, s.rx, 0f)
    }
}
