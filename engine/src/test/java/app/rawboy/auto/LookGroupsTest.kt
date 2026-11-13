package app.rawboy.auto

import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.LookGroup
import app.rawboy.auto.looks.Looks
import org.junit.Assert.assertEquals
import org.junit.Test

/** The pickers' sections: Color, Experimental, Black & white, in that order. */
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
        // A list of one group is one section, so pickers show no headings.
        assertEquals(1, Looks.sections(FilmLooks.ALL).size)
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
