package app.rawboy.auto

import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.FilmStockGroup
import app.rawboy.auto.looks.LookGroup
import app.rawboy.auto.looks.Looks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pickers' sections: Color, Experimental, Black & white, plus Film mode's stock families and stepping. */
class LookGroupsTest {
    @Test
    fun looksAreListedInTheirGroups() {
        val sections = Looks.sections(Looks.ALL)
        assertEquals(listOf(LookGroup.COLOR, LookGroup.EXPERIMENTAL, LookGroup.MONOCHROME), sections.map { it.first })
        assertEquals(
            listOf(Looks.MOVIE_GREEN, Looks.MOVIE_GREEN_V2, Looks.REDSCALE, Looks.REDSCALE_V2, Looks.LAGOON, Looks.VIOLET_DUST, Looks.UNSEEN),
            sections[1].second,
        )
        assertEquals(Looks.ALL.size, sections.sumOf { it.second.size })
        // LookGroup still treats FilmLooks.ALL as one colour group so LUT pickers don't split them as monochrome/experimental.
        assertEquals(1, Looks.sections(FilmLooks.ALL).size)
    }

    @Test
    fun filmStocksAreGroupedByFamilyWithNotes() {
        val sections = FilmLooks.sections(FilmLooks.ALL)
        assertEquals(
            listOf(FilmStockGroup.NATURAL, FilmStockGroup.COLOR_NEGATIVE, FilmStockGroup.CINEMA, FilmStockGroup.SLIDE),
            sections.map { it.first },
        )
        assertEquals(listOf(1, 6, 2, 4), sections.map { it.second.size })
        assertEquals(FilmLooks.ALL.size, sections.sumOf { it.second.size })
        val picker = Looks.pickerSections(FilmLooks.ALL)
        assertEquals(listOf("Natural", "Colour negative", "Cinema print", "Slide"), picker.map { it.label })
        assertEquals("Cinema print", Looks.categoryLabel(FilmLooks.byId("vision500t")))
        assertEquals("Slide", Looks.categoryLabel(FilmLooks.byId("velvia100")))
        assertEquals("Natural", Looks.categoryLabel(Looks.NATURAL))
        for (look in FilmLooks.ALL + Looks.ALL) {
            assertFalse("Missing note on ${look.id}", look.note.isNullOrBlank())
        }
    }

    @Test
    fun stepAndNeighborsWrapCleanly() {
        val list = FilmLooks.ALL
        assertEquals(list[1], Looks.step(list, list.first().id, +1))
        assertEquals(list.last(), Looks.step(list, list.first().id, -1, wrap = true))
        assertNull(Looks.step(list, list.first().id, -1, wrap = false))
        assertEquals(list.first(), Looks.step(list, list.last().id, +1, wrap = true))
        assertNull(Looks.step(list, list.last().id, +1, wrap = false))
        assertNull(Looks.step(listOf(Looks.NATURAL), Looks.NATURAL.id, +1))
        assertNull(Looks.step(list, list.first().id, 0))

        val neighbors = Looks.neighbors(list, list.first().id)
        assertEquals(listOf(list[1], list.last()), neighbors)
        assertTrue(Looks.neighbors(listOf(Looks.NATURAL), Looks.NATURAL.id).isEmpty())
    }

    @Test
    fun bundledLutsFollowTheirLooks() {
        assertEquals(LookGroup.EXPERIMENTAL, Looks.lutGroup("asset:luts/Redscale.png"))
        assertEquals(LookGroup.EXPERIMENTAL, Looks.lutGroup("asset:luts/Redscale V2.cube"))
        assertEquals(LookGroup.EXPERIMENTAL, Looks.lutGroup("asset:luts/Movie Green.cube"))
        assertEquals(LookGroup.EXPERIMENTAL, Looks.lutGroup("asset:luts/Movie Green V2.cube"))
        assertEquals(LookGroup.EXPERIMENTAL, Looks.lutGroup("asset:luts/Unseen.cube"))
        assertEquals(LookGroup.MONOCHROME, Looks.lutGroup("asset:luts/Yellow Mono 400.cube"))
        assertEquals(LookGroup.COLOR, Looks.lutGroup("asset:luts/Yellow Vivid 100.cube"))
        assertEquals(LookGroup.COLOR, Looks.lutGroup("asset:luts/Film Flash.cube"))
        assertEquals(LookGroup.COLOR, Looks.lutGroup(null))
    }
}
