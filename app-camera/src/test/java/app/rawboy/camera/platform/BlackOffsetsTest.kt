package app.rawboy.camera.platform

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Per-camera black offsets: interpolated in stops of ISO, held beyond the table, zero for other cameras. */
class BlackOffsetsTest {
    private val table = BlackOffsets(
        mapOf(
            "3" to listOf(
                BlackOffsets.Point(6400f, listOf(0.8f, 0.6f, 0.4f)), // out of order on purpose
                BlackOffsets.Point(400f, listOf(0f, 0f, 0f)),
                BlackOffsets.Point(1600f, listOf(0.2f, 0.2f, 0.1f)),
            ),
        ),
    )

    @Test
    fun interpolatesInStops() {
        assertArrayEquals(floatArrayOf(0.2f, 0.2f, 0.1f), table.at("3", 1600f), 1e-6f)
        // 3200 is halfway from 1600 to 6400 in stops.
        assertArrayEquals(floatArrayOf(0.5f, 0.4f, 0.25f), table.at("3", 3200f), 1e-5f)
        assertArrayEquals(floatArrayOf(0.1f, 0.1f, 0.05f), table.at("3", 800f), 1e-5f)
    }

    @Test
    fun holdsTheEnds() {
        assertArrayEquals(floatArrayOf(0f, 0f, 0f), table.at("3", 100f), 0f)
        assertArrayEquals(floatArrayOf(0.8f, 0.6f, 0.4f), table.at("3", 12800f), 0f)
    }

    @Test
    fun otherCamerasAndUnknownIsoGetNone() {
        assertArrayEquals(FloatArray(3), table.at("2", 6400f), 0f)
        assertArrayEquals(FloatArray(3), table.at(null, 6400f), 0f)
        assertArrayEquals(FloatArray(3), table.at("3", 0f), 0f)
        assertArrayEquals(FloatArray(3), BlackOffsets.NONE.at("3", 6400f), 0f)
    }

    @Test
    fun reportsBadTables() {
        assertEquals(emptyList<String>(), table.problems())
        val bad = BlackOffsets(mapOf("1" to listOf(BlackOffsets.Point(0f, listOf(9f, 0f)))))
        val problems = bad.problems()
        assertEquals(3, problems.size)
        assertTrue(problems.toString(), problems.all { it.startsWith("camera 1") })
    }
}
