package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.qualcomm.qualcommLayer
import app.rawboy.camera.platform.tensor.tensorLayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Snapdragon phones develop shots at normal GPU priority; Pixels, Samsungs and unknown chips keep the low one. */
class QualcommLayerTest {
    private val snapdragon = PhoneDescription(ChipVendor.QUALCOMM, "QTI", "SM8550", "qcom", "kalama", "Xiaomi", "Xiaomi", "2210132G", "fuxi", 34)

    @Test
    fun appliesByChip() {
        assertEquals(listOf("neutral", "qualcomm"), PlatformRegistry.resolve(snapdragon).layers)
        assertEquals(listOf("neutral"), PlatformRegistry.resolve(snapdragon.copy(chip = ChipVendor.MEDIATEK)).layers)
        assertEquals(listOf("neutral", "tensor"), PlatformRegistry.resolve(snapdragon.copy(chip = ChipVendor.TENSOR)).layers)
        assertEquals(emptyList<String>(), PlatformRegistry.resolve(snapdragon).problems())
    }

    @Test
    fun developsAtNormalPriority() {
        assertFalse(PlatformRegistry.resolve(snapdragon).still.lowPriorityDevelop)
        assertFalse(PlatformRegistry.resolve(snapdragon.copy(manufacturer = "OnePlus", model = "CPH2447")).still.lowPriorityDevelop)
    }

    @Test
    fun othersKeepTheLowPriority() {
        for (p in listOf(
            neutralPlatform,
            PlatformRegistry.stack(listOf(tensorLayer)),
            PlatformRegistry.resolve(snapdragon.copy(manufacturer = "samsung")), // Galaxy S25: Snapdragon, pinned
            PlatformRegistry.resolve(snapdragon.copy(chip = ChipVendor.MEDIATEK)),
        )) assertTrue(p.layers.toString(), p.still.lowPriorityDevelop)
    }

    @Test
    fun changesOnlyItsOwnField() {
        val p = qualcommLayer.patch.applyTo(neutralPlatform)
        assertEquals(neutralPlatform.copy(still = neutralPlatform.still.copy(lowPriorityDevelop = false)), p)
    }
}
