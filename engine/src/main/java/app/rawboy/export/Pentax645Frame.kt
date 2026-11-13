package app.rawboy.export

import java.util.Locale
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Shoot metadata imprinted into the top film rebate of a Pentax 645-style frame.
 * Unknown exposure / focal-length values (NaN or <= 0) are shown as dashes (`---`, `F--`, `-- mm`).
 */
data class Pentax645Info(
    val frameNumber: Int,
    val mode: String,
    val exposureTime: Double,
    val fNumber: Double,
    val compensationEv: Float,
    val spotMetered: Boolean,
    val focalLengthMm: Double,
)

/**
 * Renders a Pentax 645N-style black film rebate around the photo with 5x7 dot-matrix amber-orange LED shoot info
 * along the top edge: frame number, mode (FILM / LOOK / BW), shutter speed, aperture, exposure correction,
 * metering icon (large matrix icon for auto, small spot icon for tap), and lens focal length.
 *
 * Uses the same film-emulsion LED response as [DateStamp] (`1 - exp(-GAIN * E * c)`), and matches the Swift
 * implementation in `ios/Engine/app/rawboy/export/ExportSettings.swift`.
 */
object Pentax645Frame {

    data class Layout(
        val photoWidth: Int,
        val photoHeight: Int,
        val border: Int,
        val topBar: Int,
    ) {
        val outWidth: Int get() = photoWidth + 2 * border
        val outHeight: Int get() = photoHeight + topBar + border
    }

    fun layout(photoWidth: Int, photoHeight: Int): Layout {
        val shortSide = minOf(photoWidth, photoHeight).toFloat()
        val border = (shortSide * 0.005f).roundToInt().coerceAtLeast(3)
        val topBar = (shortSide * 0.036f).roundToInt().coerceAtLeast(28)
        return Layout(photoWidth, photoHeight, border, topBar)
    }

    fun formatFrameNumber(frameNumber: Int): String =
        if (frameNumber > 0) frameNumber.toString() else "--"

    fun formatShutter(t: Double): String {
        if (!t.isFinite() || t <= 0.0) return "---"
        return if (t >= 0.95) "${trimOneDecimal(t)}s" else "1/${(1.0 / t).roundToInt()}"
    }

    fun formatAperture(f: Double): String {
        if (!f.isFinite() || f <= 0.0) return "F--"
        val rounded = f.roundToInt()
        return if (abs(f - rounded) < 0.05 && rounded < 10) "F $rounded" else "F${trimOneDecimal(f)}"
    }

    fun formatEv(ev: Float): String {
        if (!ev.isFinite() || abs(ev) < 0.05f) return "±0.0EV"
        val sign = if (ev > 0f) "+" else "-"
        return String.format(Locale.ROOT, "%s%.1fEV", sign, abs(ev))
    }

    fun formatFocalLength(mm: Double): String {
        if (!mm.isFinite() || mm <= 0.0) return "-- mm"
        return "${mm.roundToInt()} mm"
    }

    private fun trimOneDecimal(v: Double): String {
        val s = String.format(Locale.ROOT, "%.1f", v)
        return if (s.endsWith(".0")) s.dropLast(2) else s
    }

    private const val LED_R = 1.0f
    private const val LED_G = 0.44f
    private const val LED_B = 0.04f
    private const val GAIN = 3.0f

    // Deep film-base black (not pure 0 so subtle emulsion grain and LED halation read naturally).
    private const val BASE_R = 0.011f
    private const val BASE_G = 0.010f
    private const val BASE_B = 0.009f
    private const val BASE_MONO = 0.010f
    private const val LED_MONO = 0.85f

    private sealed interface Token {
        class Text(val value: String) : Token
        class Metering(val spot: Boolean) : Token
    }

    /**
     * Renders rows `[bandY, bandY + bandRows)` of the top film rebate (`0 <= bandY < layout.topBar`) into [band].
     * When [monochrome] is true (B&W mode), both the rebate and LED dots are neutral greyscale.
     */
    fun renderTopBarBand(
        band: ShortArray,
        layout: Layout,
        bandY: Int,
        bandRows: Int,
        info: Pentax645Info,
        monochrome: Boolean = info.mode == "BW",
    ) {
        val outW = layout.outWidth
        val topBar = layout.topBar
        val shortSide = minOf(layout.photoWidth, layout.photoHeight).toFloat()
        val grainCell = maxOf(1f, topBar * 0.03f)

        val tokens = listOf(
            Token.Text(formatFrameNumber(info.frameNumber)),
            Token.Text(info.mode),
            Token.Text(formatShutter(info.exposureTime)),
            Token.Text(formatAperture(info.fNumber)),
            Token.Text(formatEv(info.compensationEv)),
            Token.Metering(info.spotMetered),
            Token.Text(formatFocalLength(info.focalLengthMm)),
        )

        var charH = topBar * 0.56f
        var dotPitch = charH / 7f
        var charGap = dotPitch * 1.3f
        var groupGap = dotPitch * 5.2f

        fun tokenWidth(t: Token): Float = when (t) {
            is Token.Text -> {
                val n = t.value.length
                if (n == 0) 0f else n * (5f * dotPitch) + (n - 1) * charGap
            }
            is Token.Metering -> 7f * dotPitch
        }

        val rawTotalW = tokens.sumOf { tokenWidth(it).toDouble() }.toFloat() + (tokens.size - 1) * groupGap
        val maxContentW = layout.photoWidth * 0.90f
        if (rawTotalW > maxContentW && rawTotalW > 0f) {
            val scale = maxContentW / rawTotalW
            charH *= scale
            dotPitch *= scale
            charGap *= scale
            groupGap *= scale
        }

        val totalW = tokens.sumOf { tokenWidth(it).toDouble() }.toFloat() + (tokens.size - 1) * groupGap
        val x0 = (outW - totalW) * 0.5f
        val y0 = (topBar - charH) * 0.5f

        val dotR = dotPitch * 0.36f
        val soft = maxOf(dotPitch * 0.36f, 0.8f)
        val reach = dotPitch * 1.8f
        val haloInv = 1f / (dotPitch * 0.85f)

        // Precompute dot positions (in local x, y relative to x0, y0) and their deterministic brightness.
        val dotX = ArrayList<Float>(180)
        val dotY = ArrayList<Float>(180)
        val dotBright = ArrayList<Float>(180)
        var cursorX = 0f
        var glyphIdx = 0
        for ((ti, token) in tokens.withIndex()) {
            when (token) {
                is Token.Text -> {
                    for ((ci, ch) in token.value.withIndex()) {
                        val rows = glyph5x7(ch)
                        if (rows != null) {
                            for (r in 0 until 7) {
                                val bits = rows[r]
                                for (c in 0 until 5) {
                                    if ((bits shr (4 - c)) and 1 != 0) {
                                        dotX += cursorX + (c + 0.5f) * dotPitch
                                        dotY += (r + 0.5f) * dotPitch
                                        dotBright += 0.90f + 0.10f * hash(glyphIdx * 64 + r * 8 + c, 733)
                                    }
                                }
                            }
                        }
                        cursorX += 5f * dotPitch + if (ci + 1 < token.value.length) charGap else 0f
                        glyphIdx++
                    }
                }
                is Token.Metering -> {
                    val rows = if (token.spot) SPOT_METER_7X7 else AUTO_METER_7X7
                    for (r in 0 until 7) {
                        val bits = rows[r]
                        for (c in 0 until 7) {
                            if ((bits shr (6 - c)) and 1 != 0) {
                                dotX += cursorX + (c + 0.5f) * dotPitch
                                dotY += (r + 0.5f) * dotPitch
                                dotBright += 0.92f + 0.08f * hash(glyphIdx * 64 + r * 8 + c, 733)
                            }
                        }
                    }
                    cursorX += 7f * dotPitch
                    glyphIdx++
                }
            }
            if (ti + 1 < tokens.size) cursorX += groupGap
        }

        val minY = (y0 - reach).toInt().coerceAtLeast(bandY)
        val maxY = (y0 + charH + reach).toInt().coerceAtMost(bandY + bandRows - 1)
        val minX = (x0 - reach).toInt().coerceAtLeast(0)
        val maxX = (x0 + totalW + reach).toInt().coerceAtMost(outW - 1)
        val dotCount = dotX.size

        for (py in bandY until bandY + bandRows) {
            val rowOffset = (py - bandY) * outW
            val inStampY = py in minY..maxY
            val vy = (py + 0.5f) - y0
            for (px in 0 until outW) {
                val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                var r = (if (monochrome) BASE_MONO else BASE_R) * grain
                var g = (if (monochrome) BASE_MONO else BASE_G) * grain
                var b = (if (monochrome) BASE_MONO else BASE_B) * grain

                if (inStampY && px in minX..maxX) {
                    val ux = (px + 0.5f) - x0
                    var core = 0f
                    var minDist = Float.MAX_VALUE
                    for (k in 0 until dotCount) {
                        val dx = abs(ux - dotX[k])
                        if (dx > reach) continue
                        val dy = abs(vy - dotY[k])
                        if (dy > reach) continue
                        val d = sqrt(dx * dx + dy * dy) - dotR
                        if (d < minDist) minDist = d
                        if (d < soft * 0.5f) {
                            val e = dotBright[k] * edge(d, soft)
                            if (e > core) core = e
                        }
                    }
                    val excess = minDist.coerceAtLeast(0f) * haloInv
                    val halo = 0.16f * exp(-excess * excess)
                    if (core > 0.002f || halo >= 0.004f) {
                        val e = (core + halo * (1f - core)) * grain
                        if (monochrome) {
                            val l = 1f - exp(-GAIN * e * LED_MONO)
                            r = 1f - (1f - r) * (1f - l)
                            g = 1f - (1f - g) * (1f - l)
                            b = 1f - (1f - b) * (1f - l)
                        } else {
                            val lr = 1f - exp(-GAIN * e * LED_R)
                            val lg = 1f - exp(-GAIN * e * LED_G)
                            val lb = 1f - exp(-GAIN * e * LED_B)
                            r = 1f - (1f - r) * (1f - lr)
                            g = 1f - (1f - g) * (1f - lg)
                            b = 1f - (1f - b) * (1f - lb)
                        }
                    }
                }

                val idx = (rowOffset + px) * 3
                band[idx] = toU16Short(r)
                band[idx + 1] = toU16Short(g)
                band[idx + 2] = toU16Short(b)
            }
        }
        // Keep shortSide referenced cleanly if needed for future scaling; currently topBar drives scale.
        @Suppress("UNUSED_VARIABLE")
        val unused = shortSide
    }

    /** Fills [band] (`outWidth * bandRows * 3`) with dark film-base black for the bottom border. */
    fun renderBorderBand(band: ShortArray, layout: Layout, bandY: Int, bandRows: Int, monochrome: Boolean = false) {
        val outW = layout.outWidth
        val grainCell = maxOf(1f, layout.topBar * 0.03f)
        val br = if (monochrome) BASE_MONO else BASE_R
        val bg = if (monochrome) BASE_MONO else BASE_G
        val bb = if (monochrome) BASE_MONO else BASE_B
        for (py in bandY until bandY + bandRows) {
            val rowOffset = (py - bandY) * outW
            for (px in 0 until outW) {
                val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                val idx = (rowOffset + px) * 3
                band[idx] = toU16Short(br * grain)
                band[idx + 1] = toU16Short(bg * grain)
                band[idx + 2] = toU16Short(bb * grain)
            }
        }
    }

    /**
     * Wraps a developed photo band [src] (`photoWidth * bandRows * 3`) into [dst] (`outWidth * bandRows * 3`),
     * adding left/right [Layout.border] strips. [photoY] is the row index within the photo (`0..photoHeight - 1`).
     */
    fun wrapPhotoBand(src: ShortArray, dst: ShortArray, layout: Layout, photoY: Int, bandRows: Int, monochrome: Boolean = false) {
        val pw = layout.photoWidth
        val ow = layout.outWidth
        val b = layout.border
        val grainCell = maxOf(1f, layout.topBar * 0.03f)
        val br = if (monochrome) BASE_MONO else BASE_R
        val bg = if (monochrome) BASE_MONO else BASE_G
        val bb = if (monochrome) BASE_MONO else BASE_B
        for (r in 0 until bandRows) {
            val py = layout.topBar + photoY + r
            val dstRow = r * ow
            for (px in 0 until b) {
                val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                val idx = (dstRow + px) * 3
                dst[idx] = toU16Short(br * grain)
                dst[idx + 1] = toU16Short(bg * grain)
                dst[idx + 2] = toU16Short(bb * grain)
            }
            System.arraycopy(src, r * pw * 3, dst, (dstRow + b) * 3, pw * 3)
            for (px in (b + pw) until ow) {
                val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                val idx = (dstRow + px) * 3
                dst[idx] = toU16Short(br * grain)
                dst[idx + 1] = toU16Short(bg * grain)
                dst[idx + 2] = toU16Short(bb * grain)
            }
        }
    }

    private fun edge(d: Float, soft: Float): Float {
        val t = ((soft * 0.5f - d) / soft).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    private fun hash(x: Int, y: Int): Float {
        var h = x * 374761393 + y * 668265263
        h = (h xor (h ushr 13)) * 1274126177
        h = h xor (h ushr 16)
        return (h and 0xFFFFFF) / 16777215f
    }

    private fun toU16Short(v: Float): Short = (v.coerceIn(0f, 1f) * 65535f).roundToInt().toShort()

    // 7x7 dot-matrix metering symbols: larger multi-segment frame for auto, smaller center dot for tap.
    private val AUTO_METER_7X7 = intArrayOf(
        0b1111111,
        0b1000001,
        0b1001001,
        0b1011101,
        0b1001001,
        0b1000001,
        0b1111111,
    )

    private val SPOT_METER_7X7 = intArrayOf(
        0b0000000,
        0b0000000,
        0b0001000,
        0b0011100,
        0b0001000,
        0b0000000,
        0b0000000,
    )

    private fun glyph5x7(ch: Char): IntArray? = when (ch) {
        '0' -> intArrayOf(0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110)
        '1' -> intArrayOf(0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110)
        '2' -> intArrayOf(0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111)
        '3' -> intArrayOf(0b11111, 0b00010, 0b00100, 0b00110, 0b00001, 0b10001, 0b01110)
        '4' -> intArrayOf(0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010)
        '5' -> intArrayOf(0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110)
        '6' -> intArrayOf(0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110)
        '7' -> intArrayOf(0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000)
        '8' -> intArrayOf(0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110)
        '9' -> intArrayOf(0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100)
        'B' -> intArrayOf(0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110)
        'E' -> intArrayOf(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111)
        'F' -> intArrayOf(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000)
        'I' -> intArrayOf(0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110)
        'K' -> intArrayOf(0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001)
        'L' -> intArrayOf(0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111)
        'M' -> intArrayOf(0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001)
        'O' -> intArrayOf(0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110)
        'V' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100)
        'W' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001)
        'm' -> intArrayOf(0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001)
        's' -> intArrayOf(0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110)
        '/' -> intArrayOf(0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000)
        '.' -> intArrayOf(0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100)
        '+' -> intArrayOf(0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000)
        '-' -> intArrayOf(0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000)
        '±' -> intArrayOf(0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000, 0b11111)
        else -> null
    }
}
