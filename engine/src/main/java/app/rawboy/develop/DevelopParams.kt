package app.rawboy.develop

import app.rawboy.color.BwFilter

/**
 * Slider values as the user sees them.
 *
 * - toneMapper: the display transform (AgX by default; Pro only, Auto and Camera stay on AgX)
 * - exposure: EV, -5..+5
 * - contrast, saturation, highlights, shadows, whites, blacks: -100..+100; tint: -250..+250 (WhiteBalance.MAX_TINT)
 * - temperature: Kelvin; the as-shot value is the default
 * - denoise, grain, sharpening: 0..100, 0 = off; denoise is luminance noise (and colour noise while colorDenoise is null)
 * - grainSize: 0..100, 25 = the default ~1/3200 of the long edge, each 25 doubles it (0 = half, 100 = 8x);
 *   grainRoughness: 0..100 clumping (0 = even grain); grainColor: 0..100 per-channel colour in the grain (0 = mono)
 * - colorDenoise: 0..100 colour (chroma) noise, Pro's own slider; null = follows denoise (Auto, Camera, older edits)
 * - localContrast: -100..100 edge-aware mid-frequency detail (texture a few pixels across), 0 = off
 * - highpassContrast: -100..100 local (clarity-style) contrast, 0 = off
 * - bloom: 0..100 diffusion-filter glow, 0 = off
 * - anamorphic: 0..100 horizontal anamorphic lens flare, 0 = off; anamorphicColor: [AnamorphicColor] coating;
 *   anamorphicGhosts: faint oval ghosts of the lights
 * - skinRetouch: 0..100 smoothing of skin (found by a segmentation model), 0 = off
 * - blemishRemoval: 0..100 automatic spot healing on skin; higher heals fainter spots, 0 = off
 * - lut: LutEntry id or null for "No LUT"; lutAmount: 0..100 strength
 * - film: film stock id (app.rawboy.film.FilmStocks) or null for none: the Film tone mapper (Pro, Auto, Camera);
 *   filmAmount: 0..100 blend of the film render over the toneMapper one; filmGrain, halation: 0..200, 100 = the stock's
 * - lensProfile: apply the lens corrections embedded in the file (if any)
 * - lensDistortion: -100..100, + removes barrel distortion; auto crop/scale follows
 * - lensAnamorphic: -100..100 cylindrical (horizontal) distortion; - bows vertical edges outward like an anamorphic lens
 * - lensCrop: -100..100 scale around the auto crop (0 = no empty edges; < 0 reveals curved borders; > 0 crops tighter)
 * - caRed, caBlue: -100..100, lateral chromatic aberration: + enlarges the red (blue) plane around the image centre
 * - vignetteAmount: -100..100, + brightens corners; vignetteMidpoint: 0..100 (higher = only the corners)
 * - curves: point curves (RGB, then red, green, blue) on the final display-encoded image (see [ToneCurves])
 * - bwFilter: colour filter for black and white ([app.rawboy.color.BwFilter], RawBoy Camera's B&W mode; NONE = identity),
 *   channel gains after white balance and the RGB primaries
 * - RGB primaries (after darktable): redHue/greenHue/blueHue in degrees (-45..45),
 *   red/green/bluePurity -200..200 (0 = unchanged), tintHue degrees (-180..180), tintPurity 0..100
 * - rotation: clockwise quarter turns; straighten: degrees -45..45, + turns clockwise (auto crop).
 * - scale: 100..200%, 100% = normal (scales image within the full frame to preserve final resolution).
 * - flipHorizontal/flipVertical: mirror the photo (display orientation, before rotation) left-right / top-bottom.
 * - cropLeft/Top/Right/Bottom: 0..1 edges of the user crop within the rotated + straightened frame
 *   (0, 0, 1, 1 = no crop). See [CropMath].
 *   Rotation, flips, straighten, scale and crop are per photo: they reset when another file is opened.
 *
 * Whites/Blacks follow Lightroom: Blacks < 0 raises the black point (deeper
 * blacks), Blacks > 0 lifts/fades them; Whites > 0 lowers the white point
 * (brighter whites), Whites < 0 dims them.
 */
data class DevelopParams(
    val toneMapper: ToneMapper = ToneMapper.AGX,
    val exposure: Float = 0f,
    val contrast: Float = 0f,
    val highlights: Float = 0f,
    val shadows: Float = 0f,
    val whites: Float = 0f,
    val blacks: Float = 0f,
    val temperature: Float = 5500f,
    val tint: Float = 0f,
    val saturation: Float = 0f,
    val redHue: Float = 0f,
    val redPurity: Float = 0f,
    val greenHue: Float = 0f,
    val greenPurity: Float = 0f,
    val blueHue: Float = 0f,
    val bluePurity: Float = 0f,
    val tintHue: Float = 0f,
    val tintPurity: Float = 0f,
    val bwFilter: BwFilter = BwFilter.NONE,
    val denoise: Float = 0f,
    val colorDenoise: Float? = null,
    val grain: Float = 0f,
    val grainSize: Float = 25f,
    val grainRoughness: Float = 0f,
    val grainColor: Float = 15f,
    val sharpening: Float = 0f,
    val localContrast: Float = 0f,
    val highpassContrast: Float = 0f,
    val bloom: Float = 0f,
    val anamorphic: Float = 0f,
    val anamorphicColor: AnamorphicColor = AnamorphicColor.NEUTRAL,
    val anamorphicGhosts: Boolean = false,
    val skinRetouch: Float = 0f,
    val blemishRemoval: Float = 0f,
    val lut: String? = null,
    val lutAmount: Float = 100f,
    val film: String? = null,
    val filmAmount: Float = 100f,
    val filmGrain: Float = 75f,
    val halation: Float = 100f,
    val curves: ToneCurves = ToneCurves.NONE,
    val lensProfile: Boolean = true,
    val lensDistortion: Float = 0f,
    val lensAnamorphic: Float = 0f,
    val lensCrop: Float = 0f,
    val caRed: Float = 0f,
    val caBlue: Float = 0f,
    val vignetteAmount: Float = 0f,
    val vignetteMidpoint: Float = 50f,
    val rotation: Int = 0,
    val flipHorizontal: Boolean = false,
    val flipVertical: Boolean = false,
    val straighten: Float = 0f,
    val scale: Float = 100f,
    val cropLeft: Float = 0f,
    val cropTop: Float = 0f,
    val cropRight: Float = 1f,
    val cropBottom: Float = 1f,
    /** Up to [Masks.MAX_LAYERS] mask layers with local adjustments (see Masks.kt); per photo, like the crop. */
    val masks: List<MaskLayer> = emptyList(),
    /** Up to [LightLeaks.MAX_LEAKS] light leaks over the finished picture (see LightLeaks.kt); per photo, like the masks. */
    val leaks: List<LightLeak> = emptyList(),
    /**
     * The photo is display-referred (JPEG, HEIC: see display_inverse.cpp), rendered with AgX per channel. Set only on
     * a photo's as-shot defaults, from the decoder; never a slider or preset value.
     */
    val displaySource: Boolean = false,
    /**
     * Pixel value of the photo's blown highlights (RawImage.clipLevel), which white balance changes leave neutral
     * (`uClipLevel`); 0 = unknown. Set only on a photo's as-shot defaults, from the decoder, like [displaySource].
     */
    val clipLevel: Float = 0f,
) {
    /** The colour denoise in effect: [colorDenoise], or [denoise] while it isn't set. */
    val effectiveColorDenoise: Float get() = colorDenoise ?: denoise
}

/**
 * Scene -> display tone mapping. All three share AgX's log range, middle grey and slope there, so the
 * sliders mean the same; they differ in toe/shoulder and in colour (see shaders/develop.glsl).
 * [shaderId] is the `uToneMapper` value; [key] is stored in presets.
 */
enum class ToneMapper(val shaderId: Int, val key: String, val label: String) {
    AGX(0, "agx", "AgX"),
    FILMIC(1, "filmic", "Filmic"),
    SIGMOID(2, "sigmoid", "Sigmoid");

    companion object {
        fun fromKey(key: String?): ToneMapper? = entries.firstOrNull { it.key == key }
    }
}

/**
 * Coating colour of Pro's fake anamorphic lens flare (see `anamorphicFlare` in shaders/develop.glsl). [tint] is the
 * linear Rec.2020 colour of the streak, [length] how far each channel's streak reaches (a short red and a long blue make
 * a white core, cyan, then blue tips) and [bar] the colour of the soft glow round it. [key] is stored in presets and edits.
 */
enum class AnamorphicColor(
    val key: String,
    val label: String,
    internal val tint: FloatArray,
    internal val length: FloatArray,
    internal val bar: FloatArray,
) {
    NEUTRAL("neutral", "Neutral", floatArrayOf(1f, 1f, 1f), floatArrayOf(0.85f, 0.85f, 0.85f), floatArrayOf(0.8f, 0.85f, 0.95f)),
    BLUE("blue", "Blue", floatArrayOf(0.7f, 0.9f, 1.45f), floatArrayOf(0.3f, 0.55f, 1f), floatArrayOf(0.2f, 0.5f, 1f)),
    GOLDEN("golden", "Golden", floatArrayOf(1.2f, 0.9f, 0.55f), floatArrayOf(1f, 0.7f, 0.4f), floatArrayOf(1f, 0.6f, 0.2f)),
    MAGENTA("magenta", "Magenta", floatArrayOf(1.15f, 0.8f, 1.25f), floatArrayOf(0.8f, 0.45f, 1f), floatArrayOf(0.7f, 0.3f, 1f));

    /** `uAnamorphicTint`: the colour, and a = 1 when [ghosts] are on. */
    fun tintVec(ghosts: Boolean) = floatArrayOf(tint[0], tint[1], tint[2], if (ghosts) 1f else 0f)
    fun lengthVec() = floatArrayOf(length[0], length[1], length[2], 0f)
    fun barVec() = floatArrayOf(bar[0], bar[1], bar[2], 0f)

    companion object {
        fun fromKey(key: String?): AnamorphicColor? = entries.firstOrNull { it.key == key }
    }
}
