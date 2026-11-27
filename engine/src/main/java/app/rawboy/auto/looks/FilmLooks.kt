package app.rawboy.auto.looks

/**
 * Looks on spektrafilm stocks (assets/luts/spektrafilm, ids as in its stocks.json): RawBoy Camera's film looks and Auto's
 * Film mode. The stock replaces AgX and the LUT: negative, print and scan (slides: scan only), with RawBoy's own grain
 * and halation (shaders/film_form.glsl).
 * Looks add only skin retouch on the portrait films; the auto develop's exposure, white balance and denoise stay.
 */
object FilmLooks {
    /** Auto's film grain, finer than the stock's own (100): 25% lower than it was (owner's choice, 2026-11-07). */
    const val FILM_GRAIN = 60f

    /** RawBoy Camera's film grain, unchanged by that: its film looks keep their earlier 80. */
    const val CAMERA_FILM_GRAIN = 80f

    private fun stock(
        id: String,
        name: String,
        filmGroup: FilmStockGroup,
        note: String,
        portraitRetouch: Float = 0f,
    ) = Look(
        id,
        name,
        lutFile = null,
        film = id,
        portraitRetouch = portraitRetouch,
        filmGrain = FILM_GRAIN,
        note = note,
        filmGroup = filmGroup,
    )

    val PORTRA_400 = stock(
        "portra400",
        "Yellow Portrait 400",
        FilmStockGroup.COLOR_NEGATIVE,
        "Soft skin tones, wide latitude",
        portraitRetouch = 20f,
    )

    val ALL = listOf(
        Looks.NATURAL,
        PORTRA_400,
        stock("portra800", "Yellow Portrait 800", FilmStockGroup.COLOR_NEGATIVE, "Warm shadows, punchier grain", portraitRetouch = 20f),
        stock("ektar100", "Yellow Vivid 100", FilmStockGroup.COLOR_NEGATIVE, "Rich reds and blues, fine grain"),
        stock("gold200", "Yellow Warm 200", FilmStockGroup.COLOR_NEGATIVE, "Golden sunlit cast, warm mids"),
        stock("fuji400h", "Green Pastel 400", FilmStockGroup.COLOR_NEGATIVE, "Airy pastels, cool mint highlights", portraitRetouch = 20f),
        stock("xtra400", "Green Everyday 400", FilmStockGroup.COLOR_NEGATIVE, "Punchy greens, crisp everyday colour"),
        stock("vision250d", "Yellow Cine 250D", FilmStockGroup.CINEMA, "Daylight cinema print, smooth roll-off"),
        stock("vision500t", "Yellow Cine 500T", FilmStockGroup.CINEMA, "Tungsten cinema, cool shadows and halation"),
        stock("velvia100", "Green Vivid Slide 100", FilmStockGroup.SLIDE, "Deep blacks, bold landscape saturation"),
        stock("provia100", "Green Slide 100", FilmStockGroup.SLIDE, "Crisp neutral slide, clean blues"),
        stock("ektachrome100", "Yellow Slide 100", FilmStockGroup.SLIDE, "Clean contrast, cool bright whites"),
        stock("kodachrome64", "Yellow Classic 64", FilmStockGroup.SLIDE, "Archival reds and yellows, dense contrast"),
    )

    fun byId(id: String): Look = RetiredLooks.stock(id).let { key -> ALL.firstOrNull { it.id == key } } ?: PORTRA_400

    /** Film family of [look]: its [Look.filmGroup], or [FilmStockGroup.NATURAL] for Natural. */
    fun group(look: Look): FilmStockGroup = look.filmGroup ?: FilmStockGroup.NATURAL

    /** [looks] split into [FilmStockGroup] sections in order, empty sections omitted. */
    fun sections(looks: List<Look>): List<Pair<FilmStockGroup, List<Look>>> =
        FilmStockGroup.entries.mapNotNull { g -> looks.filter { group(it) == g }.takeIf { it.isNotEmpty() }?.let { g to it } }
}
