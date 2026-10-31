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

    /**
     * B&W mode's stocks: the black and white looks RawBoy Auto has (AgX + mono LUT). Empty = no B&W mode (the
     * standard camera lists its mono looks among the others).
     */
    static let monoLooks: [Look] = [Looks.trixSoft, Looks.trix400, Looks.trixPush, Looks.trixHard, Looks.doubleX, Looks.doubleXSoft]
    static let defaultMonoLookId = Looks.trix400.id

    static func monoLook(_ id: String) -> Look { monoLooks.first { $0.id == id } ?? Looks.trix400 }

    /** No Film toggle: this edition's looks already are the film stocks. */
    static let filmLooks: [Look] = []
    static let defaultFilmLookId = FilmLooks.portra400.id

    static func filmLook(_ id: String) -> Look { FilmLooks.byId(id) }

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
