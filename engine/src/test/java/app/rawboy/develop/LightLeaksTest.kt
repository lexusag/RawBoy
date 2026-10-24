package app.rawboy.develop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Light leaks (the same cases as web's lightleaks.test.ts). */
class LightLeaksTest {
    @Test
    fun packsShownLeaksIntoImagePixelsAndSkipsHiddenOrTransparentOnes() {
        val a = LightLeaks.newLeak(LeakKind.GLOW, 0.25f, 0.5f).copy(rx = 0.1f, ry = 0.05f, angle = 90f, softness = 40f, intensity = 80f, hue = 0f, seed = 0.3f)
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
        assertEquals(0.3f, u.shape[3], 1e-6f)
        assertEquals(0.8f, u.color[3], 1e-6f)
        assertEquals(0, LightLeaks.pack(emptyList(), 4000, 3000).count)
    }

    @Test
    fun marksStreaksInTheSeedSlotAndStartsThemAsALongThinBeam() {
        val s = LightLeaks.newLeak().copy(seed = 0.25f)
        assertEquals(LeakKind.STREAK, s.kind)
        assertTrue(s.rx / s.ry > 5f)
        assertEquals(2.25f, LightLeaks.pack(listOf(s), 4000, 3000).shape[3], 1e-6f)
        val g = s.copy(angle = 30f, hue = 0f).withKind(LeakKind.GLOW)
        assertEquals(LeakKind.GLOW.rx, g.rx, 0f)
        assertEquals(LeakKind.GLOW.softness, g.softness, 0f)
        assertEquals(30f, g.angle, 0f)
        assertEquals(0.5f, g.cx, 0f)
        assertEquals(0.25f, LightLeaks.pack(listOf(g), 4000, 3000).shape[3], 1e-6f)
    }

    @Test
    fun makesWarmColours() {
        val red = LightLeaks.color(0f)
        assertEquals(1f, red[0], 0f)
        assertEquals(0.08f, red[1], 1e-6f)
        assertEquals(0.08f, red[2], 1e-6f)
        val orange = LightLeaks.color(30f)
        assertEquals(1f, orange[0], 0f)
        assertTrue(orange[1] > 0.4f && orange[1] < 0.6f)
        assertEquals(0.08f, orange[2], 1e-6f)
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
