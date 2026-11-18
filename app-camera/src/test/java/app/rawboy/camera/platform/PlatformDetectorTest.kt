package app.rawboy.camera.platform

import org.junit.Assert.assertEquals
import org.junit.Test

/** The chip maker from Build strings: the SoC manufacturer when there is one, else the hardware name. */
class PlatformDetectorTest {
    private fun chip(soc: String, hardware: String) = PlatformDetector.chipOf(soc, hardware)

    @Test
    fun socManufacturer() {
        // OnePlus 11 (measured); Pixel (AOSP gs101 config); the others as public property dumps show them.
        assertEquals(ChipVendor.QUALCOMM, chip("QTI", "qcom"))
        assertEquals(ChipVendor.QUALCOMM, chip("Qualcomm", ""))
        assertEquals(ChipVendor.TENSOR, chip("Google", "zumapro"))
        assertEquals(ChipVendor.MEDIATEK, chip("Mediatek", "mt6983"))
        assertEquals(ChipVendor.MEDIATEK, chip("MediaTek", ""))
        assertEquals(ChipVendor.EXYNOS, chip("Samsung", "s5e9925"))
        assertEquals(ChipVendor.QUALCOMM, chip(" qti ", ""))
    }

    @Test
    fun anUnknownSocManufacturerIsNotGuessedFromTheHardware() {
        assertEquals(ChipVendor.UNKNOWN, chip("Spreadtrum", "qcom"))
        assertEquals(ChipVendor.UNKNOWN, chip("Unisoc", "ums9230"))
    }

    @Test
    fun withoutSocFieldsTheHardwareDecides() {
        // API 29-30 (no SOC_*), or "unknown" from a build that leaves ro.soc.* unset.
        for (soc in listOf("", "unknown", "  ")) {
            assertEquals(ChipVendor.QUALCOMM, chip(soc, "qcom"))
            assertEquals(ChipVendor.MEDIATEK, chip(soc, "mt6765"))
            assertEquals(ChipVendor.MEDIATEK, chip(soc, "MT6893"))
            assertEquals(ChipVendor.EXYNOS, chip(soc, "exynos990"))
            assertEquals(ChipVendor.EXYNOS, chip(soc, "s5e8825"))
            assertEquals(ChipVendor.UNKNOWN, chip(soc, ""))
            assertEquals(ChipVendor.UNKNOWN, chip(soc, "kirin980"))
            // No hardware rule for Tensor: it launched on API 31, which always reports the SoC.
            assertEquals(ChipVendor.UNKNOWN, chip(soc, "gs101"))
            // Not a hint: the board name, or "mt" without a number.
            assertEquals(ChipVendor.UNKNOWN, chip(soc, "kalama"))
            assertEquals(ChipVendor.UNKNOWN, chip(soc, "mtk"))
        }
    }

    @Test
    fun describesWhatWasRead() {
        val phone = PhoneDescription(ChipVendor.QUALCOMM, "QTI", "SM8550", "qcom", "kalama", "OnePlus", "OnePlus", "CPH2447", "OP594DL1", 36)
        assertEquals(
            "chip QUALCOMM (soc \"QTI\" / \"SM8550\", hardware \"qcom\", board \"kalama\"), manufacturer \"OnePlus\", " +
                "brand \"OnePlus\", model \"CPH2447\", device \"OP594DL1\", sdk 36",
            PlatformDetector.describe(phone),
        )
    }
}
