package app.rawboy.camera.platform

/** Who made the phone's SoC, as the detector recognises it; [UNKNOWN] rather than a guess. */
enum class ChipVendor { TENSOR, QUALCOMM, MEDIATEK, EXYNOS, UNKNOWN }

/**
 * The phone the camera runs on, as `PlatformDetector` (session 07) reads it from `android.os.Build`. Pure data: the
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
) {
    /** Whether [manufacturer] is [name], ignoring case (makers differ: "samsung", "OnePlus", "Google"). */
    fun madeBy(name: String) = manufacturer.equals(name, ignoreCase = true)
}
