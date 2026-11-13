package app.rawboy.export

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Shoot metadata imprinted into the film rebate of a Pentax 645-style frame.
 * A `null` field means that item is disabled in Settings and omitted from the rebate;
 * a non-null unknown exposure / focal-length / ISO value (`NaN` or `<= 0`) is shown as dashes (`---`, `F--`, `--mm`, `ISO---`).
 */
data class Pentax645Info(
    val frameNumber: Int? = null,
    val mode: String? = null,
    val exposureTime: Double? = null,
    val fNumber: Double? = null,
    val compensationEv: Float? = null,
    val spotMetered: Boolean? = null,
    val focalLengthMm: Double? = null,
    val iso: Double? = null,
    val dateTime: String? = null,
)

/**
 * Renders a Pentax 645N-style black film rebate around the photo with 5x7 dot-matrix amber-orange LED shoot info
 * always placed along the **shorter side** of the image (top rebate for portrait/square photos, left rebate for
 * landscape photos), with rounded film-gate corners where the photo meets the black stripe.
 *
 * Uses the same film-emulsion LED response as [DateStamp] (`1 - exp(-GAIN * E * c)`), and matches the Swift
 * implementation in `ios/Engine/app/rawboy/export/ExportSettings.swift`.
 */
object Pentax645Frame {

    data class Layout(
        val photoWidth: Int,
        val photoHeight: Int,
        val border: Int,
        val infoBar: Int,
    ) {
        /** True when the photo is landscape (`photoWidth > photoHeight`), so the shorter side is vertical (left edge). */
        val infoOnLeft: Boolean get() = photoWidth > photoHeight
        val topPad: Int get() = if (infoOnLeft) border else infoBar
        val bottomPad: Int get() = border
        val leftPad: Int get() = if (infoOnLeft) infoBar else border
        val rightPad: Int get() = border
        val outWidth: Int get() = photoWidth + leftPad + rightPad
        val outHeight: Int get() = photoHeight + topPad + bottomPad

        /** Backwards-compatible alias for tests/callers checking the rebate thickness. */
        val topBar: Int get() = infoBar
    }

    fun layout(photoWidth: Int, photoHeight: Int): Layout {
        val shortSide = minOf(photoWidth, photoHeight).toFloat()
        val border = (shortSide * 0.005f).roundToInt().coerceAtLeast(3)
        val infoBar = (shortSide * 0.036f).roundToInt().coerceAtLeast(28)
        return Layout(photoWidth, photoHeight, border, infoBar)
    }

    fun formatFrameNumber(frameNumber: Int): String =
        if (frameNumber > 0) "#$frameNumber" else "#--"

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
        if (!mm.isFinite() || mm <= 0.0) return "--mm"
        return "${mm.roundToInt()}mm"
    }

    fun formatIso(iso: Double): String {
        if (!iso.isFinite() || iso <= 0.0) return "ISO---"
        return "ISO${iso.roundToInt()}"
    }

    fun formatDateTime(
        timeMs: Long,
        format: DateStampFormat = DateStampFormat.DMY,
        timeZone: TimeZone = TimeZone.getDefault(),
    ): String {
        val cal = Calendar.getInstance(timeZone).apply { timeInMillis = timeMs }
        val year = cal.get(Calendar.YEAR) % 100
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        val minute = cal.get(Calendar.MINUTE)
        return when (format) {
            DateStampFormat.DMY -> String.format(Locale.US, "%02d.%02d.%02d %02d:%02d", day, month, year, hour, minute)
            DateStampFormat.YMD -> String.format(Locale.US, "%02d.%02d.%02d %02d:%02d", year, month, day, hour, minute)
            DateStampFormat.MDY -> String.format(Locale.US, "%02d.%02d.%02d %02d:%02d", month, day, year, hour, minute)
        }
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

    private fun charCols(ch: Char): Int = when (ch) {
        '.', ':', '\'', ' ' -> 3
        else -> 5
    }

    private class StampDots(
        val u0: Float,
        val v0: Float,
        val totalU: Float,
        val charH: Float,
        val dotR: Float,
        val soft: Float,
        val reach: Float,
        val haloInv: Float,
        val dotU: FloatArray,
        val dotV: FloatArray,
        val dotBright: FloatArray,
    )

    private fun buildStampDots(layout: Layout, info: Pentax645Info): StampDots {
        val barLength = (if (layout.infoOnLeft) layout.outHeight else layout.outWidth).toFloat()
        val photoShortSide = minOf(layout.photoWidth, layout.photoHeight).toFloat()
        val infoBar = layout.infoBar.toFloat()

        val tokens = buildList {
            info.frameNumber?.let { add(Token.Text(formatFrameNumber(it))) }
            info.mode?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
            info.exposureTime?.let { add(Token.Text(formatShutter(it))) }
            info.fNumber?.let { add(Token.Text(formatAperture(it))) }
            info.compensationEv?.let { add(Token.Text(formatEv(it))) }
            info.spotMetered?.let { add(Token.Metering(it)) }
            info.focalLengthMm?.let { add(Token.Text(formatFocalLength(it))) }
            info.iso?.let { add(Token.Text(formatIso(it))) }
            info.dateTime?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
        }

        var charH = infoBar * 0.56f
        var dotPitch = charH / 7f
        var charGap = dotPitch * 1.15f
        var minGroupGap = dotPitch * 5.0f

        fun tokenWidth(t: Token): Float = when (t) {
            is Token.Text -> {
                val s = t.value
                if (s.isEmpty()) 0f
                else {
                    var cols = 0
                    for (ch in s) cols += charCols(ch)
                    cols * dotPitch + (s.length - 1) * charGap
                }
            }
            is Token.Metering -> 7f * dotPitch
        }

        var sumTokensW = tokens.sumOf { tokenWidth(it).toDouble() }.toFloat()
        val maxContentW = photoShortSide * 0.92f
        val minTotalW = if (tokens.isEmpty()) 0f else sumTokensW + (tokens.size - 1) * minGroupGap
        if (minTotalW > maxContentW && minTotalW > 0f) {
            val scale = maxContentW / minTotalW
            charH *= scale
            dotPitch *= scale
            charGap *= scale
            minGroupGap *= scale
            sumTokensW = tokens.sumOf { tokenWidth(it).toDouble() }.toFloat()
        }

        // Give wider spacing between items when fewer items are selected, up to 14x dotPitch.
        val groupGap = if (tokens.size <= 1) {
            0f
        } else {
            val targetSpan = (photoShortSide * 0.86f).coerceAtMost(maxContentW)
            val idealGap = (targetSpan - sumTokensW) / (tokens.size - 1)
            idealGap.coerceIn(minGroupGap, dotPitch * 14f)
        }

        val totalU = if (tokens.isEmpty()) 0f else sumTokensW + (tokens.size - 1) * groupGap
        val u0 = (barLength - totalU) * 0.5f
        val v0 = (infoBar - charH) * 0.5f

        val dotR = dotPitch * 0.36f
        val soft = maxOf(dotPitch * 0.36f, 0.8f)
        val reach = dotPitch * 1.8f
        val haloInv = 1f / (dotPitch * 0.85f)

        val uList = ArrayList<Float>(256)
        val vList = ArrayList<Float>(256)
        val bList = ArrayList<Float>(256)
        var cursorU = 0f
        var glyphIdx = 0
        for ((ti, token) in tokens.withIndex()) {
            when (token) {
                is Token.Text -> {
                    for ((ci, ch) in token.value.withIndex()) {
                        val cols = charCols(ch)
                        val rows = glyph5x7(ch)
                        if (rows != null) {
                            val colShift = (5 - cols) / 2
                            for (r in 0 until 7) {
                                val bits = rows[r]
                                for (c in 0 until cols) {
                                    val srcCol = c + colShift
                                    if (srcCol in 0..4 && ((bits shr (4 - srcCol)) and 1 != 0)) {
                                        uList += cursorU + (c + 0.5f) * dotPitch
                                        vList += (r + 0.5f) * dotPitch
                                        bList += 0.90f + 0.10f * hash(glyphIdx * 64 + r * 8 + c, 733)
                                    }
                                }
                            }
                        }
                        cursorU += cols * dotPitch + if (ci + 1 < token.value.length) charGap else 0f
                        glyphIdx++
                    }
                }
                is Token.Metering -> {
                    val rows = if (token.spot) SPOT_METER_7X7 else AUTO_METER_7X7
                    for (r in 0 until 7) {
                        val bits = rows[r]
                        for (c in 0 until 7) {
                            if ((bits shr (6 - c)) and 1 != 0) {
                                uList += cursorU + (c + 0.5f) * dotPitch
                                vList += (r + 0.5f) * dotPitch
                                bList += 0.92f + 0.08f * hash(glyphIdx * 64 + r * 8 + c, 733)
                            }
                        }
                    }
                    cursorU += 7f * dotPitch
                    glyphIdx++
                }
            }
            if (ti + 1 < tokens.size) cursorU += groupGap
        }

        return StampDots(
            u0 = u0,
            v0 = v0,
            totalU = totalU,
            charH = charH,
            dotR = dotR,
            soft = soft,
            reach = reach,
            haloInv = haloInv,
            dotU = uList.toFloatArray(),
            dotV = vList.toFloatArray(),
            dotBright = bList.toFloatArray(),
        )
    }

    private fun sampleRebatePixel(
        px: Int,
        py: Int,
        u: Float,
        v: Float,
        dots: StampDots?,
        grainCell: Float,
        monochrome: Boolean,
        out: ShortArray,
        idx: Int,
    ) {
        val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
        var r = (if (monochrome) BASE_MONO else BASE_R) * grain
        var g = (if (monochrome) BASE_MONO else BASE_G) * grain
        var b = (if (monochrome) BASE_MONO else BASE_B) * grain

        if (dots != null && dots.dotU.isNotEmpty()) {
            val lu = u - dots.u0
            val lv = v - dots.v0
            val reach = dots.reach
            if (lu >= -reach && lu <= dots.totalU + reach && lv >= -reach && lv <= dots.charH + reach) {
                var core = 0f
                var minDist = Float.MAX_VALUE
                val dotU = dots.dotU
                val dotV = dots.dotV
                val dotBright = dots.dotBright
                val dotR = dots.dotR
                val soft = dots.soft
                for (k in dotU.indices) {
                    val du = abs(lu - dotU[k])
                    if (du > reach) continue
                    val dv = abs(lv - dotV[k])
                    if (dv > reach) continue
                    val d = sqrt(du * du + dv * dv) - dotR
                    if (d < minDist) minDist = d
                    if (d < soft * 0.5f) {
                        val e = dotBright[k] * edge(d, soft)
                        if (e > core) core = e
                    }
                }
                val excess = minDist.coerceAtLeast(0f) * dots.haloInv
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
        }

        out[idx] = toU16Short(r)
        out[idx + 1] = toU16Short(g)
        out[idx + 2] = toU16Short(b)
    }

    /**
     * Renders rows `[bandY, bandY + bandRows)` of the top padding (`0 <= bandY < layout.topPad`) into [band].
     * For portrait/square photos this is the top shoot-info rebate bar; for landscape photos this is the thin top border
     * (whose left `infoBar` columns belong to the vertical shoot-info rebate bar).
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
        val outH = layout.outHeight
        val grainCell = maxOf(1f, layout.infoBar * 0.03f)
        val dots = buildStampDots(layout, info)
        val onLeft = layout.infoOnLeft

        for (py in bandY until bandY + bandRows) {
            val rowOffset = (py - bandY) * outW
            for (px in 0 until outW) {
                val idx = (rowOffset + px) * 3
                if (!onLeft) {
                    sampleRebatePixel(px, py, px + 0.5f, py + 0.5f, dots, grainCell, monochrome, band, idx)
                } else if (px < layout.infoBar) {
                    sampleRebatePixel(px, py, (outH - 1 - py) + 0.5f, px + 0.5f, dots, grainCell, monochrome, band, idx)
                } else {
                    sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, band, idx)
                }
            }
        }
    }

    /** Fills [band] (`outWidth * bandRows * 3`) with dark film-base black for the bottom border. */
    fun renderBorderBand(
        band: ShortArray,
        layout: Layout,
        bandY: Int,
        bandRows: Int,
        monochrome: Boolean = false,
        info: Pentax645Info? = null,
    ) {
        val outW = layout.outWidth
        val outH = layout.outHeight
        val grainCell = maxOf(1f, layout.infoBar * 0.03f)
        val onLeft = layout.infoOnLeft
        val dots = if (onLeft && info != null) buildStampDots(layout, info) else null
        for (py in bandY until bandY + bandRows) {
            val rowOffset = (py - bandY) * outW
            for (px in 0 until outW) {
                val idx = (rowOffset + px) * 3
                if (dots != null && px < layout.infoBar) {
                    sampleRebatePixel(px, py, (outH - 1 - py) + 0.5f, px + 0.5f, dots, grainCell, monochrome, band, idx)
                } else {
                    sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, band, idx)
                }
            }
        }
    }

    /**
     * Wraps a developed photo band [src] (`photoWidth * bandRows * 3`) into [dst] (`outWidth * bandRows * 3`),
     * adding left/right rebate strips and rounding the inner corners of the photo gate (with generous rounded corners
     * where the photo meets the Pentax 645 black stripe).
     */
    fun wrapPhotoBand(
        src: ShortArray,
        dst: ShortArray,
        layout: Layout,
        photoY: Int,
        bandRows: Int,
        monochrome: Boolean = false,
        info: Pentax645Info? = null,
    ) {
        val pw = layout.photoWidth
        val ph = layout.photoHeight
        val ow = layout.outWidth
        val oh = layout.outHeight
        val leftPad = layout.leftPad
        val onLeft = layout.infoOnLeft
        val grainCell = maxOf(1f, layout.infoBar * 0.03f)
        val dots = if (onLeft && info != null) buildStampDots(layout, info) else null

        val br = if (monochrome) BASE_MONO else BASE_R
        val bg = if (monochrome) BASE_MONO else BASE_G
        val bb = if (monochrome) BASE_MONO else BASE_B

        // Generous rounded corners on the black data-stripe side (like Pentax 645 film gate), subtle on opposite corners.
        val rStripe = layout.infoBar * 0.65f
        val rOther = layout.infoBar * 0.30f
        val rTopLeft = rStripe
        val rTopRight = if (onLeft) rOther else rStripe
        val rBottomLeft = if (onLeft) rStripe else rOther
        val rBottomRight = rOther
        val maxR = maxOf(rTopLeft, rTopRight, rBottomLeft, rBottomRight)

        for (r in 0 until bandRows) {
            val y = photoY + r
            val py = layout.topPad + y
            val dstRow = r * ow
            for (px in 0 until leftPad) {
                val idx = (dstRow + px) * 3
                if (dots != null) {
                    sampleRebatePixel(px, py, (oh - 1 - py) + 0.5f, px + 0.5f, dots, grainCell, monochrome, dst, idx)
                } else {
                    sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, dst, idx)
                }
            }
            System.arraycopy(src, r * pw * 3, dst, (dstRow + leftPad) * 3, pw * 3)
            for (px in (leftPad + pw) until ow) {
                val idx = (dstRow + px) * 3
                sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, dst, idx)
            }

            // Apply rounded film-gate corners to the photo rows near the top or bottom edge.
            val dyTop = y + 0.5f
            val dyBottom = (ph - y) - 0.5f
            if (dyTop < maxR || dyBottom < maxR) {
                for (x in 0 until pw) {
                    val dxLeft = x + 0.5f
                    val dxRight = (pw - x) - 0.5f
                    if (dxLeft >= maxR && dxRight >= maxR) continue

                    val rad: Float
                    val cx: Float
                    val cy: Float
                    when {
                        dxLeft < rTopLeft && dyTop < rTopLeft -> {
                            rad = rTopLeft; cx = rTopLeft - dxLeft; cy = rTopLeft - dyTop
                        }
                        dxRight < rTopRight && dyTop < rTopRight -> {
                            rad = rTopRight; cx = rTopRight - dxRight; cy = rTopRight - dyTop
                        }
                        dxLeft < rBottomLeft && dyBottom < rBottomLeft -> {
                            rad = rBottomLeft; cx = rBottomLeft - dxLeft; cy = rBottomLeft - dyBottom
                        }
                        dxRight < rBottomRight && dyBottom < rBottomRight -> {
                            rad = rBottomRight; cx = rBottomRight - dxRight; cy = rBottomRight - dyBottom
                        }
                        else -> continue
                    }
                    val d = sqrt(cx * cx + cy * cy) - rad
                    if (d <= -0.6f) continue
                    val t = ((d + 0.6f) / 1.2f).coerceIn(0f, 1f)
                    val mask = t * t * (3f - 2f * t) // 0 = photo, 1 = black corner rebate
                    val px = leftPad + x
                    val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                    val idx = (dstRow + px) * 3
                    val pr = (dst[idx].toInt() and 0xFFFF) / 65535f
                    val pg = (dst[idx + 1].toInt() and 0xFFFF) / 65535f
                    val pb = (dst[idx + 2].toInt() and 0xFFFF) / 65535f
                    dst[idx] = toU16Short(pr * (1f - mask) + br * grain * mask)
                    dst[idx + 1] = toU16Short(pg * (1f - mask) + bg * grain * mask)
                    dst[idx + 2] = toU16Short(pb * (1f - mask) + bb * grain * mask)
                }
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
        'S' -> intArrayOf(0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110)
        'V' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100)
        'W' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001)
        'm' -> intArrayOf(0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001)
        's' -> intArrayOf(0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110)
        '/' -> intArrayOf(0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000)
        '.' -> intArrayOf(0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100)
        ':' -> intArrayOf(0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000)
        '\'' -> intArrayOf(0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000)
        '#' -> intArrayOf(0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010)
        '+' -> intArrayOf(0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000)
        '-' -> intArrayOf(0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000)
        '±' -> intArrayOf(0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000, 0b11111)
        else -> null
    }
}
