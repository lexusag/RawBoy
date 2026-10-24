package app.rawboy.gl

import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A full-resolution region (RGB half floats) used for the 100% view. */
class DetailTile(val rect: PixelRect, val pixels: ByteBuffer)

data class PixelRect(val x: Int, val y: Int, val width: Int, val height: Int) {
    val right get() = x + width
    val bottom get() = y + height

    fun contains(o: PixelRect) = o.x >= x && o.y >= y && o.right <= right && o.bottom <= bottom
}

/**
 * Geometry of the 100% view: one full-resolution pixel per screen pixel,
 * centred on (cx, cy) in full-resolution coordinates.
 */
object ZoomMath {
    /** Margin kept around the visible region so denoise has real neighbours. */
    const val HALO = 16
    private const val MIN_TILE = 2048
    private const val TILE_SLACK = 512

    /**
     * Keeps the visible region inside the image. [frame]: the band the 100% view keeps around the photo on every
     * side, pixels, so the photo shows inside the view minus the frame.
     */
    fun clampCenter(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int = 0): Pair<Float, Float> {
        val halfW = min(inner(viewW, frame), imgW) / 2f
        val halfH = min(inner(viewH, frame), imgH) / 2f
        return cx.coerceIn(halfW, imgW - halfW) to cy.coerceIn(halfH, imgH - halfH)
    }

    /** The full-resolution region visible on screen (inside the [frame], as for [clampCenter]). */
    fun viewRect(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int = 0): PixelRect {
        val w = min(inner(viewW, frame), imgW)
        val h = min(inner(viewH, frame), imgH)
        val x = (cx - w / 2f).roundToInt().coerceIn(0, imgW - w)
        val y = (cy - h / 2f).roundToInt().coerceIn(0, imgH - h)
        return PixelRect(x, y, w, h)
    }

    /** The view's size less a frame on both sides. */
    private fun inner(size: Int, frame: Int) = max(1, size - 2 * frame)

    /**
     * Where the whole output image sits in the 100% view (one image pixel per view pixel), as [left, top, width,
     * height] in view pixels: the visible region is centred like DevelopRenderer.drawZoomed's quad.
     */
    fun zoomedRect(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int = 0): FloatArray {
        val v = viewRect(cx, cy, viewW, viewH, imgW, imgH, frame)
        return floatArrayOf((viewW - v.width) / 2f - v.x, (viewH - v.height) / 2f - v.y, imgW.toFloat(), imgH.toFloat())
    }

    /** A tile around [needed] (source pixels), large enough that panning rarely reloads. */
    fun tileAround(needed: PixelRect, imgW: Int, imgH: Int): PixelRect {
        val w = min(imgW, max(MIN_TILE, needed.width + TILE_SLACK))
        val h = min(imgH, max(MIN_TILE, needed.height + TILE_SLACK))
        val x = (needed.x + needed.width / 2 - w / 2).coerceIn(0, imgW - w)
        val y = (needed.y + needed.height / 2 - h / 2).coerceIn(0, imgH - h)
        return PixelRect(x, y, w, h)
    }

    /**
     * Where the photo sits in the fit view: aspect-fit inside the view minus a [frame]
     * on every side, centred. Returns (left, top, width, height) in view pixels.
     */
    fun fitRect(viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int): FloatArray {
        val availW = max(1, viewW - 2 * frame).toFloat()
        val availH = max(1, viewH - 2 * frame).toFloat()
        val scale = min(availW / imgW, availH / imgH)
        val w = imgW * scale
        val h = imgH * scale
        return floatArrayOf((viewW - w) / 2f, (viewH - h) / 2f, w, h)
    }

    /** Maps a point in the fit view to full-resolution coordinates, or null if outside the photo. */
    fun fitToImage(px: Float, py: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int): Pair<Float, Float>? {
        val r = fitRect(viewW, viewH, imgW, imgH, frame)
        val x = (px - r[0]) / r[2] * imgW
        val y = (py - r[1]) / r[3] * imgH
        return if (x in 0f..imgW.toFloat() && y in 0f..imgH.toFloat()) x to y else null
    }
}
