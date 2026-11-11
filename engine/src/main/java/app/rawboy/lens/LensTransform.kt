package app.rawboy.lens

import app.rawboy.color.Mat3
import app.rawboy.develop.DevelopParams
import app.rawboy.develop.crop
import app.rawboy.gl.PixelRect
import kotlin.math.atan
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Lens geometry for one image and one set of slider values: where each output
 * pixel samples the decoded image, and the gains to apply there.
 *
 * Output pixel p (full resolution, after rotation and crop) maps to its source by:
 *   0. add the user crop's origin (the crop only picks a window of the finished frame), then undo
 *      straighten, the perspective (keystone) correction, the 90 degree turns and the flips, with auto crop for the
 *      straighten angle and perspective ([outToImage], projective when the perspective sliders are set)
 *   1. auto scale around the image centre (crop to valid pixels, like Lightroom's Constrain Crop), adjusted by lensCrop
 *   2. manual distortion (spherical + cylindrical anamorphic, around the image centre), then the fisheye straightening
 *      (equidistant -> blend towards rectilinear, around the lens's optical axis)
 *   3. embedded DNG WarpRectilinear, in sensor coordinates, per colour plane
 *   4. manual chromatic aberration: red and blue planes scaled around the image centre
 *
 * Lens correction always works on the whole frame: the auto scale, distortion, warp and vignettes use the
 * full image and sensor, never the user crop, so a cropped pixel equals the uncropped render's pixel.
 *
 * The GLSL in Shaders.kt mirrors this exactly; Kotlin uses it to size tiles and the auto scale.
 * [knownZoom] reuses the auto scale of a transform that differs only in crop (it doesn't depend on it).
 */
class LensTransform(val info: LensInfo, params: DevelopParams, knownZoom: Double? = null) {
    val width = info.width
    val height = info.height
    val centerX = width / 2.0
    val centerY = height / 2.0
    val halfDiagonal = hypot(width / 2.0, height / 2.0)

    /** Clockwise quarter turns, 0..3. */
    val quarterTurns = ((params.rotation % 4) + 4) % 4
    /** The photo is mirrored left-right / top-bottom (display orientation, before the turns). */
    val flipHorizontal = params.flipHorizontal
    val flipVertical = params.flipVertical
    /** The rotated + straightened frame, before the user crop. */
    val frameWidth = if (quarterTurns % 2 == 1) height else width
    val frameHeight = if (quarterTurns % 2 == 1) width else height

    /** User crop in frame pixels; the whole frame when there is none. */
    val cropRect: PixelRect = cropPixels(params)
    val outputWidth = cropRect.width
    val outputHeight = cropRect.height

    private val straightenRadians = Math.toRadians(params.straighten.toDouble().coerceIn(-45.0, 45.0))
    private val scaleFactor = params.scale.toDouble().coerceIn(100.0, 200.0) / 100.0

    /** Keystone homography in frame-centred pixels ([perspectiveMatrix]), null without one. */
    val perspective: DoubleArray? = perspectiveMatrix(params.perspectiveVertical.toDouble(), params.perspectiveHorizontal.toDouble(), frameWidth.toDouble(), frameHeight.toDouble())

    /** Output pixel -> image pixel (display orientation), row-major 3x3: affine, projective with a perspective (see [project]). */
    val outToImage: DoubleArray = rotationMatrix()

    private val useProfile = params.lensProfile && info.hasProfile

    /** k in src_r = r * (1 - k r^2); +100 on the slider removes strong barrel distortion. */
    val manualK = params.lensDistortion / 100.0 * 0.25

    /** Cylindrical (horizontal) distortion k: -100 bows vertical edges outward like an anamorphic lens. */
    val anamorphicK = params.lensAnamorphic / 100.0 * 0.30

    private val fisheyeHalfFov = Math.toRadians(params.lensFisheyeFov.toDouble().coerceIn(90.0, 220.0) / 2.0)

    /** Fisheye straightening 0..1 (0 = off): the output projection is fe * tan(t * theta) / t, 1 = rectilinear. */
    val fisheyeT = params.lensFisheye.toDouble().coerceIn(0.0, 100.0) / 100.0 * min(1.0, FISHEYE_MAX_ANGLE / fisheyeHalfFov)

    /** The fisheye's image circle radius and its equidistant focal length (source radius = fe * angle), pixels. */
    private val foundCircle = info.fisheyeCircle.takeIf { params.lensFisheyeAuto }
    val fisheyeRadius = (foundCircle?.let { it.radius * 100.0 } ?: params.lensFisheyeCircle.toDouble()).coerceIn(20.0, 100.0) / 100.0 * halfDiagonal
    val fisheyeFe = fisheyeRadius / fisheyeHalfFov

    /** Optical axis offset from the image centre, pixels. */
    val fisheyeOffsetX = (foundCircle?.let { it.offsetX * 100.0 } ?: params.lensFisheyeX.toDouble()).coerceIn(-50.0, 50.0) / 100.0 * width
    val fisheyeOffsetY = (foundCircle?.let { it.offsetY * 100.0 } ?: params.lensFisheyeY.toDouble()).coerceIn(-50.0, 50.0) / 100.0 * height

    /** Scale relative to the auto crop: 0 = exact Constrain Crop, < 0 zooms out to show curved borders, > 0 crops tighter. */
    private val cropScale = 2.0.pow(params.lensCrop.toDouble().coerceIn(-100.0, 100.0) / 150.0)

    /** True when zoomed out past the auto crop, so pixels outside [0, width] x [0, height] render black. */
    val clipFrame: Boolean = params.lensCrop < 0f

    val warp: LensInfo.Warp? = info.warp.takeIf { useProfile }
    val vignette: LensInfo.RadialVignette? = info.vignette.takeIf { useProfile }

    /** The decode applied the shading gain maps; with the profile off, take the luminance part back out. */
    val undoShading: Boolean = !params.lensProfile && info.shading != null

    val manualVignette = params.vignetteAmount / 100.0
    val manualVignetteMidpoint = params.vignetteMidpoint / 100.0

    /** Oriented pixel -> sensor pixel (row-major 3x3 affine), and back. */
    val toSensor: DoubleArray = orientationMatrix(info.orientation, info.sensorWidth.toDouble(), info.sensorHeight.toDouble())
    val fromSensor: DoubleArray = Mat3.inverse(toSensor)

    val warpCenterX = (warp?.centerX ?: 0.5) * info.sensorWidth
    val warpCenterY = (warp?.centerY ?: 0.5) * info.sensorHeight
    val warpNorm = maxCornerDistance(warpCenterX, warpCenterY)
    val vignetteCenterX = (vignette?.centerX ?: 0.5) * info.sensorWidth
    val vignetteCenterY = (vignette?.centerY ?: 0.5) * info.sensorHeight
    val vignetteNorm = maxCornerDistance(vignetteCenterX, vignetteCenterY)

    /** Planes with distinct warp coefficients (3 = lateral chromatic aberration correction). */
    val warpPlanes = warp?.planes ?: 1

    /**
     * Manual lateral chromatic aberration: the red and blue planes sample at this scale around the image centre
     * (after the warp), so +100 on a slider enlarges that plane by [CA_MAX].
     */
    val caScaleRed = 1.0 - params.caRed / 100.0 * CA_MAX
    val caScaleBlue = 1.0 - params.caBlue / 100.0 * CA_MAX
    val hasManualCa: Boolean get() = caScaleRed != 1.0 || caScaleBlue != 1.0

    val isGeometric: Boolean get() = warp != null || manualK != 0.0 || anamorphicK != 0.0 || fisheyeT > 0.0

    /** Output scale: at lensCrop = 0, >= the value at which every output pixel has real image data. */
    val zoom: Double = knownZoom ?: ((if (isGeometric) autoZoom() else 1.0) * cropScale)

    /** Source position (image, display orientation) of output pixel (x, y) for colour plane 0..2. */
    fun source(x: Double, y: Double, plane: Int = 1): DoubleArray {
        val p = project(outToImage, x, y)
        return lensSource(p[0], p[1], plane, zoom)
    }

    /**
     * Output pixel showing source position (x, y) (image, display orientation): the inverse of [source], for drawing
     * image-space shapes (mask gradients) over the preview. Newton steps from the lens-free guess, keeping the best
     * estimate: far outside the photo (overlay handles) the distortion polynomial can fold.
     */
    fun output(x: Double, y: Double): DoubleArray {
        val guess = project(Mat3.inverse(outToImage), x, y)
        var ox = guess[0]
        var oy = guess[1]
        val h = 0.5
        var best = doubleArrayOf(ox, oy)
        var bestErr = Double.POSITIVE_INFINITY
        for (i in 0 until 6) {
            val s = source(ox, oy)
            val ex = s[0] - x
            val ey = s[1] - y
            val err = kotlin.math.abs(ex) + kotlin.math.abs(ey)
            if (!(err < bestErr)) break
            best = doubleArrayOf(ox, oy)
            bestErr = err
            if (err < 0.02) break
            val sx = source(ox + h, oy)
            val sy = source(ox, oy + h)
            val a = (sx[0] - s[0]) / h
            val b = (sy[0] - s[0]) / h
            val c = (sx[1] - s[1]) / h
            val d = (sy[1] - s[1]) / h
            val det = a * d - b * c
            if (kotlin.math.abs(det) < 1e-9) break
            ox -= (d * ex - b * ey) / det
            oy -= (a * ey - c * ex) / det
        }
        return best
    }

    private fun distortFactor(k: Double, rn2: Double): Double =
        if (k <= 0.0) 1.0 - k * rn2 else 0.2 + 0.8 / sqrt(1.0 + 2.5 * k * rn2)

    /** Steps 1-3 for an image position (x, y). */
    private fun lensSource(x: Double, y: Double, plane: Int, zoomOverride: Double): DoubleArray {
        // 1-2: scale and manual spherical + cylindrical distortion around the image centre.
        var dx = (x - centerX) / zoomOverride
        var dy = (y - centerY) / zoomOverride
        val rn2 = (dx * dx + dy * dy) / (halfDiagonal * halfDiagonal)
        dx *= distortFactor(manualK + anamorphicK, rn2)
        dy *= distortFactor(manualK, rn2)
        if (fisheyeT > 0.0) {
            val x = fisheyeT * hypot(dx, dy) / fisheyeFe
            val f = if (x > 1e-6) atan(x) / x else 1.0
            dx = dx * f + fisheyeOffsetX
            dy = dy * f + fisheyeOffsetY
        }
        val qx = centerX + dx
        val qy = centerY + dy
        val w = warp ?: return manualCa(qx, qy, plane)

        // 3: embedded warp in sensor space.
        val sx = toSensor[0] * qx + toSensor[1] * qy + toSensor[2]
        val sy = toSensor[3] * qx + toSensor[4] * qy + toSensor[5]
        val c = w.coefficients
        val o = (if (w.planes == 3) plane else 0) * 6
        val ux = (sx - warpCenterX) / warpNorm
        val uy = (sy - warpCenterY) / warpNorm
        val r2 = ux * ux + uy * uy
        val radial = c[o] + r2 * (c[o + 1] + r2 * (c[o + 2] + r2 * c[o + 3]))
        val tx = c[o + 4] * 2 * ux * uy + c[o + 5] * (r2 + 2 * ux * ux)
        val ty = c[o + 4] * (r2 + 2 * uy * uy) + c[o + 5] * 2 * ux * uy
        val srcX = warpCenterX + warpNorm * (ux * radial + tx)
        val srcY = warpCenterY + warpNorm * (uy * radial + ty)
        return manualCa(
            fromSensor[0] * srcX + fromSensor[1] * srcY + fromSensor[2],
            fromSensor[3] * srcX + fromSensor[4] * srcY + fromSensor[5],
            plane,
        )
    }

    /** The manual chromatic aberration scale of [plane] around the image centre. */
    private fun manualCa(x: Double, y: Double, plane: Int): DoubleArray {
        val s = when (plane) {
            0 -> caScaleRed
            2 -> caScaleBlue
            else -> return doubleArrayOf(x, y)
        }
        return doubleArrayOf(centerX + (x - centerX) * s, centerY + (y - centerY) * s)
    }

    /** Source pixels needed to render [out], plus [margin], clamped to the image. */
    fun sourceBounds(out: PixelRect, margin: Int): PixelRect {
        if (!isGeometric && !hasManualCa && zoom == 1.0 && quarterTurns == 0 && !flipHorizontal && !flipVertical && straightenRadians == 0.0 && perspective == null && scaleFactor == 1.0 && cropRect.x == 0 && cropRect.y == 0) {
            return out.expand(margin, width, height)
        }
        var minX = Double.MAX_VALUE
        var minY = Double.MAX_VALUE
        var maxX = -Double.MAX_VALUE
        var maxY = -Double.MAX_VALUE
        val steps = 24
        for (plane in if (hasManualCa) listOf(0, 1, 2) else planesToCheck()) {
            for (i in 0..steps) {
                val t = i.toDouble() / steps
                val xs = out.x + t * out.width
                val ys = out.y + t * out.height
                for ((px, py) in listOf(
                    xs to out.y.toDouble(), xs to out.bottom.toDouble(),
                    out.x.toDouble() to ys, out.right.toDouble() to ys,
                )) {
                    val s = source(px, py, plane)
                    minX = min(minX, s[0]); maxX = max(maxX, s[0])
                    minY = min(minY, s[1]); maxY = max(maxY, s[1])
                }
            }
        }
        val x0 = (floor(minX).toInt() - margin).coerceIn(0, width - 1)
        val y0 = (floor(minY).toInt() - margin).coerceIn(0, height - 1)
        val x1 = (kotlin.math.ceil(maxX).toInt() + margin).coerceIn(x0 + 1, width)
        val y1 = (kotlin.math.ceil(maxY).toInt() + margin).coerceIn(y0 + 1, height)
        return PixelRect(x0, y0, x1 - x0, y1 - y0)
    }

    private fun planesToCheck() = if (warpPlanes == 3) listOf(0, 1, 2) else listOf(1)

    /** The auto scale: every output pixel on real picture, and for a fisheye no stretched past [FISHEYE_MAX_STRETCH]. */
    private fun autoZoom(): Double {
        val valid = validZoom()
        if (fisheyeT <= 0.0) return valid
        return max(valid, fisheyeT * halfDiagonal / (fisheyeFe * sqrt(FISHEYE_MAX_STRETCH - 1.0)))
    }

    private fun validZoom(): Double {
        val circle = fisheyeT > 0.0 && fisheyeRadius < halfDiagonal * 0.999
        val circleX = centerX + fisheyeOffsetX
        val circleY = centerY + fisheyeOffsetY
        fun inside(z: Double): Boolean {
            val steps = 48
            for (plane in planesToCheck()) {
                for (i in 0..steps) {
                    val t = i.toDouble() / steps
                    for ((px, py) in listOf(
                        t * width to 0.0, t * width to height.toDouble(),
                        0.0 to t * height, width.toDouble() to t * height,
                    )) {
                        val s = lensSource(px, py, plane, z)
                        if (s[0] < -0.5 || s[1] < -0.5 || s[0] > width + 0.5 || s[1] > height + 0.5) return false
                        // A circular fisheye: nothing outside the image circle is picture.
                        if (circle && hypot(s[0] - circleX, s[1] - circleY) > fisheyeRadius) return false
                    }
                }
            }
            return true
        }
        // Straightening a wide fisheye needs far more zoom-out than a lens profile does.
        var lo = if (fisheyeT > 0.0) 0.05 else 0.7
        var hi = if (fisheyeT > 0.0) 12.0 else 1.6
        if (!inside(hi)) return hi
        if (inside(lo)) return lo
        repeat(30) {
            val mid = (lo + hi) / 2
            if (inside(mid)) hi = mid else lo = mid
        }
        return hi
    }

    /** Crop edges rounded to frame pixels, at least 16 px and inside the frame. */
    private fun cropPixels(params: DevelopParams): PixelRect {
        val c = params.crop
        if (c.isFull) return PixelRect(0, 0, frameWidth, frameHeight)
        fun edges(a: Float, b: Float, size: Int): Pair<Int, Int> {
            val minSize = min(16, size)
            val lo = Math.round(a.coerceIn(0f, 1f) * size).coerceIn(0, size - minSize)
            val hi = Math.round(b.coerceIn(0f, 1f) * size).coerceIn(lo + minSize, size)
            return lo to hi
        }
        val (x0, x1) = edges(c.left, c.right, frameWidth)
        val (y0, y1) = edges(c.top, c.bottom, frameHeight)
        return PixelRect(x0, y0, x1 - x0, y1 - y0)
    }

    /**
     * image = c_img + F R(-90k) P(R(-theta) (out + crop - c_frame) / s), in y-down coordinates where positive angles
     * turn the picture clockwise; P is the perspective homography (identity without one, so the whole map is affine);
     * F mirrors the image about its centre (the flips). s crops the straightened (and keystoned) frame to the largest
     * same-aspect rectangle inside the image; it depends on the frame, not the user crop.
     */
    private fun rotationMatrix(): DoubleArray {
        val t = straightenRadians
        val c = kotlin.math.cos(t)
        val sn = kotlin.math.sin(t)
        val ow = frameWidth.toDouble()
        val oh = frameHeight.toDouble()
        val persp = perspective
        val fit = if (persp != null) perspectiveFit(persp, c, sn, ow, oh) else c + max(ow / oh, oh / ow) * kotlin.math.abs(sn)
        val s = fit * scaleFactor
        // R(-theta) = [[c, s], [-s, c]]
        val r = doubleArrayOf(c / s, sn / s, -sn / s, c / s)
        // R(-90 k): k=1 [[0,1],[-1,0]], k=2 [[-1,0],[0,-1]], k=3 [[0,-1],[1,0]]
        val q = when (quarterTurns) {
            1 -> doubleArrayOf(0.0, 1.0, -1.0, 0.0)
            2 -> doubleArrayOf(-1.0, 0.0, 0.0, -1.0)
            3 -> doubleArrayOf(0.0, -1.0, 1.0, 0.0)
            else -> doubleArrayOf(1.0, 0.0, 0.0, 1.0)
        }
        val fx = if (flipHorizontal) -1.0 else 1.0
        val fy = if (flipVertical) -1.0 else 1.0
        // Frame centre in output (cropped) pixels.
        val cox = ow / 2 - cropRect.x
        val coy = oh / 2 - cropRect.y
        if (persp != null) {
            val fq = doubleArrayOf(fx * q[0], fx * q[1], centerX, fy * q[2], fy * q[3], centerY, 0.0, 0.0, 1.0)
            val rs = doubleArrayOf(r[0], r[1], -(r[0] * cox + r[1] * coy), r[2], r[3], -(r[2] * cox + r[3] * coy), 0.0, 0.0, 1.0)
            val m = Mat3.multiply(Mat3.multiply(fq, persp), rs)
            return DoubleArray(9) { m[it] / m[8] }
        }
        val a = fx * (q[0] * r[0] + q[1] * r[2])
        val b = fx * (q[0] * r[1] + q[1] * r[3])
        val d = fy * (q[2] * r[0] + q[3] * r[2])
        val e = fy * (q[2] * r[1] + q[3] * r[3])
        return doubleArrayOf(
            a, b, centerX - (a * cox + b * coy),
            d, e, centerY - (d * cox + e * coy),
            0.0, 0.0, 1.0,
        )
    }

    private fun maxCornerDistance(cx: Double, cy: Double): Double {
        val w = info.sensorWidth.toDouble()
        val h = info.sensorHeight.toDouble()
        return maxOf(hypot(cx, cy), hypot(w - cx, cy), hypot(cx, h - cy), hypot(w - cx, h - cy))
    }

    companion object {
        /** Plane scale at ±100 on a chromatic aberration slider: 0.2%, ~6 px in the corners of a 24 MP photo. */
        const val CA_MAX = 0.002

        /**
         * The most the auto crop lets a fisheye straightening stretch the picture along the radius: the stretch at a
         * distance x = t r / fe from the axis is 1 + x^2, so 4 stops at x = sqrt(3). Beyond it a source pixel is smeared
         * over a strip of blocks and fringes (Crop below 0 still shows it).
         */
        const val FISHEYE_MAX_STRETCH = 4.0

        /** The widest angle from the optical axis the Fisheye slider reaches at 100 (radians): 75 degrees. */
        val FISHEYE_MAX_ANGLE = Math.toRadians(75.0)

        /** The camera tilt a perspective slider reaches at ±100 (radians): 30 degrees, about Lightroom's range. */
        val PERSPECTIVE_MAX_ANGLE = Math.toRadians(30.0)

        /**
         * Keystone correction as a homography in frame-centred pixels (y down), output point -> source point, or null
         * when both sliders are 0. The picture is re-projected as if the camera had been turned by [vertical] about the
         * frame's horizontal axis and by [horizontal] about its vertical one (Rx(a) Ry(b), a focal length of the frame's
         * long side, about a 36 mm lens on full frame), with the lens shifted so the frame centre stays put:
         * K R K^-1 T(t0). Vertical - widens the top (buildings shot looking up), Horizontal + widens the right side.
         */
        fun perspectiveMatrix(vertical: Double, horizontal: Double, frameWidth: Double, frameHeight: Double): DoubleArray? {
            if (vertical == 0.0 && horizontal == 0.0) return null
            val a = vertical.coerceIn(-100.0, 100.0) / 100.0 * PERSPECTIVE_MAX_ANGLE
            val b = -horizontal.coerceIn(-100.0, 100.0) / 100.0 * PERSPECTIVE_MAX_ANGLE
            val f = max(frameWidth, frameHeight)
            val ca = kotlin.math.cos(a)
            val sa = kotlin.math.sin(a)
            val cb = kotlin.math.cos(b)
            val sb = kotlin.math.sin(b)
            // R = Rx(a) Ry(b)
            val r = Mat3.multiply(doubleArrayOf(1.0, 0.0, 0.0, 0.0, ca, -sa, 0.0, sa, ca), doubleArrayOf(cb, 0.0, sb, 0.0, 1.0, 0.0, -sb, 0.0, cb))
            val h = Mat3.multiply(Mat3.multiply(Mat3.diagonal(f, f, 1.0), r), Mat3.diagonal(1 / f, 1 / f, 1.0))
            // The output point whose ray R turns onto the optical axis: f R^T e3, projected.
            val t0x = f * r[6] / r[8]
            val t0y = f * r[7] / r[8]
            val m = Mat3.multiply(h, doubleArrayOf(1.0, 0.0, t0x, 0.0, 1.0, t0y, 0.0, 0.0, 1.0))
            return DoubleArray(9) { m[it] / m[8] }
        }

        /** Point (x, y) through the projective 3x3 [m] (row-major). */
        fun project(m: DoubleArray, x: Double, y: Double): DoubleArray {
            val w = m[6] * x + m[7] * y + m[8]
            return doubleArrayOf((m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w)
        }

        /**
         * The smallest s for which the frame's corners, turned by the straighten angle (cos [c], sin [sn]), divided by s
         * and taken through the keystone homography [persp], all land inside the frame: the corners suffice, since a
         * homography keeps lines straight and the frame is convex. Shrinking the frame only shrinks its image, so
         * bisection finds it.
         */
        fun perspectiveFit(persp: DoubleArray, c: Double, sn: Double, ow: Double, oh: Double): Double {
            fun inside(s: Double): Boolean {
                for ((x, y) in listOf(-ow / 2 to -oh / 2, ow / 2 to -oh / 2, -ow / 2 to oh / 2, ow / 2 to oh / 2)) {
                    val px = (c * x + sn * y) / s
                    val py = (-sn * x + c * y) / s
                    if (persp[6] * px + persp[7] * py + persp[8] <= 0) return false
                    val (u, v) = project(persp, px, py).let { it[0] to it[1] }
                    if (kotlin.math.abs(u) > ow / 2 + 1e-6 || kotlin.math.abs(v) > oh / 2 + 1e-6) return false
                }
                return true
            }
            var lo = 0.25
            var hi = 16.0
            if (inside(lo)) return lo
            repeat(50) {
                val mid = (lo + hi) / 2
                if (inside(mid)) hi = mid else lo = mid
            }
            return hi
        }

        /** Affine (continuous pixel coordinates) from display orientation to sensor orientation. */
        fun orientationMatrix(o: Int, w: Double, h: Double): DoubleArray = when (o) {
            2 -> doubleArrayOf(-1.0, 0.0, w, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
            3 -> doubleArrayOf(-1.0, 0.0, w, 0.0, -1.0, h, 0.0, 0.0, 1.0)
            4 -> doubleArrayOf(1.0, 0.0, 0.0, 0.0, -1.0, h, 0.0, 0.0, 1.0)
            5 -> doubleArrayOf(0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
            6 -> doubleArrayOf(0.0, 1.0, 0.0, -1.0, 0.0, h, 0.0, 0.0, 1.0)
            7 -> doubleArrayOf(0.0, -1.0, w, -1.0, 0.0, h, 0.0, 0.0, 1.0)
            8 -> doubleArrayOf(0.0, -1.0, w, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
            else -> doubleArrayOf(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
        }
    }
}

private fun PixelRect.expand(margin: Int, maxW: Int, maxH: Int): PixelRect {
    val x0 = (x - margin).coerceAtLeast(0)
    val y0 = (y - margin).coerceAtLeast(0)
    val x1 = (right + margin).coerceAtMost(maxW)
    val y1 = (bottom + margin).coerceAtMost(maxH)
    return PixelRect(x0, y0, x1 - x0, y1 - y0)
}
