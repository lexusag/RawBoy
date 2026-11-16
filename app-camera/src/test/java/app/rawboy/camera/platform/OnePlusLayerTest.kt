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
        assertEquals(listOf("neutral", "qualcomm", "oneplus"), PlatformRegistry.resolve(onePlus11).layers)
        assertEquals(listOf("neutral", "qualcomm"), PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")).layers)
        assertEquals(listOf("neutral", "oneplus"), PlatformRegistry.resolve(onePlus11.copy(chip = ChipVendor.MEDIATEK)).layers)
    }

    @Test
    fun listsStandaloneCameras() {
        assertTrue(PlatformRegistry.resolve(onePlus11).lenses.standaloneOverLogical)
        assertEquals(emptyList<String>(), PlatformRegistry.resolve(onePlus11).problems())
    }

    @Test
    fun othersKeepTheLogicalCamera() {
        assertFalse(neutralPlatform.lenses.standaloneOverLogical)
        assertFalse(PlatformRegistry.stack(listOf(tensorLayer)).lenses.standaloneOverLogical)
        assertFalse(PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")).lenses.standaloneOverLogical)
    }

    @Test
    fun changesOnlyItsOwnFields() {
        val p = onePlusLayer.patch.applyTo(neutralPlatform)
        assertEquals(neutralPlatform.copy(lenses = p.lenses), p)
    }
}
