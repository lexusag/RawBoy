package app.rawboy.develop

/**
 * The frame overlay (`uFrame`, shaders/develop.glsl `applyFrame`): a plain solid border drawn inside the output
 * picture, so the export keeps its size. [DevelopParams.frame] is its thickness in % of the short side (0 = off),
 * [DevelopParams.frameColor] its colour as `#rrggbb` (display sRGB). Mirrored in web's Frame.ts and Swift's Frame.swift.
 */
object Frame {
    const val MAX = 20f
    const val DEFAULT_COLOR = "#000000"

    /** The colours the pickers offer; any `#rrggbb` in a preset or edit works too. */
    val COLORS: List<Pair<String, String>> = listOf(
        "Black" to "#000000",
        "White" to "#ffffff",
        "Cream" to "#f1ead8",
        "Grey" to "#808080",
    )

    /** `#rrggbb` (or `rrggbb`) as 0..1 sRGB, or black for anything else. */
    fun rgb(hex: String): FloatArray {
        val h = hex.trim().removePrefix("#")
        if (h.length != 6) return floatArrayOf(0f, 0f, 0f)
        val v = h.toIntOrNull(16) ?: return floatArrayOf(0f, 0f, 0f)
        return floatArrayOf(((v shr 16) and 255) / 255f, ((v shr 8) and 255) / 255f, (v and 255) / 255f)
    }

    /** [hex] when it is a valid `#rrggbb`, lower case, else null. */
    fun normalize(hex: String?): String? {
        val h = hex?.trim()?.removePrefix("#") ?: return null
        if (h.length != 6 || h.toIntOrNull(16) == null) return null
        return "#" + h.lowercase()
    }

    /** Border thickness in output pixels for a picture [width] x [height]. */
    fun thicknessPx(percent: Float, width: Int, height: Int): Float =
        percent.coerceIn(0f, MAX) / 100f * minOf(width, height)
}
