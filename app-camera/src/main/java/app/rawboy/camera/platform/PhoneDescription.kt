package app.rawboy.camera.platform

/** Who made the phone's SoC, as the detector recognises it; [UNKNOWN] rather than a guess. */
enum class ChipVendor(
    /** What Settings shows. */
    val title: String,
    /** A short label for the debug choice ([ActivePlatform.choices]). */
    val shortTitle: String,
) {
    TENSOR("Google Tensor", "Tensor"),
    QUALCOMM("Qualcomm Snapdragon", "Qualcomm"),
    MEDIATEK("MediaTek", "MediaTek"),
    EXYNOS("Samsung Exynos", "Exynos"),
    UNKNOWN("unknown", "None"),
}

/**
 * The phone the camera runs on, as read from `android.os.Build` ([PlatformDetector]). Pure data: the
 * raw strings are kept as reported (empty when missing), so layers can match on them and the device report can show
 * them; only [chip] is interpreted.
 */
data class PhoneDescription(
    val chip: ChipVendor,
    /** `Build.SOC_MANUFACTURER` (API 31+; empty before), e.g. "QTI". */
    val socManufacturer: String = "",
    /** `Build.SOC_MODEL` (API 31+; empty before), e.g. "SM8550". */
    val socModel: String = "",
    /** `Build.HARDWARE`, e.g. "qcom": with [board], the chip hint on API 29-30. */
    val hardware: String = "",
    /** `Build.BOARD`, e.g. "kalama". */
    val board: String = "",
    /** `Build.MANUFACTURER`, e.g. "OnePlus", "samsung". */
    val manufacturer: String = "",
    /** `Build.BRAND`. */
    val brand: String = "",
    /** `Build.MODEL`, e.g. "CPH2447". */
    val model: String = "",
    /** `Build.DEVICE`, e.g. "OP594DL1". */
    val device: String = "",
    /** `Build.VERSION.SDK_INT`. */
    val sdk: Int = 0,
    /** `Build.DISPLAY`, the firmware build, e.g. "CPH2447_16.0.5.1301(EX01)" (the device report). */
    val firmware: String = "",
) {
    /** Whether [manufacturer] is [name], ignoring case (makers differ: "samsung", "OnePlus", "Google"). */
    fun madeBy(name: String) = manufacturer.equals(name, ignoreCase = true)
}
