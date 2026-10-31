import RawBoyEngine

/**
 * RawBoy Film (target RawBoyFilm): the looks are the film stocks of RawBoy Auto's Film mode (FilmLooks, rendered by
 * shaders/film_form.glsl on the luts/spektrafilm LUTs). Installs next to RawBoy Camera (app.rawboy.camera.film) and
 * saves to its own albums. Mirrors Android's film Edition.kt.
 */
enum Edition {
    static let looks: [Look] = FilmLooks.all
    static let defaultLookId = FilmLooks.portra400.id

    static func look(_ id: String) -> Look { FilmLooks.byId(id) }

    /** Photos albums for the JPEGs and the DNGs; JPEGs are named IMG_…-<jpegSuffix>.jpg. */
    static let album = "RawBoy Film"
    static let rawAlbum = "RawBoy Film RAW"
    static let jpegSuffix = "film"

    /**
     * Shown above "Open-source licences" in Settings. spektrafilm asks for credit for its LUTs wherever it's natural,
     * as a factual reference (not product branding).
     */
    static let credits: [String] = [
        "Film looks use film and print LUTs derived from spektrafilm by Andrea Volpato "
            + "(github.com/andreavolpato/spektrafilm), CC BY-SA 4.0.",
    ]
}
