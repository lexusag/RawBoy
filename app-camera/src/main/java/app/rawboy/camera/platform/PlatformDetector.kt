package app.rawboy.camera.platform

import android.os.Build

/**
 * Reads the phone the camera runs on from `android.os.Build` and recognises its chip maker. It only describes the
 * phone; which values that phone gets is [PlatformRegistry]'s business.
 *
 * Strings behind the rules (see [chipOf]): OnePlus 11 measured (2026-11-15: SOC "QTI" / "SM8550", HARDWARE "qcom",
 * BOARD "kalama"); Pixel from AOSP's gs101 device config (`ro.soc.manufacturer=Google`, `ro.soc.model=Tensor`; a
 * Pixel 8 Pro reports "Tensor G3"); MediaTek and Exynos from public property dumps, unchecked on a phone.
 */
object PlatformDetector {
    /** This phone, its Build strings as reported (empty when missing). */
    fun detect(): PhoneDescription {
        val sdk = Build.VERSION.SDK_INT
        // SOC_* only exist from API 31: reading them earlier throws.
        val socManufacturer = if (sdk >= 31) known(Build.SOC_MANUFACTURER) else ""
        val socModel = if (sdk >= 31) known(Build.SOC_MODEL) else ""
        val hardware = known(Build.HARDWARE)
        return PhoneDescription(
            chip = chipOf(socManufacturer, hardware),
            socManufacturer = socManufacturer,
            socModel = socModel,
            hardware = hardware,
            board = known(Build.BOARD),
            manufacturer = known(Build.MANUFACTURER),
            brand = known(Build.BRAND),
            model = known(Build.MODEL),
            device = known(Build.DEVICE),
            sdk = sdk,
        )
    }

    /**
     * The chip maker from the SoC manufacturer (API 31+), or, when that is missing (API 29-30, or a build that
     * leaves `ro.soc.*` unset), from `Build.HARDWARE`. A SoC manufacturer that is set but not recognised gives
     * [ChipVendor.UNKNOWN], never a guess from the hardware name; the phone maker is never a hint (Galaxies have
     * Snapdragon, Exynos or MediaTek chips).
     */
    fun chipOf(socManufacturer: String, hardware: String): ChipVendor {
        val soc = socManufacturer.trim().lowercase().takeIf { it != "unknown" }.orEmpty()
        if (soc.isNotEmpty()) return when (soc) {
            // Tensor: Samsung builds it, but its SoC manufacturer reads Google.
            "google" -> ChipVendor.TENSOR
            "qti", "qualcomm" -> ChipVendor.QUALCOMM
            "mediatek" -> ChipVendor.MEDIATEK
            "samsung" -> ChipVendor.EXYNOS
            else -> ChipVendor.UNKNOWN
        }
        // Tensor phones launched on API 31, so they always report a SoC manufacturer and need no rule here.
        val hw = hardware.trim().lowercase()
        return when {
            hw == "qcom" -> ChipVendor.QUALCOMM
            MEDIATEK_HARDWARE.matches(hw) -> ChipVendor.MEDIATEK
            hw.startsWith("exynos") || EXYNOS_HARDWARE.matches(hw) -> ChipVendor.EXYNOS
            else -> ChipVendor.UNKNOWN
        }
    }

    /** One line for logcat and the device report: what was read and what was recognised. */
    fun describe(phone: PhoneDescription): String = with(phone) {
        "chip $chip (soc \"$socManufacturer\" / \"$socModel\", hardware \"$hardware\", board \"$board\"), " +
            "manufacturer \"$manufacturer\", brand \"$brand\", model \"$model\", device \"$device\", sdk $sdk"
    }

    /** MediaTek's hardware names: "mt6765", "mt6893". */
    private val MEDIATEK_HARDWARE = Regex("mt\\d{4}.*")

    /** Exynos's newer hardware names: "s5e9925". */
    private val EXYNOS_HARDWARE = Regex("s5e\\d{4}.*")

    /** [value], or empty when Build couldn't read it ([Build.UNKNOWN]). */
    private fun known(value: String?): String = value?.takeIf { it != Build.UNKNOWN }.orEmpty()
}
