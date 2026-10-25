package app.rawboy.develop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** One photo's edits as RawBoy hands them to Auto (the same format as web's Edits.ts). */
class EditsTest {
    private val defaults = DevelopParams(temperature = 4800f, tint = 6f)

    private val edited = defaults.copy(
        exposure = 0.7f, contrast = 12f, temperature = 5500f, film = "portra400", filmAmount = 80f, colorDenoise = 20f,
        curves = ToneCurves(rgb = listOf(CurvePoint(0f, 0f), CurvePoint(0.5f, 0.6f), CurvePoint(1f, 1f))),
        rotation = 1, flipHorizontal = true, straighten = 2.5f, cropLeft = 0.1f, cropTop = 0.05f, cropRight = 0.9f, cropBottom = 0.8f,
        masks = listOf(
            Masks.newRadial().copy(adjust = LayerAdjust(exposure = -1f, lensBlur = 60f), invert = true),
            Masks.newBrush().copy(
                strokes = listOf(BrushStroke("s", erase = false, auto = true, radius = 0.02f, hardness = 40f, flow = 70f, points = listOf(0.1f, 0.2f, 0.3f, 0.4f))),
                adjust = LayerAdjust(saturation = -30f),
            ),
        ),
        leaks = listOf(LightLeaks.newLeak(LeakKind.TRIANGLE, 0.2f, 0.3f).copy(intensity = 90f, hue = 10f, seed = 0.5f, bend = 30f, taper = -20f, warp = 40f, glow = 70f)),
    )

    /** [p] with fresh-id fields blanked, to compare decoded edits with the originals. */
    private fun withoutIds(p: DevelopParams) = p.copy(
        masks = p.masks.map { l -> l.copy(id = "", strokes = l.strokes.map { it.copy(id = "") }) },
        leaks = p.leaks.map { it.copy(id = "") },
    )

    @Test
    fun keepsEveryEditGeometryMasksStrokesAndLeaksIncluded() {
        val text = Edits.encode(edited, defaults)!!
        val back = Edits.decode(text, defaults)!!
        assertEquals(withoutIds(edited), withoutIds(back))
        assertEquals(2, back.masks.size)
        assertTrue(back.masks[1].shape is MaskShape.Brush)
        assertEquals(60f, back.masks[0].adjust.lensBlur, 0f)
    }

    @Test
    fun keepsOnlyWhatDiffersFromTheAsShotDefaults() {
        assertNull(Edits.encode(defaults, defaults))
        val empty = Edits.encode(defaults, defaults, keepEmpty = true)!!
        assertEquals(defaults, Edits.decode(empty, defaults))
        val text = Edits.encode(defaults.copy(exposure = 1f), defaults)!!
        assertTrue(text.contains("\"exposure\":1"))
        assertTrue(!text.contains("temperature"))
        // The other photo's white balance doesn't leak in: missing fields keep this photo's defaults.
        val other = DevelopParams(temperature = 3200f)
        assertEquals(3200f, Edits.decode(text, other)!!.temperature, 0f)
    }

    @Test
    fun readsRawBoyWebEditsAndSkipsWhatIsInvalid() {
        val web = """
            {"format":"rawboy-edit","version":1,"values":{"exposure":-0.5,"toneMapper":"filmic","lut":null,"rotation":3,
            "flipVertical":true,"cropLeft":0.2,"cropRight":0.1,
            "masks":[{"name":"Brush","enabled":true,"opacity":80,"invert":false,"shape":{"kind":"brush"},
              "adjust":{"exposure":1,"contrast":0,"highlights":0,"shadows":0,"temperature":0,"tint":0,"saturation":0,"clarity":0,"lensBlur":30},
              "strokes":[{"erase":true,"auto":false,"radius":0.01,"hardness":50,"flow":100,"points":[0.5,0.5,0.6,0.5]},{"radius":0.01,"points":[0.5]}]}],
            "leaks":[{"enabled":true,"kind":"glow","cx":0.5,"cy":0.5,"rx":0.16,"ry":0.11,"angle":0,"softness":50,"intensity":100,"hue":22,"seed":0.1},{"cx":"x"}]}}
        """.trimIndent()
        val p = Edits.decode(web, defaults)!!
        assertEquals(-0.5f, p.exposure, 0f)
        assertEquals(ToneMapper.FILMIC, p.toneMapper)
        assertEquals(3, p.rotation)
        assertTrue(p.flipVertical)
        // A crop with its right edge left of its left one is dropped.
        assertEquals(CropMath.FULL, p.crop)
        assertEquals(1, p.masks.size)
        assertEquals(1, p.masks[0].strokes.size)
        assertTrue(p.masks[0].strokes[0].erase)
        assertEquals(30f, p.masks[0].adjust.lensBlur, 0f)
        assertEquals(1, p.leaks.size)
        assertEquals(LeakKind.GLOW, p.leaks[0].kind)
        assertEquals(defaults.temperature, p.temperature, 0f)
        assertNull(Edits.decode("""{"format":"rawboy-preset"}""", defaults))
        assertNull(Edits.decode("not json", defaults))
    }

    @Test
    fun presetsStillDropStrokesAndBrushLayers() {
        val preset = Presets.capture("p", edited, setOf(PresetGroup.MASKS))
        val decoded = Presets.decode(Presets.encode(listOf(preset)))[0]
        @Suppress("UNCHECKED_CAST")
        val layers = decoded.values["masks"] as List<MaskLayer>
        assertEquals(1, layers.size)
        assertTrue(layers[0].strokes.isEmpty())
    }
}
