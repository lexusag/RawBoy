package app.rawboy.camera.platform

import app.rawboy.color.Mat3

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
    /** The camera streaming the preview: the physical camera's id for a lens streamed through a logical one. */
    val cameraId: String? = null,
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

/**
 * [base]'s colours with the chroma of some cameras' previews scaled by [byCamera] (camera id -> factor, 1 = as
 * [base]), around grey at equal Rec.2020 luminance, for ISPs that render some lenses' previews paler or more saturated
 * than their raws. Other cameras get [base] unchanged.
 */
data class CameraSaturation(val base: PreviewColor, val byCamera: Map<String, Double>) : PreviewColor {
    override fun toRec2020(input: PreviewColorInput): DoubleArray? {
        val m = base.toRec2020(input)
        val s = input.cameraId?.let { byCamera[it] } ?: return m
        return Mat3.multiply(saturation(s), m ?: SRGB_TO_REC2020_ROWS)
    }

    override fun toString() = "CameraSaturation($base, $byCamera)"

    companion object {
        /** Rec.2020 luminance weights. */
        private val Y = doubleArrayOf(0.2627, 0.6780, 0.0593)

        /** c -> Y + s (c - Y): grey stays grey, luminance is kept, chroma scales by [s]. Row-major. */
        fun saturation(s: Double): DoubleArray = DoubleArray(9) { i -> (if (i / 3 == i % 3) s else 0.0) + (1 - s) * Y[i % 3] }
    }
}

/**
 * Plain sRGB -> Rec.2020 primaries, row-major, as the decoder's kSrgbToRec2020; also what the viewfinder applies when
 * a [PreviewColor] returns null.
 */
internal val SRGB_TO_REC2020_ROWS = doubleArrayOf(
    0.6274040, 0.3292820, 0.0433136,
    0.0690970, 0.9195400, 0.0113612,
    0.0163916, 0.0880132, 0.8955950,
)
