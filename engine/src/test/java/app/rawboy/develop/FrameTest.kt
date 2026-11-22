package app.rawboy.develop

import app.rawboy.gl.ShaderParams
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The frame overlay's params (Frame.kt): colours, the preset group, edits and the B&W rule behind `uMonoFx`. */
class FrameTest {
    @Test
    fun defaultsAreOff() {
        val p = DevelopParams()
        assertEquals(0f, p.frame, 0f)
        assertEquals("#000000", p.frameColor)
        assertFalse(p.monoFx)
    }

    @Test
    fun colourParsing() {
        assertArrayEquals(floatArrayOf(1f, 0f, 0f), Frame.rgb("#ff0000"), 1e-6f)
        assertArrayEquals(floatArrayOf(1f, 1f, 1f), Frame.rgb("FFFFFF"), 1e-6f)
        assertArrayEquals(floatArrayOf(0f, 0f, 0f), Frame.rgb("nonsense"), 0f)
        assertEquals("#f1ead8", Frame.normalize(" #F1EAD8 "))
        assertNull(Frame.normalize("#12345"))
        assertNull(Frame.normalize("#gggggg"))
        assertNull(Frame.normalize(null))
    }

    @Test
    fun thicknessFollowsTheShortSide() {
        assertEquals(40f, Frame.thicknessPx(2f, 4000, 2000), 1e-4f)
        assertEquals(0f, Frame.thicknessPx(0f, 4000, 2000), 0f)
        assertEquals(400f, Frame.thicknessPx(99f, 4000, 2000), 1e-3f) // clamped to MAX (20%)
    }

    @Test
    fun frameGroupRoundTripsThroughPresetsAndIsNotTickedByDefault() {
        assertFalse(PresetGroup.FRAME in PresetGroup.DEFAULT)
        val edited = DevelopParams(frame = 4f, frameColor = "#ffffff")
        val preset = Presets.decode(Presets.encode(listOf(Presets.capture("Border", edited, setOf(PresetGroup.FRAME))))).single()
        val applied = Presets.apply(preset, DevelopParams())
        assertEquals(4f, applied.frame, 0f)
        assertEquals("#ffffff", applied.frameColor)
        // Out-of-range thickness and bad colours from a hand-edited file are tamed or ignored.
        assertEquals(20f, Presets.set(DevelopParams(), "frame", 99f).frame, 0f)
        assertEquals("#000000", Presets.set(DevelopParams(), "frameColor", "red").frameColor)
    }

    @Test
    fun editsKeepTheFrame() {
        val defaults = DevelopParams()
        val edited = defaults.copy(frame = 6.5f, frameColor = "#808080")
        val back = Edits.decode(Edits.encode(edited, defaults)!!, defaults)!!
        assertEquals(6.5f, back.frame, 0f)
        assertEquals("#808080", back.frameColor)
        assertNull(Edits.encode(defaults, defaults))
    }

    @Test
    fun monoRuleIsTheExplicitFlagOrAFullStrengthMonoLut() {
        val mono = "asset:luts/Yellow Mono 400.cube"
        assertFalse(ShaderParams.isMono(DevelopParams()))
        assertTrue(ShaderParams.isMono(DevelopParams(monoFx = true)))
        assertTrue(ShaderParams.isMono(DevelopParams(lut = mono)))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = mono, lutAmount = 60f)))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = mono, film = "portra400")))
        assertFalse(ShaderParams.isMono(DevelopParams(lut = "asset:luts/Movie Green.cube")))
    }
}
