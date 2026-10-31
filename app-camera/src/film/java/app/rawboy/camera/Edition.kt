package app.rawboy.camera

import app.rawboy.auto.looks.FilmLooks
import app.rawboy.auto.looks.Look

/**
 * RawBoy Film (flavour "film"): the looks are the film stocks of RawBoy Auto's Film mode (FilmLooks, rendered by
 * shaders/film_form.glsl on the luts/spektrafilm LUTs). Installs next to RawBoy Camera (applicationId
 * app.rawboy.camera.film) and saves to its own folder.
 */
internal object Edition {
    val looks: List<Look> = FilmLooks.ALL
    val defaultLookId: String = FilmLooks.PORTRA_400.id

    fun look(id: String): Look = FilmLooks.byId(id)

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
