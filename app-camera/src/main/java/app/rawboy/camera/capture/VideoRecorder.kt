package app.rawboy.camera.capture

import android.annotation.SuppressLint
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import app.rawboy.camera.Edition
import app.rawboy.gl.VideoSink
import java.io.IOException
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * One video file: HEVC (H.264 fallback) 1080p30 from the viewfinder's encoder surface ([sink], drawn by the renderer) plus stereo AAC
 * from the microphone, muxed to MP4 in Movies/RawBoy Camera. The picture already carries the look; nothing here knows
 * about colour.
 *
 * Use: [create] (on a worker thread), hand [sink] to the viewfinder, [stop] (on a worker thread) when done.
 * Timestamps: video frames carry the camera's own clock (the sensor timestamps are CLOCK_BOOTTIME on the Pixel, as
 * [SystemClock.elapsedRealtimeNanos]; if a phone reports another clock the first frame sets the offset), audio is
 * stamped from the same clock, both relative to [startNs].
 */
class VideoRecorder private constructor(
    private val resolver: ContentResolver,
    private val uri: Uri,
    private val descriptor: ParcelFileDescriptor,
    private val muxer: MediaMuxer,
    private val videoCodec: MediaCodec,
    private val audio: Audio?,
    val sink: VideoSink,
) {
    /** The microphone and its AAC encoder. */
    private class Audio(val record: AudioRecord, val codec: MediaCodec, val bufferBytes: Int)

    private val startNs = SystemClock.elapsedRealtimeNanos()
    private var clockOffsetNs = Long.MIN_VALUE
    private var lastVideoPtsNs = -1L

    private val lock = Any()
    private var videoTrack = -1
    private var audioTrack = -1
    private var muxerStarted = false
    private val waiting = ArrayList<Sample>()
    private class Sample(val track: Int, val data: ByteBuffer, val info: MediaCodec.BufferInfo)

    @Volatile
    private var stopAudio = false
    private var videoThread: Thread? = null
    private var audioThread: Thread? = null
    private var videoFrames = 0

    /** Elapsed recording time for the timer. */
    val elapsedMs: Long get() = (SystemClock.elapsedRealtimeNanos() - startNs) / 1_000_000

    /** True when the device refused the encoder surface, or no frame ever arrived. */
    val failed: Boolean get() = sink.failed

    val hasAudio: Boolean get() = audio != null

    private fun begin() {
        videoCodec.start()
        videoThread = Thread({ drainVideo() }, "RawBoy-video").also { it.start() }
        audio?.let { a ->
            a.codec.start()
            a.record.startRecording()
            audioThread = Thread({ runAudio(a) }, "RawBoy-audio").also { it.start() }
        }
    }

    /** Camera frame time -> presentation time in the file, or -1 for a frame before the start or out of order. */
    private fun presentationNs(cameraNs: Long): Long {
        if (clockOffsetNs == Long.MIN_VALUE) {
            val now = SystemClock.elapsedRealtimeNanos()
            clockOffsetNs = if (abs(now - cameraNs) < CLOCK_AGREES_NS) 0L else now - cameraNs
        }
        val pts = cameraNs + clockOffsetNs - startNs
        if (pts < 0 || pts <= lastVideoPtsNs) return -1
        lastVideoPtsNs = pts
        return pts
    }

    // ---- Muxing: samples wait until both tracks (video, and audio if any) exist ----

    private fun addTrack(format: MediaFormat, isVideo: Boolean) = synchronized(lock) {
        val index = muxer.addTrack(format)
        if (isVideo) videoTrack = index else audioTrack = index
        if (videoTrack >= 0 && (audio == null || audioTrack >= 0)) {
            muxer.start()
            muxerStarted = true
            for (s in waiting) muxer.writeSampleData(s.track, s.data, s.info)
            waiting.clear()
        }
    }

    private fun write(track: Int, data: ByteBuffer, info: MediaCodec.BufferInfo) = synchronized(lock) {
        if (muxerStarted) {
            muxer.writeSampleData(track, data, info)
        } else {
            // Copied: the codec takes its buffer back as soon as it is released.
            val copy = ByteBuffer.allocate(info.size)
            copy.put(data)
            copy.flip()
            waiting.add(Sample(track, copy, MediaCodec.BufferInfo().also { it.set(0, info.size, info.presentationTimeUs, info.flags) }))
        }
    }

    private fun drainVideo() {
        val info = MediaCodec.BufferInfo()
        try {
            while (true) {
                val index = videoCodec.dequeueOutputBuffer(info, TIMEOUT_US)
                when {
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> addTrack(videoCodec.outputFormat, isVideo = true)
                    index >= 0 -> {
                        val buffer = videoCodec.getOutputBuffer(index)
                        val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                        if (buffer != null && info.size > 0 && !config) {
                            buffer.position(info.offset)
                            buffer.limit(info.offset + info.size)
                            write(videoTrack, buffer, info)
                            videoFrames++
                        }
                        videoCodec.releaseOutputBuffer(index, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "video encoder stopped", e)
        }
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO was granted before create() built the AudioRecord
    private fun runAudio(a: Audio) {
        val pcm = ByteArray(a.bufferBytes)
        val info = MediaCodec.BufferInfo()
        var frames = 0L
        var firstPtsUs = -1L
        var inputDone = false
        try {
            while (true) {
                if (!inputDone) {
                    val read = a.record.read(pcm, 0, pcm.size)
                    if (read > 0) {
                        if (firstPtsUs < 0) {
                            // The first buffer ended now: it began one buffer's duration earlier.
                            val endUs = (SystemClock.elapsedRealtimeNanos() - startNs) / 1000
                            firstPtsUs = (endUs - read / BYTES_PER_FRAME * 1_000_000L / AUDIO_RATE).coerceAtLeast(0)
                        }
                        feedAudio(a.codec, pcm, read, firstPtsUs + frames * 1_000_000L / AUDIO_RATE)
                        frames += read / BYTES_PER_FRAME
                    }
                    if (stopAudio) {
                        val i = a.codec.dequeueInputBuffer(TIMEOUT_US * 10)
                        if (i >= 0) {
                            val pts = (if (firstPtsUs < 0) 0 else firstPtsUs) + frames * 1_000_000L / AUDIO_RATE
                            a.codec.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        }
                    }
                }
                // Every finished AAC frame, not one per microphone read: a read holds several frames' worth of
                // samples, so taking one output per read left the encoder's input full and feedAudio dropped most
                // of the sound (a 7 s clip held 1.7 s of audio with 1.3-1.5 s holes; Photos stalled and ran the
                // picture fast against that audio clock, VLC ignored it).
                while (true) {
                    val index = a.codec.dequeueOutputBuffer(info, if (inputDone) TIMEOUT_US else 0)
                    when {
                        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> addTrack(a.codec.outputFormat, isVideo = false)
                        index >= 0 -> {
                            val buffer = a.codec.getOutputBuffer(index)
                            val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                            if (buffer != null && info.size > 0 && !config) {
                                buffer.position(info.offset)
                                buffer.limit(info.offset + info.size)
                                write(audioTrack, buffer, info)
                            }
                            a.codec.releaseOutputBuffer(index, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                        }
                        else -> break
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "audio stopped", e)
        }
    }

    private fun feedAudio(codec: MediaCodec, pcm: ByteArray, size: Int, ptsUs: Long) {
        var offset = 0
        while (offset < size) {
            val i = codec.dequeueInputBuffer(TIMEOUT_US * 10)
            if (i < 0) return // the encoder is behind: drop the rest of this buffer rather than stall the microphone
            val input = codec.getInputBuffer(i) ?: return
            val n = minOf(input.capacity(), size - offset)
            input.clear()
            input.put(pcm, offset, n)
            codec.queueInputBuffer(i, 0, n, ptsUs + offset / BYTES_PER_FRAME * 1_000_000L / AUDIO_RATE, 0)
            offset += n
        }
    }

    /**
     * Ends the recording and finalises the file; blocking (up to a few seconds), so off the main thread. Returns the
     * file's Uri, or null when nothing was recorded (the empty entry is removed).
     */
    fun stop(): Uri? {
        // The renderer draws no more frames and lets go of the encoder's surface on its own thread; only then may the
        // encoder end its input. Not answered in time (camera stalled, view gone): end it anyway.
        sink.closing = true
        // The sound stops with the picture: it used to run on while the renderer let go (0.7-1.6 s of extra audio).
        stopAudio = true
        sink.requestRender()
        val deadline = SystemClock.uptimeMillis() + 800
        while (!sink.released && SystemClock.uptimeMillis() < deadline) Thread.sleep(10)
        runCatching { videoCodec.signalEndOfInputStream() }
        stopAudio = true
        videoThread?.join(5000)
        audioThread?.join(5000)
        runCatching { audio?.record?.stop() }
        var ok = videoFrames > 0
        synchronized(lock) {
            if (muxerStarted) {
                try {
                    muxer.stop()
                } catch (e: Exception) {
                    Log.w(TAG, "muxer stop", e)
                    ok = false
                }
            } else {
                ok = false
            }
        }
        runCatching { muxer.release() }
        runCatching { videoCodec.stop() }
        runCatching { videoCodec.release() }
        sink.surface.release()
        audio?.let {
            runCatching { it.codec.stop() }
            runCatching { it.codec.release() }
            runCatching { it.record.release() }
        }
        runCatching { descriptor.close() }
        return if (ok) {
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            uri
        } else {
            runCatching { resolver.delete(uri, null, null) }
            null
        }
    }

    companion object {
        private const val TAG = "RawBoyVideo"
        private const val TIMEOUT_US = 10_000L
        private const val CLOCK_AGREES_NS = 1_000_000_000L
        private const val AUDIO_RATE = 48_000
        private const val BYTES_PER_FRAME = 4 // 16-bit stereo
        private const val VIDEO_BITRATE = 16_000_000
        private const val AUDIO_BITRATE = 192_000

        /** A configured encoder of [mime] (surface input), or null when the device has none or refuses the format. */
        private fun videoCodecOf(width: Int, height: Int, mime: String): MediaCodec? {
            var codec: MediaCodec? = null
            try {
                val format = MediaFormat.createVideoFormat(mime, width, height).apply {
                    setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                    setInteger(MediaFormat.KEY_BIT_RATE, VIDEO_BITRATE)
                    setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                    setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
                    setInteger(
                        MediaFormat.KEY_PROFILE,
                        if (mime == MediaFormat.MIMETYPE_VIDEO_HEVC) MediaCodecInfo.CodecProfileLevel.HEVCProfileMain
                        else MediaCodecInfo.CodecProfileLevel.AVCProfileHigh,
                    )
                    // The picture is the display-referred look: tag it as ordinary SDR BT.709 video.
                    setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709)
                    setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
                    setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED)
                }
                codec = MediaCodec.createEncoderByType(mime)
                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                return codec
            } catch (e: Exception) {
                Log.w(TAG, "no $mime encoder", e)
                runCatching { codec?.release() }
                return null
            }
        }

        /** 1080p long side and short side; the file is landscape or portrait with the phone ([create]'s `turns`). */
        const val LONG_SIDE = 1920
        const val SHORT_SIDE = 1080

        /**
         * Sets up a recording of the viewfinder turned [turns] quarter turns (odd: the phone is sideways, a landscape
         * file). [withAudio]: stereo microphone, if RECORD_AUDIO is granted (the caller checks). Throws [IOException]
         * when the file or an encoder can't be made.
         */
        fun create(
            context: Context,
            turns: Int,
            withAudio: Boolean,
            requestRender: () -> Unit,
        ): VideoRecorder {
            val landscape = turns % 2 != 0
            val width = if (landscape) LONG_SIDE else SHORT_SIDE
            val height = if (landscape) SHORT_SIDE else LONG_SIDE

            val resolver = context.contentResolver
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, "VID_$stamp-${Edition.JPEG_SUFFIX}.mp4")
                put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/" + Edition.FOLDER + "/")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
                ?: throw IOException("Could not create the video file")
            var descriptor: ParcelFileDescriptor? = null
            var muxer: MediaMuxer? = null
            var video: MediaCodec? = null
            var surface: android.view.Surface? = null
            var microphone: Audio? = null
            try {
                descriptor = resolver.openFileDescriptor(uri, "w") ?: throw IOException("Could not open the video file")
                muxer = MediaMuxer(descriptor.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

                // HEVC first: the Pixel's player stalled for seconds on this app's grainy H.264 High files (the same
                // frames re-muxed with exact 30 fps times stalled too), while the camera's own videos play fine.
                // H.264 stays as the fallback for a device without an HEVC encoder.
                video = videoCodecOf(width, height, MediaFormat.MIMETYPE_VIDEO_HEVC)
                    ?: videoCodecOf(width, height, MediaFormat.MIMETYPE_VIDEO_AVC)
                    ?: throw IOException("No video encoder")
                surface = video.createInputSurface()

                if (withAudio) microphone = runCatching { audioOf() }.onFailure { Log.w(TAG, "no microphone", it) }.getOrNull()

                // Built last: the sink's callbacks need the recorder.
                lateinit var recorder: VideoRecorder
                val sink = VideoSink(
                    surface = surface,
                    width = width,
                    height = height,
                    turns = turns,
                    presentationNs = { recorder.presentationNs(it) },
                    requestRender = requestRender,
                )
                recorder = VideoRecorder(resolver, uri, descriptor, muxer, video, microphone, sink)
                recorder.begin()
                return recorder
            } catch (e: Exception) {
                runCatching { microphone?.record?.release() }
                runCatching { microphone?.codec?.release() }
                runCatching { video?.release() }
                runCatching { surface?.release() }
                runCatching { muxer?.release() }
                runCatching { descriptor?.close() }
                runCatching { resolver.delete(uri, null, null) }
                throw if (e is IOException) e else IOException(e.message ?: "Could not start the recording", e)
            }
        }

        @SuppressLint("MissingPermission")
        private fun audioOf(): Audio {
            val channels = AudioFormat.CHANNEL_IN_STEREO
            val encoding = AudioFormat.ENCODING_PCM_16BIT
            val minimum = AudioRecord.getMinBufferSize(AUDIO_RATE, channels, encoding)
            if (minimum <= 0) throw IOException("No stereo microphone")
            val bytes = (minimum * 2).coerceAtLeast(AUDIO_RATE / 10 * BYTES_PER_FRAME)
            // CAMCORDER tunes the microphones for video (direction follows the camera); plain MIC as the fallback.
            var record: AudioRecord? = null
            for (source in intArrayOf(MediaRecorder.AudioSource.CAMCORDER, MediaRecorder.AudioSource.MIC)) {
                val candidate = AudioRecord(source, AUDIO_RATE, channels, encoding, bytes)
                if (candidate.state == AudioRecord.STATE_INITIALIZED) {
                    record = candidate
                    break
                }
                candidate.release()
            }
            val microphone = record ?: throw IOException("Microphone unavailable")
            val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, AUDIO_RATE, 2).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BITRATE)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, bytes)
            }
            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            return Audio(microphone, codec, bytes)
        }
    }
}
