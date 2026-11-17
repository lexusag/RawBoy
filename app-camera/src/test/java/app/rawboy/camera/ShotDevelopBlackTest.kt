package app.rawboy.camera

import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.PhoneDescription
import app.rawboy.camera.platform.PlatformRegistry
import app.rawboy.raw.BlackFix
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** How a shot's raw is decoded: LibRaw's own black unless the platform says otherwise. */
class ShotDevelopBlackTest {
    private val onePlus11 = PlatformRegistry.resolve(
        PhoneDescription(ChipVendor.QUALCOMM, "QTI", "SM8550", "qcom", "kalama", "OnePlus", "OnePlus", "CPH2447", "OP594DL1", 36),
    )

    @Test
    fun libRawsBlackWhereNothingIsSet() {
        for (chip in listOf(ChipVendor.TENSOR, ChipVendor.QUALCOMM, ChipVendor.UNKNOWN)) {
            for (maker in listOf("Google", "samsung", "Xiaomi")) {
                val p = PlatformRegistry.resolve(PhoneDescription(chip, manufacturer = maker))
                assertSame("$chip $maker", BlackFix.LIBRAW, ShotDevelop.blackFix(p.still, "0", 6400f))
            }
        }
    }

    @Test
    fun onePlus11UltrawideAtHighIso() {
        val fix = ShotDevelop.blackFix(onePlus11.still, "3", 6400f)
        assertEquals(true, fix.exact)
        assertEquals(32f, fix.pedestal)
        assertArrayEquals(floatArrayOf(0.27f, 0.14f, 0.04f), fix.offset, 1e-6f)
    }

    @Test
    fun onePlus11SelfieGetsTheExactBlackWithoutOffsets() {
        assertEquals(BlackFix(exact = true, pedestal = 32f), ShotDevelop.blackFix(onePlus11.still, "1", 1600f))
        assertEquals(BlackFix(exact = true, pedestal = 32f), ShotDevelop.blackFix(onePlus11.still, null, 1600f))
    }
}
