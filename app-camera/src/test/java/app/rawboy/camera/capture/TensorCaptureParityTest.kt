package app.rawboy.camera.capture

import app.rawboy.auto.analysis.AutoTone
import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.PhoneDescription
import app.rawboy.camera.platform.PlatformRegistry
import app.rawboy.camera.platform.PreviewColorInput
import app.rawboy.color.Mat3
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.pow

/**
 * The capture code reading the Tensor profile gives exactly what `CameraController` computed with its own constants
 * before they moved into the profile. The former code is kept here verbatim (on plain numbers instead of Camera2
 * objects) as the reference; results must be bit-identical.
 */
class TensorCaptureParityTest {
    private val tensor = PlatformRegistry.resolve(PhoneDescription(ChipVendor.TENSOR, manufacturer = "Google"))

    // --- Preview colour: the former CameraController.previewToRec2020 -------------------------------------------

    private val formerSrgbToRec2020 = doubleArrayOf(
        0.6274040, 0.3292820, 0.0433136,
        0.0690970, 0.9195400, 0.0113612,
        0.0163916, 0.0880132, 0.8955950,
    )

    /** The former body; [neutral] as the result's array (any length), [gains] as R, G even, G odd, B. */
    private fun formerPreviewToRec2020(rgbCam: DoubleArray?, ccm: DoubleArray?, gains: DoubleArray?, neutral: DoubleArray?): DoubleArray? {
        rgbCam ?: return null
        ccm ?: return null
        val g = gains ?: return null
        if (neutral == null || neutral.size < 3) return null
        val n = DoubleArray(3) { neutral[it] }
        val gs = doubleArrayOf(g[0], (g[1] + g[2]) / 2.0, g[3])
        if (n.any { it <= 0.0 } || gs.any { it <= 0.0 }) return null
        val ispInverse = runCatching { Mat3.inverse(ccm) }.getOrNull() ?: return null
        val toCamera = Mat3.multiply(Mat3.diagonal(1 / gs[0], 1 / gs[1], 1 / gs[2]), ispInverse)
        val balance = Mat3.diagonal(1 / n[0], 1 / n[1], 1 / n[2])
        val m = Mat3.multiply(formerSrgbToRec2020, Mat3.multiply(rgbCam, Mat3.multiply(balance, toCamera)))
        val white = Mat3.apply(m, doubleArrayOf(1.0, 1.0, 1.0))
        val y = 0.2627 * white[0] + 0.6780 * white[1] + 0.0593 * white[2]
        if (!(y > 0)) return null
        return DoubleArray(9) { m[it] / y }
    }

    /** What `CameraController.previewColorInput` builds from the same result. */
    private fun input(rgbCam: DoubleArray?, ccm: DoubleArray?, gains: DoubleArray?, neutral: DoubleArray?) = PreviewColorInput(
        cameraToSrgb = rgbCam,
        ispMatrix = ccm,
        ispGains = gains?.let { doubleArrayOf(it[0], (it[1] + it[2]) / 2.0, it[3]) },
        neutral = neutral?.takeIf { it.size >= 3 }?.let { n -> DoubleArray(3) { n[it] } },
    )

    private val rgbCam = doubleArrayOf(1.62, -0.48, -0.14, -0.21, 1.42, -0.21, 0.02, -0.55, 1.53)
    private val identity = Mat3.diagonal(1.0, 1.0, 1.0)

    private val cases = listOf(
        // A saturated ISP matrix with rows summing to 1, as the Pixel's.
        listOf(rgbCam, doubleArrayOf(1.80, -0.66, -0.14, -0.30, 1.55, -0.25, 0.05, -0.70, 1.65), doubleArrayOf(2.1, 1.0, 1.0, 1.6), doubleArrayOf(0.48, 1.0, 0.62)),
        // Tungsten: strong blue gain.
        listOf(rgbCam, doubleArrayOf(1.55, -0.40, -0.15, -0.22, 1.38, -0.16, 0.02, -0.48, 1.46), doubleArrayOf(1.30, 1.0, 1.02, 3.10), doubleArrayOf(0.77, 1.0, 0.32)),
        // As the OnePlus 11 reports it: an identity matrix, gains about 2 / 1 / 1 / 2.4, greens differing slightly.
        listOf(rgbCam, identity, doubleArrayOf(1.95, 1.0, 1.003, 2.40), doubleArrayOf(0.51, 1.0, 0.42)),
        // A neutral reported with a fourth element is still read as its first three.
        listOf(rgbCam, identity, doubleArrayOf(1.95, 1.0, 1.0, 2.40), doubleArrayOf(0.51, 1.0, 0.42, 0.7)),
    )

    @Test
    fun previewColourAsBefore() {
        for ((cam, ccm, gains, neutral) in cases) {
            val before = formerPreviewToRec2020(cam, ccm, gains, neutral)!!
            val now = tensor.preview.color.toRec2020(input(cam, ccm, gains, neutral))!!
            assertArrayEquals(before, now, 0.0)
        }
    }

    @Test
    fun previewColourFallsBackAsBefore() {
        val (cam, ccm, gains, neutral) = cases[0]
        val missing = listOf(
            listOf(null, ccm, gains, neutral),
            listOf(cam, null, gains, neutral),
            listOf(cam, ccm, null, neutral),
            listOf(cam, ccm, gains, null),
            listOf(cam, ccm, gains, doubleArrayOf(0.48, 1.0)),
            listOf(cam, ccm, doubleArrayOf(2.1, 0.0, 0.0, 1.6), neutral),
            listOf(cam, ccm, gains, doubleArrayOf(0.48, 0.0, 0.62)),
            listOf(cam, DoubleArray(9), gains, neutral),
        )
        for ((c, m, g, n) in missing) {
            assertNull(formerPreviewToRec2020(c, m, g, n))
            assertNull(tensor.preview.color.toRec2020(input(c, m, g, n)))
        }
    }

    // --- Still gain: the former CameraController.stillGain with MAX_STILL_EXPOSURE_NS ---------------------------

    private fun formerStillGain(exposureNs: Long, boost: Float, fpsUpper: Int): Float {
        if (exposureNs <= 0L) return 1f
        val capNs = 1_000_000_000L / fpsUpper
        if (exposureNs < capNs * 9 / 10) return 1f
        return minOf(66_666_667L.toFloat() / exposureNs, boost).coerceAtLeast(1f)
    }

    private val stillCases = listOf(
        Triple(0L, 2.0f, 30), Triple(10_000_000L, 2.39f, 30), Triple(29_843_000L, 1.01f, 30),
        Triple(33_333_333L, 2.39f, 30), Triple(33_333_333L, 1.2f, 30), Triple(30_000_000L, 0.9f, 30),
        Triple(29_993_000L, 3.5f, 30), Triple(41_666_666L, 4f, 24), Triple(36_000_000L, 1.6f, 24),
    )

    @Test
    fun stillGainAsBefore() {
        for ((t, boost, fps) in stillCases) {
            assertEquals("$t ns, boost $boost, $fps fps", formerStillGain(t, boost, fps),
                StillGain.over(t, boost, 1_000_000_000L / fps, tensor.still.maxStillExposureNs), 0f)
        }
        // Preview 1/30 s, boost 2.39: the still takes 1/15 s, twice the preview.
        assertEquals(66_666_667f / 33_333_333f, StillGain.over(33_333_333L, 2.39f, 33_333_333L, tensor.still.maxStillExposureNs), 0f)
    }

    @Test
    fun stillGainFollowsTheProfile() {
        // A platform whose still stays at 1/30 s predicts no gain: the controller reads the profile, not a constant.
        assertEquals(1f, StillGain.over(33_333_333L, 2.39f, 33_333_333L, 33_333_333L), 0f)
        assertNotEquals(1f, StillGain.over(33_333_333L, 2.39f, 33_333_333L, tensor.still.maxStillExposureNs))
    }

    // --- Flash start: the former default guide x aperture scale ----------------------------------------------------

    private fun formerFlashStart(fNumber: Float, known: Boolean): Float {
        val apertureScale = (fNumber / 1.7f).let { it * it }.coerceIn(0.5f, 8f)
        return (if (known) 16f else 4f) * apertureScale
    }

    @Test
    fun flashStartAsBefore() {
        for (f in listOf(1.68f, 1.7f, 2.2f, 2.8f, 3.5f, 4.5f, 1.0f, 8.0f)) for (known in listOf(true, false)) {
            assertEquals("f/$f known $known", formerFlashStart(f, known), FlashStart.gain(tensor.flash, f, known), 0f)
        }
        // A tele at f/2.8 starts (2.8 / 1.7)² = 2.7x above the main lens's guide.
        assertEquals(16f * (2.8f / 1.7f).pow(2), FlashStart.gain(tensor.flash, 2.8f, true), 1e-4f)
        // The scale is clamped: very slow and very fast lenses don't run away.
        assertEquals(16f * 8f, FlashStart.gain(tensor.flash, 8f, true), 0f)
        assertEquals(4f * 0.5f, FlashStart.gain(tensor.flash, 1.0f, false), 0f)
    }

    @Test
    fun flashStartFollowsTheProfile() {
        val other = tensor.flash.copy(defaultGuide = 10f, referenceFNumber = 2f, defaultGainNoDistance = 3f)
        assertEquals(10f, FlashStart.gain(other, 2f, true), 0f)
        assertEquals(3f * (2.8f / 2f).let { it * it }, FlashStart.gain(other, 2.8f, false), 0f)
    }

    // --- Long exposure key: the former CameraController.LONG_EXPOSURE_KEY ------------------------------------------

    @Test
    fun longExposureKeyAsBefore() {
        assertEquals(0.06f, AutoTone.PHONE_KEY)
    }
}
