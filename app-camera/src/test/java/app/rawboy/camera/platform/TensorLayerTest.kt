package app.rawboy.camera.platform

import app.rawboy.camera.CameraSettings
import app.rawboy.camera.ShotSaver
import app.rawboy.camera.platform.tensor.tensorLayer
import app.rawboy.camera.platform.traits.UndoIspPreviewColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * The Tensor profile equals what the camera does today. Constants still visible in the shared code are compared
 * directly; private ones (and every value once the constants have moved into the profile) as literals, named after
 * the constant they replace.
 */
class TensorLayerTest {
    private val tensor = PlatformRegistry.resolve(PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"))

    @Test
    fun resolvesToTensor() {
        assertEquals(listOf("neutral", "tensor"), tensor.layers)
    }

    @Test
    fun previewAsToday() {
        // The former CameraController.previewToRec2020: the result's ISP matrix and gains are undone.
        assertSame(UndoIspPreviewColor, tensor.preview.color)
    }

    @Test
    fun stillAsToday() {
        assertEquals(ShotSaver.EXTRA_BLACK, tensor.still.extraBlack)
        assertEquals(1.46e-3f, tensor.still.extraBlack)
        assertEquals(66_666_667L, tensor.still.maxStillExposureNs) // CameraController.MAX_STILL_EXPOSURE_NS
        // No Samsung look on a Pixel.
        assertEquals(0f, tensor.still.lookContrast)
        assertEquals(0f, tensor.still.lookSaturation)
    }

    @Test
    fun noiseAsToday() {
        assertEquals(4f, tensor.noise.backIsoScale) // ShotSaver.PHONE_NOISE_ISO_SCALE
        assertEquals(8f, tensor.noise.frontIsoScale) // ShotSaver.FRONT_NOISE_ISO_SCALE
        assertEquals(CameraSettings.LUT_LUMA_DENOISE, tensor.noise.lutLumaFloor)
        assertEquals(CameraSettings.LUT_COLOR_DENOISE, tensor.noise.lutColorFloor)
        assertEquals(CameraSettings.LUT_LUMA_DENOISE_EXPERIMENTAL, tensor.noise.experimentalLumaFloor)
        assertEquals(CameraSettings.LUT_COLOR_DENOISE_EXPERIMENTAL, tensor.noise.experimentalColorFloor)
        assertEquals(12f, tensor.noise.lutLumaFloor)
        assertEquals(70f, tensor.noise.lutColorFloor)
        assertEquals(22f, tensor.noise.experimentalLumaFloor)
        assertEquals(70f, tensor.noise.experimentalColorFloor)
    }

    @Test
    fun flashAsToday() {
        assertEquals(16f, tensor.flash.defaultGuide) // CameraController.DEFAULT_FLASH_GUIDE
        assertEquals(4f, tensor.flash.defaultGainNoDistance) // CameraController.DEFAULT_FLASH_GAIN_NO_DISTANCE
        assertEquals(1.7f, tensor.flash.referenceFNumber) // CameraController.FLASH_REFERENCE_F_NUMBER
    }

    @Test
    fun tensorPinsItsValuesWhateverTheNeutralProfileSays() {
        // The Tensor layer repeats the numbers it shares with the neutral profile, so changing those doesn't move the Pixel.
        val shifted = PlatformPatch { p ->
            p.copy(
                still = p.still.copy(extraBlack = 0.01f, maxStillExposureNs = 1L),
                noise = p.noise.copy(backIsoScale = 1f, frontIsoScale = 1f, lutLumaFloor = 0f, lutColorFloor = 0f, experimentalLumaFloor = 0f, experimentalColorFloor = 0f),
                flash = p.flash.copy(defaultGuide = 1f, referenceFNumber = 9f, defaultGainNoDistance = 1f),
                preview = p.preview.copy(color = SrgbPreviewColor),
            )
        }
        val pinned = tensorLayer.patch.applyTo(shifted.applyTo(tensor))
        assertEquals(tensor, pinned)
    }
}
