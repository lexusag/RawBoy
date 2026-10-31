package app.rawboy.color

/**
 * A colour filter for black and white (RawBoy Film's B&W mode): like a glass filter on the lens, it passes its own
 * colour and holds back the others, so they print lighter or darker once the picture is grey. Gains on linear Rec.2020
 * after white balance (rough Wratten 8 / 21 / 25 / 11 transmissions), divided by their luminance so middle grey keeps
 * its exposure, as a photographer opens up by the filter factor. Port: BwFilter.ts, BwFilter.swift.
 */
enum class BwFilter(val key: String, val label: String, private val r: Double, private val g: Double, private val b: Double) {
    NONE("none", "None", 1.0, 1.0, 1.0),
    YELLOW("yellow", "Yellow", 1.0, 0.92, 0.35),
    ORANGE("orange", "Orange", 1.0, 0.6, 0.12),
    RED("red", "Red", 1.0, 0.18, 0.03),
    GREEN("green", "Green", 0.4, 1.0, 0.35);

    /** Row-major diagonal gains, luminance-normalised; identity for [NONE]. */
    fun matrix(): DoubleArray {
        val y = LUMA_R * r + LUMA_G * g + LUMA_B * b
        return Mat3.diagonal(r / y, g / y, b / y)
    }

    companion object {
        // Rec.2020 luminance, as LUMA_REC2020 in shaders/develop.glsl.
        private const val LUMA_R = 0.2627
        private const val LUMA_G = 0.6780
        private const val LUMA_B = 0.0593

        fun fromKey(key: String?): BwFilter? = entries.firstOrNull { it.key == key }
    }
}
