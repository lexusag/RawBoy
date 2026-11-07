package app.rawboy.gl

import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Test

class FlareSourceTest {
    @Test
    fun rowsOfBandZeroSurviveTheStackedHeight() {
        for (rows in listOf(1, 2, 3, 4, 100, 767, 768, 1024, 1536)) {
            val stacked = rows + 2 * FlareSource.coarseRows(rows)
            val source = PreviewImage(10, stacked, ByteBuffer.allocate(0), 100, 100)
            assertEquals(rows, FlareSource.rows(source))
        }
    }
}
