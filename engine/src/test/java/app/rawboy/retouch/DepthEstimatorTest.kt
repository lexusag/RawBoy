package app.rawboy.retouch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Unit tests for [DepthEstimator]: person detection, pet/salient subject detection, flat scenes, and DEPTH16. */
class DepthEstimatorTest {

    @Test
    fun detectsPersonFromSegmentationAndPlacesSubjectInForeground() {
        val w = 32
        val h = 32
        val rgb = FloatArray(w * h * 3) { 0.35f }
        val gray = FloatArray(w * h) { 0.35f }
        val personProb = FloatArray(w * h)
        for (y in 8 until 26) {
            for (x in 10 until 22) {
                val i = y * w + x
                personProb[i] = 0.92f
                gray[i] = 0.65f
                rgb[i * 3] = 0.7f
                rgb[i * 3 + 1] = 0.55f
                rgb[i * 3 + 2] = 0.45f
            }
        }

        val depth = DepthEstimator.estimateFromFeatures(
            w = w,
            h = h,
            rgb = rgb,
            gray = gray,
            personProb = personProb,
            skinAreaFraction = 0.04f,
            hasFace = true,
            focusX = 0.5f,
            focusY = 0.5f,
        )

        assertTrue(depth.subjectDetected)
        assertFalse(depth.hardware)
        val centerDepth = depth.sampleUv(0.5f, 0.5f)
        val cornerDepth = depth.sampleUv(0.05f, 0.05f)
        assertTrue("Subject ($centerDepth) should be closer than background ($cornerDepth)", centerDepth < cornerDepth - 0.3f)
        assertTrue("Focus depth (${depth.focusDepth}) should match subject depth", depth.focusDepth in 0.08f..0.35f)
    }

    @Test
    fun detectsPetSubjectViaSharpForegroundAndFurMaskWithoutFace() {
        val w = 48
        val h = 48
        val rgb = FloatArray(w * h * 3)
        val gray = FloatArray(w * h)
        val furProb = FloatArray(w * h)
        // Smooth green/grey background; textured warm-brown pet in the center.
        for (y in 0 until h) {
            for (x in 0 until w) {
                val i = y * w + x
                val inPet = x in 14..33 && y in 14..35
                if (inPet) {
                    val tex = if ((x + y) % 2 == 0) 0.12f else -0.12f
                    val v = (0.58f + tex).coerceIn(0f, 1f)
                    gray[i] = v
                    rgb[i * 3] = (0.72f + tex).coerceIn(0f, 1f)
                    rgb[i * 3 + 1] = (0.48f + tex).coerceIn(0f, 1f)
                    rgb[i * 3 + 2] = (0.28f + tex).coerceIn(0f, 1f)
                    furProb[i] = 0.75f
                } else {
                    gray[i] = 0.28f
                    rgb[i * 3] = 0.20f
                    rgb[i * 3 + 1] = 0.34f
                    rgb[i * 3 + 2] = 0.22f
                }
            }
        }

        val depth = DepthEstimator.estimateFromFeatures(
            w = w,
            h = h,
            rgb = rgb,
            gray = gray,
            personProb = FloatArray(w * h),
            hairOrFurProb = furProb,
            skinAreaFraction = 0f,
            hasFace = false,
            focusX = 0.5f,
            focusY = 0.5f,
        )

        assertTrue("Pet subject should be detected", depth.subjectDetected)
        assertTrue(depth.sampleUv(0.5f, 0.5f) < depth.sampleUv(0.05f, 0.05f) - 0.25f)
    }

    @Test
    fun rejectsFlatSceneWithoutPersonOrPet() {
        val w = 32
        val h = 32
        val rgb = FloatArray(w * h * 3) { 0.45f }
        val gray = FloatArray(w * h) { 0.45f }

        val depth = DepthEstimator.estimateFromFeatures(
            w = w,
            h = h,
            rgb = rgb,
            gray = gray,
            personProb = FloatArray(w * h),
            skinAreaFraction = 0f,
            hasFace = false,
        )

        assertFalse("Flat scene should not report a person or pet subject", depth.subjectDetected)
    }

    @Test
    fun convertsHardwareDepth16AndAppliesExifOrientation() {
        val w = 8
        val h = 6
        val buf = ByteBuffer.allocate(w * h * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (y in 0 until h) {
            for (x in 0 until w) {
                // Left side near (600 mm), right side far (3000 mm), confidence = 7 (top 3 bits).
                val mm = if (x < w / 2) 600 else 3000
                val sample = (7 shl 13) or mm
                buf.putShort((y * w + x) * 2, sample.toShort())
            }
        }

        val depth = DepthEstimator.fromHardwareDepth16(
            buffer = buf,
            width = w,
            height = h,
            rowStrideBytes = w * 2,
            exifOrientation = 1,
            focusX = 0.25f,
            focusY = 0.5f,
            subjectDetected = true,
        )
        assertNotNull(depth)
        depth!!
        assertTrue(depth.hardware)
        assertTrue(depth.subjectDetected)
        assertEquals(w, depth.width)
        assertEquals(h, depth.height)
        assertTrue(depth.sampleAt(1, 3) < 0.2f)
        assertTrue(depth.sampleAt(w - 2, 3) > 0.8f)
        assertTrue(depth.focusDepth < 0.25f)
    }
}
