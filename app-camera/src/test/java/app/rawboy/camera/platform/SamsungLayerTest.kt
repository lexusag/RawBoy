package app.rawboy.camera.platform

import app.rawboy.camera.ShotDevelop
import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.oem.samsung.samsungLayer
import app.rawboy.camera.platform.traits.UndoIspPreviewColor
import app.rawboy.develop.DevelopParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Samsung phones get the ISP look on saved photos and keep the Pixel's extra black and preview colour path whatever
 * chip they have, so they develop as before chips were told apart.
 */
class SamsungLayerTest {
    private fun samsung(chip: ChipVendor) = PlatformRegistry.resolve(PhoneDescription(chip, manufacturer = "samsung"))

    @Test
    fun appliesByManufacturerIgnoringCase() {
        for (maker in listOf("samsung", "Samsung", "SAMSUNG")) {
            val p = PlatformRegistry.resolve(PhoneDescription(ChipVendor.MEDIATEK, manufacturer = maker))
            assertEquals(listOf("neutral", "samsung"), p.layers)
        }
        assertEquals(listOf("neutral"), PlatformRegistry.resolve(PhoneDescription(ChipVendor.MEDIATEK, manufacturer = "Google")).layers)
    }

    @Test
    fun pinsTodaysValuesOnAnyChip() {
        // Galaxy S25: Snapdragon; Galaxy Tab S11 Ultra: MediaTek; neither gets the Tensor layer once chips are detected.
        for (chip in listOf(ChipVendor.QUALCOMM, ChipVendor.MEDIATEK, ChipVendor.EXYNOS, ChipVendor.UNKNOWN)) {
            val p = samsung(chip)
            assertEquals("$chip", 1.46e-3f, p.still.extraBlack)
            assertSame("$chip", UndoIspPreviewColor, p.preview.color)
            assertEquals("$chip", 25f, p.still.lookContrast) // CameraSettings.SAMSUNG_CONTRAST
            assertEquals("$chip", 25f, p.still.lookSaturation) // CameraSettings.SAMSUNG_SATURATION
            assertEquals("$chip", emptyList<String>(), p.problems())
        }
    }

    @Test
    fun developsAsWhenEveryPhoneWasTakenForTensor() {
        // Before chips were detected a Samsung got Tensor + Samsung; every value but the layer names stays.
        val before = PlatformRegistry.stack(listOf(app.rawboy.camera.platform.tensor.tensorLayer, samsungLayer))
        for (chip in listOf(ChipVendor.QUALCOMM, ChipVendor.MEDIATEK, ChipVendor.EXYNOS, ChipVendor.UNKNOWN)) {
            assertEquals("$chip", before.copy(layers = samsung(chip).layers), samsung(chip))
        }
    }

    @Test
    fun onTensorOnlyTheLookIsAdded() {
        val tensor = PlatformRegistry.resolve(PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"))
        val p = samsung(ChipVendor.TENSOR)
        assertEquals(listOf("neutral", "tensor", "samsung"), p.layers)
        assertEquals(tensor.copy(layers = p.layers, still = tensor.still.copy(lookContrast = 25f, lookSaturation = 25f)), p)
    }

    @Test
    fun changesOnlyItsOwnFields() {
        val p = samsungLayer.patch.applyTo(neutralPlatform)
        assertEquals(neutralPlatform.noise, p.noise)
        assertEquals(neutralPlatform.flash, p.flash)
        assertEquals(neutralPlatform.still.maxStillExposureNs, p.still.maxStillExposureNs)
    }

    // The former CameraSettingsTest cases of withPhoneIspLook, on the layer's profile.

    @Test
    fun samsungGetsTheIspLook() {
        val base = DevelopParams()
        val p = ShotDevelop.withIspLook(base, samsung(ChipVendor.QUALCOMM).still)
        assertEquals(base.contrast + 25f, p.contrast, 1e-4f)
        assertEquals(base.saturation + 25f, p.saturation, 1e-4f)
    }

    @Test
    fun otherMakersAreUntouched() {
        val base = DevelopParams()
        val google = PlatformRegistry.resolve(PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"))
        assertSame(base, ShotDevelop.withIspLook(base, google.still))
        assertSame(base, ShotDevelop.withIspLook(base, neutralPlatform.still))
    }

    @Test
    fun blackAndWhiteStaysGrey() {
        val p = ShotDevelop.withIspLook(DevelopParams(saturation = -100f), samsung(ChipVendor.QUALCOMM).still)
        assertEquals(-100f, p.saturation, 0f)
    }

    @Test
    fun theLookIsCappedAt100() {
        val p = ShotDevelop.withIspLook(DevelopParams(contrast = 90f, saturation = 95f), samsung(ChipVendor.QUALCOMM).still)
        assertEquals(100f, p.contrast, 0f)
        assertEquals(100f, p.saturation, 0f)
    }
}
