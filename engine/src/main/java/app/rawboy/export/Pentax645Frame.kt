package app.rawboy.export

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** LED imprint color for film rebate frames ([PhotoFrame.PENTAX_645] and [PhotoFrame.CONTAX_645]). */
enum class FilmFrameColor(val label: String) {
    AMBER("Amber"),
    SLIDE("Slide"),
    RED("Red"),
    GREEN("Green"),
}

/** Film rebate frame layout style. */
enum class FilmFrameStyle {
    PENTAX_645,
    CONTAX_645,
}

/**
 * Shoot metadata imprinted into the film rebate of a Pentax 645 or Contax 645-style frame.
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
    val date: String? = null,
    val time: String? = null,
    val dateTime: String? = null,
    val flipped: Boolean = false,
    val fieldOrder: List<String>? = null,
    val color: FilmFrameColor = FilmFrameColor.AMBER,
    val style: FilmFrameStyle = FilmFrameStyle.PENTAX_645,
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
        val style: FilmFrameStyle = FilmFrameStyle.PENTAX_645,
    ) {
        /** True when the photo is landscape (`photoWidth > photoHeight`), so the shorter side is vertical (left/right edges). */
        val infoOnLeft: Boolean get() = photoWidth > photoHeight
        val topPad: Int get() = if (style == FilmFrameStyle.CONTAX_645 && !infoOnLeft) infoBar else border
        val bottomPad: Int get() = if (style == FilmFrameStyle.CONTAX_645 && !infoOnLeft) infoBar else border
        val leftPad: Int get() = if (style == FilmFrameStyle.CONTAX_645 && infoOnLeft) infoBar else border
        val rightPad: Int get() = if (style == FilmFrameStyle.CONTAX_645 && infoOnLeft) infoBar else border
        val outWidth: Int get() = photoWidth + leftPad + rightPad
        val outHeight: Int get() = photoHeight + topPad + bottomPad

        /** Backwards-compatible alias for tests/callers checking the rebate thickness. */
        val topBar: Int get() = infoBar
    }

    fun layout(photoWidth: Int, photoHeight: Int, style: FilmFrameStyle = FilmFrameStyle.PENTAX_645): Layout {
        val shortSide = minOf(photoWidth, photoHeight).toFloat()
        val border = when (style) {
            FilmFrameStyle.PENTAX_645 -> (shortSide * 0.005f).roundToInt().coerceAtLeast(3)
            FilmFrameStyle.CONTAX_645 -> (shortSide * 0.012f).roundToInt().coerceAtLeast(6)
        }
        val infoBar = (shortSide * 0.036f).roundToInt().coerceAtLeast(28)
        return Layout(photoWidth, photoHeight, border, infoBar, style)
    }

    fun formatFrameNumber(frameNumber: Int): String =
        if (frameNumber > 0) "#$frameNumber" else "#--"

    fun formatContaxFrameNumber(frameNumber: Int): String =
        if (frameNumber > 0) "$frameNumber" else "--"

    fun formatShutter(t: Double): String {
        if (!t.isFinite() || t <= 0.0) return "---"
        return if (t >= 0.95) "${trimOneDecimal(t)}s" else "1/${(1.0 / t).roundToInt()}"
    }

    fun formatContaxShutter(t: Double): String {
        if (!t.isFinite() || t <= 0.0) return "---"
        return if (t >= 0.95) "${trimOneDecimal(t)}s" else "${(1.0 / t).roundToInt()}"
    }

    fun formatAperture(f: Double): String {
        if (!f.isFinite() || f <= 0.0) return "F--"
        val rounded = f.roundToInt()
        return if (abs(f - rounded) < 0.05 && rounded < 10) "F $rounded" else "F${trimOneDecimal(f)}"
    }

    fun formatContaxAperture(f: Double): String {
        if (!f.isFinite() || f <= 0.0) return "F--"
        return "F ${trimOneDecimal(f)}"
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

    private val MONTHS = arrayOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

    fun formatDate(
        timeMs: Long,
        format: DateStampFormat = DateStampFormat.DMY,
        timeZone: TimeZone = TimeZone.getDefault(),
    ): String {
        val cal = Calendar.getInstance(timeZone).apply { timeInMillis = timeMs }
        val year = cal.get(Calendar.YEAR) % 100
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        return when (format) {
            DateStampFormat.DMY -> String.format(Locale.US, "%02d.%02d.%02d", day, month, year)
            DateStampFormat.YMD -> String.format(Locale.US, "%02d.%02d.%02d", year, month, day)
            DateStampFormat.MDY -> String.format(Locale.US, "%02d.%02d.%02d", month, day, year)
            DateStampFormat.MMM_YY -> String.format(Locale.US, "%s %02d", MONTHS[(month - 1).coerceIn(0, 11)], year)
        }
    }

    fun formatTime(
        timeMs: Long,
        format: TimeStampFormat = TimeStampFormat.H24,
        timeZone: TimeZone = TimeZone.getDefault(),
    ): String {
        val cal = Calendar.getInstance(timeZone).apply { timeInMillis = timeMs }
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        val minute = cal.get(Calendar.MINUTE)
        return when (format) {
            TimeStampFormat.H24 -> String.format(Locale.US, "%02d:%02d", hour, minute)
            TimeStampFormat.H12 -> {
                val h12 = when (val h = hour % 12) {
                    0 -> 12
                    else -> h
                }
                val ampm = if (hour < 12) "AM" else "PM"
                String.format(Locale.US, "%d:%02d%s", h12, minute, ampm)
            }
        }
    }

    fun formatDateTime(
        timeMs: Long,
        format: DateStampFormat = DateStampFormat.DMY,
        timeZone: TimeZone = TimeZone.getDefault(),
        timeFormat: TimeStampFormat = TimeStampFormat.H24,
    ): String = "${formatDate(timeMs, format, timeZone)} ${formatTime(timeMs, timeFormat, timeZone)}"

    private fun trimOneDecimal(v: Double): String {
        val s = String.format(Locale.ROOT, "%.1f", v)
        return if (s.endsWith(".0")) s.dropLast(2) else s
    }

    private fun ledRgb(color: FilmFrameColor): Triple<Float, Float, Float> = when (color) {
        FilmFrameColor.AMBER -> Triple(1.0f, 0.44f, 0.04f)
        FilmFrameColor.SLIDE -> Triple(0.76f, 0.90f, 0.14f)
        FilmFrameColor.RED -> Triple(1.0f, 0.13f, 0.05f)
        FilmFrameColor.GREEN -> Triple(0.08f, 0.95f, 0.08f)
    }

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
        data object Triangle : Token
    }

    private fun charCols(ch: Char): Int = when (ch) {
        '.', ':', '\'', ' ' -> 3
        else -> 5
    }

    private val DEFAULT_FIELD_ORDER = listOf(
        "frame", "mode", "shutter", "aperture", "ev", "metering", "focal", "iso", "date", "time", "datetime",
    )

    private class StampDots(
        val u0: Float,
        val v0: Float,
        val totalU: Float,
        val charH: Float,
        val dotR: Float,
        val soft: Float,
        val reach: Float,
        val haloInv: Float,
        val flipped: Boolean,
        val dotU: FloatArray,
        val dotV: FloatArray,
        val dotBright: FloatArray,
    )

    private fun buildStampDots(layout: Layout, info: Pentax645Info): StampDots {
        val barLength = (if (layout.infoOnLeft) layout.outHeight else layout.outWidth).toFloat()
        val photoShortSide = minOf(layout.photoWidth, layout.photoHeight).toFloat()
        val infoBar = layout.infoBar.toFloat()
        val isContax = info.style == FilmFrameStyle.CONTAX_645

        val order = if (info.fieldOrder.isNullOrEmpty()) {
            DEFAULT_FIELD_ORDER
        } else {
            info.fieldOrder + DEFAULT_FIELD_ORDER.filter { it !in info.fieldOrder }
        }
        val tokens = buildList {
            for (key in order) {
                when (key) {
                    // Contax 645 places the frame number in the bottom bar with a triangle.
                    "frame" -> if (!isContax) info.frameNumber?.let { add(Token.Text(formatFrameNumber(it))) }
                    "mode" -> info.mode?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
                    "shutter" -> info.exposureTime?.let {
                        add(Token.Text(if (isContax) formatContaxShutter(it) else formatShutter(it)))
                    }
                    "aperture" -> info.fNumber?.let {
                        add(Token.Text(if (isContax) formatContaxAperture(it) else formatAperture(it)))
                    }
                    "ev" -> info.compensationEv?.let { add(Token.Text(formatEv(it))) }
                    "metering" -> info.spotMetered?.let { add(Token.Metering(it)) }
                    "focal" -> info.focalLengthMm?.let { add(Token.Text(formatFocalLength(it))) }
                    "iso" -> info.iso?.let { add(Token.Text(formatIso(it))) }
                    "date" -> info.date?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
                    "time" -> info.time?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
                    "datetime" -> info.dateTime?.takeIf { it.isNotEmpty() }?.let { add(Token.Text(it)) }
                }
            }
        }

        val vTop = if (isContax) 0f else layout.border.toFloat()
        return buildDotsFromTokens(tokens, barLength, photoShortSide, infoBar, vTop, info.flipped)
    }

    private fun buildContaxBottomDots(layout: Layout, info: Pentax645Info): StampDots? {
        val frameNum = info.frameNumber ?: return null
        val barLength = (if (layout.infoOnLeft) layout.outHeight else layout.outWidth).toFloat()
        val photoShortSide = minOf(layout.photoWidth, layout.photoHeight).toFloat()
        val infoBar = layout.infoBar.toFloat()
        val tokens = listOf(Token.Triangle, Token.Text(formatContaxFrameNumber(frameNum)))
        return buildDotsFromTokens(
            tokens = tokens,
            barLength = barLength,
            photoShortSide = photoShortSide,
            infoBar = infoBar,
            vTop = 0f,
            flipped = info.flipped,
            maxGroupGapMul = 2.2f,
        )
    }

    private fun buildDotsFromTokens(
        tokens: List<Token>,
        barLength: Float,
        photoShortSide: Float,
        infoBar: Float,
        vTop: Float,
        flipped: Boolean,
        maxGroupGapMul: Float = 14f,
    ): StampDots {
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
            is Token.Triangle -> 6f * dotPitch
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

        // Give wider spacing between items when fewer items are selected, up to maxGroupGapMul * dotPitch.
        val groupGap = if (tokens.size <= 1) {
            0f
        } else {
            val targetSpan = (photoShortSide * 0.86f).coerceAtMost(maxContentW)
            val idealGap = (targetSpan - sumTokensW) / (tokens.size - 1)
            idealGap.coerceIn(minGroupGap.coerceAtMost(dotPitch * maxGroupGapMul), dotPitch * maxGroupGapMul)
        }

        val totalU = if (tokens.isEmpty()) 0f else sumTokensW + (tokens.size - 1) * groupGap
        val u0 = (barLength - totalU) * 0.5f
        val v0 = vTop + (infoBar - charH) * 0.5f

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
                is Token.Triangle -> {
                    for (r in 0 until 7) {
                        val bits = TRIANGLE_7X6[r]
                        for (c in 0 until 6) {
                            if ((bits shr (5 - c)) and 1 != 0) {
                                uList += cursorU + (c + 0.5f) * dotPitch
                                vList += (r + 0.5f) * dotPitch
                                bList += 0.92f + 0.08f * hash(glyphIdx * 64 + r * 8 + c, 733)
                            }
                        }
                    }
                    cursorU += 6f * dotPitch
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
            flipped = flipped,
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
        color: FilmFrameColor,
        out: ShortArray,
        idx: Int,
    ) {
        val grain = 0.90f + 0.20f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
        var r = (if (monochrome) BASE_MONO else BASE_R) * grain
        var g = (if (monochrome) BASE_MONO else BASE_G) * grain
        var b = (if (monochrome) BASE_MONO else BASE_B) * grain

        if (dots != null && dots.dotU.isNotEmpty()) {
            val rawLu = u - dots.u0
            val rawLv = v - dots.v0
            val lu = if (dots.flipped) dots.totalU - rawLu else rawLu
            val lv = if (dots.flipped) dots.charH - rawLv else rawLv
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
                        val (ledR, ledG, ledB) = ledRgb(color)
                        val lr = 1f - exp(-GAIN * e * ledR)
                        val lg = 1f - exp(-GAIN * e * ledG)
                        val lb = 1f - exp(-GAIN * e * ledB)
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
     * Renders rows `[bandY, bandY + bandRows)` of the top border (`0 <= bandY < layout.topPad`) into [band].
     * In [FilmFrameStyle.PENTAX_645], the black data stripe itself is composited in [wrapPhotoBand] so its rounded
     * ends reveal the photo corners underneath. In [FilmFrameStyle.CONTAX_645], the top rebate carries the shoot info.
     */
    fun renderTopBarBand(
        band: ShortArray,
        layout: Layout,
        bandY: Int,
        bandRows: Int,
        info: Pentax645Info,
        monochrome: Boolean = false,
    ) {
        if (layout.style == FilmFrameStyle.CONTAX_645 && !layout.infoOnLeft) {
            val outW = layout.outWidth
            val grainCell = maxOf(1f, layout.infoBar * 0.03f)
            val dots = buildStampDots(layout, info)
            for (py in bandY until bandY + bandRows) {
                val rowOffset = (py - bandY) * outW
                for (px in 0 until outW) {
                    val idx = (rowOffset + px) * 3
                    sampleRebatePixel(px, py, px + 0.5f, py + 0.5f, dots, grainCell, monochrome, info.color, band, idx)
                }
            }
        } else {
            renderBorderBand(band, layout, bandY, bandRows, monochrome, info)
        }
    }

    /** Fills [band] (`outWidth * bandRows * 3`) with dark film-base black for the top/bottom border (and Contax bottom frame number). */
    fun renderBorderBand(
        band: ShortArray,
        layout: Layout,
        bandY: Int,
        bandRows: Int,
        monochrome: Boolean = false,
        info: Pentax645Info? = null,
    ) {
        val outW = layout.outWidth
        val grainCell = maxOf(1f, layout.infoBar * 0.03f)
        val bottomStart = layout.topPad + layout.photoHeight
        val isContaxBottom = layout.style == FilmFrameStyle.CONTAX_645 && !layout.infoOnLeft && bandY >= bottomStart
        val dots = if (isContaxBottom && info != null) buildContaxBottomDots(layout, info) else null
        val color = info?.color ?: FilmFrameColor.AMBER
        for (py in bandY until bandY + bandRows) {
            val rowOffset = (py - bandY) * outW
            val v = if (isContaxBottom) (py - bottomStart) + 0.5f else 0f
            for (px in 0 until outW) {
                val idx = (rowOffset + px) * 3
                sampleRebatePixel(px, py, px + 0.5f, v, dots, grainCell, monochrome, color, band, idx)
            }
        }
    }

    /**
     * Wraps a developed photo band [src] (`photoWidth * bandRows * 3`) into [dst] (`outWidth * bandRows * 3`),
     * adding thin dark rebate borders on all sides and (for [FilmFrameStyle.PENTAX_645]) compositing the black data
     * stripe along the shorter edge (`y < infoBar` for portrait/square, `x < infoBar` for landscape) with convex
     * rounded ends so the photo wraps naturally into the corners.
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
        val infoBar = layout.infoBar.toFloat()
        val cornerSpan = infoBar * 1.6f
        val grainCell = maxOf(1f, infoBar * 0.03f)
        val color = info?.color ?: FilmFrameColor.AMBER
        val isPentax = layout.style == FilmFrameStyle.PENTAX_645
        val isContaxVertical = !isPentax && onLeft
        val dots = if (isPentax || isContaxVertical) info?.let { buildStampDots(layout, it) } else null
        val contaxRightDots = if (isContaxVertical) info?.let { buildContaxBottomDots(layout, it) } else null
        val softEdge = maxOf(1.6f, infoBar * 0.055f)
        val tmp = ShortArray(3)

        for (r in 0 until bandRows) {
            val y = photoY + r
            val py = layout.topPad + y
            val dstRow = r * ow
            for (px in 0 until leftPad) {
                val u = if (isContaxVertical) (oh - 1 - py) + 0.5f else 0f
                val v = if (isContaxVertical) px + 0.5f else 0f
                sampleRebatePixel(px, py, u, v, if (isContaxVertical) dots else null, grainCell, monochrome, color, dst, (dstRow + px) * 3)
            }
            System.arraycopy(src, r * pw * 3, dst, (dstRow + leftPad) * 3, pw * 3)
            for (px in (leftPad + pw) until ow) {
                val u = if (isContaxVertical) (oh - 1 - py) + 0.5f else 0f
                val v = if (isContaxVertical) (px - (leftPad + pw)) + 0.5f else 0f
                sampleRebatePixel(px, py, u, v, contaxRightDots, grainCell, monochrome, color, dst, (dstRow + px) * 3)
            }

            if (!isPentax) {
                val gateInset = maxOf(2f, infoBar * 0.11f)
                val sideInset = maxOf(1.2f, infoBar * 0.045f)
                val cornerR = maxOf(2f, infoBar * 0.10f)
                val yc = y + 0.5f
                val isTop = yc < ph * 0.5f
                val yFromEdge = if (isTop) yc else (ph - yc)
                val horizDepthLimit = if (isContaxVertical) sideInset else gateInset
                val vertDepthLimit = if (isContaxVertical) gateInset else sideInset
                val nearHorizEdge = yFromEdge < horizDepthLimit * 1.8f + softEdge + cornerR
                val sideSpan = minOf(pw / 2, (vertDepthLimit * 2.2f + softEdge + cornerR).toInt() + 1)

                fun contaxEdgeMask(x: Int): Float {
                    val xc = x + 0.5f
                    val isLeft = xc < pw * 0.5f
                    val xFromEdge = if (isLeft) xc else (pw - xc)
                    val cornerSeed = (if (isTop) 0 else 2) + (if (isLeft) 0 else 1)

                    var mask = 0f
                    if (nearHorizEdge) {
                        if (!isContaxVertical) {
                            val cutoutEnd = infoBar * (1.15f + 0.35f * hash(cornerSeed, 101))
                            val ramp = infoBar * (0.28f + 0.12f * hash(cornerSeed, 202))
                            val t = ((xFromEdge - cutoutEnd) / ramp).coerceIn(0f, 1f)
                            val cutoutDepth = sideInset * (0.85f + 0.25f * gateImperfection(xc, infoBar, cornerSeed * 17 + 11))
                            val baseDepth = cutoutDepth + (gateInset - cutoutDepth) * t * t * (3f - 2f * t)
                            val wobble = gateImperfection(xc, infoBar, cornerSeed * 17 + 7) * gateInset * 0.22f * t
                            val edgeDepth = (baseDepth + wobble).coerceAtLeast(0f)
                            mask = maxOf(mask, gateMask(yFromEdge - edgeDepth, softEdge))
                        } else {
                            val horizSeed = if (isTop) 31 else 53
                            val horizDepth = (sideInset * (0.85f + 0.25f * gateImperfection(xc, infoBar, horizSeed))).coerceAtLeast(0f)
                            mask = maxOf(mask, gateMask(yFromEdge - horizDepth, softEdge))
                        }
                    }

                    if (xFromEdge < sideSpan) {
                        if (isContaxVertical) {
                            val cutoutEnd = infoBar * (1.15f + 0.35f * hash(cornerSeed, 101))
                            val ramp = infoBar * (0.28f + 0.12f * hash(cornerSeed, 202))
                            val t = ((yFromEdge - cutoutEnd) / ramp).coerceIn(0f, 1f)
                            val cutoutDepth = sideInset * (0.85f + 0.25f * gateImperfection(yc, infoBar, cornerSeed * 17 + 11))
                            val baseDepth = cutoutDepth + (gateInset - cutoutDepth) * t * t * (3f - 2f * t)
                            val wobble = gateImperfection(yc, infoBar, cornerSeed * 17 + 7) * gateInset * 0.22f * t
                            val edgeDepth = (baseDepth + wobble).coerceAtLeast(0f)
                            mask = maxOf(mask, gateMask(xFromEdge - edgeDepth, softEdge))
                        } else {
                            val sideSeed = if (isLeft) 31 else 53
                            val sideDepth = (sideInset * (0.85f + 0.25f * gateImperfection(yc, infoBar, sideSeed))).coerceAtLeast(0f)
                            mask = maxOf(mask, gateMask(xFromEdge - sideDepth, softEdge))
                        }

                        if (yFromEdge < cornerR && xFromEdge < cornerR) {
                            val dx = cornerR - xFromEdge
                            val dy = cornerR - yFromEdge
                            val cornerDist = cornerR - sqrt(dx * dx + dy * dy)
                            mask = maxOf(mask, gateMask(cornerDist, softEdge))
                        }
                    }
                    return mask
                }

                if (nearHorizEdge) {
                    for (x in 0 until pw) {
                        val mask = contaxEdgeMask(x)
                        if (mask <= 0.001f) continue
                        val px = leftPad + x
                        val idx = (dstRow + px) * 3
                        sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, color, tmp, 0)
                        blendPixel(dst, idx, tmp, mask)
                    }
                } else {
                    for (x in 0 until sideSpan) {
                        val mask = contaxEdgeMask(x)
                        if (mask > 0.001f) {
                            val px = leftPad + x
                            val idx = (dstRow + px) * 3
                            sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, color, tmp, 0)
                            blendPixel(dst, idx, tmp, mask)
                        }
                    }
                    for (x in maxOf(sideSpan, pw - sideSpan) until pw) {
                        val mask = contaxEdgeMask(x)
                        if (mask > 0.001f) {
                            val px = leftPad + x
                            val idx = (dstRow + px) * 3
                            sampleRebatePixel(px, py, 0f, 0f, null, grainCell, monochrome, color, tmp, 0)
                            blendPixel(dst, idx, tmp, mask)
                        }
                    }
                }
                continue
            }

            if (!onLeft) {
                if (y >= layout.infoBar + softEdge.toInt() + 2) continue
                val yc = y + 0.5f
                for (x in 0 until pw) {
                    val xc = x + 0.5f
                    val distFromEnd = minOf(xc, pw - xc)
                    val edgeY = if (distFromEnd < cornerSpan) {
                        val t = distFromEnd / cornerSpan
                        infoBar * (2f * t - t * t)
                    } else {
                        infoBar
                    }
                    val mask = gateMask(yc - edgeY, softEdge)
                    if (mask <= 0.001f) continue
                    val px = leftPad + x
                    val idx = (dstRow + px) * 3
                    sampleRebatePixel(px, py, px + 0.5f, py + 0.5f, dots, grainCell, monochrome, color, tmp, 0)
                    blendPixel(dst, idx, tmp, mask)
                }
            } else {
                val yc = y + 0.5f
                val distFromEnd = minOf(yc, ph - yc)
                val edgeX = if (distFromEnd < cornerSpan) {
                    val t = distFromEnd / cornerSpan
                    infoBar * (2f * t - t * t)
                } else {
                    infoBar
                }
                val xMax = minOf(pw, (edgeX + softEdge + 1.5f).toInt())
                for (x in 0 until xMax) {
                    val mask = gateMask((x + 0.5f) - edgeX, softEdge)
                    if (mask <= 0.001f) continue
                    val px = leftPad + x
                    val idx = (dstRow + px) * 3
                    sampleRebatePixel(px, py, (oh - 1 - py) + 0.5f, px + 0.5f, dots, grainCell, monochrome, color, tmp, 0)
                    blendPixel(dst, idx, tmp, mask)
                }
            }
        }
    }

    private fun blendPixel(dst: ShortArray, idx: Int, stripe: ShortArray, mask: Float) {
        if (mask >= 0.999f) {
            dst[idx] = stripe[0]
            dst[idx + 1] = stripe[1]
            dst[idx + 2] = stripe[2]
            return
        }
        val inv = 1f - mask
        for (c in 0 until 3) {
            val p = dst[idx + c].toInt() and 0xFFFF
            val s = stripe[c].toInt() and 0xFFFF
            dst[idx + c] = (p * inv + s * mask).roundToInt().toShort()
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

    private fun gateMask(d: Float, softEdge: Float): Float {
        if (d >= softEdge) return 0f
        val t = ((softEdge - d) / (2f * softEdge)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    private fun gateImperfection(pos: Float, infoBar: Float, seed: Int): Float {
        val slow = smoothNoise1D(pos / maxOf(12f, infoBar * 1.4f), seed) - 0.5f
        val med = smoothNoise1D(pos / maxOf(5f, infoBar * 0.45f), seed + 101) - 0.5f
        return slow * 0.45f + med * 0.25f
    }

    private fun smoothNoise1D(x: Float, seed: Int): Float {
        val i = kotlin.math.floor(x.toDouble()).toInt()
        val f = x - i
        val u = f * f * (3f - 2f * f)
        return hash(i, seed) * (1f - u) + hash(i + 1, seed) * u
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

    // Filled right-pointing triangle (7x6) for Contax 645 bottom frame number.
    private val TRIANGLE_7X6 = intArrayOf(
        0b100000,
        0b111000,
        0b111110,
        0b111111,
        0b111110,
        0b111000,
        0b100000,
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
        'A' -> intArrayOf(0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001)
        'B' -> intArrayOf(0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110)
        'E' -> intArrayOf(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111)
        'F' -> intArrayOf(0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000)
        'I' -> intArrayOf(0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110)
        'K' -> intArrayOf(0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001)
        'L' -> intArrayOf(0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111)
        'M' -> intArrayOf(0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001)
        'O' -> intArrayOf(0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110)
        'P' -> intArrayOf(0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000)
        'S' -> intArrayOf(0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110)
        'V' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100)
        'W' -> intArrayOf(0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001)
        'a' -> intArrayOf(0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111)
        'b' -> intArrayOf(0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110)
        'c' -> intArrayOf(0b00000, 0b00000, 0b01110, 0b10001, 0b10000, 0b10001, 0b01110)
        'd' -> intArrayOf(0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111)
        'e' -> intArrayOf(0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110)
        'f' -> intArrayOf(0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000)
        'g' -> intArrayOf(0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110)
        'h' -> intArrayOf(0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001)
        'i' -> intArrayOf(0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110)
        'j' -> intArrayOf(0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100)
        'k' -> intArrayOf(0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010)
        'l' -> intArrayOf(0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110)
        'm' -> intArrayOf(0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001)
        'n' -> intArrayOf(0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001)
        'o' -> intArrayOf(0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110)
        'p' -> intArrayOf(0b00000, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000)
        'q' -> intArrayOf(0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001)
        'r' -> intArrayOf(0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000)
        's' -> intArrayOf(0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110)
        't' -> intArrayOf(0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110)
        'u' -> intArrayOf(0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101)
        'v' -> intArrayOf(0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100)
        'w' -> intArrayOf(0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010)
        'x' -> intArrayOf(0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001)
        'y' -> intArrayOf(0b00000, 0b10001, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110)
        'z' -> intArrayOf(0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111)
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
