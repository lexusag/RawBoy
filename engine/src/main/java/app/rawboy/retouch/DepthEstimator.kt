package app.rawboy.retouch

import android.content.Context
import android.util.Half
import app.rawboy.export.DepthMap
import app.rawboy.gl.PreviewImage
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Produces an upright 8-bit normalized [DepthMap] (`0` = near foreground, `255` = far background) either from an
 * Android `ImageFormat.DEPTH16` sensor frame ([fromHardwareDepth16]) or by on-device software depth estimation with
 * person and pet subject detection ([estimate]).
 */
object DepthEstimator {

    /**
     * Estimates an upright [DepthMap] from the photo's ~512 px [image] copy, centered on the user's focus/meter target
     * (`[focusX]`, `[focusY]` in normalized `0..1` coordinates).
     */
    fun estimate(
        context: Context,
        image: PreviewImage,
        focusX: Float = 0.5f,
        focusY: Float = 0.5f,
    ): DepthMap {
        val w = image.width
        val h = image.height
        val (bitmap, gray) = SkinSegmenter.toDisplayBitmap(image)
        val seg = try {
            SkinSegmenter.segmentSubject(context, bitmap, w, h)
        } finally {
            bitmap.recycle()
        }
        val rgb = extractNormalizedRgb(image, w, h)
        return estimateFromFeatures(
            w = w,
            h = h,
            rgb = rgb,
            gray = gray,
            personProb = seg?.personForeground,
            hairOrFurProb = seg?.hairOrFur,
            otherProb = seg?.otherForeground,
            skinAreaFraction = seg?.skinAreaFraction ?: 0f,
            hasFace = seg?.hasFace ?: false,
            focusX = focusX,
            focusY = focusY,
        )
    }

    /**
     * Pure-JVM depth estimation and person/pet detection from normalized RGB (`w * h * 3`), luminance (`w * h`), and
     * optional segmentation probability masks.
     *
     * Detects:
     * 1. **Person**: when a face is detected, skin covers `>= 1.2%` of the frame, or the neural person silhouette
     *    (`personProb > 0.5`) covers `>= 2%` of the frame.
     * 2. **Pet / salient foreground subject**: when hair/fur/object segmentation (`hairOrFurProb + otherProb`) or
     *    focus-region acutance (sharpness contrast vs. out-of-focus background) and color distinction isolate a
     *    compact foreground subject (`2%..65%` of the frame) around (`[focusX]`, `[focusY]`).
     */
    internal fun estimateFromFeatures(
        w: Int,
        h: Int,
        rgb: FloatArray,
        gray: FloatArray,
        personProb: FloatArray? = null,
        hairOrFurProb: FloatArray? = null,
        otherProb: FloatArray? = null,
        skinAreaFraction: Float = 0f,
        hasFace: Boolean = false,
        focusX: Float = 0.5f,
        focusY: Float = 0.5f,
    ): DepthMap {
        val n = w * h
        val fx = focusX.coerceIn(0.15f, 0.85f)
        val fy = focusY.coerceIn(0.15f, 0.85f)

        // 1. Local acutance (high-frequency gradient energy) smoothed over a small neighborhood.
        val grad = FloatArray(n)
        for (y in 0 until h) {
            val ym = max(0, y - 1)
            val yp = min(h - 1, y + 1)
            for (x in 0 until w) {
                val xm = max(0, x - 1)
                val xp = min(w - 1, x + 1)
                val dx = abs(gray[y * w + xp] - gray[y * w + xm])
                val dy = abs(gray[yp * w + x] - gray[ym * w + x])
                grad[y * w + x] = sqrt(dx * dx + dy * dy)
            }
        }
        val radius = max(2, min(w, h) / 32)
        val localSharpness = Filters.box(grad, w, h, radius)

        // 2. Compare focus-window sharpness and color against the outer frame border (background prior).
        var focusSharpSum = 0.0
        var focusWeightSum = 0.0
        var focusR = 0.0
        var focusG = 0.0
        var focusB = 0.0
        var borderSharpSum = 0.0
        var borderCount = 0
        var borderR = 0.0
        var borderG = 0.0
        var borderB = 0.0

        for (y in 0 until h) {
            val ny = (y + 0.5f) / h
            val dy = (ny - fy) / 0.25f
            for (x in 0 until w) {
                val nx = (x + 0.5f) / w
                val dx = (nx - fx) / 0.25f
                val i = y * w + x
                val r = rgb[i * 3].toDouble()
                val g = rgb[i * 3 + 1].toDouble()
                val b = rgb[i * 3 + 2].toDouble()
                val d2 = dx * dx + dy * dy
                if (d2 <= 1.0f) {
                    val wgt = exp(-1.5 * d2)
                    focusSharpSum += localSharpness[i] * wgt
                    focusR += r * wgt
                    focusG += g * wgt
                    focusB += b * wgt
                    focusWeightSum += wgt
                }
                val isBorder = nx < 0.12f || nx > 0.88f || ny < 0.12f
                if (isBorder) {
                    borderSharpSum += localSharpness[i]
                    borderR += r
                    borderG += g
                    borderB += b
                    borderCount++
                }
            }
        }

        val meanFocusSharp = if (focusWeightSum > 0) (focusSharpSum / focusWeightSum).toFloat() else 0f
        val meanBorderSharp = if (borderCount > 0) (borderSharpSum / borderCount).toFloat() else 0f
        val fcR = if (focusWeightSum > 0) (focusR / focusWeightSum).toFloat() else 0.5f
        val fcG = if (focusWeightSum > 0) (focusG / focusWeightSum).toFloat() else 0.5f
        val fcB = if (focusWeightSum > 0) (focusB / focusWeightSum).toFloat() else 0.5f
        val bcR = if (borderCount > 0) (borderR / borderCount).toFloat() else 0.5f
        val bcG = if (borderCount > 0) (borderG / borderCount).toFloat() else 0.5f
        val bcB = if (borderCount > 0) (borderB / borderCount).toFloat() else 0.5f

        val maxSharp = max(localSharpness.maxOrNull() ?: 1e-4f, 1e-4f)
        val sharpRatio = meanFocusSharp / max(meanBorderSharp, 1e-4f)

        // 3. Evaluate neural person/pet mask coverage.
        var personPixels = 0
        var petNeuralPixels = 0
        if (personProb != null) {
            for (i in 0 until n) {
                if (personProb[i] > 0.5f) personPixels++
                val furOrObj = (hairOrFurProb?.get(i) ?: 0f) + (otherProb?.get(i) ?: 0f)
                if (furOrObj > 0.35f) petNeuralPixels++
            }
        }
        val personFraction = personPixels.toFloat() / max(1, n)
        val petNeuralFraction = petNeuralPixels.toFloat() / max(1, n)
        val personDetected = hasFace || skinAreaFraction >= 0.012f || personFraction in 0.02f..0.85f

        // 4. Salient foreground / pet probability map combining focus-area acutance, color affinity to the focus
        // subject vs. border background, and spatial compactness around the focus point.
        val salientSubject = FloatArray(n)
        var salientPixels = 0
        val colorContrast = sqrt((fcR - bcR) * (fcR - bcR) + (fcG - bcG) * (fcG - bcG) + (fcB - bcB) * (fcB - bcB))
        for (y in 0 until h) {
            val ny = (y + 0.5f) / h
            val dy = (ny - fy) / 0.38f
            for (x in 0 until w) {
                val nx = (x + 0.5f) / w
                val dx = (nx - fx) / 0.38f
                val i = y * w + x
                val spatial = exp(-0.8f * (dx * dx + dy * dy))
                val r = rgb[i * 3]
                val g = rgb[i * 3 + 1]
                val b = rgb[i * 3 + 2]
                val distFocus = sqrt((r - fcR) * (r - fcR) + (g - fcG) * (g - fcG) + (b - fcB) * (b - fcB))
                val distBorder = sqrt((r - bcR) * (r - bcR) + (g - bcG) * (g - bcG) + (b - bcB) * (b - bcB))
                val colorAffinity = if (colorContrast > 0.06f) {
                    ((distBorder - distFocus) / max(distBorder + distFocus, 1e-3f) * 0.5f + 0.5f).coerceIn(0f, 1f)
                } else {
                    0.5f
                }
                val normSharp = (localSharpness[i] / maxSharp).coerceIn(0f, 1f)
                val neural = max(
                    personProb?.get(i) ?: 0f,
                    ((hairOrFurProb?.get(i) ?: 0f) + (otherProb?.get(i) ?: 0f)).coerceIn(0f, 1f),
                )
                val rawSalience = if (personDetected && personProb != null) {
                    0.75f * personProb[i] + 0.25f * (spatial * (0.5f * normSharp + 0.5f * colorAffinity))
                } else {
                    val focusCue = spatial * (0.55f * normSharp + 0.45f * colorAffinity)
                    max(neural, focusCue)
                }
                salientSubject[i] = rawSalience.coerceIn(0f, 1f)
                if (rawSalience > 0.48f && spatial > 0.25f) salientPixels++
            }
        }
        val salientFraction = salientPixels.toFloat() / max(1, n)
        // A pet or distinct foreground subject is present when either the neural segmenter found hair/fur/object
        // foreground or the focus area has strong sharpness & color separation from the border background.
        val petOrForegroundDetected = !personDetected && (
            petNeuralFraction in 0.02f..0.75f ||
                (sharpRatio >= 1.45f && meanFocusSharp >= 0.018f && colorContrast >= 0.08f && salientFraction in 0.025f..0.65f)
            )
        val subjectDetected = personDetected || petOrForegroundDetected

        // 5. Refine the foreground map with the edge-preserving guided filter so depth boundaries snap to hair/fur/edges.
        val refinedFg = SkinSegmenter.guidedFilter(
            g = gray,
            p = salientSubject,
            w = w,
            h = h,
            radius = max(3, min(w, h) / 48),
            eps = 1e-3f,
        )

        // 6. Compose continuous depth (0 = near foreground, 1 = far background):
        //    Combine subject foreground layer (~0.12..0.25), defocus / sharpness cue, and vertical ground-plane gradient.
        val depthBytes = ByteArray(n)
        var subjectDepthSum = 0.0
        var subjectWeightSum = 0.0
        for (y in 0 until h) {
            val ny = (y + 0.5f) / h
            // Ground-plane prior: top of frame is typically farther (0.85), bottom is nearer (0.35).
            val verticalPrior = (0.88f - 0.50f * ny).coerceIn(0.25f, 0.92f)
            for (x in 0 until w) {
                val i = y * w + x
                val fg = refinedFg[i].coerceIn(0f, 1f)
                val normSharp = (localSharpness[i] / maxSharp).coerceIn(0f, 1f)
                val bgDepth = (0.65f * verticalPrior + 0.35f * (1f - 0.6f * normSharp)).coerceIn(0.35f, 1f)
                val subjectDepth = (0.16f + 0.08f * (1f - normSharp)).coerceIn(0.10f, 0.28f)
                val d = if (subjectDetected) {
                    (fg * subjectDepth + (1f - fg) * bgDepth).coerceIn(0f, 1f)
                } else {
                    (0.55f * verticalPrior + 0.45f * (1f - 0.7f * normSharp)).coerceIn(0f, 1f)
                }
                depthBytes[i] = (d * 255f).roundToInt().coerceIn(0, 255).toByte()
                if (fg > 0.5f) {
                    subjectDepthSum += d * fg
                    subjectWeightSum += fg
                }
            }
        }

        val prelim = DepthMap(
            width = w,
            height = h,
            data = depthBytes,
            hardware = false,
            subjectDetected = subjectDetected,
            focusDepth = 0.2f,
        )
        val focusDepth = if (subjectDetected && subjectWeightSum > 0.0) {
            (subjectDepthSum / subjectWeightSum).toFloat().coerceIn(0.05f, 0.85f)
        } else {
            prelim.sampleUv(fx, fy).coerceIn(0.05f, 0.90f)
        }
        return DepthMap(
            width = w,
            height = h,
            data = depthBytes,
            hardware = false,
            subjectDetected = subjectDetected,
            focusDepth = focusDepth,
        )
    }

    /**
     * Converts an Android `ImageFormat.DEPTH16` plane (`16-bit` little-endian samples: low 13 bits = depth in mm,
     * high 3 bits = confidence `0..7`) into an upright, normalized [DepthMap] (max dimension [maxDimension]).
     */
    fun fromHardwareDepth16(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        rowStrideBytes: Int,
        pixelStrideBytes: Int = 2,
        exifOrientation: Int = 1,
        focusX: Float = 0.5f,
        focusY: Float = 0.5f,
        subjectDetected: Boolean = true,
        maxDimension: Int = 512,
    ): DepthMap? {
        if (width <= 0 || height <= 0) return null
        val scale = min(1f, maxDimension.toFloat() / max(width, height))
        val srcW = max(1, (width * scale).roundToInt())
        val srcH = max(1, (height * scale).roundToInt())
        val mm = FloatArray(srcW * srcH)
        val valid = ArrayList<Float>(srcW * srcH)
        val dup = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)

        for (y in 0 until srcH) {
            val sy = ((y + 0.5f) * height / srcH).toInt().coerceIn(0, height - 1)
            val rowOffset = sy * rowStrideBytes
            for (x in 0 until srcW) {
                val sx = ((x + 0.5f) * width / srcW).toInt().coerceIn(0, width - 1)
                val idx = rowOffset + sx * pixelStrideBytes
                if (idx + 1 >= dup.limit()) continue
                val sample = dup.getShort(idx).toInt() and 0xffff
                val depthMm = sample and 0x1fff
                val confidence = (sample ushr 13) and 0x7
                // In Android DEPTH16, confidence 0 denotes 100% confidence on some HALs or invalid if depthMm == 0;
                // depthMm in 40..15000 mm with confidence != 1 is usable.
                if (depthMm in 40..15000 && confidence != 1) {
                    val v = depthMm.toFloat()
                    mm[y * srcW + x] = v
                    valid.add(v)
                }
            }
        }
        if (valid.size < (srcW * srcH) / 16) return null
        valid.sort()
        val nearMm = valid[(valid.size * 0.03f).toInt().coerceIn(0, valid.size - 1)]
        val farMm = max(nearMm + 100f, valid[(valid.size * 0.95f).toInt().coerceIn(0, valid.size - 1)])
        val fallbackMm = valid[valid.size / 2]

        // Fill holes (0 values) from nearest valid neighbor along rows/columns, then normalize to 0..1.
        var last = fallbackMm
        for (i in mm.indices) {
            if (mm[i] > 0f) last = mm[i] else mm[i] = last
        }
        val norm = FloatArray(srcW * srcH) { i ->
            ((mm[i] - nearMm) / (farMm - nearMm)).coerceIn(0f, 1f)
        }
        val smoothed = Filters.box(norm, srcW, srcH, 1)

        // Apply EXIF orientation (1..8) so the resulting DepthMap matches the upright decoded RawImage.
        val swapAxes = exifOrientation in 5..8
        val outW = if (swapAxes) srcH else srcW
        val outH = if (swapAxes) srcW else srcH
        val outBytes = ByteArray(outW * outH)
        for (sy in 0 until srcH) {
            for (sx in 0 until srcW) {
                val (dx, dy) = orientPixel(sx, sy, srcW, srcH, exifOrientation)
                val b = (smoothed[sy * srcW + sx] * 255f).roundToInt().coerceIn(0, 255).toByte()
                outBytes[dy * outW + dx] = b
            }
        }
        val prelim = DepthMap(outW, outH, outBytes, hardware = true, subjectDetected = subjectDetected, focusDepth = 0.2f)
        val focusDepth = prelim.sampleUv(focusX.coerceIn(0.1f, 0.9f), focusY.coerceIn(0.1f, 0.9f))
        return DepthMap(
            width = outW,
            height = outH,
            data = outBytes,
            hardware = true,
            subjectDetected = subjectDetected,
            focusDepth = focusDepth,
        )
    }

    private fun orientPixel(x: Int, y: Int, w: Int, h: Int, orientation: Int): Pair<Int, Int> = when (orientation) {
        2 -> (w - 1 - x) to y
        3 -> (w - 1 - x) to (h - 1 - y)
        4 -> x to (h - 1 - y)
        5 -> y to x
        6 -> (h - 1 - y) to x
        7 -> (h - 1 - y) to (w - 1 - x)
        8 -> y to (w - 1 - x)
        else -> x to y
    }

    private fun extractNormalizedRgb(image: PreviewImage, w: Int, h: Int): FloatArray {
        val n = w * h
        val halves = image.pixels.duplicate().order(ByteOrder.nativeOrder()).asShortBuffer()
        val out = FloatArray(n * 3)
        for (i in 0 until n) {
            val r = Half.toFloat(halves.get(i * 3)).coerceAtLeast(0f)
            val g = Half.toFloat(halves.get(i * 3 + 1)).coerceAtLeast(0f)
            val b = Half.toFloat(halves.get(i * 3 + 2)).coerceAtLeast(0f)
            out[i * 3] = r / (1f + r)
            out[i * 3 + 1] = g / (1f + g)
            out[i * 3 + 2] = b / (1f + b)
        }
        return out
    }
}
