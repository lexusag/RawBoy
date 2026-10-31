package app.rawboy.camera

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

    /** Pictures/<FOLDER> (JPEGs) and Pictures/<FOLDER>/RAW (DNGs); JPEGs are named IMG_…-<JPEG_SUFFIX>.jpg. */
    const val FOLDER = "RawBoy Camera"
    const val JPEG_SUFFIX = "camera"

    /** Extra lines above "Open-source licences" in Settings. */
    val credits: List<String> = emptyList()
}
