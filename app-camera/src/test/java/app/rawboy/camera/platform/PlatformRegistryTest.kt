package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.tensor.tensorLayer
import app.rawboy.camera.platform.traits.UndoIspPreviewColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatformRegistryTest {
    private fun layer(name: String, level: LayerLevel, matches: (PhoneDescription) -> Boolean = { true }, patch: PlatformPatch) =
        PlatformLayer(name, level, matches, patch)

    private val setsBlack = layer("black", LayerLevel.CHIP_VENDOR, patch = PlatformPatch { it.copy(still = it.still.copy(extraBlack = 0.002f)) })
    private val setsGuide = layer("guide", LayerLevel.MANUFACTURER, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 30f)) })
    private val empty = layer("empty", LayerLevel.MODEL, patch = PlatformPatch { it })

    @Test
    fun neutralIsUsable() {
        assertEquals(emptyList<String>(), neutralPlatform.problems())
        assertEquals(listOf("neutral"), neutralPlatform.layers)
    }

    @Test
    fun noMatchingLayerGivesNeutral() {
        val phone = PhoneDescription(ChipVendor.UNKNOWN, manufacturer = "Nobody")
        assertEquals(neutralPlatform, PlatformRegistry.resolve(phone))
    }

    @Test
    fun layerReplacesOnlyWhatItSets() {
        val p = PlatformRegistry.stack(listOf(setsBlack))
        assertEquals(0.002f, p.still.extraBlack)
        assertEquals(neutralPlatform.copy(layers = p.layers, still = neutralPlatform.still.copy(extraBlack = 0.002f)), p)
        assertEquals(listOf("neutral", "black"), p.layers)
    }

    @Test
    fun emptyLayerChangesNothingButItsName() {
        val with = PlatformRegistry.stack(listOf(setsBlack, setsGuide, empty))
        val without = PlatformRegistry.stack(listOf(setsBlack, setsGuide))
        assertEquals(without.copy(layers = with.layers), with)
        assertEquals(listOf("neutral", "black", "guide", "empty"), with.layers)
    }

    @Test
    fun layersApplyByLevelNotListOrder() {
        val chipGuide = layer("chip", LayerLevel.CHIP_VENDOR, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 10f)) })
        val makerGuide = layer("maker", LayerLevel.MANUFACTURER, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 20f)) })
        val modelGuide = layer("model", LayerLevel.MODEL, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 40f)) })
        val socGuide = layer("soc", LayerLevel.SOC, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 15f)) })
        // Listed backwards: the manufacturer still overrides the chip, the model overrides both.
        val p = PlatformRegistry.stack(listOf(modelGuide, makerGuide, socGuide, chipGuide))
        assertEquals(40f, p.flash.defaultGuide)
        assertEquals(listOf("neutral", "chip", "soc", "maker", "model"), p.layers)
        assertEquals(20f, PlatformRegistry.stack(listOf(makerGuide, socGuide, chipGuide)).flash.defaultGuide)
        // Within one level, list order.
        val second = layer("second", LayerLevel.CHIP_VENDOR, patch = PlatformPatch { it.copy(flash = it.flash.copy(defaultGuide = 11f)) })
        assertEquals(11f, PlatformRegistry.stack(listOf(chipGuide, second)).flash.defaultGuide)
    }

    @Test
    fun manufacturerOverridesChipStrategy() {
        // A maker can take back a chip layer's strategy (and the other way round).
        val maker = layer("maker", LayerLevel.MANUFACTURER, patch = PlatformPatch { it.copy(preview = it.preview.copy(color = SrgbPreviewColor)) })
        assertSame(UndoIspPreviewColor, PlatformRegistry.stack(listOf(tensorLayer)).preview.color)
        assertSame(SrgbPreviewColor, PlatformRegistry.stack(listOf(tensorLayer, maker)).preview.color)
    }

    @Test
    fun onlyMatchingLayersApply() {
        val samsungOnly = layer("maker", LayerLevel.MANUFACTURER, matches = { it.madeBy("samsung") }, patch = setsGuide.patch)
        val from = listOf(tensorLayer, samsungOnly)
        val galaxy = PlatformRegistry.resolve(PhoneDescription(ChipVendor.QUALCOMM, manufacturer = "samsung"), from)
        assertEquals(listOf("neutral", "maker"), galaxy.layers)
        assertEquals(30f, galaxy.flash.defaultGuide)
        val pixel = PlatformRegistry.resolve(PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"), from)
        assertEquals(listOf("neutral", "tensor"), pixel.layers)
        assertTrue(PhoneDescription(ChipVendor.UNKNOWN, manufacturer = "Samsung").madeBy("samsung"))
    }

    @Test
    fun everyRegisteredLayerGivesAUsableProfile() {
        for (l in PlatformRegistry.layers) {
            assertEquals("$l", emptyList<String>(), PlatformRegistry.stack(listOf(l)).problems())
        }
    }

    @Test
    fun problemsAreReported() {
        val bad = neutralPlatform.copy(still = neutralPlatform.still.copy(extraBlack = -1f), noise = neutralPlatform.noise.copy(lutColorFloor = 120f))
        assertEquals(2, bad.problems().size)
    }
}
