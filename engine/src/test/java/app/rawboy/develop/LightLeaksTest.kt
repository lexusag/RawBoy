package app.rawboy.develop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Light leaks (the same cases as web's lightleaks.test.ts). */
class LightLeaksTest {
    @Test
    fun packsShownLeaksIntoImagePixelsAndSkipsHiddenOrTransparentOnes() {
        val a = LightLeaks.newLeak(LeakKind.GLOW, 0.25f, 0.5f).copy(
            rx = 0.1f, ry = 0.05f, angle = 90f, softness = 40f, glow = 50f, bend = 50f, warp = 20f, taper = -30f,
            intensity = 80f, hue = 0f, seed = 0.3f,
        )
        val hidden = LightLeaks.newLeak().copy(enabled = false)
        val clear = LightLeaks.newLeak().copy(intensity = 0f)
        val u = LightLeaks.pack(listOf(hidden, a, clear), 4000, 3000)
        assertEquals(1, u.count)
        assertEquals(1000f, u.geom[0], 1e-3f)
        assertEquals(1500f, u.geom[1], 1e-3f)
        assertEquals(1f / 400f, u.geom[2], 1e-7f)
        assertEquals(1f / 200f, u.geom[3], 1e-7f)
        assertEquals(0f, u.shape[0], 1e-6f)
        assertEquals(1f, u.shape[1], 1e-6f)
        assertEquals(0.4f, u.shape[2], 1e-6f)
        assertEquals(LightLeaks.glowReach(50f), u.shape[3], 1e-6f)
        assertEquals(0.8f, u.color[3], 1e-6f)
        assertEquals(0.3f, u.outer[3], 1e-6f)
        assertEquals(0f, u.form[0], 0f) // glow
        assertEquals(0.5f / 400f, u.form[1], 1e-9f) // bend 50: the ends move half a length radius over 400 px
        assertEquals(0.2f, u.form[2], 1e-6f)
        assertEquals(-0.3f, u.form[3], 1e-6f)
        assertEquals(0, LightLeaks.pack(emptyList(), 4000, 3000).count)
    }

    @Test
    fun numbersTheKindsAndStartsAStreakAsALongThinBeam() {
        val s = LightLeaks.newLeak()
        assertEquals(LeakKind.STREAK, s.kind)
        assertTrue(s.rx / s.ry > 5f)
        assertEquals(1f, LightLeaks.pack(listOf(s), 4000, 3000).form[0], 0f)
        assertEquals(2f, LightLeaks.pack(listOf(LightLeaks.newLeak(LeakKind.TRIANGLE)), 4000, 3000).form[0], 0f)
        val g = s.copy(bend = 30f, hue = 0f).withKind(LeakKind.GLOW)
        assertEquals(LeakKind.GLOW.rx, g.rx, 0f)
        assertEquals(LeakKind.GLOW.glow, g.glow, 0f)
        assertEquals(30f, g.bend, 0f)
        assertEquals(0.5f, g.cx, 0f)
    }

    @Test
    fun measuresEdgesInShapeRadii() {
        assertEquals(-1f, LightLeaks.edge(LeakKind.GLOW, 0f, 0f), 0f)
        assertEquals(0f, LightLeaks.edge(LeakKind.GLOW, 0.6f, 0.8f), 1e-6f)
        assertEquals(0f, LightLeaks.edge(LeakKind.STREAK, 5f, 1f), 0f)
        assertEquals(0f, LightLeaks.edge(LeakKind.TRIANGLE, 1f, 0f), 1e-6f) // apex
        assertEquals(0f, LightLeaks.edge(LeakKind.TRIANGLE, -1f, 1f), 1e-6f) // base corner
        assertTrue(LightLeaks.edge(LeakKind.TRIANGLE, 0f, 0f) < 0f)
        assertTrue(LightLeaks.edge(LeakKind.TRIANGLE, 0f, 0.6f) > 0f)
    }

    @Test
    fun makesPhotoshopsColours() {
        val inner = LightLeaks.color(LightLeaks.HUE) // (255, 156, 0)
        assertEquals(1f, inner[0], 0f)
        assertEquals(156f / 255f, inner[1], 0.02f)
        assertEquals(0f, inner[2], 1e-6f)
        val outer = LightLeaks.outerColor(LightLeaks.HUE) // (255, 5, 5)
        assertEquals(1f, outer[0], 0f)
        assertTrue(outer[1] < 0.05f && outer[2] < 0.05f)
        assertTrue(LightLeaks.color(-40f)[2] > 0.5f) // magenta-red: some blue
    }

    @Test
    fun theOverlayShapeKeepsTheGeometry() {
        val l = LightLeaks.newLeak(cx = 0.3f, cy = 0.6f)
        val moved = l.withShape(l.shape.copy(cx = 0.4f, angle = 10f, feather = 5f))
        assertEquals(0.4f, moved.cx, 0f)
        assertEquals(10f, moved.angle, 0f)
        assertEquals(l.softness, moved.softness, 0f) // the overlay's feather ring only shows softness
    }

    @Test
    fun presetsNeverKeepLeaks() {
        assertTrue(PresetGroup.entries.none { "leaks" in it.fields })
    }
}
