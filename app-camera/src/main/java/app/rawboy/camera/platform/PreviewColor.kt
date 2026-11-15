package app.rawboy.camera.platform

/**
 * What a preview frame's colour path needs, as plain numbers (taken from Camera2 by `CameraController`), so the
 * strategies stay free of Camera2 objects and testable on the JVM.
 */
class PreviewColorInput(
    /** The raw decoder's camera RGB -> sRGB for this camera (LibRaw's rgb_cam), row-major; null if unknown. */
    val cameraToSrgb: DoubleArray?,
    /** The ISP's colour matrix from the frame's result (COLOR_CORRECTION_TRANSFORM), row-major; null if not reported. */
    val ispMatrix: DoubleArray?,
    /** The ISP's white balance gains from the result (COLOR_CORRECTION_GAINS): red, mean of the greens, blue. */
    val ispGains: DoubleArray?,
    /** The frame's as-shot neutral (SENSOR_NEUTRAL_COLOR_POINT) in camera RGB. */
    val neutral: DoubleArray?,
)

/** How linear preview RGB becomes Rec.2020 matching the raw's colours (the viewfinder's `Frame.color`). */
fun interface PreviewColor {
    /** Linear preview RGB -> Rec.2020, row-major; null = take the preview as plain sRGB (sRGB primaries). */
    fun toRec2020(input: PreviewColorInput): DoubleArray?
}

/** The neutral path: the preview is taken as plain sRGB, whatever the result reports. */
object SrgbPreviewColor : PreviewColor {
    override fun toRec2020(input: PreviewColorInput): DoubleArray? = null
    override fun toString() = "SrgbPreviewColor"
}
