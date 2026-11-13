package app.rawboy.export

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * Imprints a classic 35mm film data-back date stamp (`'YY MM DD`) in the bottom-right corner of an exported image,
 * using a slanted 7-segment clock font in yellowy-orange with a subtle warm orange halo.
 */
object DateStamp {

    /**
     * Formats [timeMs] in classic film date-back order: `'YY MM DD` (for example `'26 11 13`).
     */
    fun format(timeMs: Long, timeZone: TimeZone = TimeZone.getDefault()): String {
        val cal = Calendar.getInstance(timeZone).apply { timeInMillis = timeMs }
        val year = cal.get(Calendar.YEAR) % 100
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        return String.format(Locale.US, "'%02d %02d %02d", year, month, day)
    }

    /**
     * Burns [text] into the 16-bit interleaved RGB [band] covering rows `[bandY, bandY + bandRows)` of an image of
     * size [width] x [height]. Bands outside the bottom-right stamp box return immediately.
     */
    fun imprint(band: ShortArray, width: Int, height: Int, bandY: Int, bandRows: Int, text: String) {
        if (text.isEmpty() || width <= 0 || height <= 0 || bandRows <= 0) return

        val shortSide = minOf(width, height).toFloat()
        val charH = (shortSide * 0.028f).coerceAtLeast(14f)
        val charW = charH * 0.56f
        val thick = charH * 0.13f
        val gap = charH * 0.24f
        val tickAdv = charW * 0.35f
        val digitAdv = charW

        val count = text.length
        val cellX = FloatArray(count)
        val cellW = FloatArray(count)
        val masks = IntArray(count)
        val isTick = BooleanArray(count)

        var cursorX = 0f
        for (i in 0 until count) {
            val ch = text[i]
            val adv = if (ch == '\'') tickAdv else digitAdv
            cellX[i] = cursorX
            cellW[i] = adv
            isTick[i] = ch == '\''
            masks[i] = segmentMask(ch)
            cursorX += adv + if (i + 1 < count) gap else 0f
        }
        val totalW = cursorX

        val marginRight = shortSide * 0.055f
        val marginBottom = shortSide * 0.050f
        val x0 = width - marginRight - totalW
        val y0 = height - marginBottom - charH
        val glowRadius = thick * 1.6f
        val slant = 0.14f
        val slantMaxShift = charH * 0.5f * slant

        val minY = (y0 - glowRadius).toInt().coerceAtLeast(0)
        val maxY = (y0 + charH + glowRadius).toInt().coerceAtMost(height - 1)
        if (bandY + bandRows <= minY || bandY > maxY) return

        val minX = (x0 - glowRadius - slantMaxShift).toInt().coerceAtLeast(0)
        val maxX = (x0 + totalW + glowRadius + slantMaxShift).toInt().coerceAtMost(width - 1)
        if (minX > maxX) return

        val rowStart = maxOf(bandY, minY)
        val rowEnd = minOf(bandY + bandRows - 1, maxY)
        val segGap = thick * 0.58f
        val halfH = charH * 0.5f
        val halfThick = thick * 0.5f
        val aa = 1.2f
        val glowInvSigma = 1f / (thick * 0.65f)
        val cullDistance = halfThick + aa * 0.5f + glowRadius

        for (py in rowStart..rowEnd) {
            val vy = (py + 0.5f) - y0
            val slantOffset = (halfH - vy) * slant
            val rowOffset = (py - bandY) * width
            for (px in minX..maxX) {
                val ux = (px + 0.5f) - x0 - slantOffset
                var minDist = Float.MAX_VALUE
                for (i in 0 until count) {
                    val m = masks[i]
                    val tick = isTick[i]
                    if (m == 0 && !tick) continue
                    val cx = cellX[i]
                    val cw = cellW[i]
                    if (ux < cx - cullDistance || ux > cx + cw + cullDistance) continue
                    val lx = ux - cx
                    val d = if (tick) {
                        distToSegment(lx, vy, cw * 0.5f, charH * 0.04f, cw * 0.5f, charH * 0.38f)
                    } else {
                        distToDigitSegments(lx, vy, cw, charH, halfH, segGap, m)
                    }
                    if (d < minDist) minDist = d
                }

                val tCore = ((halfThick + aa * 0.5f - minDist) / aa).coerceIn(0f, 1f)
                val core = tCore * tCore * (3f - 2f * tCore)
                val excess = (minDist - halfThick).coerceAtLeast(0f)
                val tGlow = excess * glowInvSigma
                val glow = 0.38f * exp(-tGlow * tGlow)
                if (core <= 0f && glow < 0.005f) continue

                val idx = (rowOffset + px) * 3
                val r = (band[idx].toInt() and 0xFFFF) / 65535f
                val g = (band[idx + 1].toInt() and 0xFFFF) / 65535f
                val b = (band[idx + 2].toInt() and 0xFFFF) / 65535f

                // Warm orange halo screen-blended on red/green with subtle blue absorption so it reads on bright areas too.
                val r1 = 1f - (1f - r) * (1f - glow)
                val g1 = 1f - (1f - g) * (1f - glow * 0.45f)
                val b1 = b * (1f - glow * 0.40f) + 0.02f * glow

                val alpha = core * 0.94f
                val rOut = r1 + (1.00f - r1) * alpha
                val gOut = g1 + (0.72f - g1) * alpha
                val bOut = b1 + (0.10f - b1) * alpha

                band[idx] = toU16Short(rOut)
                band[idx + 1] = toU16Short(gOut)
                band[idx + 2] = toU16Short(bOut)
            }
        }
    }

    private fun segmentMask(ch: Char): Int = when (ch) {
        '0' -> 0x3F
        '1' -> 0x06
        '2' -> 0x5B
        '3' -> 0x4F
        '4' -> 0x66
        '5' -> 0x6D
        '6' -> 0x7D
        '7' -> 0x07
        '8' -> 0x7F
        '9' -> 0x6F
        '-' -> 0x40
        else -> 0
    }

    private fun distToDigitSegments(
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        halfH: Float,
        segGap: Float,
        mask: Int,
    ): Float {
        var minD = Float.MAX_VALUE
        if ((mask and 0x01) != 0) minD = minOf(minD, distToSegment(x, y, segGap, 0f, w - segGap, 0f))
        if ((mask and 0x02) != 0) minD = minOf(minD, distToSegment(x, y, w, segGap, w, halfH - segGap * 0.5f))
        if ((mask and 0x04) != 0) minD = minOf(minD, distToSegment(x, y, w, halfH + segGap * 0.5f, w, h - segGap))
        if ((mask and 0x08) != 0) minD = minOf(minD, distToSegment(x, y, segGap, h, w - segGap, h))
        if ((mask and 0x10) != 0) minD = minOf(minD, distToSegment(x, y, 0f, halfH + segGap * 0.5f, 0f, h - segGap))
        if ((mask and 0x20) != 0) minD = minOf(minD, distToSegment(x, y, 0f, segGap, 0f, halfH - segGap * 0.5f))
        if ((mask and 0x40) != 0) minD = minOf(minD, distToSegment(x, y, segGap, halfH, w - segGap, halfH))
        return minD
    }

    private fun distToSegment(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
        val abx = bx - ax
        val aby = by - ay
        val lenSq = abx * abx + aby * aby
        if (lenSq <= 0f) return hypot(px - ax, py - ay)
        val t = (((px - ax) * abx + (py - ay) * aby) / lenSq).coerceIn(0f, 1f)
        val cx = ax + t * abx
        val cy = ay + t * aby
        return hypot(px - cx, py - cy)
    }

    private fun toU16Short(v: Float): Short =
        (v.coerceIn(0f, 1f) * 65535f).roundToInt().coerceIn(0, 65535).toShort()
}
