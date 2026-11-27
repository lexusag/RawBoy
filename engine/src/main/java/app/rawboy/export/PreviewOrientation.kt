package app.rawboy.export

/**
 * EXIF/TIFF orientation helpers for DNG embedded previews.
 *
 * Per the DNG specification, IFD0's Orientation tag (274) applies to both the raw SubIFD and every embedded preview
 * IFD. RawBoy renders developed previews upright (display orientation), so before embedding a preview into a DNG with
 * IFD0 orientation `o`, the preview pixels must be transformed by [inverse]`(o)` back into sensor orientation.
 */
object PreviewOrientation {
    /** TIFF orientation 1..8 that undoes [orientation] (so applying [orientation] afterwards recovers the original). */
    fun inverse(orientation: Int): Int = when (orientation) {
        6 -> 8
        8 -> 6
        in 1..8 -> orientation
        else -> 1
    }

    /** Output `(width, height)` after applying TIFF [orientation] to a `[width] x [height]` image. */
    fun outputSize(width: Int, height: Int, orientation: Int): Pair<Int, Int> =
        if (orientation in 5..8) height to width else width to height

    /**
     * Scatters [rows] rows of 16-bit unsigned RGB [band] (starting at row [y] of a `[srcWidth] x [srcHeight]` image)
     * into 8-bit RGB [dst] after applying TIFF [orientation] (1..8). [dst] must have size `srcWidth * srcHeight * 3`.
     */
    fun scatterBandToRgb8(
        band: ShortArray,
        y: Int,
        rows: Int,
        srcWidth: Int,
        srcHeight: Int,
        orientation: Int,
        dst: ByteArray,
    ) {
        val dstWidth = if (orientation in 5..8) srcHeight else srcWidth
        var s = 0
        for (row in 0 until rows) {
            val sy = y + row
            val start = destOffset(0, sy, srcWidth, srcHeight, dstWidth, orientation)
            val step = if (srcWidth > 1) {
                destOffset(1, sy, srcWidth, srcHeight, dstWidth, orientation) - start
            } else 3
            var d = start
            for (sx in 0 until srcWidth) {
                dst[d] = to8(band[s])
                dst[d + 1] = to8(band[s + 1])
                dst[d + 2] = to8(band[s + 2])
                s += 3
                d += step
            }
        }
    }

    private fun destOffset(sx: Int, sy: Int, w: Int, h: Int, dstW: Int, o: Int): Int {
        val dx: Int
        val dy: Int
        when (o) {
            2 -> { dx = w - 1 - sx; dy = sy }
            3 -> { dx = w - 1 - sx; dy = h - 1 - sy }
            4 -> { dx = sx; dy = h - 1 - sy }
            5 -> { dx = sy; dy = sx }
            6 -> { dx = h - 1 - sy; dy = sx }
            7 -> { dx = h - 1 - sy; dy = w - 1 - sx }
            8 -> { dx = sy; dy = w - 1 - sx }
            else -> { dx = sx; dy = sy }
        }
        return (dy * dstW + dx) * 3
    }

    private fun to8(s: Short): Byte = (((s.toInt() and 0xffff) * 255 + 32767) / 65535).toByte()
}
