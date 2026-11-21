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
        assertEquals(listOf("neutral", "qualcomm", "oneplus", "cph2447"), PlatformRegistry.resolve(onePlus11).layers)
        assertEquals(listOf("neutral", "qualcomm", "oneplus"), PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).layers) // OnePlus 12
        assertEquals(listOf("neutral", "qualcomm"), PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")).layers)
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
    fun decodesTheExactBlackWithAPedestal() {
        val still = PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).still
        assertTrue(still.exactBlack)
        assertEquals(32f, still.blackPedestal)
        assertEquals(BlackOffsets.NONE, still.blackOffsets) // sensor offsets are the model's
    }

    @Test
    fun othersDecodeBlackAsBefore() {
        for (p in listOf(
            neutralPlatform,
            PlatformRegistry.stack(listOf(tensorLayer)),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")),
        )) {
            assertFalse(p.layers.toString(), p.still.exactBlack)
            assertEquals(p.layers.toString(), 0f, p.still.blackPedestal)
            assertEquals(p.layers.toString(), BlackOffsets.NONE, p.still.blackOffsets)
        }
    }

    @Test
    fun brightnessReachesTheRawUnlessAeIsAtItsCeiling() {
        assertEquals(CompensationModel.AE_GAIN_IN_RAW, PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).still.compensation)
        for (p in listOf(
            neutralPlatform,
            PlatformRegistry.stack(listOf(tensorLayer)),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")),
        )) {
            assertEquals(p.layers.toString(), CompensationModel.BOOST_STAYS_DIGITAL, p.still.compensation)
        }
    }

    @Test
    fun flashIsExposedByTheCamerasAe() {
        val flash = PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).flash
        assertEquals(FlashMetering.CAMERA_AE, flash.metering)
        assertEquals(0f, flash.cameraAeCompensationEv) // the compensation is the model's
        assertTrue(flash.screenFlashUntilExposed)
        assertEquals(-1f, PlatformRegistry.resolve(onePlus11).flash.cameraAeCompensationEv)
    }

    @Test
    fun othersExposeTheFlashAsBefore() {
        for (p in listOf(
            neutralPlatform,
            PlatformRegistry.stack(listOf(tensorLayer)),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")),
            PlatformRegistry.resolve(onePlus11.copy(manufacturer = "samsung")),
        )) {
            assertEquals(p.layers.toString(), FlashMetering.MANUAL_GUIDE, p.flash.metering)
            assertEquals(p.layers.toString(), 0f, p.flash.cameraAeCompensationEv)
            assertFalse(p.layers.toString(), p.flash.screenFlashUntilExposed)
        }
    }

    @Test
    fun changesOnlyItsOwnFields() {
        val p = onePlusLayer.patch.applyTo(neutralPlatform)
        assertEquals(
            neutralPlatform.copy(
                lenses = p.lenses, preview = p.preview, still = neutralPlatform.still.copy(exactBlack = true, blackPedestal = 32f, compensation = CompensationModel.AE_GAIN_IN_RAW),
                flash = neutralPlatform.flash.copy(metering = FlashMetering.CAMERA_AE, screenFlashUntilExposed = true),
            ),
            p,
        )
        assertEquals(neutralPlatform.preview.color, p.preview.color)
    }
}
