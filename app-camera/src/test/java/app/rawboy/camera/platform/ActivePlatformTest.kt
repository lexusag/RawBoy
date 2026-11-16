package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.oem.samsung.samsungLayer
import app.rawboy.camera.platform.tensor.tensorLayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Each phone gets its own chip's layers; a debug build's hand-picked chip keeps its calibration apart. */
class ActivePlatformTest {
    private val tensor = PlatformRegistry.stack(listOf(tensorLayer))
    private val pixel = PhoneDescription(
        PlatformDetector.chipOf("Google", "zumapro"), "Google", "Tensor G4", "zumapro", "caiman", "Google", "google", "Pixel 9 Pro", "caiman", 36,
    )
    private val onePlus = PhoneDescription(
        PlatformDetector.chipOf("QTI", "qcom"), "QTI", "SM8550", "qcom", "kalama", "OnePlus", "OnePlus", "CPH2447", "OP594DL1", 36,
    )

    @Test
    fun aPixelGetsTensor() {
        val r = ActivePlatform.resolve(pixel, null)
        assertEquals(tensor, r.profile)
        assertEquals("", r.profile.calibrationSlot)
        assertEquals(listOf("neutral", "tensor"), r.profile.layers)
    }

    @Test
    fun anUntestedPhoneGetsTheNeutralProfile() {
        // The OnePlus 11: no Qualcomm or OnePlus layer yet.
        assertEquals(neutralPlatform, ActivePlatform.resolve(onePlus, null).profile)
        assertEquals(neutralPlatform, ActivePlatform.resolve(PhoneDescription(ChipVendor.UNKNOWN), null).profile)
        assertEquals(neutralPlatform, ActivePlatform.resolve(PhoneDescription(ChipVendor.MEDIATEK, manufacturer = "Xiaomi"), null).profile)
    }

    @Test
    fun aSamsungGetsItsLayerOnItsChip() {
        val galaxy = PhoneDescription(PlatformDetector.chipOf("QTI", "qcom"), manufacturer = "samsung", model = "SM-S931B")
        assertEquals(PlatformRegistry.stack(listOf(samsungLayer)), ActivePlatform.resolve(galaxy, null).profile)
    }

    @Test
    fun choosingTensorGivesWhatEveryPhoneHadBeforeDetection() {
        // Before session 07 every phone was taken to have a Tensor chip, its other fields its own.
        val r = ActivePlatform.resolve(onePlus, ChipVendor.TENSOR)
        assertEquals(ChipVendor.TENSOR, r.chosenChip)
        assertEquals(tensor.copy(calibrationSlot = "neutral+tensor"), r.profile)
        val galaxy = PhoneDescription(ChipVendor.MEDIATEK, manufacturer = "samsung")
        assertEquals(listOf("neutral", "tensor", "samsung"), ActivePlatform.resolve(galaxy, ChipVendor.TENSOR).profile.layers)
    }

    @Test
    fun aChosenProfileLearnsApartUnlessItIsTheAutomaticOne() {
        assertEquals("neutral", ActivePlatform.resolve(pixel, ChipVendor.UNKNOWN).profile.calibrationSlot)
        assertEquals("neutral+tensor", ActivePlatform.resolve(onePlus, ChipVendor.TENSOR).profile.calibrationSlot)
        // The same layers as detected: the same profile, so the phone's own calibration stays valid.
        assertEquals("", ActivePlatform.resolve(pixel, ChipVendor.TENSOR).profile.calibrationSlot)
        assertEquals("", ActivePlatform.resolve(onePlus, ChipVendor.UNKNOWN).profile.calibrationSlot)
    }

    @Test
    fun logLineNamesThePhoneLayersAndValues() {
        val line = ActivePlatform.describe(ActivePlatform.resolve(onePlus, ChipVendor.TENSOR))
        for (part in listOf("chip QUALCOMM", "\"SM8550\"", "taken for TENSOR by hand", "layers neutral+tensor", "calibration neutral+tensor", "extraBlack=0.00146", "UndoIspPreviewColor", "backIsoScale=4.0", "defaultGuide=16.0")) {
            assertTrue("$part not in $line", part in line)
        }
        assertTrue("automatic; layers neutral; calibration own" in ActivePlatform.describe(ActivePlatform.resolve(onePlus, null)))
    }
}
