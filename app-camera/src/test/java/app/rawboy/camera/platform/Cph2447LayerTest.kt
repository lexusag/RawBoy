package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.oem.oneplus.cph2447Layer
import app.rawboy.camera.platform.oem.oneplus.onePlusLayer
import app.rawboy.color.Mat3
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The OnePlus 11's model layer: only its ultrawide's viewfinder colour changes, and only on that phone. */
class Cph2447LayerTest {
    private val onePlus11 = PhoneDescription(ChipVendor.QUALCOMM, "QTI", "SM8550", "qcom", "kalama", "OnePlus", "OnePlus", "CPH2447", "OP594DL1", 36)
    private val profile = PlatformRegistry.resolve(onePlus11)

    private fun input(camera: String?) = PreviewColorInput(null, null, null, doubleArrayOf(0.47, 1.0, 0.70), cameraId = camera)

    @Test
    fun appliesToTheOnePlus11Only() {
        assertEquals("cph2447", profile.layers.last())
        assertEquals(listOf("neutral", "oneplus"), PlatformRegistry.resolve(onePlus11.copy(model = "CPH2581")).layers)
        assertEquals(listOf("neutral"), PlatformRegistry.resolve(onePlus11.copy(manufacturer = "Xiaomi")).layers)
        assertEquals(emptyList<String>(), profile.problems())
    }

    @Test
    fun changesOnlyThePreviewColour() {
        val below = onePlusLayer.patch.applyTo(neutralPlatform)
        val p = cph2447Layer.patch.applyTo(below)
        assertEquals(below.copy(preview = below.preview.copy(color = p.preview.color)), p)
    }

    @Test
    fun mainAndSelfieCamerasKeepPlainSrgb() {
        // Cameras 2 (main) and 1 (selfie): what the OnePlus layer gives, the preview as plain sRGB.
        assertNull(profile.preview.color.toRec2020(input("2")))
        assertNull(profile.preview.color.toRec2020(input("1")))
        assertNull(profile.preview.color.toRec2020(input(null)))
    }

    @Test
    fun ultrawideGetsMoreChromaAtTheSameGreyAndLuminance() {
        val m = profile.preview.color.toRec2020(input("3"))!!
        val plain = SRGB_TO_REC2020_ROWS
        // Grey stays the plain matrix's grey (sRGB white -> Rec.2020 white, rows summing to 1).
        assertArrayEquals(Mat3.apply(plain, doubleArrayOf(0.3, 0.3, 0.3)), Mat3.apply(m, doubleArrayOf(0.3, 0.3, 0.3)), 1e-6)
        // A colour keeps its luminance and moves 1.25x as far from grey.
        val c = doubleArrayOf(0.4, 0.2, 0.1)
        val y = doubleArrayOf(0.2627, 0.6780, 0.0593)
        val before = Mat3.apply(plain, c)
        val after = Mat3.apply(m, c)
        val yb = (0..2).sumOf { y[it] * before[it] }
        assertEquals(yb, (0..2).sumOf { y[it] * after[it] }, 1e-6)
        for (i in 0..2) assertEquals(1.25 * (before[i] - yb), after[i] - yb, 1e-6)
    }
}
