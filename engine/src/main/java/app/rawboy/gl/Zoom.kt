package app.rawboy.gl

import java.nio.ByteBuffer
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A full-resolution region (RGB half floats) used for the zoomed view. */
class DetailTile(val rect: PixelRect, val pixels: ByteBuffer)

data class PixelRect(val x: Int, val y: Int, val width: Int, val height: Int) {
    val right get() = x + width
    val bottom get() = y + height

    fun contains(o: PixelRect) = o.x >= x && o.y >= y && o.right <= right && o.bottom <= bottom
}

/**
 * Geometry of the zoomed view, centred on (cx, cy) in full-resolution coordinates: [scale] screen pixels per
 * full-resolution pixel, 1 = the 100% view (double tap); a pinch zooms to other scales.
 */
object ZoomMath {
    /** Pinch zoom's limit, screen pixels per full-resolution pixel (out past the fit view goes back to it). */
    const val MAX_SCALE = 4f

    /** Margin kept around the visible region so denoise has real neighbours. */
    const val HALO = 16
    private const val MIN_TILE = 2048
    private const val TILE_SLACK = 512

    /**
     * Keeps the visible region inside the image. [frame]: the band the zoomed view keeps around the photo on every
     * side, pixels, so the photo shows inside the view minus the frame.
     */
    fun clampCenter(
        cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, scale: Float = 1f, frame: Int = 0,
    ): Pair<Float, Float> {
        val halfW = min(inner(viewW, frame) / scale, imgW.toFloat()) / 2f
        val halfH = min(inner(viewH, frame) / scale, imgH.toFloat()) / 2f
        return cx.coerceIn(halfW, imgW - halfW) to cy.coerceIn(halfH, imgH - halfH)
    }

    /**
     * The full-resolution region visible on screen (inside the [frame], as for [clampCenter]), as [x, y, width,
     * height]: whole pixels at 100%, fractional at other scales (whole ones would make panning jump [scale] screen
     * pixels at a time).
     */
    fun viewRectF(
        cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, scale: Float = 1f, frame: Int = 0,
    ): FloatArray {
        if (scale == 1f) {
            val v = viewRect(cx, cy, viewW, viewH, imgW, imgH, 1f, frame)
            return floatArrayOf(v.x.toFloat(), v.y.toFloat(), v.width.toFloat(), v.height.toFloat())
        }
        val w = min(inner(viewW, frame) / scale, imgW.toFloat())
        val h = min(inner(viewH, frame) / scale, imgH.toFloat())
        return floatArrayOf((cx - w / 2f).coerceIn(0f, imgW - w), (cy - h / 2f).coerceIn(0f, imgH - h), w, h)
    }

    /** [viewRectF] in whole pixels: exact at 100%, the pixels it touches at other scales. */
    fun viewRect(cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, scale: Float = 1f, frame: Int = 0): PixelRect {
        if (scale != 1f) {
            val v = viewRectF(cx, cy, viewW, viewH, imgW, imgH, scale, frame)
            val x0 = floor(v[0]).toInt().coerceIn(0, imgW - 1)
            val y0 = floor(v[1]).toInt().coerceIn(0, imgH - 1)
            val x1 = ceil(v[0] + v[2]).toInt().coerceIn(x0 + 1, imgW)
            val y1 = ceil(v[1] + v[3]).toInt().coerceIn(y0 + 1, imgH)
            return PixelRect(x0, y0, x1 - x0, y1 - y0)
        }
        val w = min(inner(viewW, frame), imgW)
        val h = min(inner(viewH, frame), imgH)
        val x = (cx - w / 2f).roundToInt().coerceIn(0, imgW - w)
        val y = (cy - h / 2f).roundToInt().coerceIn(0, imgH - h)
        return PixelRect(x, y, w, h)
    }

    /** The view's size less a frame on both sides. */
    private fun inner(size: Int, frame: Int) = max(1, size - 2 * frame)

    /**
     * Where the whole output image sits in the zoomed view ([scale] view pixels per image pixel), as [left, top,
     * width, height] in view pixels: the visible region is centred like DevelopRenderer.drawZoomed's quad.
     */
    fun zoomedRect(
        cx: Float, cy: Float, viewW: Int, viewH: Int, imgW: Int, imgH: Int, scale: Float = 1f, frame: Int = 0,
    ): FloatArray {
        val v = viewRectF(cx, cy, viewW, viewH, imgW, imgH, scale, frame)
        return floatArrayOf(
            (viewW - v[2] * scale) / 2f - v[0] * scale, (viewH - v[3] * scale) / 2f - v[1] * scale,
            imgW * scale, imgH * scale,
        )
    }

    /** The fit view's scale: view pixels per full-resolution pixel. */
    fun fitScale(viewW: Int, viewH: Int, imgW: Int, imgH: Int, frame: Int): Float =
        fitRect(viewW, viewH, imgW, imgH, frame)[2] / imgW

    /**
     * Whether the downscaled preview is sharp enough at [scale] (a pinch between fit and 100%): at most a quarter
     * upsampled. Above it the view needs a full-resolution tile.
     */
    fun previewSuffices(scale: Float, previewWidth: Int, fullWidth: Int): Boolean = scale <= 1.25f * previewWidth / fullWidth

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
