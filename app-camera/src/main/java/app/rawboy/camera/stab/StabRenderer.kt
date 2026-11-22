package app.rawboy.camera.stab

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer
import kotlin.math.abs

/**
 * Renders a stabilized copy of a video: decodes it into a SurfaceTexture, draws each output frame of a [StabPlan]
 * as a warped mesh into a video encoder's surface, and muxes that with the original audio (copied as is). Output
 * frames keep the recording's timing, so the sound stays in step. Blocking; run it off the main thread.
 */
class StabRenderer(
    private val plan: StabPlan,
    /** Opens the source video. */
    private val source: (MediaExtractor) -> Unit,
    /** The muxer the copy is written into. */
    private val muxer: MediaMuxer,
) {
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE

    /** Renders everything; [progress] gets the share done (0..1) now and then. */
    fun run(progress: (Float) -> Unit = {}) {
        val videoIn = MediaExtractor().also(source)
        val audioIn = MediaExtractor().also(source)
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var encoderSurface: Surface? = null
        var texture: SurfaceTexture? = null
        var decoderSurface: Surface? = null
        val callbacks = HandlerThread("RawBoy-stab-frames").apply { start() }
        try {
            val videoTrack = trackOf(videoIn, "video/") ?: throw IOException("no video track")
            val audioTrack = trackOf(audioIn, "audio/")
            videoIn.selectTrack(videoTrack)
            audioTrack?.let(audioIn::selectTrack)
            val inFormat = videoIn.getTrackFormat(videoTrack)
            val width = inFormat.getInteger(MediaFormat.KEY_WIDTH)
            val height = inFormat.getInteger(MediaFormat.KEY_HEIGHT)
            val mime = inFormat.getString(MediaFormat.KEY_MIME)!!
            if (inFormat.containsKey(MediaFormat.KEY_ROTATION)) muxer.setOrientationHint(inFormat.getInteger(MediaFormat.KEY_ROTATION))

            encoder = encoderFor(mime, width, height, inFormat)
                ?: encoderFor(MediaFormat.MIMETYPE_VIDEO_AVC, width, height, inFormat)
                ?: throw IOException("no video encoder")
            encoderSurface = encoder.createInputSurface()
            encoder.start()
            setUpEgl(encoderSurface)
            val program = MeshProgram()

            val oes = IntArray(1).also { GLES20.glGenTextures(1, it, 0) }[0]
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oes)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            val st = SurfaceTexture(oes)
            texture = st
            val frameLock = Object()
            var frameReady = false
            st.setOnFrameAvailableListener({
                synchronized(frameLock) {
                    frameReady = true
                    frameLock.notifyAll()
                }
            }, Handler(callbacks.looper))
            decoderSurface = Surface(st)
            decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(inFormat, decoderSurface, null, 0)
            decoder.start()

            val mux = Mux(muxer, encoder, audioIn, audioTrack)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var decodeDone = false
            var next = 0 // the next output frame
            val texMatrix = FloatArray(16)
            val outputs = plan.outputs
            // Encoded index of each decoded frame, matched by presentation time.
            val sourcePtsUs = sourcePtsUs()
            while (!decodeDone) {
                if (!inputDone) {
                    val i = decoder.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        val n = videoIn.readSampleData(decoder.getInputBuffer(i)!!, 0)
                        if (n < 0) {
                            decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            decoder.queueInputBuffer(i, 0, n, videoIn.sampleTime, 0)
                            videoIn.advance()
                        }
                    }
                }
                mux.drain(false)
                val o = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
                if (o < 0) continue
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) decodeDone = true
                val hasFrame = info.size > 0 || info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM == 0
                val j = nearest(sourcePtsUs, info.presentationTimeUs)
                decoder.releaseOutputBuffer(o, hasFrame)
                if (!hasFrame) continue
                synchronized(frameLock) {
                    val deadline = System.currentTimeMillis() + FRAME_WAIT_MS
                    while (!frameReady) {
                        val left = deadline - System.currentTimeMillis()
                        if (left <= 0) throw IOException("decoder frame didn't arrive")
                        frameLock.wait(left)
                    }
                    frameReady = false
                }
                st.updateTexImage()
                st.getTransformMatrix(texMatrix)
                // Every output frame up to this source: normally one, two where the recorder lost a frame (held).
                while (next < outputs.size && outputs[next].source <= j) {
                    val grid = plan.warp(next, GRID_X, GRID_Y)
                    program.draw(oes, texMatrix, grid, width, height)
                    EGLExt.eglPresentationTimeANDROID(display, surface, outputs[next].ptsNs)
                    EGL14.eglSwapBuffers(display, surface)
                    mux.drain(false)
                    next++
                }
                progress(next.toFloat() / outputs.size)
            }
            // The last frame sent through the surface can still be on its way into the encoder; ending the stream
            // at once lost it (every copy was a frame short). Wait until the encoder has given out what was drawn.
            val deadline = System.currentTimeMillis() + LAST_FRAME_WAIT_MS
            while (mux.written < next && System.currentTimeMillis() < deadline) {
                mux.drain(false)
                if (mux.written < next) Thread.sleep(5)
            }
            encoder.signalEndOfInputStream()
            mux.drain(true)
            mux.finishAudio()
            Log.i(TAG, "stabilized: ${outputs.size} frames (${outputs.count { it.hold }} held), $next drawn, ${mux.written} written, crop ${plan.crop}, eased ${"%.2f".format(plan.eased)}")
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            decoderSurface?.release()
            texture?.release()
            releaseEgl()
            encoderSurface?.release()
            callbacks.quitSafely()
            videoIn.release()
            audioIn.release()
        }
    }

    /** The encoded frames' file times (µs), in file order: the motion data's ENCODED pts. */
    private fun sourcePtsUs(): LongArray = plan.sourcePtsNs.map { it / 1000 }.toLongArray()

    private fun nearest(a: LongArray, v: Long): Int {
        val i = a.binarySearch(v).let { if (it >= 0) return it else -it - 1 }
        if (i <= 0) return 0
        if (i >= a.size) return a.size - 1
        return if (abs(a[i - 1] - v) <= abs(a[i] - v)) i - 1 else i
    }

    private fun trackOf(e: MediaExtractor, prefix: String): Int? =
        (0 until e.trackCount).firstOrNull { e.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(prefix) == true }

    private fun encoderFor(mime: String, width: Int, height: Int, source: MediaFormat): MediaCodec? {
        val format = MediaFormat.createVideoFormat(mime, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, if (source.containsKey(MediaFormat.KEY_BIT_RATE)) source.getInteger(MediaFormat.KEY_BIT_RATE) else DEFAULT_BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
            setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
            // The source's colour description (flat videos are Rec.2020): the pixels pass through unchanged.
            fun color(key: String, default: Int) = setInteger(key, if (source.containsKey(key)) source.getInteger(key) else default)
            color(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709)
            color(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
            color(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED)
        }
        val codec = runCatching { MediaCodec.createEncoderByType(mime) }.getOrNull() ?: return null
        return try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec
        } catch (e: Exception) {
            Log.w(TAG, "encoder $mime refused ${width}x$height", e)
            codec.release()
            null
        }
    }

    private fun setUpEgl(window: Surface) {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }
        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL_RECORDABLE_ANDROID, 1, EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0) { "no recordable EGL config" }
        context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
        surface = EGL14.eglCreateWindowSurface(display, configs[0], window, intArrayOf(EGL14.EGL_NONE), 0)
        check(surface != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed" }
        check(EGL14.eglMakeCurrent(display, surface, surface, context)) { "eglMakeCurrent failed" }
    }

    private fun releaseEgl() {
        if (display == EGL14.EGL_NO_DISPLAY) return
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
        if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
        EGL14.eglTerminate(display)
        display = EGL14.EGL_NO_DISPLAY
    }

    /**
     * The encoder's output and the audio into the muxer. The muxer starts once the encoder knows its format; audio
     * samples follow the video, each written once the video has passed its time, so the two stay interleaved.
     */
    private class Mux(
        private val muxer: MediaMuxer,
        private val encoder: MediaCodec,
        private val audio: MediaExtractor,
        audioTrack: Int?,
    ) {
        private val audioFormat = audioTrack?.let { audio.getTrackFormat(it) }
        private var videoOut = -1

        /** Video frames written, for the log. */
        var written = 0
            private set
        private var audioOut = -1
        private var started = false
        private var audioDone = audioTrack == null
        private val info = MediaCodec.BufferInfo()
        private val audioBuffer = ByteBuffer.allocateDirect(1 shl 20)
        private val audioInfo = MediaCodec.BufferInfo()

        fun drain(end: Boolean) {
            while (true) {
                val o = encoder.dequeueOutputBuffer(info, if (end) TIMEOUT_US else 0)
                when {
                    o == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!end) return
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        videoOut = muxer.addTrack(encoder.outputFormat)
                        audioFormat?.let { audioOut = muxer.addTrack(it) }
                        muxer.start()
                        started = true
                    }
                    o >= 0 -> {
                        val buffer = encoder.getOutputBuffer(o)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && started) {
                            buffer.position(info.offset).limit(info.offset + info.size)
                            muxer.writeSampleData(videoOut, buffer, info)
                            written++
                            writeAudioUntil(info.presentationTimeUs)
                        }
                        encoder.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }

        private fun writeAudioUntil(us: Long) {
            while (!audioDone && started) {
                val t = audio.sampleTime
                if (t < 0) {
                    audioDone = true
                    return
                }
                if (t > us) return
                audioBuffer.clear()
                val n = audio.readSampleData(audioBuffer, 0)
                if (n < 0) {
                    audioDone = true
                    return
                }
                audioInfo.set(0, n, t, if (audio.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                muxer.writeSampleData(audioOut, audioBuffer, audioInfo)
                audio.advance()
            }
        }

        /** The audio after the last video frame. */
        fun finishAudio() = writeAudioUntil(Long.MAX_VALUE)
    }

    /** Draws the camera texture through a grid whose points sample [grid]'s source positions. */
    private class MeshProgram {
        private val program: Int
        private val aPos: Int
        private val aTex: Int
        private val uMatrix: Int
        private val uTex: Int
        private val positions: FloatBuffer
        private val coords: FloatBuffer
        private val indices: ShortBuffer
        private val indexCount: Int

        init {
            program = link(VERTEX, FRAGMENT)
            aPos = GLES20.glGetAttribLocation(program, "aPos")
            aTex = GLES20.glGetAttribLocation(program, "aTex")
            uMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
            uTex = GLES20.glGetUniformLocation(program, "uTex")
            val p = FloatArray(GRID_X * GRID_Y * 2)
            for (j in 0 until GRID_Y) for (i in 0 until GRID_X) {
                val o = (j * GRID_X + i) * 2
                p[o] = 2f * i / (GRID_X - 1) - 1f
                p[o + 1] = 1f - 2f * j / (GRID_Y - 1) // row 0 = the top of the picture
            }
            positions = floats(p)
            coords = ByteBuffer.allocateDirect(p.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
            val idx = ShortArray((GRID_X - 1) * (GRID_Y - 1) * 6)
            var k = 0
            for (j in 0 until GRID_Y - 1) for (i in 0 until GRID_X - 1) {
                val a = (j * GRID_X + i).toShort()
                val b = (a + 1).toShort()
                val c = (a + GRID_X).toShort()
                val d = (c + 1).toShort()
                idx[k++] = a; idx[k++] = c; idx[k++] = b
                idx[k++] = b; idx[k++] = c; idx[k++] = d
            }
            indexCount = k
            indices = ByteBuffer.allocateDirect(idx.size * 2).order(ByteOrder.nativeOrder()).asShortBuffer().put(idx).also { it.position(0) }
        }

        fun draw(texture: Int, texMatrix: FloatArray, grid: FloatArray, width: Int, height: Int) {
            // Source fractions (top-left origin) -> texture coordinates before the SurfaceTexture's matrix (bottom-left).
            coords.position(0)
            for (i in 0 until grid.size / 2) {
                coords.put(grid[2 * i])
                coords.put(1f - grid[2 * i + 1])
            }
            coords.position(0)
            GLES20.glViewport(0, 0, width, height)
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
            GLES20.glUniform1i(uTex, 0)
            GLES20.glUniformMatrix4fv(uMatrix, 1, false, texMatrix, 0)
            GLES20.glEnableVertexAttribArray(aPos)
            GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, positions)
            GLES20.glEnableVertexAttribArray(aTex)
            GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 0, coords)
            GLES20.glDrawElements(GLES20.GL_TRIANGLES, indexCount, GLES20.GL_UNSIGNED_SHORT, indices)
        }

        private fun floats(a: FloatArray): FloatBuffer =
            ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(a).also { it.position(0) }

        private fun link(vs: String, fs: String): Int {
            fun compile(type: Int, src: String): Int {
                val s = GLES20.glCreateShader(type)
                GLES20.glShaderSource(s, src)
                GLES20.glCompileShader(s)
                val ok = IntArray(1)
                GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
                check(ok[0] != 0) { "shader: " + GLES20.glGetShaderInfoLog(s) }
                return s
            }
            val p = GLES20.glCreateProgram()
            GLES20.glAttachShader(p, compile(GLES20.GL_VERTEX_SHADER, vs))
            GLES20.glAttachShader(p, compile(GLES20.GL_FRAGMENT_SHADER, fs))
            GLES20.glLinkProgram(p)
            val ok = IntArray(1)
            GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
            check(ok[0] != 0) { "program: " + GLES20.glGetProgramInfoLog(p) }
            return p
        }

        companion object {
            const val VERTEX = """
                attribute vec2 aPos;
                attribute vec2 aTex;
                uniform mat4 uTexMatrix;
                varying vec2 vTex;
                void main() {
                    gl_Position = vec4(aPos, 0.0, 1.0);
                    vTex = (uTexMatrix * vec4(aTex, 0.0, 1.0)).xy;
                }
            """
            const val FRAGMENT = """
                #extension GL_OES_EGL_image_external : require
                precision mediump float;
                uniform samplerExternalOES uTex;
                varying vec2 vTex;
                void main() { gl_FragColor = texture2D(uTex, vTex); }
            """
        }
    }

    companion object {
        private const val TAG = "RawBoyStab"
        private const val TIMEOUT_US = 10_000L
        private const val FRAME_WAIT_MS = 2_500L
        private const val LAST_FRAME_WAIT_MS = 1_000L
        private const val DEFAULT_BITRATE = 16_000_000
        private const val EGL_RECORDABLE_ANDROID = 0x3142

        /** Mesh points across and down: the rolling shutter bends rows, so rows are dense enough to follow it. */
        const val GRID_X = 33
        const val GRID_Y = 33
    }
}
