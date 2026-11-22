package app.rawboy.camera.stab

import app.rawboy.camera.capture.MotionData
import app.rawboy.camera.capture.MotionFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs

class StabPlanTest {
    private val frameNs = 33_333_333L

    /** [frames] frames at 30 fps, every [dropEvery]th one missing from the file; gyro at 400 Hz from [rate] (rad/s per axis, by time). */
    private fun data(frames: Int, dropEvery: Int = 0, rate: (Double) -> DoubleArray = { doubleArrayOf(0.0, 0.0, 0.0) }): MotionData {
        val t0 = 1_000_000_000L
        val gyroT = LongArray(((frames + 4) * frameNs / 2_500_000L).toInt()) { t0 - 2 * frameNs + it * 2_500_000L }
        val gyro = FloatArray(gyroT.size * 6)
        for (i in gyroT.indices) {
            val r = rate((gyroT[i] - t0) * 1e-9)
            gyro[i * 6] = r[0].toFloat(); gyro[i * 6 + 1] = r[1].toFloat(); gyro[i * 6 + 2] = r[2].toFloat()
        }
        val list = (0 until frames).map { i ->
            MotionFrame(t0 + i * frameNs, 10_000_000L, frameNs, 20_000_000L, 0f, 6.9f, 0, "", intArrayOf(-1, -1, -1, -1),
                floatArrayOf(2844f, 2844f, 2040f, 1536f, 0f), LongArray(0), FloatArray(0), FloatArray(0))
        }
        val encoded = list.filterIndexed { i, _ -> dropEvery == 0 || i % dropEvery != dropEvery - 1 }
            .flatMap { listOf(it.t, it.t - t0) }.toLongArray()
        return MotionData(1, "{}", gyroT, gyro, LongArray(0), FloatArray(0), list, encoded, null)
    }

    private fun input(width: Int, height: Int, turns: Int, front: Boolean = false) =
        StabInput(width, height, turns, 90, front, 4080, "W")

    @Test
    fun stillCameraShowsTheCentralCrop() {
        for ((w, h, turns) in listOf(Triple(1920, 1440, 3), Triple(1440, 1920, 0), Triple(1920, 1440, 1), Triple(1440, 1920, 2))) {
            val plan = StabPlan.make(input(w, h, turns), data(60), 0.7)
            assertNotNull(plan)
            plan!!
            assertEquals(0.0, plan.eased, 0.0)
            val g = plan.warp(30, 3, 3)
            // Corners and centre: the 70% crop around the middle, whatever the turn.
            val lo = 0.15
            val hi = 0.85
            val expected = listOf(lo to lo, 0.5 to lo, hi to lo, lo to 0.5, 0.5 to 0.5, hi to 0.5, lo to hi, 0.5 to hi, hi to hi)
            for ((k, e) in expected.withIndex()) {
                assertEquals("turns $turns x$k", e.first, g[2 * k].toDouble(), 1e-3)
                assertEquals("turns $turns y$k", e.second, g[2 * k + 1].toDouble(), 1e-3)
            }
        }
    }

    @Test
    fun droppedFramesAreHeld() {
        val plan = StabPlan.make(input(1920, 1440, 3), data(40, dropEvery = 10), 0.7)!!
        assertEquals(40 - 1, plan.outputs.size) // the last camera frame was the dropped one, after the last encoded
        val held = plan.outputs.withIndex().filter { it.value.hold }.map { it.index }
        assertEquals(listOf(9, 19, 29), held)
        // Output times follow the camera, not the file: no gap where a frame was lost.
        for (i in 1 until plan.outputs.size) assertEquals(frameNs, plan.outputs[i].ptsNs - plan.outputs[i - 1].ptsNs)
    }

    @Test
    fun shakeIsTakenOut() {
        // A 4 Hz shake about the gyro's x axis (the camera's y: sideways in the picture), 0.5 deg amplitude.
        val amp = 0.5 * PI / 180 * 2 * PI * 4
        val plan = StabPlan.make(input(1920, 1440, 3), data(120) { t -> doubleArrayOf(amp * kotlin.math.cos(2 * PI * 4 * t), 0.0, 0.0) }, 0.7)!!
        val centres = (20 until 100).map { plan.warp(it, 3, 3)[8].toDouble() } // centre x of each frame
        val spread = centres.max() - centres.min()
        // 0.5 deg at f 1340 px is ~12 px, ~0.6% of the width: the warp follows it.
        assertTrue("spread $spread", spread > 0.008)
        assertTrue(abs(centres.average() - 0.5) < 0.01)
    }

    @Test
    fun selfiesAreLeftAlone() {
        assertNull(StabPlan.make(input(1440, 1920, 0, front = true), data(30), 0.7))
    }

    @Test
    fun smoothingKeepsAHalfTurnContinuous() {
        // A camera turning steadily through more than 180 degrees: the smoothed path must not flip.
        val q = Array(200) { Quat.fromRotvec(0.0, 0.0, it * 0.03) }
        val s = StabPlan.smooth(q, 15.0)
        for (i in 40 until 160) {
            val angle = 2 * kotlin.math.acos(abs(s[i].dot(q[i])).coerceAtMost(1.0))
            assertTrue("frame $i off by $angle", angle < 0.01)
        }
    }

    @Test
    fun longLensesSmoothLonger() {
        // Pixel 9 Pro focal lengths in 1920 px stream pixels: UW, W, T, T2.
        assertEquals(StabPlan.SIGMA_S, StabPlan.sigmaSeconds(692.0, 1920), 1e-9)
        assertEquals(StabPlan.SIGMA_S, StabPlan.sigmaSeconds(1390.0, 1920), 0.01)
        assertEquals(0.69, StabPlan.sigmaSeconds(2760.0, 1920), 0.01)
        assertEquals(StabPlan.MAX_SIGMA_S, StabPlan.sigmaSeconds(6100.0, 1920), 1e-9)
    }
}
