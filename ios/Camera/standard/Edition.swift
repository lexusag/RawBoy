import RawBoyEngine

/** RawBoy Camera (target RawBoyCamera): the looks on the bundled film LUTs, as RawBoy Auto has them. */
enum Edition {
    /** Colour looks; the black and white ones are B&W mode's (monoLooks). */
    static let looks: [Look] = Looks.all.filter { !$0.monochrome }
    static let defaultLookId = Looks.portra400.id

    static func look(_ id: String) -> Look { Looks.byId(id) }

    /** B&W mode's stocks: RawBoy Auto's black and white looks, as in RawBoy Film. */
    static let monoLooks: [Look] = Looks.all.filter(\.monochrome)
    static let defaultMonoLookId = Looks.trix400.id

    static func monoLook(_ id: String) -> Look { monoLooks.first { $0.id == id } ?? Looks.trix400 }

    /** Photos albums for the JPEGs and the DNGs; JPEGs are named IMG_…-<jpegSuffix>.jpg. */
    static let album = "RawBoy Camera"
    static let rawAlbum = "RawBoy Camera RAW"
    static let jpegSuffix = "camera"

    /** Extra lines above "Open-source licences" in Settings. */
    static let credits: [String] = []
}
