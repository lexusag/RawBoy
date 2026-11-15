package app.rawboy.camera.platform.traits

import app.rawboy.camera.platform.PreviewColor
import app.rawboy.camera.platform.PreviewColorInput
import app.rawboy.color.Mat3

/**
 * For ISPs that report the white balance gains and colour matrix they render the preview with: undoes both (result
 * COLOR_CORRECTION_GAINS / TRANSFORM) back to camera RGB and applies what the raw decoder does, 1 / AsShotNeutral
 * then rgb_cam. Scaled so the ISP's white keeps its luminance, which keeps the exposure calibration (previewScale)
 * valid. Null (plain sRGB) when the frame doesn't report it all.
 *
 * On the Pixel 9 Pro the preview's matrix is more saturated than the DNG's (~20-40% in reds), so a plain sRGB ->
 * Rec.2020 viewfinder didn't match the photo. A phone whose result reports an identity matrix while the ISP applies
 * its own (OnePlus 11) must not use this: it oversaturates the viewfinder.
 */
object UndoIspPreviewColor : PreviewColor {
    override fun toRec2020(input: PreviewColorInput): DoubleArray? {
        val rgbCam = input.cameraToSrgb ?: return null
        val ccm = input.ispMatrix ?: return null
        val gains = input.ispGains ?: return null
        val n = input.neutral ?: return null
        if (rgbCam.size != 9 || ccm.size != 9 || gains.size != 3 || n.size != 3) return null
        if (n.any { it <= 0.0 } || gains.any { it <= 0.0 }) return null
        val ispInverse = runCatching { Mat3.inverse(ccm) }.getOrNull() ?: return null
        val toCamera = Mat3.multiply(Mat3.diagonal(1 / gains[0], 1 / gains[1], 1 / gains[2]), ispInverse)
        val balance = Mat3.diagonal(1 / n[0], 1 / n[1], 1 / n[2])
        val m = Mat3.multiply(SRGB_TO_REC2020, Mat3.multiply(rgbCam, Mat3.multiply(balance, toCamera)))
        val white = Mat3.apply(m, doubleArrayOf(1.0, 1.0, 1.0))
        val y = 0.2627 * white[0] + 0.6780 * white[1] + 0.0593 * white[2]
        if (!(y > 0)) return null
        return DoubleArray(9) { m[it] / y }
    }

    override fun toString() = "UndoIspPreviewColor"

    /** As the decoder's kSrgbToRec2020. */
    internal val SRGB_TO_REC2020 = doubleArrayOf(
        0.6274040, 0.3292820, 0.0433136,
        0.0690970, 0.9195400, 0.0113612,
        0.0163916, 0.0880132, 0.8955950,
    )
}
