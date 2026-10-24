package app.rawboy.gl

import android.opengl.GLES30
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The masks' lens blur (ports: web's gl/BokehTexture.ts). Like bloom it works on a small whole-image copy, so the fit
 * view, the 100% view and export tiles all sample the same texture: no tile seams and no spatial margin. Two passes on
 * the GPU, re-run only when the masks, their blur or the source change:
 * 1. bokeh_prep.glsl (after develop.glsl, so the masks are the develop shader's own layerMask): the highlight-boosted
 *    copy at the bokeh size, premultiplied by its fade-in, with each texel's blur radius.
 * 2. bokeh_gather.frag: an exact round disc gather (every texel inside the radius), sharp texels never smeared.
 * The develop shader mixes the result in by the radius at each pixel (main_body.glsl, `uBokeh`).
 * Needs float render targets (GL_EXT_color_buffer_float); without them the lens blur is off.
 */
internal class BokehTexture(private val quad: FullscreenQuad) {
    /** Bokeh texture size for some params and how its texels relate to the image. */
    class Geometry(
        val width: Int,
        val height: Int,
        /** Bokeh texels per full-resolution pixel (`uBokehScale`). */
        val scale: Float,
        /** Largest radius in texels. */
        val maxRadius: Float,
    )

    private val prep = DevelopProgram(forExport = false, Shaders.fragmentWithMain(ShaderSources.BOKEH_PREP))
    private val gather = GlUtil.createProgram(ShaderSources.DENOISE_VERT, ShaderSources.BOKEH_GATHER_FRAG)
    private val fbo = IntArray(1).also { GLES30.glGenFramebuffers(1, it, 0) }[0]
    private val source = GlUtil.createTexture(GLES30.GL_LINEAR).also {
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR_MIPMAP_LINEAR)
    }
    private val radii = GlUtil.createTexture(GLES30.GL_NEAREST)

    /** The result, sampled on [UNIT]; 1x1 transparent until the first blur (the develop shader then shows none). */
    private val out: Int
    private var uploaded: PreviewImage? = null
    private var width = 0
    private var height = 0

    /** What [out] holds, so unchanged masks aren't blurred again on every slider move. */
    private var key: List<Any>? = null

    private val supported: Boolean = GLES30.glGetString(GLES30.GL_EXTENSIONS).orEmpty().contains("GL_EXT_color_buffer_float")
        .also { if (!it) Log.w("RawBoy", "lens blur off: no GL_EXT_color_buffer_float") }

    init {
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + UNIT)
        out = GlUtil.createTexture(GLES30.GL_LINEAR)
        GLES30.glTexImage2D(
            GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA16F, 1, 1, 0, GLES30.GL_RGBA, GLES30.GL_HALF_FLOAT,
            ByteBuffer.allocateDirect(8),
        )
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
    }

    /**
     * Brings the blur up to date for [p] and binds it to [UNIT]. Call after the brush atlas is bound (the masks read
     * it). Leaves framebuffer [framebuffer] bound, the viewport as it was and unit 0 active.
     */
    fun bind(p: ShaderParams, framebuffer: Int = 0) {
        val g = if (supported) geometry(p) else null
        val src = p.bokehSource
        if (g != null && src != null) render(p, src, g, framebuffer)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + UNIT)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, out)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
    }

    private fun render(p: ShaderParams, src: PreviewImage, g: Geometry, framebuffer: Int) {
        if (src !== uploaded) {
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + UNIT_PASS)
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, source)
            GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 4)
            GLES30.glTexImage2D(
                GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA16F, src.width, src.height, 0,
                GLES30.GL_RGBA, GLES30.GL_HALF_FLOAT, rgbaHalf(src),
            )
            GLES30.glGenerateMipmap(GLES30.GL_TEXTURE_2D)
            uploaded = src
            key = null
        }
        val l = p.layers
        val newKey = listOf(
            src, g.width, g.height, l.count, l.geom.toList(), l.shape.toList(), l.color.toList(), l.blur.toList(),
            l.brush.map { r -> r?.let { "${it.width}x${it.height}@${it.version}" } ?: "-" },
        )
        if (newKey == key) return

        if (g.width != width || g.height != height) {
            for (t in intArrayOf(radii, out)) {
                GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t)
                GLES30.glTexImage2D(
                    GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA16F, g.width, g.height, 0,
                    GLES30.GL_RGBA, GLES30.GL_HALF_FLOAT, null as java.nio.Buffer?,
                )
            }
            width = g.width
            height = g.height
        }
        val viewport = IntArray(4).also { GLES30.glGetIntegerv(GLES30.GL_VIEWPORT, it, 0) }
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo)
        GLES30.glViewport(0, 0, g.width, g.height)
        GLES30.glDisable(GLES30.GL_BLEND)

        // 1. Masks -> radius, premultiplied source.
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, radii, 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + UNIT_PASS)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, source)
        prep.bindMasks(p, src.fullWidth, src.fullHeight)
        prep.bokehPrep(UNIT_PASS, max(0f, log2(max(src.width, src.height).toFloat() / max(g.width, g.height))), g)
        quad.draw()

        // 2. Disc gather.
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, out, 0)
        GLES30.glUseProgram(gather)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, radii)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(gather, "uSrc"), UNIT_PASS)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(gather, "uMaxRadius"), ceil(g.maxRadius).toInt())
        quad.draw()

        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, 0, 0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer)
        GLES30.glViewport(viewport[0], viewport[1], viewport[2], viewport[3])
        key = newKey
    }

    fun release() {
        prep.release()
        GLES30.glDeleteProgram(gather)
        GLES30.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
        GLES30.glDeleteTextures(3, intArrayOf(source, radii, out), 0)
    }

    companion object {
        /** Develop shader's unit for the result (`uBokeh`). */
        const val UNIT = 12

        /** Pass-local unit, past the develop shader's and the denoise pre-pass's. */
        private const val UNIT_PASS = 13

        /** Largest blur radius in bokeh texels: the texture is sized so a layer's strongest blur lands near it. */
        const val RADIUS = 16

        /** Bokeh texture long side limits. The source copy is [SOURCE_MAX_DIMENSION], so a smaller blur is sharper. */
        private const val MIN_DIMENSION = 128
        const val SOURCE_MAX_DIMENSION = 1536

        /** Bokeh texture size for [p], or null = no lens blur. */
        fun geometry(p: ShaderParams): Geometry? {
            val src = p.bokehSource ?: return null
            val l = p.layers
            var maxPx = 0f
            for (i in 0 until l.count) maxPx = max(maxPx, l.blur[i])
            if (maxPx <= 0f) return null
            val imageLong = max(src.fullWidth, src.fullHeight)
            val long = min(max(src.width, src.height), max(MIN_DIMENSION, (RADIUS * imageLong / maxPx).roundToInt()))
            val scale = long.toFloat() / imageLong
            return Geometry(
                width = max(1, (src.fullWidth * scale).roundToInt()),
                height = max(1, (src.fullHeight * scale).roundToInt()),
                scale = scale,
                maxRadius = maxPx * scale,
            )
        }

        /** RGB half floats -> RGBA (alpha 1), so the copy can be mipmapped (RGB16F isn't renderable). */
        private fun rgbaHalf(img: PreviewImage): ByteBuffer {
            val n = img.width * img.height
            val src = img.pixels.duplicate().apply { position(0) }.order(ByteOrder.nativeOrder()).asShortBuffer()
            val out = ByteBuffer.allocateDirect(n * 8).order(ByteOrder.nativeOrder())
            val dst = out.asShortBuffer()
            val one: Short = 0x3c00
            for (i in 0 until n) {
                dst.put(src.get(i * 3)); dst.put(src.get(i * 3 + 1)); dst.put(src.get(i * 3 + 2)); dst.put(one)
            }
            return out
        }
    }
}
