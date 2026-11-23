package app.rawboy.camera.depth

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import app.rawboy.export.DepthMap
import app.rawboy.gl.PreviewImage
import app.rawboy.retouch.SkinSegmenter
import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Settings › Save depth map › AI estimate: a depth map estimated from the photo by Depth Anything V2 Small
 * (Apache 2.0; the onnx-community export, 4-bit weights, `assets/models`), run by ONNX Runtime on the CPU.
 *
 * The model gives relative inverse depth (larger = nearer) for the shot's 512 px copy. It sees through glasses (the
 * lenses come out as far as the wall behind), which would blur the eyes, so inside MediaPipe's person mask nothing is
 * allowed farther than a little behind the person's own depth. With a person in the frame the focus is on them.
 */
object AiDepth {
    private const val TAG = "RawBoyCamera"
    private const val MODEL = "models/depth_anything_v2_small_q4f16.onnx"

    /** The model's input: long side in pixels, both sides multiples of its 14 px patches. */
    private const val INPUT_LONG = 518
    private const val PATCH = 14
    private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
    private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)

    /** How far behind the person's median depth their own pixels may read (0..1 depth units). */
    private const val PERSON_SLACK = 0.08f

    /** A person covering at least this share of the frame is the subject. */
    private const val PERSON_AREA = 0.015f

    private var session: OrtSession? = null

    private fun session(context: Context): OrtSession = session ?: run {
        val env = OrtEnvironment.getEnvironment()
        val bytes = context.assets.open(MODEL).use { it.readBytes() }
        val options = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(4)
        }
        env.createSession(bytes, options)
    }.also { session = it }

    /**
     * The upright depth map of the photo whose small linear copy is [base] (display orientation, as [DepthMap]
     * wants), or null if the model fails. Blocking, ~1-3 s on a phone: call from a background thread.
     */
    @Synchronized
    fun estimate(context: Context, base: PreviewImage): DepthMap? = try {
        val start = System.nanoTime()
        val scale = INPUT_LONG.toFloat() / max(base.width, base.height)
        val w = max(PATCH, (base.width * scale / PATCH).roundToInt() * PATCH)
        val h = max(PATCH, (base.height * scale / PATCH).roundToInt() * PATCH)
        val display = SkinSegmenter.displayBitmap(base)
        val input = Bitmap.createScaledBitmap(display, w, h, true)
        display.recycle()
        val pixels = IntArray(w * h).also { input.getPixels(it, 0, w, 0, 0, w, h) }
        input.recycle()
        val chw = FloatArray(3 * w * h)
        for (i in pixels.indices) {
            val p = pixels[i]
            chw[i] = (((p shr 16) and 0xff) / 255f - MEAN[0]) / STD[0]
            chw[w * h + i] = (((p shr 8) and 0xff) / 255f - MEAN[1]) / STD[1]
            chw[2 * w * h + i] = ((p and 0xff) / 255f - MEAN[2]) / STD[2]
        }
        val s = session(context)
        val env = OrtEnvironment.getEnvironment()
        val inverse = OnnxTensor.createTensor(env, FloatBuffer.wrap(chw), longArrayOf(1, 3, h.toLong(), w.toLong())).use { tensor ->
            s.run(mapOf(s.inputNames.first() to tensor)).use { result ->
                val out = result[0] as OnnxTensor
                val shape = out.info.shape
                val ow = shape.last().toInt()
                val oh = shape[shape.size - 2].toInt()
                val buf = out.floatBuffer
                FloatArray(ow * oh).also { buf.get(it) } to (ow to oh)
            }
        }
        val tModel = System.nanoTime()
        val (inv, size) = inverse
        val (ow, oh) = size
        val depth = toDepth(inv)
        // The person mask on the same grid as the model's output.
        val person = SkinSegmenter.personMask(context, base)?.let { resample(it, base.width, base.height, ow, oh) }
        val (subject, focus) = person?.let { applyPerson(depth, it) } ?: (false to depth[(oh / 2) * ow + ow / 2])
        Log.d(TAG, "AI depth ${ow}x$oh: model ${(tModel - start) / 1_000_000} ms, total ${(System.nanoTime() - start) / 1_000_000} ms, " +
            "person $subject, focus ${"%.2f".format(focus)}")
        val bytes = ByteArray(depth.size) { (depth[it] * 255f).roundToInt().coerceIn(0, 255).toByte() }
        DepthMap(ow, oh, bytes, hardware = false, subjectDetected = subject, focusDepth = focus)
    } catch (t: Throwable) {
        // ONNX Runtime or MediaPipe failures may be Errors (native libraries): fail softly, the shot saves without depth.
        Log.w(TAG, "AI depth failed", t)
        null
    }

    /** Inverse depth (nearer = larger) → 0..1 depth (0 near, 1 far) over its 2nd..98th percentiles. */
    internal fun toDepth(inverse: FloatArray): FloatArray {
        val sorted = inverse.copyOf().also { it.sort() }
        val lo = sorted[(sorted.size * 0.02f).toInt().coerceIn(0, sorted.size - 1)]
        val hi = sorted[(sorted.size * 0.98f).toInt().coerceIn(0, sorted.size - 1)]
        val range = max(hi - lo, 1e-6f)
        return FloatArray(inverse.size) { 1f - ((inverse[it] - lo) / range).coerceIn(0f, 1f) }
    }

    /**
     * Pulls see-through parts of the person (glasses) to their depth: nothing under the mask reads farther than their
     * median + [PERSON_SLACK], blended by the mask's confidence. Returns whether a person is the subject, and the focus
     * depth (their median, or the middle of the frame without one).
     */
    internal fun applyPerson(depth: FloatArray, person: FloatArray): Pair<Boolean, Float> {
        val inside = depth.indices.filter { person[it] > 0.5f }
        if (inside.size < depth.size * PERSON_AREA) return false to depth[depth.size / 2]
        val median = inside.map { depth[it] }.sorted()[inside.size / 2]
        val cap = median + PERSON_SLACK
        for (i in depth.indices) {
            val m = person[i]
            if (m > 0f && depth[i] > cap) depth[i] = depth[i] * (1 - m) + cap * m
        }
        return true to median
    }

    private fun resample(src: FloatArray, sw: Int, sh: Int, dw: Int, dh: Int): FloatArray {
        if (sw == dw && sh == dh) return src
        return FloatArray(dw * dh) { i ->
            val x = ((i % dw + 0.5f) * sw / dw).toInt().coerceIn(0, sw - 1)
            val y = ((i / dw + 0.5f) * sh / dh).toInt().coerceIn(0, sh - 1)
            src[y * sw + x]
        }
    }
}
