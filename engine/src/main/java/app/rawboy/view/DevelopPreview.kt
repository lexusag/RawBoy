package app.rawboy.view

import android.opengl.GLSurfaceView
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.rawboy.gl.DetailTile
import app.rawboy.gl.DevelopRenderer
import app.rawboy.gl.FrameColor
import app.rawboy.gl.PreviewImage
import app.rawboy.gl.ShaderParams

@Composable
fun DevelopPreview(
    image: PreviewImage?,
    params: ShaderParams,
    zoomCenter: Pair<Float, Float>?,
    detail: DetailTile?,
    frameWidth: Int,
    frameColor: FrameColor,
    modifier: Modifier = Modifier,
    /** Empty space around the frame in the fit view, pixels (the mask tool's room for handles). */
    margin: Int = 0,
    /** Marks clipped highlights red and crushed shadows blue (Pro's histogram toggles it). */
    clipWarning: Boolean = false,
    /** View pixels per full-resolution pixel while zoomed (1 = 100%; a pinch sets others). */
    zoomScale: Float = 1f,
    /**
     * Shown over the view until its first frame with the photo is on screen. A new GLSurfaceView shows an empty
     * hole while it builds the develop program and uploads the image, so without it the photo blinks out
     * (Auto's pager makes a new view for each photo swiped to).
     */
    placeholder: (@Composable () -> Unit)? = null,
) {
    val renderer = remember { DevelopRenderer() }
    var view by remember { mutableStateOf<GLSurfaceView?>(null) }
    var drawn by remember { mutableStateOf(false) }

    Box(modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                GLSurfaceView(context).apply {
                    setEGLContextClientVersion(3)
                    preserveEGLContextOnPause = true
                    setRenderer(renderer)
                    renderMode = GLSurfaceView.RENDERMODE_WHEN_DIRTY
                }.also { view = it }
            },
        )
        if (placeholder != null && !drawn) placeholder()
    }
    if (placeholder != null) {
        // Set before the view is attached, so its first frame can't be missed.
        DisposableEffect(renderer) {
            val main = Handler(Looper.getMainLooper())
            renderer.onPhotoDrawn = {
                renderer.onPhotoDrawn = null
                // Two vsyncs: the frame is swapped after onDrawFrame returns and composited on a later vsync.
                main.post {
                    val choreographer = Choreographer.getInstance()
                    choreographer.postFrameCallback { choreographer.postFrameCallback { drawn = true } }
                }
            }
            onDispose { renderer.onPhotoDrawn = null }
        }
    }

    LaunchedEffect(image, view) {
        renderer.setImage(image)
        view?.requestRender()
    }
    LaunchedEffect(params, view) {
        renderer.params = params
        view?.requestRender()
    }
    LaunchedEffect(detail, view) {
        renderer.setDetail(detail)
        view?.requestRender()
    }
    LaunchedEffect(frameWidth, frameColor, margin, view) {
        renderer.frameWidth = frameWidth
        renderer.frameGrey = frameColor.level
        renderer.margin = margin
        view?.requestRender()
    }
    LaunchedEffect(clipWarning, view) {
        renderer.clipWarning = clipWarning
        view?.requestRender()
    }
    LaunchedEffect(zoomCenter, zoomScale, view) {
        renderer.zoom = zoomCenter?.let { it to zoomScale }
        view?.requestRender()
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, view) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> view?.onResume()
                Lifecycle.Event.ON_PAUSE -> view?.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
}
