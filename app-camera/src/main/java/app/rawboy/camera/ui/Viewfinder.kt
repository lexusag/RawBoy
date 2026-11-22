package app.rawboy.camera.ui

import android.graphics.SurfaceTexture
import android.opengl.GLSurfaceView
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.rawboy.gl.RawPreviewFrames
import app.rawboy.gl.ShaderParams
import app.rawboy.gl.VideoSink
import app.rawboy.gl.ViewfinderRenderer
import javax.microedition.khronos.egl.EGL10
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.egl.EGLDisplay

/**
 * Component sizes for the viewfinder's EGL config ([GLSurfaceView.setEGLConfigChooser]). The config also sets the
 * format of the screen's buffers, and it is a recording's fallback encoder config ([app.rawboy.gl.EncoderConfig.CONTEXT]).
 * [recordable]: a config with EGL_RECORDABLE_ANDROID, so a recordable encoder surface matches the view's context.
 */
data class ViewfinderEglConfig(
    val red: Int,
    val green: Int,
    val blue: Int,
    val alpha: Int,
    val depth: Int = 0,
    val stencil: Int = 0,
    val recordable: Boolean = false,
) {
    companion object {
        /** [app.rawboy.camera.capture.VideoVariant.RECORDABLE_VIEWFINDER]'s config. */
        val RECORDABLE_RGBA8888 = ViewfinderEglConfig(8, 8, 8, 8, recordable = true)
    }
}

/**
 * The live camera preview, developed with [params] (see [ViewfinderRenderer]), with an optional focus [loupe]. While
 * [onLuma] is set it gets the renderer's greyscale copies (QR codes), while [onTrackLuma] is the small ones every frame
 * (the subject tracker). [videoSink]: the video encoder's surface while recording (see [ViewfinderRenderer.videoSink]); [videoMode] moves the grain with the frames. [turns]: clockwise quarter turns from the upright picture to the view (see
 * [ViewfinderRenderer.turns]). [eglConfig]: the view's EGL config; null leaves [GLSurfaceView]'s own
 * choice. Another config makes the view (and its renderer) again: a GL context's config is fixed, so the camera restarts
 * on the new view's surface.
 */
@Composable
fun Viewfinder(
    frame: ViewfinderRenderer.Frame?,
    params: ShaderParams?,
    onSurfaceTexture: (SurfaceTexture) -> Unit,
    onBase: (width: Int, height: Int, rgba: FloatArray) -> Unit,
    modifier: Modifier = Modifier,
    loupe: ViewfinderRenderer.Loupe? = null,
    onLuma: ((width: Int, height: Int, luma: ByteArray) -> Unit)? = null,
    onTrackLuma: ((width: Int, height: Int, luma: ByteArray) -> Unit)? = null,
    turns: Int = 0,
    zoom: Float = 1f,
    /** Raw viewfinder frames (prototype, see [ViewfinderRenderer.rawFrames]); used only while the frame says [ViewfinderRenderer.Frame.raw]. */
    rawFrames: RawPreviewFrames? = null,
    videoSink: VideoSink? = null,
    videoMode: Boolean = false,
    eglConfig: ViewfinderEglConfig? = null,
) {
    key(eglConfig) {
        val surfaceCallback = rememberUpdatedState(onSurfaceTexture)
        val baseCallback = rememberUpdatedState(onBase)
        val lumaCallback = rememberUpdatedState(onLuma)
        val trackCallback = rememberUpdatedState(onTrackLuma)
        val view = remember { arrayOfNulls<GLSurfaceView>(1) }
        val renderer = remember {
            ViewfinderRenderer(
                onSurfaceTexture = { surfaceCallback.value(it) },
                requestRender = { view[0]?.requestRender() },
                onBase = { w, h, rgba -> baseCallback.value(w, h, rgba) },
            )
        }

        AndroidView(
            modifier = modifier,
            factory = { context ->
                GLSurfaceView(context).apply {
                    setEGLContextClientVersion(3)
                    // Before setRenderer, as GLSurfaceView requires.
                    eglConfig?.let { c ->
                        if (c.recordable) setEGLConfigChooser(RecordableChooser(c)) else setEGLConfigChooser(c.red, c.green, c.blue, c.alpha, c.depth, c.stencil)
                    }
                    preserveEGLContextOnPause = true
                    setRenderer(renderer)
                    // Frames are drawn as the camera delivers them (SurfaceTexture's frame listener).
                    renderMode = GLSurfaceView.RENDERMODE_WHEN_DIRTY
                }.also { view[0] = it }
            },
        )

        LaunchedEffect(frame) {
            renderer.frame = frame
            view[0]?.requestRender()
        }
        LaunchedEffect(params) {
            renderer.params = params
            view[0]?.requestRender()
        }
        // Keyed on on/off only: a new lambda each recomposition mustn't restart it.
        LaunchedEffect(onLuma != null) {
            val forward: (Int, Int, ByteArray) -> Unit = { w, h, luma -> lumaCallback.value?.invoke(w, h, luma) }
            renderer.onLuma = forward.takeIf { onLuma != null }
        }
        LaunchedEffect(onTrackLuma != null) {
            val forward: (Int, Int, ByteArray) -> Unit = { w, h, luma -> trackCallback.value?.invoke(w, h, luma) }
            renderer.onTrackLuma = forward.takeIf { onTrackLuma != null }
        }
        LaunchedEffect(turns) {
            renderer.turns = turns
            view[0]?.requestRender()
        }
        LaunchedEffect(rawFrames) {
            renderer.rawFrames = rawFrames
        }
        LaunchedEffect(zoom) {
            renderer.zoom = zoom
            view[0]?.requestRender()
        }
        LaunchedEffect(videoSink) {
            renderer.videoSink = videoSink
            view[0]?.requestRender()
        }
        LaunchedEffect(videoMode) {
            renderer.animateGrain = videoMode
            view[0]?.requestRender()
        }
        LaunchedEffect(loupe) {
            renderer.loupe = loupe
            view[0]?.requestRender()
        }

        val lifecycleOwner = LocalLifecycleOwner.current
        DisposableEffect(lifecycleOwner) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_RESUME -> view[0]?.onResume()
                    Lifecycle.Event.ON_PAUSE -> view[0]?.onPause()
                    else -> Unit
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
                view[0]?.onPause()
                renderer.release()
            }
        }
    }
}

/**
 * A GLES 3 window config of [c]'s sizes with EGL_RECORDABLE_ANDROID. Without one (the device reports none), the same
 * sizes without the flag, then any GLES 3 window config: a remembered video variant must never stop the viewfinder.
 */
private class RecordableChooser(private val c: ViewfinderEglConfig) : GLSurfaceView.EGLConfigChooser {
    override fun chooseConfig(egl: EGL10, display: EGLDisplay): EGLConfig {
        val sizes = intArrayOf(
            EGL10.EGL_RED_SIZE, c.red, EGL10.EGL_GREEN_SIZE, c.green, EGL10.EGL_BLUE_SIZE, c.blue, EGL10.EGL_ALPHA_SIZE, c.alpha,
            EGL10.EGL_DEPTH_SIZE, c.depth, EGL10.EGL_STENCIL_SIZE, c.stencil,
        )
        val base = intArrayOf(EGL10.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL10.EGL_SURFACE_TYPE, EGL10.EGL_WINDOW_BIT)
        for (attribs in listOf(base + sizes + intArrayOf(EGL_RECORDABLE_ANDROID, 1), base + sizes, base)) {
            val configs = arrayOfNulls<EGLConfig>(1)
            val count = IntArray(1)
            if (egl.eglChooseConfig(display, attribs + EGL10.EGL_NONE, configs, 1, count) && count[0] > 0) {
                configs[0]?.let { return it }
            }
            Log.w("RawBoyViewfinder", "no EGL config for ${attribs.joinToString()}")
        }
        throw IllegalStateException("No GLES 3 window config")
    }

    private companion object {
        const val EGL_OPENGL_ES3_BIT = 0x40
        const val EGL_RECORDABLE_ANDROID = 0x3142
    }
}
