package app.rawboy.camera.depth

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.ImageReader
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.rawboy.camera.capture.DualPixelStream
import app.rawboy.camera.i18n.tr
import app.rawboy.retouch.DualPixelDepth
import app.rawboy.retouch.DualPixelMetric
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Session
import com.google.ar.core.exceptions.NotYetAvailableException
import com.google.ar.core.exceptions.UnavailableException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.EnumSet
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.abs
import kotlin.math.min

/**
 * Settings › Experimental › Calibrate dual-pixel distances: measures the main lens's dual-pixel constants
 * ([app.rawboy.retouch.DualPixelCalibration]) against ARCore's depth, once per phone.
 *
 * ARCore (Google Play Services for AR) shares its back camera (on the Pixel 9 Pro the logical camera 0, RawBoy's W)
 * with RawBoy's own dual-pixel stream on the physical camera behind it ([DualPixelStream]). While the user moves the
 * phone (ARCore's depth comes from motion), each raw depth frame is paired with the dual-pixel frame of the same
 * exposure and the lens's focus distance; the dual-pixel shift is sampled where ARCore is confident, and
 * [DualPixelMetric.calibrate] fits the line once there is enough defocus spread. Saved in [DualPixelCalibrations].
 */
class DepthCalibrationActivity : Activity(), GLSurfaceView.Renderer {
    private lateinit var glView: GLSurfaceView
    /** What to do: stays on screen the whole time (it used to be replaced by the progress within a second). */
    private lateinit var instructions: TextView
    private lateinit var status: TextView
    private lateinit var finishButton: Button
    private val cameraThread = HandlerThread("RawBoy-calibration").apply { start() }
    private val handler = Handler(cameraThread.looper)
    private val executor = Executor { handler.post(it) }
    private val workThread = HandlerThread("RawBoy-calibration-work").apply { start() }
    private val work = Handler(workThread.looper)

    private var session: Session? = null
    private var camera: CameraDevice? = null
    private var capture: CameraCaptureSession? = null
    private var dpReader: ImageReader? = null
    @Volatile private var running = false
    private var textureId = -1

    /** Dual-pixel frames and focus distances by sensor timestamp, the last ~12 frames. */
    private val dpFrames = ConcurrentHashMap<Long, ByteArray>()
    private val focusAt = ConcurrentHashMap<Long, Float>()
    private var dpSize = DualPixelStream.RAW_DEPTH10 to (0 to 0)
    private val busy = AtomicBoolean(false)
    private var depthFrames = 0

    // Samples (work thread): defocus x = 1/z − D from ARCore, shift d from the dual pixel.
    private val xs = ArrayList<Float>()
    private val ds = ArrayList<Float>()
    private var pairs = 0
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        glView = GLSurfaceView(this).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setRenderer(this@DepthCalibrationActivity)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        instructions = TextView(this).apply {
            setTextColor(Color.WHITE)
            setBackgroundColor(0x99000000.toInt())
            textSize = 17f
            setPadding(48, 48, 48, 24)
            text = tr("Point the camera at a scene with near and far things (0.3 to 3 m), then move the phone slowly from side to side. Aim close and far now and then.")
        }
        status = TextView(this).apply {
            setTextColor(Color.WHITE)
            setBackgroundColor(0x99000000.toInt())
            textSize = 16f
            setPadding(48, 48, 48, 48)
        }
        finishButton = Button(this).apply {
            text = tr("Cancel")
            setOnClickListener { finish() }
        }
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(instructions)
            addView(status)
            addView(finishButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.END; setMargins(0, 24, 48, 0) })
        }
        setContentView(FrameLayout(this).apply {
            addView(glView)
            addView(overlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply { bottomMargin = 96 })
        })
        say(tr("Starting the camera…"))
    }

    private fun say(text: String) = runOnUiThread { status.text = text }

    override fun onResume() {
        super.onResume()
        if (session == null && !createSession()) return
        glView.onResume()
        handler.post { runCatching { openCamera() }.onFailure { fail("Camera: ${it.message}") } }
    }

    override fun onPause() {
        running = false
        glView.onPause()
        handler.post { closeCamera() }
        super.onPause()
    }

    override fun onDestroy() {
        handler.post { closeCamera(); session?.close(); session = null }
        cameraThread.quitSafely()
        workThread.quitSafely()
        super.onDestroy()
    }

    /** ARCore installed and the shared-camera session made; else a message and false. */
    private fun createSession(): Boolean {
        try {
            when (ArCoreApk.getInstance().requestInstall(this, true)) {
                ArCoreApk.InstallStatus.INSTALL_REQUESTED -> return false // resumed again after the install
                ArCoreApk.InstallStatus.INSTALLED -> Unit
            }
            val s = Session(this, EnumSet.of(Session.Feature.SHARED_CAMERA))
            if (!s.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY)) {
                s.close()
                fail(tr("This phone's ARCore has no depth: calibration isn't possible here."))
                return false
            }
            s.configure(s.config.apply {
                depthMode = Config.DepthMode.RAW_DEPTH_ONLY
                focusMode = Config.FocusMode.AUTO
            })
            session = s
            return true
        } catch (e: UnavailableException) {
            fail(tr("ARCore (Google Play Services for AR) isn't available: ") + e.javaClass.simpleName)
        } catch (e: Exception) {
            fail("ARCore: ${e.message}")
        }
        return false
    }

    private fun fail(message: String) {
        Log.w(TAG, message)
        running = false
        runOnUiThread {
            status.text = message
            instructions.visibility = android.view.View.GONE
            finishButton.text = tr("Close")
        }
    }

    @SuppressLint("MissingPermission") // CameraActivity holds the permission before Settings can open this
    private fun openCamera() {
        val s = session ?: return
        val manager = getSystemService(CameraManager::class.java)
        val cameraId = s.cameraConfig.cameraId
        calibratedCamera = cameraId
        val chars = manager.getCameraCharacteristics(cameraId)
        chars.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)?.let { if (it.height() > 0) sensorAspect = it.width().toFloat() / it.height() }
        val stream = DualPixelStream.find(manager, cameraId, chars)
            ?: return fail(tr("This lens has no dual-pixel stream."))
        val reader = ImageReader.newInstance(stream.size.width, stream.size.height, stream.format, 6)
        dpSize = stream.format to (stream.size.width to stream.size.height)
        reader.setOnImageAvailableListener({ r ->
            r.acquireNextImage()?.use { img ->
                val pl = img.planes[0]
                if (dpRowStride == 0) dpRowStride = pl.rowStride
                dpFrames[img.timestamp] = ByteArray(pl.buffer.remaining()).also { pl.buffer.get(it) }
                while (dpFrames.size > 12) dpFrames.keys.minOrNull()?.let { dpFrames.remove(it) }
            }
        }, handler)
        dpReader = reader
        val shared = s.sharedCamera
        shared.setAppSurfaces(cameraId, listOf(reader.surface))
        manager.openCamera(cameraId, shared.createARDeviceStateCallback(object : CameraDevice.StateCallback() {
            override fun onOpened(c: CameraDevice) {
                camera = c
                startCapture(c, stream)
            }
            override fun onDisconnected(c: CameraDevice) = fail(tr("The camera was taken by another app."))
            override fun onError(c: CameraDevice, error: Int) = fail("Camera error $error")
        }, handler), handler)
    }

    @Volatile private var dpRowStride = 0

    /** The camera ARCore opened (RawBoy's W on a logical back camera): the calibration's key, as `Shot.cameraId`. */
    @Volatile private var calibratedCamera = ""

    /** The sensor's width / height in sensor orientation (ARCore's picture is a band of it). */
    @Volatile private var sensorAspect = 4f / 3f

    private fun startCapture(c: CameraDevice, stream: DualPixelStream) {
        val s = session ?: return
        val shared = s.sharedCamera
        val reader = dpReader ?: return
        val arSurfaces: List<Surface> = shared.arCoreSurfaces
        // The stream belongs to a physical camera behind the logical one: whichever the phone accepts next to ARCore's.
        val outputs = stream.cameraIds.map { physical ->
            arSurfaces.map { OutputConfiguration(it) } + OutputConfiguration(reader.surface).also { o -> physical?.let { o.setPhysicalCameraId(it) } }
        }.firstOrNull { o ->
            runCatching { c.isSessionConfigurationSupported(SessionConfiguration(SessionConfiguration.SESSION_REGULAR, o, executor, NO_STATE)) }.getOrDefault(false)
        } ?: return fail(tr("The phone doesn't stream dual pixel next to ARCore."))
        c.createCaptureSession(SessionConfiguration(SessionConfiguration.SESSION_REGULAR, outputs, executor, shared.createARSessionStateCallback(object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(cs: CameraCaptureSession) {
                capture = cs
                // Results of ARCore's own requests: the lens's focus distance per frame.
                shared.setCaptureCallback(object : CameraCaptureSession.CaptureCallback() {
                    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                        val ts = result.get(CaptureResult.SENSOR_TIMESTAMP) ?: return
                        result.get(CaptureResult.LENS_FOCUS_DISTANCE)?.let { focusAt[ts] = it }
                        while (focusAt.size > 64) focusAt.keys.minOrNull()?.let { focusAt.remove(it) }
                    }
                }, handler)
                try {
                    s.resume()
                    val request = c.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                        arSurfaces.forEach(::addTarget)
                        addTarget(reader.surface)
                    }
                    cs.setRepeatingRequest(request.build(), null, handler)
                    running = true
                } catch (e: Exception) {
                    fail("ARCore: ${e.message}")
                }
            }
            override fun onConfigureFailed(cs: CameraCaptureSession) = fail(tr("The phone doesn't stream dual pixel next to ARCore."))
        }, handler)))
    }

    private fun closeCamera() {
        running = false
        runCatching { session?.pause() }
        runCatching { capture?.close() }
        capture = null
        runCatching { camera?.close() }
        camera = null
        dpReader?.close()
        dpReader = null
    }

    // GL thread: the camera picture behind the instructions, and ARCore's frames.

    private var program = 0
    private val quad: FloatBuffer = floatBuf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val uv: FloatBuffer = floatBuf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f)

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        textureId = IntArray(1).also { GLES20.glGenTextures(1, it, 0) }[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        program = linkProgram(
            "attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv; void main() { vUv = aUv; gl_Position = vec4(aPos, 0.0, 1.0); }",
            "#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 vUv; uniform samplerExternalOES uTex; void main() { gl_FragColor = texture2D(uTex, vUv); }",
        )
        session?.setCameraTextureName(textureId)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        @Suppress("DEPRECATION")
        session?.setDisplayGeometry(windowManager.defaultDisplay.rotation, width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        val s = session ?: return
        if (!running) return
        val frame = try {
            s.setCameraTextureName(textureId)
            s.update()
        } catch (e: Exception) {
            return
        }
        if (frame.hasDisplayGeometryChanged()) {
            quad.position(0); uv.position(0)
            frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad, Coordinates2d.TEXTURE_NORMALIZED, uv)
        }
        if (frame.timestamp != 0L) drawCamera()
        try {
            frame.acquireRawDepthImage16Bits().use { depth ->
                depthFrames++
                // A pair at most every ~10 frames, and only while the last is being worked out (~1 s each).
                if (done || depthFrames % 10 != 0 || !busy.compareAndSet(false, true)) return@use
                val cameraTs = depth.timestamp - (frame.timestamp - frame.androidCameraTimestamp)
                val dpTs = dpFrames.keys.minByOrNull { abs(it - cameraTs) }?.takeIf { abs(it - cameraTs) < 10_000_000 }
                val focusTs = focusAt.keys.minByOrNull { abs(it - cameraTs) }?.takeIf { abs(it - cameraTs) < 10_000_000 }
                val dp = dpTs?.let { dpFrames[it] }
                val focus = focusTs?.let { focusAt[it] }
                if (dp == null || focus == null || focus <= 0f) {
                    busy.set(false)
                    return@use
                }
                frame.acquireRawDepthConfidenceImage().use { conf ->
                    val w = depth.width
                    val h = depth.height
                    val mm = ShortArray(w * h)
                    val dPlane = depth.planes[0]
                    val db = dPlane.buffer.order(ByteOrder.LITTLE_ENDIAN)
                    val c = ByteArray(w * h)
                    val cPlane = conf.planes[0]
                    for (y in 0 until h) for (x in 0 until w) {
                        mm[y * w + x] = db.getShort(y * dPlane.rowStride + x * dPlane.pixelStride)
                        c[y * w + x] = cPlane.buffer.get(y * cPlane.rowStride + x * cPlane.pixelStride)
                    }
                    work.post { addPair(dp, focus, mm, c, w, h) }
                }
            }
        } catch (_: NotYetAvailableException) {
        } catch (_: IllegalStateException) {
        }
    }

    /** Work thread: samples one pair (ARCore's confident pixels against the dual pixel there). */
    private fun addPair(dp: ByteArray, focus: Float, mm: ShortArray, conf: ByteArray, w: Int, h: Int) {
        try {
            val (format, size) = dpSize
            val m = DualPixelDepth.measure(dp, size.first, size.second, dpRowStride, format) ?: return
            // ARCore's depth covers its own (16:9) picture: the full sensor width and the middle of its height.
            val depthAspect = w.toFloat() / h
            val heightShare = min(1f, sensorAspect / depthAspect)
            var added = 0
            for (y in 0 until h) for (x in 0 until w) {
                if ((conf[y * w + x].toInt() and 0xff) < 200) continue
                val z = mm[y * w + x].toInt() and 0xffff
                if (z <= 0) continue
                val su = (x + 0.5f) / w
                val sv = 0.5f + ((y + 0.5f) / h - 0.5f) * heightShare
                xs += 1000f / z - focus
                ds += m.smoothAt(su, sv)
                added++
            }
            pairs++
            Log.d(TAG, "pair $pairs: focus $focus D, $added samples (total ${xs.size})")
            progress()
        } finally {
            busy.set(false)
        }
    }

    private fun progress() {
        val x = xs.toFloatArray()
        val spread = if (x.size > 100) DualPixelDepth.percentile(x, 0.95f) - DualPixelDepth.percentile(x, 0.05f) else 0f
        val enough = x.size >= TARGET_SAMPLES && spread >= TARGET_SPREAD && pairs >= MIN_PAIRS
        say(tr("Keep moving slowly. Samples: ") + "${x.size} / $TARGET_SAMPLES, " + tr("depth range: ") +
            "%.1f / %.1f D".format(spread, TARGET_SPREAD) + (if (spread < TARGET_SPREAD) "\n" + tr("Aim at something nearer and something farther.") else ""))
        if (enough && !done) {
            done = true
            when (val fit = DualPixelMetric.calibrate(x, ds.toFloatArray())) {
                is DualPixelMetric.Fit.Ok -> {
                    DualPixelCalibrations.put(this, calibratedCamera, fit.calibration)
                    Log.d(TAG, "calibrated: $fit from $pairs pairs")
                    runOnUiThread {
                        instructions.visibility = android.view.View.GONE
                        status.text = tr("Calibrated. Photos on the main lens with Depth from: Dual pixel now save distances in millimetres.") +
                            "\n(%.3f px/D, %d samples)".format(fit.calibration.slope, fit.calibration.samples)
                        finishButton.text = tr("Done")
                    }
                    handler.post { closeCamera() }
                }
                is DualPixelMetric.Fit.Failed -> {
                    Log.w(TAG, "calibration failed: ${fit.why}")
                    fail(tr("Calibration failed, try again with more near and far things: ") + fit.why)
                    handler.post { closeCamera() }
                }
            }
        }
    }

    private fun drawCamera() {
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        val pos = GLES20.glGetAttribLocation(program, "aPos")
        val tex = GLES20.glGetAttribLocation(program, "aUv")
        quad.position(0); uv.position(0)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glVertexAttribPointer(tex, 2, GLES20.GL_FLOAT, false, 0, uv)
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glEnableVertexAttribArray(tex)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }

    private fun linkProgram(vs: String, fs: String): Int {
        fun shader(type: Int, src: String) = GLES20.glCreateShader(type).also { GLES20.glShaderSource(it, src); GLES20.glCompileShader(it) }
        return GLES20.glCreateProgram().also {
            GLES20.glAttachShader(it, shader(GLES20.GL_VERTEX_SHADER, vs))
            GLES20.glAttachShader(it, shader(GLES20.GL_FRAGMENT_SHADER, fs))
            GLES20.glLinkProgram(it)
        }
    }

    private companion object {
        const val TAG = "RawBoyCalibration"

        const val TARGET_SAMPLES = 20_000
        const val TARGET_SPREAD = 1.0f
        const val MIN_PAIRS = 12

        val NO_STATE = object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) = Unit
            override fun onConfigureFailed(session: CameraCaptureSession) = Unit
        }

        fun floatBuf(vararg v: Float): FloatBuffer =
            ByteBuffer.allocateDirect(v.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(v); position(0) }
    }
}
