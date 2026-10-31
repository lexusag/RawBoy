package app.rawboy.gl

import android.opengl.GLES30
import android.opengl.GLSurfaceView
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * Renders the developed image into a GLSurfaceView: either the whole downscaled
 * preview (aspect-fit) or, when zoomed, a window into a full-resolution tile (1:1 at 100%, any scale with a pinch).
 */
class DevelopRenderer : GLSurfaceView.Renderer {
    private val lock = Any()
    private var image: PreviewImage? = null
    private var imageDirty = false
    private var detail: DetailTile? = null
    private var detailDirty = false

    @Volatile
    var params: ShaderParams? = null

    /** Frame around the photo in the fit and 100% views: width in pixels and its grey level (display-encoded). */
    @Volatile
    var frameWidth: Int = 0

    @Volatile
    var frameGrey: Float = FrameColor.GREY.level

    /** Extra empty space around the frame in the fit view, pixels (room for the mask tool's handles). */
    @Volatile
    var margin: Int = 0

    /** Paints clipped highlights red and crushed shadows blue (Pro's histogram, `clipWarning` in develop.glsl). */
    @Volatile
    var clipWarning: Boolean = false

    /**
     * The zoomed view's centre (full-resolution pixels) and scale (view pixels per full-resolution pixel, 1 = 100%),
     * set together so a frame never mixes them; null for fit-to-view.
     */
    @Volatile
    var zoom: Pair<Pair<Float, Float>, Float>? = null

    /** Called on the GL thread after each frame that drew the photo (not just the clear colour). */
    @Volatile
    var onPhotoDrawn: (() -> Unit)? = null

    private var program: DevelopProgram? = null
    private var quad: FullscreenQuad? = null
    private var lutTexture: LutTexture? = null
    private var shadingTexture: ShadingTexture? = null
    private var baseTexture: ImageTexture? = null
    private var bloomHaloTexture: ImageTexture? = null
    private var bloomTailTexture: ImageTexture? = null
    private var maskTexture: MaskTexture? = null
    private var brushTexture: BrushTexture? = null
    private var filmTextures: FilmTextures? = null
    private var bokehTexture: BokehTexture? = null
    private var previewTexture = 0
    private var detailTexture = 0
    private var uploadedDetail: DetailTile? = null
    private var denoiser: WaveletDenoise? = null

    /** Upload counters: the denoise pre-pass caches by them. */
    private var previewVersion = 0
    private var detailVersion = 0
    private var denoisedInput = false
    private var viewWidth = 1
    private var viewHeight = 1

    fun setImage(newImage: PreviewImage?) = synchronized(lock) {
        image = newImage
        imageDirty = true
    }

    fun setDetail(tile: DetailTile?) = synchronized(lock) {
        detail = tile
        detailDirty = true
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        // A new context means all GL objects are gone: rebuild and re-upload.
        program = DevelopProgram(forExport = false)
        quad = FullscreenQuad()
        lutTexture = LutTexture()
        shadingTexture = ShadingTexture()
        baseTexture = ImageTexture(ImageTexture.BASE_UNIT)
        bloomHaloTexture = ImageTexture(ImageTexture.BLOOM_HALO_UNIT)
        bloomTailTexture = ImageTexture(ImageTexture.BLOOM_TAIL_UNIT)
        maskTexture = MaskTexture()
        brushTexture = BrushTexture()
        filmTextures = FilmTextures()
        bokehTexture = BokehTexture(quad!!)
        previewTexture = GlUtil.createTexture(GLES30.GL_LINEAR)
        detailTexture = GlUtil.createTexture(GLES30.GL_NEAREST) // 1:1, keep pixels crisp
        uploadedDetail = null
        denoiser = WaveletDenoise(quad!!, GLES30.GL_LINEAR)
        previewVersion++
        detailVersion++
        synchronized(lock) {
            imageDirty = true
            detailDirty = true
        }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        viewWidth = width.coerceAtLeast(1)
        viewHeight = height.coerceAtLeast(1)
        GLES30.glViewport(0, 0, viewWidth, viewHeight)
    }

    override fun onDrawFrame(gl: GL10?) {
        val img: PreviewImage?
        val tile: DetailTile?
        val uploadImage: Boolean
        val uploadDetail: Boolean
        synchronized(lock) {
            img = image
            tile = detail
            uploadImage = imageDirty
            uploadDetail = detailDirty
            imageDirty = false
            detailDirty = false
        }
        if (uploadImage && img != null) {
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, previewTexture)
            GlUtil.uploadHalfRgb(img.width, img.height, img.pixels)
            previewVersion++
        }
        if (uploadDetail) {
            uploadedDetail = tile?.also {
                GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, detailTexture)
                GlUtil.uploadHalfRgb(it.rect.width, it.rect.height, it.pixels)
                detailVersion++
            }
        }

        GLES30.glClearColor(0.07f, 0.07f, 0.07f, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        val p = params ?: return
        if (img == null) return

        lutTexture!!.bind(p.lut)
        shadingTexture!!.bind(p.lens.info.shading)
        baseTexture!!.bind(p.base)
        bloomHaloTexture!!.bind(p.bloomHalo)
        bloomTailTexture!!.bind(p.bloomTail)
        maskTexture!!.bind(p.skinMask)
        brushTexture!!.bind(p.layers.brush)
        filmTextures!!.bind(p.film)
        bokehTexture!!.bind(p) // after the brush atlas: its mask pass reads it
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        val z = zoom
        if (z != null) {
            drawZoomed(p, img, uploadedDetail, z.first, z.second)
        } else {
            drawFit(p, img)
        }
        program!!.setClipWarning(clipWarning)
        program!!.setDenoisePre(denoisedInput)
        quad!!.draw()
        onPhotoDrawn?.invoke()
    }

    private fun drawFit(p: ShaderParams, img: PreviewImage) {
        val outW = p.lens.outputWidth
        val outH = p.lens.outputHeight
        val frame = frameWidth
        val r = ZoomMath.fitRect(viewWidth, viewHeight, outW, outH, frame + margin)
        val texture = denoised(p, previewTexture, "p$previewVersion", img.width, img.height, img.width.toFloat() / img.fullWidth)

        clearFrame(r[0], r[1], r[2], r[3])

        val sx = r[2] / viewWidth
        val sy = r[3] / viewHeight
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
        val input = PixelRect(0, 0, img.fullWidth, img.fullHeight)
        val output = PixelRect(0, 0, outW, outH)
        val geometry = SampleGeometry(img.width, img.height, input, output, img.fullWidth, img.fullHeight)
        program!!.bind(p, geometry, sx, sy, flipY = true)
    }

    private fun drawZoomed(p: ShaderParams, img: PreviewImage, tile: DetailTile?, center: Pair<Float, Float>, scale: Float) {
        // Output = what's on screen; input = the loaded full-resolution tile. If the lens moves pixels outside the
        // tile while a new one loads, edges smear briefly. Between fit and 100% (pinch) the preview may be enough,
        // and it stands in while a tile for a new region or scale loads.
        val outW = p.lens.outputWidth
        val outH = p.lens.outputHeight
        val viewF = ZoomMath.viewRectF(center.first, center.second, viewWidth, viewHeight, outW, outH, scale, frameWidth)
        val view = ZoomMath.viewRect(center.first, center.second, viewWidth, viewHeight, outW, outH, scale, frameWidth)
        // The frame stays while zoomed: the photo shows inside it, like in the fit view.
        val w = viewF[2] * scale
        val h = viewF[3] * scale
        clearFrame((viewWidth - w) / 2f, (viewHeight - h) / 2f, w, h)
        val useTile = tile != null && !ZoomMath.previewSuffices(scale, img.width, img.fullWidth) &&
            (scale == 1f || tile.rect.contains(p.lens.sourceBounds(view, 0)))
        val geometry = if (useTile) {
            val t = tile!!.rect
            val texture = denoised(p, detailTexture, "d$detailVersion", t.width, t.height, 1f)
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
            if (texture == detailTexture) {
                // Pixels stay crisp from 100% up; below it, smooth. (The denoise output, shared with the fit view, stays linear.)
                val filter = if (scale >= 1f) GLES30.GL_NEAREST else GLES30.GL_LINEAR
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, filter)
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, filter)
            }
            SampleGeometry(t.width, t.height, t, view, img.fullWidth, img.fullHeight, outputF = viewF)
        } else {
            val texture = denoised(p, previewTexture, "p$previewVersion", img.width, img.height, img.width.toFloat() / img.fullWidth)
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture)
            val input = PixelRect(0, 0, img.fullWidth, img.fullHeight)
            SampleGeometry(img.width, img.height, input, view, img.fullWidth, img.fullHeight, outputF = viewF)
        }
        program!!.bind(p, geometry, scaleX = w / viewWidth, scaleY = h / viewHeight, flipY = true)
    }

    /**
     * Frame: a band of neutral grey / white / black around the photo at ([left], [top], [width], [height]) (view
     * pixels, top-left origin), for judging exposure.
     */
    private fun clearFrame(left: Float, top: Float, width: Float, height: Float) {
        val frame = frameWidth
        if (frame <= 0) return
        val g = frameGrey
        GLES30.glEnable(GLES30.GL_SCISSOR_TEST)
        GLES30.glScissor(
            (left - frame).toInt(), (viewHeight - (top + height + frame)).toInt(), // GL origin is bottom-left
            (width + 2 * frame).toInt(), (height + 2 * frame).toInt(),
        )
        GLES30.glClearColor(g, g, g, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
    }

    /** [texture], or its copy through the wavelet denoise pre-pass when denoise is on (see WaveletDenoise). */
    private fun denoised(p: ShaderParams, texture: Int, key: String, w: Int, h: Int, pixelScale: Float): Int {
        val d = denoiser!!
        denoisedInput = d.active(p.denoise, p.colorDenoise)
        if (!denoisedInput) return texture
        val out = d.apply(texture, key, w, h, pixelScale, p.denoise, p.colorDenoise)
        GLES30.glViewport(0, 0, viewWidth, viewHeight)
        return out
    }
}

/** Frame colours around the photo, cycled by tapping outside it. Levels are display-encoded (sRGB). */
enum class FrameColor(val level: Float) {
    /** Perceptual middle grey (~18% reflectance). */
    GREY(0.46f),
    WHITE(1f),
    BLACK(0f),
    ;

    fun next(): FrameColor = entries[(ordinal + 1) % entries.size]
}
