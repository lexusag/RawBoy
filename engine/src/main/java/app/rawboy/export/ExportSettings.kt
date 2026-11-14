package app.rawboy.export

import android.content.Context
import app.rawboy.raw.RawImage

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
    /** Frame / date-stamp overlay choice for RawBoy Pro and Auto exports. */
    val photoFrame: PhotoFrame = PhotoFrame.NONE,
    val dateStampFormat: DateStampFormat = DateStampFormat.DMY,
    /** Visual style for [dateStamp] (`Classic` yellow-orange Digital-7 or `Red LED` rounded segments). */
    val dateStampStyle: DateStampStyle = DateStampStyle.CLASSIC,
    val timeStampFormat: TimeStampFormat = TimeStampFormat.H24,
    val pentax645Fields: Set<Pentax645Field> = Pentax645Field.EXPORT_DEFAULT,
    val pentax645Order: List<Pentax645Field> = Pentax645Field.EXPORT_FIELDS,
    val pentax645Flip: Boolean = false,
    val frameColor: FilmFrameColor = FilmFrameColor.AMBER,
    /** 1-based frame counter for Pentax 645 / Contax 645 exports (in Auto: the photo's batch index). */
    val frameNumber: Int = 1,
    /** Optional EXIF capture date (`"YYYY:MM:DD HH:MM:SS"`) for [resolveFrame] when already known by the caller. */
    val captureDate: String? = null,
    /**
     * Optional film-style date stamp (e.g. `'26 11 13`) imprinted in the bottom-right corner of the exported image.
     * Empty string = no date stamp.
     */
    val dateStamp: String = "",
    /**
     * Optional Pentax 645N-style black film rebate with dot-matrix shoot info along the top edge.
     * Mutually exclusive with [dateStamp]; when non-null, [pentax645] takes precedence.
     */
    val pentax645: Pentax645Info? = null,
    /** When true (B&W mode), both [dateStamp] and [pentax645] render in neutral black-and-white. */
    val monochromeImprint: Boolean = false,
) {
    /** Output dimensions including any [PhotoFrame.PENTAX_645] / [PhotoFrame.CONTAX_645] film rebate. */
    fun outputSize(outputWidth: Int, outputHeight: Int): Pair<Int, Int> {
        val (w, h) = BandDownscaler.outputSize(outputWidth, outputHeight, maxLongSide)
        return when {
            pentax645 != null -> Pentax645Frame.layout(w, h, pentax645.style).let { it.outWidth to it.outHeight }
            photoFrame == PhotoFrame.PENTAX_645 -> Pentax645Frame.layout(w, h, FilmFrameStyle.PENTAX_645).let { it.outWidth to it.outHeight }
            photoFrame == PhotoFrame.CONTAX_645 -> Pentax645Frame.layout(w, h, FilmFrameStyle.CONTAX_645).let { it.outWidth to it.outHeight }
            else -> w to h
        }
    }

    /**
     * Resolves [photoFrame] into [dateStamp] or [pentax645] from [image]'s EXIF metadata and [exifDate] when not
     * already populated by the caller (e.g. RawBoy Camera).
     */
    fun resolveFrame(
        image: RawImage,
        exifDate: String? = captureDate,
        monochrome: Boolean = false,
        nowMs: Long = System.currentTimeMillis(),
    ): ExportSettings {
        val mono = monochromeImprint || monochrome
        if (dateStamp.isNotEmpty() || pentax645 != null || photoFrame == PhotoFrame.NONE) {
            return if (mono != monochromeImprint) copy(monochromeImprint = mono) else this
        }
        val timeMs = DateStamp.parseExifDate(exifDate) ?: nowMs
        return when (photoFrame) {
            PhotoFrame.NONE -> this
            PhotoFrame.DATE_STAMP -> {
                val fmt = if (dateStampFormat == DateStampFormat.MMM_YY) DateStampFormat.DMY else dateStampFormat
                copy(dateStamp = DateStamp.format(timeMs, fmt), monochromeImprint = mono)
            }
            PhotoFrame.PENTAX_645, PhotoFrame.CONTAX_645 -> {
                val info = image.shotInfo
                val fields = pentax645Fields
                val focalMm = info.focalLength35mm.takeIf { it.isFinite() && it > 0 } ?: info.focalLength
                val isoVal = info.iso.takeIf { it.isFinite() && it > 0 } ?: image.iso.toDouble()
                copy(
                    pentax645 = Pentax645Info(
                        frameNumber = if (Pentax645Field.FRAME_NUMBER in fields) frameNumber else null,
                        exposureTime = if (Pentax645Field.SHUTTER in fields) info.exposureTime else null,
                        fNumber = if (Pentax645Field.APERTURE in fields) info.fNumber else null,
                        focalLengthMm = if (Pentax645Field.FOCAL_LENGTH in fields) focalMm else null,
                        iso = if (Pentax645Field.ISO in fields) isoVal else null,
                        date = if (Pentax645Field.DATE in fields) Pentax645Frame.formatDate(timeMs, dateStampFormat) else null,
                        time = if (Pentax645Field.TIME in fields) Pentax645Frame.formatTime(timeMs, timeStampFormat) else null,
                        flipped = pentax645Flip,
                        fieldOrder = pentax645Order.map { it.key },
                        color = frameColor,
                        style = if (photoFrame == PhotoFrame.CONTAX_645) FilmFrameStyle.CONTAX_645 else FilmFrameStyle.PENTAX_645,
                    ),
                    monochromeImprint = mono,
                )
            }
        }
    }
}

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
            photoFrame = runCatching { PhotoFrame.valueOf(p.getString("photoFrame", null)!!) }.getOrDefault(defaults.photoFrame),
            dateStampFormat = runCatching { DateStampFormat.valueOf(p.getString("dateStampFormat", null)!!) }.getOrDefault(defaults.dateStampFormat),
            dateStampStyle = runCatching { DateStampStyle.valueOf(p.getString("dateStampStyle", null)!!) }.getOrDefault(defaults.dateStampStyle),
            timeStampFormat = runCatching { TimeStampFormat.valueOf(p.getString("timeStampFormat", null)!!) }.getOrDefault(defaults.timeStampFormat),
            pentax645Fields = Pentax645Field.parseExportFields(p.getString("pentax645Fields", null)),
            pentax645Order = Pentax645Field.parseExportOrder(p.getString("pentax645Order", null)),
            pentax645Flip = p.getBoolean("pentax645Flip", defaults.pentax645Flip),
            frameColor = runCatching { FilmFrameColor.valueOf(p.getString("frameColor", null)!!) }.getOrDefault(defaults.frameColor),
        )
    }

    fun save(context: Context, settings: ExportSettings) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("format", settings.format.name)
            .putInt("jpegQuality", settings.jpegQuality)
            .putInt("tiffBits", settings.tiffBits)
            .putBoolean("filmScan", settings.filmScan)
            .putString("photoFrame", settings.photoFrame.name)
            .putString("dateStampFormat", settings.dateStampFormat.name)
            .putString("dateStampStyle", settings.dateStampStyle.name)
            .putString("timeStampFormat", settings.timeStampFormat.name)
            .putString("pentax645Fields", settings.pentax645Fields.joinToString(",") { it.name })
            .putString("pentax645Order", settings.pentax645Order.joinToString(",") { it.name })
            .putBoolean("pentax645Flip", settings.pentax645Flip)
            .putString("frameColor", settings.frameColor.name)
            .apply()
    }
}
