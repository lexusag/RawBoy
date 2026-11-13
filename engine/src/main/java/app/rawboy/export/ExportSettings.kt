package app.rawboy.export

import android.content.Context

enum class ExportFormat(val extension: String, val mimeType: String) {
    JPEG("jpg", "image/jpeg"),
    TIFF("tif", "image/tiff"),
}

/**
 * JPEG encoders. SYSTEM is Android's (libjpeg-turbo via Bitmap.compress, 4:2:0 chroma, 8-bit input).
 * JPEGLI is Google's jpegli: 4:4:4, 16-bit input, adaptive quantisation; slower, better per byte.
 */
enum class JpegEncoder { SYSTEM, JPEGLI }

data class ExportSettings(
    val format: ExportFormat = ExportFormat.JPEG,
    val jpegQuality: Int = 92,   // 1..100
    val tiffBits: Int = 16,      // 8 or 16
    val jpegEncoder: JpegEncoder = JpegEncoder.SYSTEM,
    /** Long side of the saved image in pixels, area-downscaled from full resolution; null = full size. */
    val maxLongSide: Int? = null,
    /** Light sharpening after the downscale (0 = none, ~0.5 subtle); only when [maxLongSide] makes the image smaller. */
    val downscaleSharpen: Float = 0f,
    /**
     * Film mode only: render [app.rawboy.gl.ScanScale.SCALE] times larger, upscaling the photo and growing the film grain
     * on the finer pitch. Photos without a film look export as usual; [maxLongSide] doesn't apply to a scan.
     */
    val filmScan: Boolean = false,
    /**
     * JPEGLI only: write an Ultra HDR JPEG, i.e. the SDR picture plus a gain map (MPF, XMP `hdrgm`, ISO 21496-1) that
     * lets HDR screens show the highlights brighter. Off, or a picture with nothing bright, gives the plain JPEG.
     */
    val hdrGainMap: Boolean = false,
    /** JPEGLI/TIFF: written as the file's ImageDescription instead of the source's (blank: the source's). */
    val description: String = "",
    /**
     * Optional film-style date stamp (e.g. `'26 11 13`) imprinted in the bottom-right corner of the exported image.
     * Empty string = no date stamp.
     */
    val dateStamp: String = "",
    /** Visual style for [dateStamp] (`Classic` yellow-orange Digital-7 or `Red LED` rounded segments). */
    val dateStampStyle: DateStampStyle = DateStampStyle.CLASSIC,
    /**
     * Optional Pentax 645N-style black film rebate with dot-matrix shoot info along the top edge.
     * Mutually exclusive with [dateStamp]; when non-null, [pentax645] takes precedence.
     */
    val pentax645: Pentax645Info? = null,
    /** When true (B&W mode), both [dateStamp] and [pentax645] render in neutral black-and-white. */
    val monochromeImprint: Boolean = false,
)

object ExportSettingsStore {
    private const val PREFS = "export"

    fun load(context: Context): ExportSettings {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val defaults = ExportSettings()
        return ExportSettings(
            format = runCatching { ExportFormat.valueOf(p.getString("format", null)!!) }.getOrDefault(defaults.format),
            jpegQuality = p.getInt("jpegQuality", defaults.jpegQuality).coerceIn(1, 100),
            tiffBits = p.getInt("tiffBits", defaults.tiffBits).let { if (it == 8) 8 else 16 },
            filmScan = p.getBoolean("filmScan", defaults.filmScan),
        )
    }

    fun save(context: Context, settings: ExportSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("format", settings.format.name)
            .putInt("jpegQuality", settings.jpegQuality)
            .putInt("tiffBits", settings.tiffBits)
            .putBoolean("filmScan", settings.filmScan)
            .apply()
    }
}
