package app.rawboy.gl

import android.opengl.GLES30
import android.util.Log

/**
 * The film scan export's upscale pre-pass (port of ScanUpscaler.ts): renders a larger copy of the image texture that
 * the develop shader reads in place of the image, with `uPixelScale` = the scale. Steps in shaders/scan.frag: bicubic
 * start, four rounds of iterative back projection, then an unsharp mask on the luma. Needs float render targets
 * (GL_EXT_color_buffer_float); without them [supported] is false and the develop shader samples the source as it is
 * (a plain enlargement: the finer grain still applies).
 */
internal class ScanUpscaler(private val quad: FullscreenQuad) {
    private val program = GlUtil.createProgram(ShaderSources.DENOISE_VERT, ShaderSources.SCAN_FRAG)
    private val fbo = IntArray(1).also { GLES30.glGenFramebuffers(1, it, 0) }[0]
    private var width = 0
    private var height = 0
    private var srcWidth = 0
    private var srcHeight = 0
    private var hr = IntArray(0)
    private var residual = 0
    private var luma = 0
    private var blur = 0
    private var out = 0

    val supported: Boolean = GLES30.glGetString(GLES30.GL_EXTENSIONS).orEmpty().contains("GL_EXT_color_buffer_float")
        .also { if (!it) Log.w("RawBoy", "film scan upscale off: no GL_EXT_color_buffer_float (plain enlargement)") }

    private fun ensure(srcW: Int, srcH: Int, w: Int, h: Int) {
        if (w == width && h == height && srcW == srcWidth && srcH == srcHeight && out != 0) return
        releaseTextures()
        fun make(format: Int, filter: Int, tw: Int, th: Int): Int {
            val t = GlUtil.createTexture(filter)
            GLES30.glTexStorage2D(GLES30.GL_TEXTURE_2D, 1, format, tw, th)
            return t
        }
        hr = intArrayOf(make(GLES30.GL_RGBA32F, GLES30.GL_NEAREST, w, h), make(GLES30.GL_RGBA32F, GLES30.GL_NEAREST, w, h))
        residual = make(GLES30.GL_RGBA16F, GLES30.GL_LINEAR, srcW, srcH)
        luma = make(GLES30.GL_RGBA32F, GLES30.GL_NEAREST, w, h)
        blur = make(GLES30.GL_RGBA32F, GLES30.GL_NEAREST, w, h)
        out = make(GLES30.GL_RGBA16F, GLES30.GL_LINEAR, w, h)
        width = w
        height = h
        srcWidth = srcW
        srcHeight = srcH
    }

    /**
     * Upscales [src] (linear RGB, [srcW] x [srcH]) to [w] x [h] and returns the texture holding the result (RGBA16F,
     * linearly filtered). [denoise]: the 0..1 Denoise slider, which raises the unsharp mask's noise threshold as the
     * develop's Sharpen does. Leaves framebuffer 0 bound and unit 0 active; the caller sets its viewport and framebuffer.
     */
    fun apply(src: Int, srcW: Int, srcH: Int, w: Int, h: Int, denoise: Float): Int {
        ensure(srcW, srcH, w, h)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo)
        GLES30.glDisable(GLES30.GL_BLEND)
        GLES30.glUseProgram(program)
        fun loc(name: String) = GLES30.glGetUniformLocation(program, name)
        GLES30.glUniform1i(loc("uA"), UNIT_A)
        GLES30.glUniform1i(loc("uB"), UNIT_B)
        GLES30.glUniform2f(loc("uScale"), w.toFloat() / srcW, h.toFloat() / srcH)
        GLES30.glUniform2i(loc("uSrcSize"), srcW, srcH)
        GLES30.glUniform2i(loc("uHrSize"), w, h)
        GLES30.glUniform1f(loc("uAmount"), ScanScale.SHARPEN)
        GLES30.glUniform1f(loc("uThreshold"), 0.008f + denoise * 0.04f) // as the develop's sharpenGain
        val uPass = loc("uPass")
        fun run(pass: Int, a: Int, b: Int, target: Int, tw: Int, th: Int) {
            GLES30.glUniform1i(uPass, pass)
            bindTexture(UNIT_A, a)
            bindTexture(UNIT_B, b)
            GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, target, 0)
            GLES30.glDrawBuffers(1, intArrayOf(GLES30.GL_COLOR_ATTACHMENT0), 0)
            GLES30.glViewport(0, 0, tw, th)
            quad.draw()
        }
        var cur = 0
        run(0, src, 0, hr[0], w, h)
        repeat(ROUNDS) {
            run(1, hr[cur], src, residual, srcW, srcH)
            run(2, hr[cur], residual, hr[1 - cur], w, h)
            cur = 1 - cur
        }
        run(3, hr[cur], 0, luma, w, h)
        run(4, luma, 0, blur, w, h)
        run(5, hr[cur], blur, out, w, h)
        // Unbind the pass textures so none stays attached and sampled at once later.
        bindTexture(UNIT_B, 0)
        bindTexture(UNIT_A, 0)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        return out
    }

    private fun bindTexture(unit: Int, texture: Int) {
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + unit)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
    }

    private fun releaseTextures() {
        val all = (hr.toList() + listOf(residual, luma, blur, out)).filter { it != 0 }.toIntArray()
        if (all.isNotEmpty()) GLES30.glDeleteTextures(all.size, all, 0)
        hr = IntArray(0)
        residual = 0
        luma = 0
        blur = 0
        out = 0
        width = 0
        height = 0
        srcWidth = 0
        srcHeight = 0
    }

    fun release() {
        releaseTextures()
        GLES30.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
        GLES30.glDeleteProgram(program)
    }

    private companion object {
        const val UNIT_A = 10
        const val UNIT_B = 11
        const val ROUNDS = 4
    }
}
