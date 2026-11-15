package app.rawboy.camera.platform

import app.rawboy.camera.platform.tensor.tensorLayer
import org.junit.Assert.assertEquals
import org.junit.Test

/** Until the chip is detected, every phone gets the Tensor profile; manufacturer layers still apply. */
class ActivePlatformTest {
    private val tensor = PlatformRegistry.stack(listOf(tensorLayer))

    @Test
    fun everyPhoneGetsTensor() {
        val phones = listOf(
            PhoneDescription(ChipVendor.QUALCOMM, socManufacturer = "QTI", socModel = "SM8550", hardware = "qcom", board = "kalama", manufacturer = "OnePlus", model = "CPH2447"),
            PhoneDescription(ChipVendor.UNKNOWN),
            PhoneDescription(ChipVendor.MEDIATEK, manufacturer = "samsung"),
            PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"),
        )
        for (phone in phones) assertEquals("$phone", tensor, PlatformRegistry.resolve(ActivePlatform.untilAutodetect(phone)))
    }

    @Test
    fun keepsThePhonesOwnFields() {
        val galaxy = PhoneDescription(ChipVendor.QUALCOMM, manufacturer = "samsung", model = "SM-S931B", device = "pa1q", sdk = 35)
        assertEquals(galaxy.copy(chip = ChipVendor.TENSOR), ActivePlatform.untilAutodetect(galaxy))
    }

    @Test
    fun manufacturerLayersStillApply() {
        val samsung = PlatformLayer("samsung", LayerLevel.MANUFACTURER, { it.madeBy("samsung") }, PlatformPatch { it.copy(still = it.still.copy(lookContrast = 25f)) })
        val p = PlatformRegistry.resolve(ActivePlatform.untilAutodetect(PhoneDescription(ChipVendor.QUALCOMM, manufacturer = "samsung")), listOf(tensorLayer, samsung))
        assertEquals(listOf("neutral", "tensor", "samsung"), p.layers)
        assertEquals(25f, p.still.lookContrast)
        assertEquals(tensor.still.extraBlack, p.still.extraBlack)
    }
}
