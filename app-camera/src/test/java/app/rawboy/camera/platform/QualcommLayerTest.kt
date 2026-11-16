package app.rawboy.camera.platform

import app.rawboy.camera.platform.generic.neutralPlatform
import app.rawboy.camera.platform.qualcomm.qualcommLayer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Snapdragon phones get the preview curve at even points; the Pixel, Samsung and other chips keep theirs. */
class QualcommLayerTest {
    private fun phone(chip: ChipVendor, maker: String) = PlatformRegistry.resolve(PhoneDescription(chip, manufacturer = maker))

    @Test
    fun snapdragonPhonesGetTheEvenCurve() {
        for (maker in listOf("OnePlus", "Xiaomi", "Google")) { // Google: a Pixel 5 or older
            val p = phone(ChipVendor.QUALCOMM, maker)
            assertEquals(maker, "qualcomm", p.layers[1])
            assertTrue(maker, p.preview.curveAtEvenPoints)
            assertEquals(maker, emptyList<String>(), p.problems())
        }
    }

    @Test
    fun othersKeepThePackedCurve() {
        assertFalse(neutralPlatform.preview.curveAtEvenPoints)
        assertFalse(phone(ChipVendor.TENSOR, "Google").preview.curveAtEvenPoints)
        assertFalse(phone(ChipVendor.MEDIATEK, "Xiaomi").preview.curveAtEvenPoints)
        assertFalse(phone(ChipVendor.QUALCOMM, "samsung").preview.curveAtEvenPoints) // Galaxy S25: pinned (decision 30)
    }

    @Test
    fun changesOnlyItsOwnFields() {
        val p = qualcommLayer.patch.applyTo(neutralPlatform)
        assertEquals(neutralPlatform.copy(preview = neutralPlatform.preview.copy(curveAtEvenPoints = true)), p)
    }
}
