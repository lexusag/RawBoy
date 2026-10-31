package app.rawboy.camera

import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.Look
import app.rawboy.auto.looks.Looks

/**
 * RawBoy Film (flavour "film"): the looks are the film stocks of RawBoy Auto's Film mode (FilmLooks, rendered by
 * shaders/film_form.glsl on the luts/spektrafilm LUTs). Installs next to RawBoy Camera (applicationId
 * app.rawboy.camera.film) and saves to its own folder.
 */
internal object Edition {
    val looks: List<Look> = FilmLooks.ALL
    val defaultLookId: String = FilmLooks.PORTRA_400.id

    fun look(id: String): Look = FilmLooks.byId(id)

    /**
     * B&W mode's stocks: the black and white looks RawBoy Auto has (AgX + mono LUT). Empty = no B&W mode (the
     * standard camera lists its mono looks among the others).
     */
    val monoLooks: List<Look> = listOf(
        Looks.TRIX_SOFT, Looks.TRIX_400, Looks.TRIX_PUSH, Looks.TRIX_HARD, Looks.DOUBLE_X, Looks.DOUBLE_X_SOFT,
    )
    val defaultMonoLookId: String = Looks.TRIX_400.id

    fun monoLook(id: String): Look = monoLooks.firstOrNull { it.id == id } ?: Looks.TRIX_400

    /** No Film toggle: this edition's looks already are the film stocks. */
    val filmLooks: List<Look> = emptyList()
    val defaultFilmLookId: String = FilmLooks.PORTRA_400.id

    fun filmLook(id: String): Look = FilmLooks.byId(id)

    /** Pictures/<FOLDER> (JPEGs) and Pictures/<FOLDER>/RAW (DNGs); JPEGs are named IMG_…-<JPEG_SUFFIX>.jpg. */
    const val FOLDER = "RawBoy Film"
    const val JPEG_SUFFIX = "film"

    /**
     * Shown above "Open-source licences" in Settings. spektrafilm asks for credit for its LUTs wherever it's natural,
     * as a factual reference (not product branding).
     */
    val credits: List<String> = listOf(
        "Film looks use film and print LUTs derived from spektrafilm by Andrea Volpato " +
            "(github.com/andreavolpato/spektrafilm), CC BY-SA 4.0.",
    )
}
