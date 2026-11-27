package app.rawboy.camera

import app.rawboy.auto.looks.Looks
import app.rawboy.camera.i18n.UKRAINIAN
import app.rawboy.camera.ui.swipeStockDelta
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Viewfinder stock swipe geometry, mode look lists, and Ukrainian i18n coverage for stock labels/notes. */
class StockSelectionTest {
    @Test
    fun swipeStockDeltaRespectsScreenOrientationAcrossAllTurns() {
        val threshold = 48f
        // Portrait (turns = 0): swipe left (-dx) -> next (+1), swipe right (+dx) -> prev (-1).
        assertEquals(1, swipeStockDelta(dx = -80f, dy = 10f, turns = 0, thresholdPx = threshold))
        assertEquals(-1, swipeStockDelta(dx = 80f, dy = -10f, turns = 0, thresholdPx = threshold))
        // 90° CW (turns = 1): screenDx = -dy, screenDy = dx.
        assertEquals(1, swipeStockDelta(dx = 8f, dy = 80f, turns = 1, thresholdPx = threshold))
        assertEquals(-1, swipeStockDelta(dx = -8f, dy = -80f, turns = 1, thresholdPx = threshold))
        // 180° (turns = 2): screenDx = -dx, screenDy = -dy.
        assertEquals(1, swipeStockDelta(dx = 80f, dy = 5f, turns = 2, thresholdPx = threshold))
        assertEquals(-1, swipeStockDelta(dx = -80f, dy = 5f, turns = 2, thresholdPx = threshold))
        // 270° CW / standard landscape (turns = 3): screenDx = dy, screenDy = -dx.
        assertEquals(1, swipeStockDelta(dx = 5f, dy = -80f, turns = 3, thresholdPx = threshold))
        assertEquals(-1, swipeStockDelta(dx = 5f, dy = 80f, turns = 3, thresholdPx = threshold))
    }

    @Test
    fun swipeStockDeltaRejectsShortVerticalAndDiagonalDrags() {
        val threshold = 48f
        assertEquals(0, swipeStockDelta(dx = -30f, dy = 0f, turns = 0, thresholdPx = threshold))
        assertEquals(0, swipeStockDelta(dx = 0f, dy = -120f, turns = 0, thresholdPx = threshold))
        assertEquals(0, swipeStockDelta(dx = -70f, dy = 60f, turns = 0, thresholdPx = threshold))
    }

    @Test
    fun activeLooksMatchesCameraMode() {
        assertEquals(Edition.filmLooks, CameraSettings(film = true, mono = false).activeLooks)
        assertEquals(Edition.looks, CameraSettings(film = false, mono = false).activeLooks)
        assertEquals(Edition.monoLooks, CameraSettings(film = true, mono = true).activeLooks)
        assertEquals(Edition.monoLooks, CameraSettings(film = false, mono = true).activeLooks)
    }

    @Test
    fun allCameraStockNotesAndSectionsHaveUkrainianTranslations() {
        val allModeLists = listOf(Edition.filmLooks, Edition.looks, Edition.monoLooks)
        for (list in allModeLists) {
            for (sec in Looks.pickerSections(list)) {
                assertTrue("Missing UK translation for section '${sec.label}'", sec.label in UKRAINIAN)
                assertTrue("Missing UK translation for short section '${sec.shortLabel}'", sec.shortLabel in UKRAINIAN)
            }
            for (look in list) {
                val cat = Looks.categoryLabel(look)
                assertTrue("Missing UK translation for category '$cat'", cat in UKRAINIAN)
                val note = look.note
                assertTrue("Missing note for look '${look.id}'", !note.isNullOrBlank())
                assertTrue("Missing UK translation for note '$note'", note in UKRAINIAN)
            }
        }
    }
}
