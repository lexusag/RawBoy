package app.rawboy.camera.stab

import app.rawboy.camera.capture.MotionData
import app.rawboy.camera.capture.MotionFrame
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * What [StabPlan] needs besides the motion data: the video's geometry and the lens. All of it is in the `.motion`
 * header ([StabInput.fromHeader]).
 */
class StabInput(
    /** The video's pixel size (as encoded, turned to the recording's orientation). */
    val width: Int,
    val height: Int,
    /** Clockwise quarter turns of the recording (`recording.turns`) and the lens's sensor orientation in degrees. */
    val turns: Int,
    val sensorOrientation: Int,
    val front: Boolean,
    /** The active array's width: OIS samples are in its pixels. */
    val activeWidth: Int,
    val label: String,
)

/**
 * The stabilized camera path of one recording and the warp of each output frame, from its motion data: the gyro gives
 * the camera's orientation at any time, a Gaussian-smoothed copy of it is the virtual camera, and each output point
 * looks up the source row it came from (rolling shutter) and the lens's OIS shift at that row's time. Where the crop
 * would show the frame's edge, the virtual camera follows the real one, easing in and out over ±0.4 s (hard clamps
 * read as jumps). Ported from the prototype (`video-stabilization/prototype/stab2.py`) and its findings on the Pixel 9
 * Pro (plan §12).
 *
 * Coordinates: the *stream* is the camera's landscape frame (x right, y down, the sensor's readout order); the video
 * is the stream turned clockwise [quarterTurns] times. Camera rays: x right, y down, z forward.
 */
class StabPlan private constructor(
    private val input: StabInput,
    /** The visible part of the frame, 0.7 = 70% of each side. */
    val crop: Double,
    private val gyroT: LongArray,
    private val orientations: Array<Quat>,
    private val oisT: LongArray,
    private val oisX: FloatArray,
    private val oisY: FloatArray,
    /** Pixels of the stream per active-array pixel. */
    private val oisScale: Double,
    private val fx: Double,
    /** One per output frame, in order. */
    val outputs: List<Output>,
    /** The encoded frames in file order (their camera frames). */
    val sources: List<MotionFrame?>,
    /** Their times in the file (ns), in the same order. */
    val sourcePtsNs: LongArray,
    /** Their camera (sensor) times, in the same order. */
    private val sourceT: LongArray,
    private val typicalExposureNs: Long,
    private val typicalSkewNs: Long,
    /** Share of the output frames where the crop's limit made the virtual camera follow the real one. */
    val eased: Double,
) {
    /** An output frame: the encoded frame it shows, whether it repeats the one before (a frame the recorder lost), its time in the file and the virtual camera. */
    class Output(val source: Int, val hold: Boolean, val ptsNs: Long, val virtual: Quat)

    private val quarterTurns = ((input.sensorOrientation / 90 + input.turns) % 4 + 4) % 4
    private val streamW = if (quarterTurns % 2 == 0) input.width else input.height
    private val streamH = if (quarterTurns % 2 == 0) input.height else input.width
    private val cx = streamW / 2.0
    private val cy = streamH / 2.0

    /**
     * The source position of each point of a [gx] x [gy] grid over output frame [index] (corners included, row by
     * row from the top left), as fractions of the video's width and height (0..1 across the pixels' outer edges).
     */
    fun warp(index: Int, gx: Int, gy: Int): FloatArray {
        val out = outputs[index]
        val src = sources[out.source]
        val ts = sourceT[out.source]
        // A frame whose capture result never came keeps the typical exposure and skew.
        val e = src?.exposureNs?.takeIf { it > 0 } ?: typicalExposureNs
        val skew = src?.skewNs?.takeIf { it > 0 } ?: typicalSkewNs
        val v = out.virtual.matrix()
        val result = FloatArray(gx * gy * 2)
        val p = DoubleArray(2)
        for (j in 0 until gy) for (i in 0 until gx) {
            // The output point in video pixels (centre convention), scaled into the crop around the middle.
            val xv = (i.toDouble() / (gx - 1)) * input.width - 0.5
            val yv = (j.toDouble() / (gy - 1)) * input.height - 0.5
            videoToStream(input.width / 2.0 - 0.5 + (xv - (input.width / 2.0 - 0.5)) * crop,
                input.height / 2.0 - 0.5 + (yv - (input.height / 2.0 - 0.5)) * crop, p)
            // The virtual camera's ray.
            val rx = (p[0] - cx) / fx
            val ry = (p[1] - cy) / fx
            val vx = v[0] * rx + v[1] * ry + v[2]
            val vy = v[3] * rx + v[4] * ry + v[5]
            val vz = v[6] * rx + v[7] * ry + v[8]
            // Which source row: first guessed from the output row, then from the row the first guess found.
            var readout = (p[1] / (streamH - 1)).coerceIn(0.0, 1.0)
            var sx = p[0]
            var sy = p[1]
            for (k in 0 until 2) {
                val t = ts + e / 2 + (skew * readout).toLong()
                val c = orientationAt(t).inv().matrix()
                val dx = c[0] * vx + c[1] * vy + c[2] * vz
                val dy = c[3] * vx + c[4] * vy + c[5] * vz
                val dz = c[6] * vx + c[7] * vy + c[8] * vz
                sx = cx + fx * dx / dz + oisScale * interp(oisT, oisX, t)
                sy = cy + fx * dy / dz + oisScale * interp(oisT, oisY, t)
                readout = (sy / (streamH - 1)).coerceIn(0.0, 1.0)
            }
            streamToVideo(sx, sy, p)
            val o = (j * gx + i) * 2
            result[o] = ((p[0] + 0.5) / input.width).toFloat()
            result[o + 1] = ((p[1] + 0.5) / input.height).toFloat()
        }
        return result
    }

    /** Video pixel -> stream pixel: the video's clockwise turns undone. */
    private fun videoToStream(x0: Double, y0: Double, out: DoubleArray) {
        var x = x0
        var y = y0
        var w = input.width
        var h = input.height
        repeat(quarterTurns) {
            val nx = y
            val ny = w - 1 - x
            x = nx
            y = ny
            val t = w; w = h; h = t
        }
        out[0] = x
        out[1] = y
    }

    private fun streamToVideo(x0: Double, y0: Double, out: DoubleArray) {
        var x = x0
        var y = y0
        var w = streamW
        var h = streamH
        repeat(quarterTurns) {
            val nx = h - 1 - y
            val ny = x
            x = nx
            y = ny
            val t = w; w = h; h = t
        }
        out[0] = x
        out[1] = y
    }

    private fun orientationAt(t: Long): Quat = orientationAt(gyroT, orientations, t)

    companion object {
        /** Gaussian smoothing of the camera path, in seconds (prototype: σ 0.5 s). */
        const val SIGMA_S = 0.5

        /** How far ahead and behind the virtual camera starts following the real one near the crop's limit. */
        const val EASE_S = 0.4

        /**
         * Lenses whose OIS is on but sends no samples move the picture by only part of what the gyro says (Pixel 9
         * Pro T2, 2026-11-21: 0.57 sideways, 0.80 up/down). Recordings since 2026-11-22 have OIS off there.
         */
        private val UNREAD_OIS = doubleArrayOf(0.80, 0.57, 1.0)

        /**
         * The plan for [data], or null when it can't be stabilized (no gyro, no encoded frames, the selfie camera).
         * [gain] is the lens's picture-per-gyro scale (x, y) over its focal length (`LensProfile.motionGain`).
         */
        fun make(input: StabInput, data: MotionData, crop: Double, gain: FloatArray = floatArrayOf(1f, 1f)): StabPlan? {
            if (input.front || data.gyroT.size < 2 || data.encoded.size < 4 || data.frames.isEmpty()) return null
            val streamW = max(input.width, input.height)
            val streamH = min(input.width, input.height)
            val frames = data.frames.associateBy { it.t }
            val intr = data.frames.mapNotNull { f -> f.intrinsics.takeIf { it.isNotEmpty() }?.get(0)?.toDouble() }.sorted()
            if (intr.isEmpty() || input.activeWidth <= 0) return null
            val s = streamW.toDouble() / input.activeWidth
            val fx = intr[intr.size / 2] * s

            // OIS samples, sorted by time.
            val samples = data.frames.flatMap { f -> f.oisT.indices.map { Triple(f.oisT[it], f.oisX[it], f.oisY[it]) } }
                .sortedBy { it.first }
            val oisT = LongArray(samples.size) { samples[it].first }
            val oisX = FloatArray(samples.size) { samples[it].second }
            val oisY = FloatArray(samples.size) { samples[it].third }
            val oisOn = data.frames.map { it.oisMode }.sorted()[data.frames.size / 2] == 1

            // The camera's orientation (camera to world) at each gyro sample: camera rotation = (-gy, -gx, -gz) of
            // the gyro for the landscape stream, each axis scaled by the lens's measured gain.
            val damp = if (oisOn && samples.isEmpty()) UNREAD_OIS else doubleArrayOf(1.0, 1.0, 1.0)
            val ax = damp[0] * gain[1] // camera x rotation moves the picture up and down
            val ay = damp[1] * gain[0]
            val n = data.gyroT.size
            val orientations = arrayOfNulls<Quat>(n)
            orientations[0] = Quat.IDENTITY
            for (k in 1 until n) {
                val dt = (data.gyroT[k] - data.gyroT[k - 1]) * 1e-9
                val g0 = (k - 1) * 6
                val g1 = k * 6
                val wx = -(data.gyro[g0 + 1] + data.gyro[g1 + 1]) / 2.0 * ax
                val wy = -(data.gyro[g0] + data.gyro[g1]) / 2.0 * ay
                val wz = -(data.gyro[g0 + 2] + data.gyro[g1 + 2]) / 2.0 * damp[2]
                orientations[k] = (orientations[k - 1]!! * Quat.fromRotvec(wx * dt, wy * dt, wz * dt)).normalized()
            }
            val orient = orientations.requireNoNulls()

            // Encoded frames in file order, and every camera frame between the first and the last of them.
            val encT = LongArray(data.encoded.size / 2) { data.encoded[it * 2] }
            val encPts = LongArray(data.encoded.size / 2) { data.encoded[it * 2 + 1] }
            val ptsOffset = encT[0] - encPts[0]
            // Camera frames: those with a capture result and those in the file. The camera sometimes drops a result
            // while the frame itself is recorded (Pixel 9 Pro T2, 2026-11-22: two 100 ms holes in the results only).
            val camT = (frames.keys.filter { it in encT.first()..encT.last() } + encT.toList()).distinct().sorted()
            if (camT.size < 4) return null
            val sources = encT.map { frames[it] }
            fun median(v: List<Long>) = v.sorted().let { if (it.isEmpty()) 0L else it[it.size / 2] }
            val typicalExposure = median(data.frames.map { it.exposureNs }.filter { it > 0 })
            val typicalSkew = median(data.frames.map { it.skewNs }.filter { it > 0 })

            val fps = (camT.size - 1) / ((camT.last() - camT.first()) * 1e-9)
            val mids = LongArray(camT.size) { i ->
                val f = frames[camT[i]]
                camT[i] + (f?.exposureNs?.takeIf { it > 0 } ?: typicalExposure) / 2 + (f?.skewNs?.takeIf { it > 0 } ?: typicalSkew) / 2
            }
            val cm = Array(camT.size) { orientationAt(data.gyroT, orient, mids[it]) }
            val oisAt = { t: Long -> doubleArrayOf(s * interp(oisT, oisX, t), s * interp(oisT, oisY, t)) }
            val om = Array(camT.size) { oisAt(mids[it]) }

            val border = border(streamW, streamH, crop)
            fun fits(c: Quat, v: Quat, o: DoubleArray): Boolean {
                val r = (c.inv() * v).matrix()
                val slack = 2.0
                for (b in border) {
                    val rx = (b[0] - streamW / 2.0) / fx
                    val ry = (b[1] - streamH / 2.0) / fx
                    val dx = r[0] * rx + r[1] * ry + r[2]
                    val dy = r[3] * rx + r[4] * ry + r[5]
                    val dz = r[6] * rx + r[7] * ry + r[8]
                    if (dz <= 0) return false
                    val px = streamW / 2.0 + fx * dx / dz + o[0]
                    val py = streamH / 2.0 + fx * dy / dz + o[1]
                    if (px < slack || px > streamW - 1 - slack || py < slack || py > streamH - 1 - slack) return false
                }
                return true
            }
            fun alphaFor(c: Quat, v: Quat, o: DoubleArray): Double {
                if (fits(c, v, o)) return 1.0
                var lo = 0.0
                var hi = 1.0
                repeat(12) {
                    val m = (lo + hi) / 2
                    if (fits(c, Quat.slerp(c, v, m), o)) lo = m else hi = m
                }
                return lo
            }

            val sigma = SIGMA_S * fps
            var v = smooth(cm, sigma)
            var easedShare = 0.0
            for (iteration in 0 until 3) {
                val a = DoubleArray(cm.size) { alphaFor(cm[it], v[it], om[it]) }
                if (a.min() >= 1.0) break
                if (iteration == 0) easedShare = a.count { it < 1.0 }.toDouble() / a.size
                // A frame that must follow the camera starts following ~0.4 s earlier and lets go slowly.
                val w = (EASE_S * fps).roundToInt().coerceAtLeast(1)
                val amin = DoubleArray(a.size) { i -> (max(0, i - w)..min(a.size - 1, i + w)).minOf { a[it] } }
                val kernel = gaussian(w, w / 2.0)
                val eased = convolve(convolve(amin, kernel).let { s1 -> DoubleArray(s1.size) { min(s1[it], a[it]) } }, kernel)
                v = Array(cm.size) { Quat.slerp(cm[it], v[it], eased[it].coerceIn(0.0, 1.0)) }
                v = smooth(v, sigma / 3)
            }
            // Last guard: never show the edge (rare small steps).
            v = Array(cm.size) { Quat.slerp(cm[it], v[it], alphaFor(cm[it], v[it], om[it])) }

            // Each camera frame shows the encoded frame nearest in time; one the recorder lost repeats the last.
            val outputs = ArrayList<Output>(camT.size)
            var last = -1
            for (i in camT.indices) {
                var j = encT.binarySearch(camT[i]).let { if (it >= 0) it else (-it - 1).coerceAtMost(encT.size - 1) }
                // A tie (a lost frame halfway between two) shows the earlier: the last frame is held, never one from ahead.
                if (j > 0 && kotlin.math.abs(encT[j - 1] - camT[i]) <= kotlin.math.abs(encT[j] - camT[i])) j--
                outputs += Output(j, hold = j == last, ptsNs = camT[i] - ptsOffset, virtual = v[i])
                last = j
            }
            return StabPlan(input, crop, data.gyroT, orient, oisT, oisX, oisY, s, fx, outputs, sources, encPts, encT, typicalExposure, typicalSkew, easedShare)
        }

        /** 36 points around the crop's edge, in stream pixels. */
        private fun border(w: Int, h: Int, crop: Double): List<DoubleArray> = buildList {
            val t = DoubleArray(9) { it / 8.0 }
            fun add(bx: Double, by: Double) = add(doubleArrayOf(w / 2.0 + (bx - 0.5) * w * crop, h / 2.0 + (by - 0.5) * h * crop))
            t.forEach { add(it, 0.0) }
            t.forEach { add(1.0, it) }
            t.forEach { add(1 - it, 1.0) }
            t.forEach { add(0.0, 1 - it) }
        }

        internal fun orientationAt(gyroT: LongArray, q: Array<Quat>, t: Long): Quat {
            if (t <= gyroT[0]) return q[0]
            if (t >= gyroT[gyroT.size - 1]) return q[q.size - 1]
            val i = gyroT.binarySearch(t).let { if (it >= 0) return q[it] else -it - 1 }
            val f = (t - gyroT[i - 1]).toDouble() / (gyroT[i] - gyroT[i - 1])
            return Quat.slerp(q[i - 1], q[i], f)
        }

        /** Linear interpolation of [v] at [t] (0 without samples, held at the ends). */
        internal fun interp(ts: LongArray, v: FloatArray, t: Long): Double {
            if (ts.isEmpty()) return 0.0
            if (t <= ts[0]) return v[0].toDouble()
            if (t >= ts[ts.size - 1]) return v[v.size - 1].toDouble()
            val i = ts.binarySearch(t).let { if (it >= 0) return v[it].toDouble() else -it - 1 }
            val f = (t - ts[i - 1]).toDouble() / (ts[i] - ts[i - 1])
            return v[i - 1] + (v[i] - v[i - 1]) * f
        }

        /** Gaussian average of a quaternion path ([sigma] in frames), each kept on its neighbour's hemisphere. */
        internal fun smooth(q: Array<Quat>, sigma: Double): Array<Quat> {
            val aligned = q.copyOf()
            for (i in 1 until aligned.size) if (aligned[i].dot(aligned[i - 1]) < 0) aligned[i] = -aligned[i]
            val k = gaussian((3 * sigma).roundToInt().coerceAtLeast(1), sigma)
            val w = DoubleArray(aligned.size) { aligned[it].w }
            val x = DoubleArray(aligned.size) { aligned[it].x }
            val y = DoubleArray(aligned.size) { aligned[it].y }
            val z = DoubleArray(aligned.size) { aligned[it].z }
            val sw = convolve(w, k); val sx = convolve(x, k); val sy = convolve(y, k); val sz = convolve(z, k)
            return Array(aligned.size) { Quat(sw[it], sx[it], sy[it], sz[it]).normalized() }
        }

        private fun gaussian(half: Int, sigma: Double): DoubleArray {
            val k = DoubleArray(2 * half + 1) { exp(-0.5 * ((it - half) / sigma).let { d -> d * d }) }
            val sum = k.sum()
            return DoubleArray(k.size) { k[it] / sum }
        }

        /** Same-size convolution with [k], the ends held (edge padding). */
        private fun convolve(a: DoubleArray, k: DoubleArray): DoubleArray {
            val half = k.size / 2
            return DoubleArray(a.size) { i ->
                var s = 0.0
                for (j in k.indices) s += k[j] * a[(i + j - half).coerceIn(0, a.size - 1)]
                s
            }
        }
    }
}
