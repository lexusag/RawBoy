package app.rawboy.gl

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.util.Log
import android.view.Surface

/**
 * Where the viewfinder's developed picture goes while recording: a video encoder's input [surface]. The renderer
 * draws the same develop pass it draws on the screen into it ([ViewfinderRenderer.videoSink]), so the film or look the
 * photographer sees is the one in the file.
 *
 * The picture is the upright viewfinder image turned [turns] quarter turns clockwise (as the window shows it) and
 * cropped to fill [width] x [height] (a 16:9 slice of the 4:3 viewfinder).
 */
class VideoSink(
    val surface: Surface,
    val width: Int,
    val height: Int,
    val turns: Int,
    /** Record the flat Apple Log picture ([FlatProgram]) instead of the developed look. */
    val flat: Boolean = false,
    /** Flat only: EV added in linear light before the log encode (the converter takes it out again). */
    val raiseEv: Float = 0f,
    /** The EGL configs tried, in order, for the encoder's window surface (see [EncoderConfig]). */
    val encoderConfigs: List<EncoderConfig> = EncoderConfig.DEFAULT_ORDER,
    /** Camera frame timestamp (ns, the SurfaceTexture's) -> presentation time (ns) of the encoded frame, or < 0 to skip the frame. */
    val presentationNs: (cameraTimestampNs: Long) -> Long,
    /** Asks the view for a frame (so a stop is noticed even if the camera has stalled); set by [ViewfinderRenderer.videoSink]. */
    @Volatile
    var requestRender: () -> Unit = {},
) {
    /** Set by the owner to stop: the renderer then draws no more frames and releases its EGL surface. */
    @Volatile
    var closing = false

    /** Set by the renderer (GL thread) once nothing will touch [surface] again. */
    @Volatile
    var released = false

    /** Set by the renderer when the device refused an EGL surface on [surface]. */
    @Volatile
    var failed = false

    /** Frames the renderer handed to the encoder (set on the GL thread). */
    @Volatile
    var framesSent = 0

    /** When the first of them went ([android.os.SystemClock.uptimeMillis]); 0 before. */
    @Volatile
    var firstSentAtMs = 0L
}

/**
 * One way to choose the EGL config of the encoder's window surface. [EncoderSurface.create] tries a [VideoSink]'s
 * [VideoSink.encoderConfigs] in order and keeps the first that the device lets it make current.
 */
enum class EncoderConfig {
    /** 8-bit RGBA with the recordable flag: what MediaCodec's input surfaces are meant for. */
    RECORDABLE_RGBA8888,

    /** The viewfinder context's own config: always compatible with the context. */
    CONTEXT,

    /**
     * 8-bit RGBA recordable, as [RECORDABLE_RGBA8888], current in a context of its own that shares the viewfinder's
     * textures and programs: for drivers that refuse a surface whose config differs from the context's. The frame is
     * drawn in the viewfinder's context into a texture and copied onto the encoder in this one.
     */
    RECORDABLE_OWN_CONTEXT;

    companion object {
        /** Recordable first, the context's own config as the fallback. */
        val DEFAULT_ORDER: List<EncoderConfig> = listOf(RECORDABLE_RGBA8888, CONTEXT)

        /** eglChooseConfig attributes of [RECORDABLE_RGBA8888]. */
        internal fun recordableRgba8888Attribs(): IntArray = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
            EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_NONE,
        )

        private const val EGL_OPENGL_ES3_BIT = 0x40
        private const val EGL_RECORDABLE_ANDROID = 0x3142
    }
}

/**
 * An EGL window surface on a [VideoSink]'s surface, in the viewfinder's own GL context (so its textures and programs
 * are shared). All calls on the GL thread.
 */
internal class EncoderSurface(private val sink: VideoSink) {
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE

    /** The encoder's own context ([EncoderConfig.RECORDABLE_OWN_CONTEXT]), or none: then [context] draws it. */
    private var own: EGLContext = EGL14.EGL_NO_CONTEXT

    /** The vertex array of the copy in [own] (vertex arrays aren't shared between contexts). */
    private var ownQuad: FullscreenQuad? = null
    private var savedDraw: EGLSurface = EGL14.EGL_NO_SURFACE
    private var savedRead: EGLSurface = EGL14.EGL_NO_SURFACE

    /** Creates the surface; false (and nothing left behind) when this device refuses it. */
    fun create(): Boolean {
        display = EGL14.eglGetCurrentDisplay()
        context = EGL14.eglGetCurrentContext()
        if (display == EGL14.EGL_NO_DISPLAY || context == EGL14.EGL_NO_CONTEXT) return false
        savedDraw = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
        savedRead = EGL14.eglGetCurrentSurface(EGL14.EGL_READ)
        for (attempt in sink.encoderConfigs) {
            val config = chooseConfig(attempt) ?: continue
            var drawContext = context
            if (attempt == EncoderConfig.RECORDABLE_OWN_CONTEXT) {
                val made = EGL14.eglCreateContext(display, config, context, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
                if (made == null || made == EGL14.EGL_NO_CONTEXT) continue
                drawContext = made
            }
            val created = EGL14.eglCreateWindowSurface(display, config, sink.surface, intArrayOf(EGL14.EGL_NONE), 0)
            if (created == null || created == EGL14.EGL_NO_SURFACE) {
                if (drawContext != context) EGL14.eglDestroyContext(display, drawContext)
                continue
            }
            if (EGL14.eglMakeCurrent(display, created, created, drawContext)) {
                surface = created
                if (drawContext != context) {
                    own = drawContext
                    ownQuad = FullscreenQuad()
                }
                val visual = IntArray(1)
                EGL14.eglGetConfigAttrib(display, config, EGL14.EGL_NATIVE_VISUAL_ID, visual, 0)
                Log.i(TAG, "encoder surface: $attempt, native format 0x${visual[0].toString(16)}")
                EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
                return true
            }
            EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
            EGL14.eglDestroySurface(display, created)
            if (drawContext != context) EGL14.eglDestroyContext(display, drawContext)
        }
        Log.w(TAG, "no EGL surface for the encoder (0x${EGL14.eglGetError().toString(16)})")
        return false
    }

    private fun chooseConfig(attempt: EncoderConfig): EGLConfig? {
        val attribs = when (attempt) {
            EncoderConfig.RECORDABLE_RGBA8888, EncoderConfig.RECORDABLE_OWN_CONTEXT -> EncoderConfig.recordableRgba8888Attribs()
            EncoderConfig.CONTEXT -> {
                val id = IntArray(1)
                if (!EGL14.eglQueryContext(display, context, EGL14.EGL_CONFIG_ID, id, 0)) return null
                intArrayOf(EGL14.EGL_CONFIG_ID, id[0], EGL14.EGL_NONE)
            }
        }
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) || count[0] < 1) return null
        return configs[0]
    }

    /** True when the encoder draws in a context of its own: the frame must reach it as a texture ([ownQuad]). */
    val ownContext: Boolean get() = own != EGL14.EGL_NO_CONTEXT

    /** The copy's vertex array in the encoder's own context (null without one). */
    val quad: FullscreenQuad? get() = ownQuad

    /** Makes the encoder's surface the current one (remembering the screen's), in its own context if it has one. */
    fun makeCurrent(): Boolean {
        savedDraw = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
        savedRead = EGL14.eglGetCurrentSurface(EGL14.EGL_READ)
        return EGL14.eglMakeCurrent(display, surface, surface, if (ownContext) own else context)
    }

    /** Hands the drawn frame to the encoder, stamped [ptsNs], and goes back to the screen's surface. */
    fun swapAndRestore(ptsNs: Long) {
        EGLExt.eglPresentationTimeANDROID(display, surface, ptsNs)
        EGL14.eglSwapBuffers(display, surface)
        EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
    }

    /** Goes back to the screen's surface without presenting. */
    fun restore() {
        EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
    }

    fun release() {
        if (surface != EGL14.EGL_NO_SURFACE) {
            // The screen's surface must be current again before the other one is destroyed.
            EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
            EGL14.eglDestroySurface(display, surface)
            surface = EGL14.EGL_NO_SURFACE
        }
        discardOwnContext()
    }

    /**
     * For a lost viewfinder context (nothing of it is current or usable any more): lets go of the surface and the
     * encoder's own context without making anything current.
     */
    fun discard() {
        if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
        surface = EGL14.EGL_NO_SURFACE
        discardOwnContext()
    }

    private fun discardOwnContext() {
        // Its vertex array goes with the context.
        ownQuad = null
        if (own != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, own)
        own = EGL14.EGL_NO_CONTEXT
    }

    private companion object {
        const val TAG = "RawBoyVideo"
    }
}
