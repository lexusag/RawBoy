package app.rawboy.raw

/**
 * How [RawImage.open] takes the black off a raw with a 2x2 per-site black level (DNG BlackLevelRepeatDim 2 2, as
 * Android's DngCreator writes); other raws ignore it. LibRaw keeps such blacks as integers, dropping their fraction (a
 * phone's 64.81 becomes 64), and clips what falls below black at zero: both lift and tint the deepest shadows of a
 * noisy frame. [LIBRAW] is LibRaw's own handling, what Pro and Auto decode with.
 */
data class BlackFix(
    /** Subtract the file's fractional per-site black exactly instead of its integer part. */
    val exact: Boolean = false,
    /** DN of noise kept below black instead of clipped at zero (0 = LibRaw's clip); decoded values may go negative. */
    val pedestal: Float = 0f,
    /** DN of black beyond the file's per camera colour (R, G, B), where the sensor's black differs from the file's. */
    val offset: FloatArray = FloatArray(3),
) {
    init {
        require(offset.size == 3) { "offset needs R, G, B" }
        require(pedestal >= 0f) { "pedestal $pedestal < 0" }
    }

    override fun equals(other: Any?): Boolean =
        other is BlackFix && exact == other.exact && pedestal == other.pedestal && offset.contentEquals(other.offset)

    override fun hashCode(): Int = (exact.hashCode() * 31 + pedestal.hashCode()) * 31 + offset.contentHashCode()

    override fun toString(): String = "BlackFix(exact=$exact, pedestal=$pedestal, offset=${offset.joinToString(prefix = "[", postfix = "]")})"

    companion object {
        val LIBRAW = BlackFix()
    }
}
