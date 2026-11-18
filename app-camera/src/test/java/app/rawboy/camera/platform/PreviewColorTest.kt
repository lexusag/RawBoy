package app.rawboy.camera.platform

import app.rawboy.camera.platform.traits.UndoIspPreviewColor
import app.rawboy.color.Mat3
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PreviewColorTest {
    private val identity = Mat3.diagonal(1.0, 1.0, 1.0)

    // A camera RGB -> sRGB and an ISP matrix of the rough shape real ones have (rows summing to 1).
    private val rgbCam = doubleArrayOf(1.62, -0.48, -0.14, -0.21, 1.42, -0.21, 0.02, -0.55, 1.53)
    private val ispMatrix = doubleArrayOf(1.80, -0.66, -0.14, -0.30, 1.55, -0.25, 0.05, -0.70, 1.65)
    private val gains = doubleArrayOf(2.1, 1.0, 1.6)
    private val neutral = doubleArrayOf(0.48, 1.0, 0.62)

    private fun luma(v: DoubleArray) = 0.2627 * v[0] + 0.6780 * v[1] + 0.0593 * v[2]

    @Test
    fun srgbTakesThePreviewAsIs() {
        assertNull(SrgbPreviewColor.toRec2020(PreviewColorInput(rgbCam, ispMatrix, gains, neutral)))
    }

    @Test
    fun undoIspNeedsEverything() {
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(null, ispMatrix, gains, neutral)))
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, null, gains, neutral)))
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, ispMatrix, null, neutral)))
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, ispMatrix, gains, null)))
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, ispMatrix, doubleArrayOf(2.1, 0.0, 1.6), neutral)))
        assertNull(UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, DoubleArray(9), gains, neutral))) // singular
    }

    @Test
    fun undoIspWithANeutralIspIsPlainSrgb() {
        // ISP gains = 1 / neutral and an identity matrix, raw decoder also identity: only sRGB -> Rec.2020 is left.
        val m = UndoIspPreviewColor.toRec2020(
            PreviewColorInput(identity, identity, doubleArrayOf(1 / 0.5, 1.0, 1 / 0.8), doubleArrayOf(0.5, 1.0, 0.8)),
        )!!
        val s = UndoIspPreviewColor.SRGB_TO_REC2020
        val white = luma(Mat3.apply(s, doubleArrayOf(1.0, 1.0, 1.0)))
        assertArrayEquals(DoubleArray(9) { s[it] / white }, m, 1e-12)
    }

    @Test
    fun undoIspGivesTheRawDecodersColour() {
        val m = UndoIspPreviewColor.toRec2020(PreviewColorInput(rgbCam, ispMatrix, gains, neutral))!!
        // White as the ISP renders it keeps its luminance.
        assertEquals(1.0, luma(Mat3.apply(m, doubleArrayOf(1.0, 1.0, 1.0))), 1e-12)
        // Any camera colour: through the ISP, then m, lands where the raw decoder puts it, up to the white scale.
        val decoder = Mat3.multiply(UndoIspPreviewColor.SRGB_TO_REC2020, Mat3.multiply(rgbCam, Mat3.diagonal(1 / neutral[0], 1 / neutral[1], 1 / neutral[2])))
        val isp = Mat3.multiply(ispMatrix, Mat3.diagonal(gains[0], gains[1], gains[2]))
        val scale = luma(Mat3.apply(decoder, Mat3.apply(Mat3.inverse(isp), doubleArrayOf(1.0, 1.0, 1.0))))
        for (camera in listOf(doubleArrayOf(0.2, 0.5, 0.1), doubleArrayOf(0.9, 0.3, 0.6), doubleArrayOf(0.05, 0.05, 0.4))) {
            val viaPreview = Mat3.apply(m, Mat3.apply(isp, camera))
            val direct = Mat3.apply(decoder, camera).map { it / scale }.toDoubleArray()
            assertArrayEquals(direct, viaPreview, 1e-9)
        }
    }

    @Test
    fun cameraSaturationOnlyTouchesItsCameras() {
        val base = UndoIspPreviewColor
        val c = CameraSaturation(base, mapOf("3" to 1.5))
        val full = PreviewColorInput(rgbCam, ispMatrix, gains, neutral, cameraId = "2")
        assertArrayEquals(base.toRec2020(full), c.toRec2020(full), 0.0)
        val three = PreviewColorInput(rgbCam, ispMatrix, gains, neutral, cameraId = "3")
        assertArrayEquals(Mat3.multiply(CameraSaturation.saturation(1.5), base.toRec2020(three)!!), c.toRec2020(three), 1e-12)
        // A base that takes the preview as plain sRGB: the saturation goes on top of the viewfinder's own sRGB matrix.
        val plain = CameraSaturation(SrgbPreviewColor, mapOf("3" to 1.5))
        assertNull(plain.toRec2020(full))
        assertArrayEquals(Mat3.multiply(CameraSaturation.saturation(1.5), SRGB_TO_REC2020_ROWS), plain.toRec2020(three), 1e-12)
    }

    @Test
    fun saturationOneIsIdentity() {
        assertArrayEquals(identity, CameraSaturation.saturation(1.0), 1e-12)
    }
}
