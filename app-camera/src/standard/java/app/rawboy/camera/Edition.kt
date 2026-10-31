package app.rawboy.camera

import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.Look
import app.rawboy.auto.looks.Looks

/** RawBoy Camera (flavour "standard"): the looks on the bundled film LUTs, as RawBoy Auto has them. */
internal object Edition {
    /** Colour looks; the black and white ones are B&W mode's ([monoLooks]). */
    val looks: List<Look> = Looks.ALL.filter { !it.monochrome }
    val defaultLookId: String = Looks.PORTRA_400.id

    fun look(id: String): Look = Looks.byId(id)

    /** B&W mode's stocks: RawBoy Auto's black and white looks, as in RawBoy Film. */
    val monoLooks: List<Look> = Looks.ALL.filter { it.monochrome }
    val defaultMonoLookId: String = Looks.TRIX_400.id

    fun monoLook(id: String): Look = monoLooks.firstOrNull { it.id == id } ?: Looks.TRIX_400

    /**
     * Film mode's stocks (the Film toggle): the film stocks of RawBoy Auto's Film mode, as RawBoy Film has them.
     * Their ids overlap the LUT looks' ids (portra400 is both), so Film mode keeps its own pick (filmLookId).
     */
    val filmLooks: List<Look> = FilmLooks.ALL
    val defaultFilmLookId: String = FilmLooks.PORTRA_400.id

    fun filmLook(id: String): Look = FilmLooks.byId(id)

    /** Pictures/<FOLDER> (JPEGs) and Pictures/<FOLDER>/RAW (DNGs); JPEGs are named IMG_…-<JPEG_SUFFIX>.jpg. */
    const val FOLDER = "RawBoy Camera"
    const val JPEG_SUFFIX = "camera"

    /**
     * Shown above "Open-source licences" in Settings. spektrafilm asks for credit for its LUTs wherever it's natural,
     * as a factual reference (not product branding): Film mode uses them.
     */
    val credits: List<String> = listOf(
        "Film mode uses film and print LUTs derived from spektrafilm by Andrea Volpato " +
            "(github.com/andreavolpato/spektrafilm), CC BY-SA 4.0.",
    )
}
