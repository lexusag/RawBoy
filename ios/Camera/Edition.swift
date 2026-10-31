import RawBoyEngine

/**
 * RawBoy Camera's look lists, albums and credits: the looks on the bundled film LUTs, Film mode's film stocks and B&W
 * mode's black and white looks, as RawBoy Auto has them. Mirrors Android's Edition.kt. (Until 2026-10-31 a second
 * target, RawBoy Film, had its own copy.)
 */
enum Edition {
    /** Colour looks; the black and white ones are B&W mode's (monoLooks). */
    static let looks: [Look] = Looks.all.filter { !$0.monochrome }
    static let defaultLookId = Looks.portra400.id

    static func look(_ id: String) -> Look { Looks.byId(id) }

    /** B&W mode's stocks: RawBoy Auto's black and white looks. */
    static let monoLooks: [Look] = Looks.all.filter(\.monochrome)
    static let defaultMonoLookId = Looks.trix400.id

    static func monoLook(_ id: String) -> Look { monoLooks.first { $0.id == id } ?? Looks.trix400 }

    /**
     * Film mode's stocks (the Film toggle): the film stocks of RawBoy Auto's Film mode.
     * Their ids overlap the LUT looks' ids (portra400 is both), so Film mode keeps its own pick (filmLookId).
     */
    static let filmLooks: [Look] = FilmLooks.all
    static let defaultFilmLookId = FilmLooks.portra400.id

    static func filmLook(_ id: String) -> Look { FilmLooks.byId(id) }

    /** Photos albums for the JPEGs and the DNGs; JPEGs are named IMG_…-<jpegSuffix>.jpg. */
    static let album = "RawBoy Camera"
    static let rawAlbum = "RawBoy Camera RAW"
    static let jpegSuffix = "camera"

    /**
     * Shown above "Open-source licences" in Settings. spektrafilm asks for credit for its LUTs wherever it's natural,
     * as a factual reference (not product branding): Film mode uses them.
     */
    static let credits: [String] = [
        "Film mode uses film and print LUTs derived from spektrafilm by Andrea Volpato "
            + "(github.com/andreavolpato/spektrafilm), CC BY-SA 4.0.",
    ]
}
