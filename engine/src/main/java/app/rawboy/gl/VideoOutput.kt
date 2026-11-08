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
    /** Camera frame timestamp (ns, the SurfaceTexture's) -> presentation time (ns) of the encoded frame, or < 0 to skip the frame. */
    val presentationNs: (cameraTimestampNs: Long) -> Long,
    /** Asks the view for a frame (so a stop is noticed even if the camera has stalled). */
    val requestRender: () -> Unit,
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
}

/**
 * An EGL window surface on a [VideoSink]'s surface, in the viewfinder's own GL context (so its textures and programs
 * are shared). All calls on the GL thread.
 */
internal class EncoderSurface(private val sink: VideoSink) {
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var savedDraw: EGLSurface = EGL14.EGL_NO_SURFACE
    private var savedRead: EGLSurface = EGL14.EGL_NO_SURFACE

    /** Creates the surface; false (and nothing left behind) when this device refuses it. */
    fun create(): Boolean {
        display = EGL14.eglGetCurrentDisplay()
        context = EGL14.eglGetCurrentContext()
        if (display == EGL14.EGL_NO_DISPLAY || context == EGL14.EGL_NO_CONTEXT) return false
        savedDraw = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
        savedRead = EGL14.eglGetCurrentSurface(EGL14.EGL_READ)
        // The recordable flag is what MediaCodec's surfaces are meant for; the context's own config is the fallback
        // (always compatible with the context).
        for (recordable in booleanArrayOf(true, false)) {
            val config = chooseConfig(recordable) ?: continue
            val created = EGL14.eglCreateWindowSurface(display, config, sink.surface, intArrayOf(EGL14.EGL_NONE), 0)
            if (created == null || created == EGL14.EGL_NO_SURFACE) continue
            if (EGL14.eglMakeCurrent(display, created, created, context)) {
                surface = created
                EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
                return true
            }
            EGL14.eglMakeCurrent(display, savedDraw, savedRead, context)
            EGL14.eglDestroySurface(display, created)
        }
        Log.w(TAG, "no EGL surface for the encoder (0x${EGL14.eglGetError().toString(16)})")
        return false
    }

    private fun chooseConfig(recordable: Boolean): EGLConfig? {
        val attribs = if (recordable) {
            intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
                EGL_RECORDABLE_ANDROID, 1,
                EGL14.EGL_NONE,
            )
        } else {
            val id = IntArray(1)
            if (!EGL14.eglQueryContext(display, context, EGL14.EGL_CONFIG_ID, id, 0)) return null
            intArrayOf(EGL14.EGL_CONFIG_ID, id[0], EGL14.EGL_NONE)
        }
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) || count[0] < 1) return null
        return configs[0]
    }

    /** Makes the encoder's surface the current one (remembering the screen's). */
    fun makeCurrent(): Boolean {
        savedDraw = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW)
        savedRead = EGL14.eglGetCurrentSurface(EGL14.EGL_READ)
        return EGL14.eglMakeCurrent(display, surface, surface, context)
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
    }

    private companion object {
        const val TAG = "RawBoyVideo"
        const val EGL_OPENGL_ES3_BIT = 0x40
        const val EGL_RECORDABLE_ANDROID = 0x3142
    }
}
