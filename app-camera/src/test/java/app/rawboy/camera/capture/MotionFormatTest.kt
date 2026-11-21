package app.rawboy.camera.capture

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream

class MotionFormatTest {
    private fun frame(t: Long, ois: Int) = MotionFrame(
        t = t, exposureNs = 8_000_000, frameDurationNs = 33_333_333, skewNs = 12_500_000,
        focusDiopters = 0.5f, focalLengthMm = 6.9f, oisMode = 0, physicalId = "2",
        crop = intArrayOf(0, 0, 4080, 3072), intrinsics = floatArrayOf(2844.5f, 2844.5f, 2044.9f, 1536.1f, 0f),
        oisT = LongArray(ois) { t + it * 1_000_000L }, oisX = FloatArray(ois) { it * 0.5f }, oisY = FloatArray(ois) { -it * 0.25f },
    )

    private fun write(block: MotionWriter.() -> Unit): ByteArray {
        val out = ByteArrayOutputStream()
        MotionWriter(out, """{"format":"rawboy-motion","lens":{"label":"W"}}""").apply(block).close()
        return out.toByteArray()
    }

    @Test
    fun roundTrip() {
        val bytes = write {
            for (i in 0 until 400) gyro(1_000_000_000L + i * 2_500_000L, i * 0.01f, -0.02f, 0.03f, Float.NaN, Float.NaN, Float.NaN)
            accel(1_000_000_000L, 0.1f, 9.8f, 0.2f)
            frame(frame(1_010_000_000L, 0))
            frame(frame(1_043_333_333L, 7))
            encoded(1_010_000_000L, 0L)
            encoded(1_043_333_333L, 33_333_333L)
            end(2_000_000_000L, 1_005_000_000L, 0L)
        }
        val d = MotionData.read(bytes)
        assertEquals(MotionFormat.VERSION, d.version)
        assertTrue(d.headerJson.contains("rawboy-motion"))
        assertEquals(400, d.gyroT.size)
        assertEquals(400 * 6, d.gyro.size)
        assertEquals(1_000_000_000L + 399 * 2_500_000L, d.gyroT.last())
        assertEquals(399 * 0.01f, d.gyro[399 * 6], 1e-6f)
        assertTrue(d.gyro[3].isNaN())
        assertEquals(1, d.accelT.size)
        assertEquals(9.8f, d.accel[1], 0f)
        assertEquals(2, d.frames.size)
        val f = d.frames[1]
        assertEquals(1_043_333_333L, f.t)
        assertEquals(12_500_000L, f.skewNs)
        assertEquals("2", f.physicalId)
        assertArrayEquals(intArrayOf(0, 0, 4080, 3072), f.crop)
        assertEquals(5, f.intrinsics.size)
        assertEquals(7, f.oisT.size)
        assertEquals(-1.5f, f.oisY[6], 0f)
        assertArrayEquals(longArrayOf(1_010_000_000L, 0L, 1_043_333_333L, 33_333_333L), d.encoded)
        assertArrayEquals(longArrayOf(2_000_000_000L, 1_005_000_000L, 0L), d.ended)
    }

    @Test
    fun fileCutShortReadsWholeRecords() {
        val bytes = write {
            gyro(1L, 0f, 0f, 0f, 0f, 0f, 0f)
            frame(frame(2L, 3))
            gyro(3L, 0f, 0f, 0f, 0f, 0f, 0f)
        }
        // The app was killed in the middle of the last record: no END, the rest is kept.
        val d = MotionData.read(bytes.copyOf(bytes.size - 5))
        assertEquals(1, d.gyroT.size)
        assertEquals(1, d.frames.size)
        assertNull(d.ended)
    }

    @Test
    fun missingValues() {
        val bytes = write {
            frame(
                MotionFrame(5L, -1, -1, -1, Float.NaN, Float.NaN, -1, "", intArrayOf(-1, -1, -1, -1), FloatArray(0), LongArray(0), FloatArray(0), FloatArray(0)),
            )
        }
        val f = MotionData.read(bytes).frames.single()
        assertEquals(-1L, f.skewNs)
        assertEquals(-1, f.oisMode)
        assertEquals("", f.physicalId)
        assertTrue(f.focusDiopters.isNaN())
        assertEquals(0, f.intrinsics.size)
    }

    @Test(expected = IllegalArgumentException::class)
    fun notAMotionFile() {
        MotionData.read("RIFF....WAVEfmt ".toByteArray())
    }

    @Test
    fun writerStopsAfterAFailure() {
        var writes = 0
        val out = object : java.io.OutputStream() {
            override fun write(b: Int) = throw UnsupportedOperationException()
            override fun write(b: ByteArray, off: Int, len: Int) {
                if (++writes > 2) throw java.io.IOException("disk full")
            }
        }
        val w = MotionWriter(out, "{}")
        w.gyro(1L, 0f, 0f, 0f, 0f, 0f, 0f)
        w.gyro(2L, 0f, 0f, 0f, 0f, 0f, 0f)
        assertNotNull(w.failed)
        w.gyro(3L, 0f, 0f, 0f, 0f, 0f, 0f) // ignored, no throw
    }
}
