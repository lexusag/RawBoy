package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.oem.oneplus.onePlusLayer
import app.rawboy.camera.platform.tensor.tensorLayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** OnePlus phones get their HAL's workarounds; other Snapdragon phones, the Pixel and unknown phones keep theirs. */
class OnePlusLayerTest {
    private val onePlus11 = PhoneDescription(ChipVendor.QUALCOMM, "QTI", "SM8550", "qcom", "kalama", "OnePlus", "OnePlus", "CPH2447", "OP594DL1", 36)

    @Test
    fun appliesByManufacturer() {
        assertEquals(listOf("neutral", "oneplus", "cph2447"), PlatformRegistry.resolve(onePlus11).layers)
        assertEquals(listOf("neutral", "oneplus"), PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).layers) // OnePlus 12
        assertEquals(listOf("neutral"), PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")).layers)
        assertEquals(listOf("neutral", "oneplus", "cph2447"), PlatformRegistry.resolve(onePlus11.copy(chip = ChipVendor.MEDIATEK)).layers)
    }

    @Test
    fun listsStandaloneCamerasAndSendsTheCurveAtEvenPoints() {
        assertTrue(PlatformRegistry.resolve(onePlus11).lenses.standaloneOverLogical)
        assertTrue(PlatformRegistry.resolve(onePlus11).preview.curveAtEvenPoints)
        assertEquals(PreviewLevel.STILL_WHITE_BALANCED, PlatformRegistry.resolve(onePlus11).preview.level)
        assertFalse(PlatformRegistry.resolve(onePlus11).preview.liftsShadows)
        assertEquals(emptyList<String>(), PlatformRegistry.resolve(onePlus11).problems())
    }

    @Test
    fun othersKeepTheirLensOrderAndCurve() {
        for (p in listOf(
            neutralPlatform,
            PlatformRegistry.stack(listOf(tensorLayer)),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")), // another Snapdragon phone
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")),
        )) {
            assertFalse(p.layers.toString(), p.lenses.standaloneOverLogical)
            assertFalse(p.layers.toString(), p.preview.curveAtEvenPoints)
            assertEquals(p.layers.toString(), PreviewLevel.BOOSTED, p.preview.level)
            assertTrue(p.layers.toString(), p.preview.liftsShadows)
        }
        assertFalse(neutralPlatform.lenses.standaloneOverLogical)
        assertFalse(PlatformRegistry.stack(listOf(tensorLayer)).lenses.standaloneOverLogical)
        assertFalse(PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")).lenses.standaloneOverLogical)
    }

    @Test
    fun changesOnlyItsOwnFields() {
        val p = onePlusLayer.patch.applyTo(neutralPlatform)
        assertEquals(neutralPlatform.copy(lenses = p.lenses, preview = p.preview), p)
        assertEquals(neutralPlatform.preview.color, p.preview.color)
    }
}
