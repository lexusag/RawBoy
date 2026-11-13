package app.rawboy.export

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * Imprints a 35mm film data-back date (`'YY MM DD`) in the bottom-right corner of an exported image, rendered the way
 * a quartz date back does it: orange LED segments shining through the film base onto the emulsion. So the digits are
 * light added to the picture (they show on dark areas and fade into bright ones), soft-edged (the LEDs sit behind the
 * base, out of focus), with a hot yellow core that falls off to red-orange at the fringes, a reddish halation glow,
 * slightly uneven segment brightness and grain. Same output as `DateStamp` in ios/Engine ExportSettings.swift.
 */
object DateStamp {

    /** Formats [timeMs] in classic film date-back order: `'YY MM DD` (for example `'26 11 13`). */
    fun format(timeMs: Long, timeZone: TimeZone = TimeZone.getDefault()): String {
        val cal = Calendar.getInstance(timeZone).apply { timeInMillis = timeMs }
        val year = cal.get(Calendar.YEAR) % 100
        val month = cal.get(Calendar.MONTH) + 1
        val day = cal.get(Calendar.DAY_OF_MONTH)
        return String.format(Locale.US, "'%02d %02d %02d", year, month, day)
    }

    /**
     * The LED's light as each film layer sees it, in "exposure per unit" for the response `1 - exp(-GAIN * E * c)`:
     * red saturates first, so the bright core goes yellow and the dim fringe stays red-orange (yellowy-orange overall).
     */
    private const val LED_R = 1.0f
    private const val LED_G = 0.42f
    private const val LED_B = 0.035f
    private const val GAIN = 3f

    /** How much the stamp still darkens blue where the picture is already bright, so it reads (faintly) on a sky. */
    private const val BLUE_ABSORB = 0.55f

    /**
     * Burns [text] into the 16-bit interleaved RGB [band] covering rows `[bandY, bandY + bandRows)` of an image of
     * size [width] x [height]. Bands outside the bottom-right stamp box return immediately.
     */
    fun imprint(band: ShortArray, width: Int, height: Int, bandY: Int, bandRows: Int, text: String) {
        if (text.isEmpty() || width <= 0 || height <= 0 || bandRows <= 0) return

        val shortSide = minOf(width, height).toFloat()
        val charH = (shortSide * 0.028f).coerceAtLeast(14f)
        val charW = charH * 0.56f
        val thick = charH * 0.14f
        val gap = charH * 0.24f
        val tickAdv = charW * 0.35f

        val count = text.length
        val cellX = FloatArray(count)
        val cellW = FloatArray(count)
        val masks = IntArray(count)
        val isTick = BooleanArray(count)
        var cursorX = 0f
        for (i in 0 until count) {
            val ch = text[i]
            val adv = if (ch == '\'') tickAdv else charW
            cellX[i] = cursorX
            cellW[i] = adv
            isTick[i] = ch == '\''
            masks[i] = segmentMask(ch)
            cursorX += adv + if (i + 1 < count) gap else 0f
        }
        val totalW = cursorX

        val x0 = width - shortSide * 0.055f - totalW
        val y0 = height - shortSide * 0.050f - charH
        val reach = thick * 3f // the halation's extent
        val slant = 0.14f
        val slantMaxShift = charH * 0.5f * slant

        val minY = (y0 - reach).toInt().coerceAtLeast(0)
        val maxY = (y0 + charH + reach).toInt().coerceAtMost(height - 1)
        if (bandY + bandRows <= minY || bandY > maxY) return
        val minX = (x0 - reach - slantMaxShift).toInt().coerceAtLeast(0)
        val maxX = (x0 + totalW + reach + slantMaxShift).toInt().coerceAtMost(width - 1)
        if (minX > maxX) return

        val segGap = thick * 0.6f
        val halfH = charH * 0.5f
        val halfThick = thick * 0.5f
        // Out-of-focus LED: the segment edge is a soft ramp, not a pixel-sharp line.
        val soft = maxOf(thick * 0.6f, 1f)
        val haloInv = 1f / (thick * 1.3f)
        val grainCell = maxOf(1f, thick * 0.22f)

        val rowStart = maxOf(bandY, minY)
        val rowEnd = minOf(bandY + bandRows - 1, maxY)
        for (py in rowStart..rowEnd) {
            val vy = (py + 0.5f) - y0
            val slantOffset = (halfH - vy) * slant
            val rowOffset = (py - bandY) * width
            for (px in minX..maxX) {
                val ux = (px + 0.5f) - x0 - slantOffset
                var core = 0f
                var minDist = Float.MAX_VALUE
                for (i in 0 until count) {
                    val m = masks[i]
                    val tick = isTick[i]
                    if (m == 0 && !tick) continue
                    val cx = cellX[i]
                    val cw = cellW[i]
                    if (ux < cx - reach || ux > cx + cw + reach) continue
                    val lx = ux - cx
                    if (tick) {
                        val d = distToSegment(lx, vy, cw * 0.5f, charH * 0.04f, cw * 0.5f, charH * 0.38f)
                        if (d < minDist) minDist = d
                        core = maxOf(core, ledBrightness(i, 7) * edge(d, halfThick, soft))
                        continue
                    }
                    for (s in 0 until 7) {
                        if ((m shr s) and 1 == 0) continue
                        val d = distToDigitSegment(s, lx, vy, cw, charH, halfH, segGap)
                        if (d < minDist) minDist = d
                        core = maxOf(core, ledBrightness(i, s) * edge(d, halfThick, soft))
                    }
                }
                val excess = (minDist - halfThick).coerceAtLeast(0f) * haloInv
                val halo = 0.35f * exp(-excess * excess)
                if (core <= 0.002f && halo < 0.004f) continue

                // Grain: the exposure varies a little from clump to clump, as it does in the emulsion.
                val grain = 0.9f + 0.2f * hash((px / grainCell).toInt(), (py / grainCell).toInt())
                val e = (core + halo * (1f - core)) * grain

                val lr = 1f - exp(-GAIN * e * LED_R)
                val lg = 1f - exp(-GAIN * e * LED_G)
                val lb = 1f - exp(-GAIN * e * LED_B)

                val idx = (rowOffset + px) * 3
                val r = (band[idx].toInt() and 0xFFFF) / 65535f
                val g = (band[idx + 1].toInt() and 0xFFFF) / 65535f
                val b = (band[idx + 2].toInt() and 0xFFFF) / 65535f
                // Light adds to the picture (screen); blue is held back where the LED is strong.
                band[idx] = toU16Short(1f - (1f - r) * (1f - lr))
                band[idx + 1] = toU16Short(1f - (1f - g) * (1f - lg))
                band[idx + 2] = toU16Short((1f - (1f - b) * (1f - lb)) * (1f - BLUE_ABSORB * lr))
            }
        }
    }

    /** Soft segment edge: 1 inside, easing to 0 across [soft] pixels around the segment's outline. */
    private fun edge(d: Float, halfThick: Float, soft: Float): Float {
        val t = ((halfThick + soft * 0.5f - d) / soft).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    /** Each LED segment is a little brighter or dimmer than the others (90-100%), the same for every photo. */
    private fun ledBrightness(char: Int, segment: Int): Float = 0.9f + 0.1f * hash(char * 8 + segment, 911)

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

    /** Distance to segment [s] (a..g = 0..6) of a digit cell [w] x [h]. */
    private fun distToDigitSegment(s: Int, x: Float, y: Float, w: Float, h: Float, halfH: Float, segGap: Float): Float =
        when (s) {
            0 -> distToSegment(x, y, segGap, 0f, w - segGap, 0f)
            1 -> distToSegment(x, y, w, segGap, w, halfH - segGap * 0.5f)
            2 -> distToSegment(x, y, w, halfH + segGap * 0.5f, w, h - segGap)
            3 -> distToSegment(x, y, segGap, h, w - segGap, h)
            4 -> distToSegment(x, y, 0f, halfH + segGap * 0.5f, 0f, h - segGap)
            5 -> distToSegment(x, y, 0f, segGap, 0f, halfH - segGap * 0.5f)
            else -> distToSegment(x, y, segGap, halfH, w - segGap, halfH)
        }

    private fun distToSegment(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
        val abx = bx - ax
        val aby = by - ay
        val lenSq = abx * abx + aby * aby
        if (lenSq <= 0f) return hypot(px - ax, py - ay)
        val t = (((px - ax) * abx + (py - ay) * aby) / lenSq).coerceIn(0f, 1f)
        return hypot(px - (ax + t * abx), py - (ay + t * aby))
    }

    /** Deterministic 0..1 hash of an integer pair (matches the Swift version bit for bit). */
    private fun hash(x: Int, y: Int): Float {
        var h = x * 374761393 + y * 668265263
        h = (h xor (h ushr 13)) * 1274126177
        h = h xor (h ushr 16)
        return (h and 0xFFFFFF) / 16777215f
    }

    private fun toU16Short(v: Float): Short = (v.coerceIn(0f, 1f) * 65535f).roundToInt().toShort()
}
