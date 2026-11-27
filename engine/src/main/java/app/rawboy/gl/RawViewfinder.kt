package app.rawboy.gl

import android.opengl.GLES30
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicReference

/**
 * The raw viewfinder (prototype, `PreviewProfile.rawViewfinder`): the camera streams RAW_SENSOR frames next to the
 * preview, and the viewfinder's pass 1 builds its linear Rec.2020 image from them instead of from the ISP's preview.
 * Preview and shot then come from the same sensor data through the same colour maths, so no preview colour matrix,
 * tone-curve inverse or per-lens preview gain calibration is needed.
 *
 * One frame: a copy of the sensor data (16-bit, one plane) and the levels it is decoded with, as `decoder_libraw.cpp`
 * decodes a DNG: (raw − black) / (white − black) − extra black, times the lens shading gain, times the white balance
 * multipliers normalised to the largest (LibRaw's pre_mul), camera RGB → Rec.2020 with the raw decoder's matrix.
 * Demosaicing is a 2×2 bin (one RGB pixel per CFA block, the greens averaged): half the sensor's resolution, about the
 * screen's, so it costs nothing a full demosaic would.
 */
class RawPreviewFrame internal constructor(
    /** The sensor data, native byte order, [rowStride] bytes per row; owned by [RawPreviewFrames]' pool. */
    internal val data: ByteBuffer,
) {
    var width = 0
        internal set
    var height = 0
        internal set
    /** Bytes per row of [data] (whole 16-bit samples). */
    var rowStride = 0
        internal set
    /** Camera2's SENSOR_INFO_COLOR_FILTER_ARRANGEMENT: 0 RGGB, 1 GRBG, 2 GBRG, 3 BGGR. */
    var cfa = 0
        internal set
    /** Black per 2×2 position, row-major, in DN. */
    val black = FloatArray(4)
    var white = 1023f
        internal set
    /** White balance multipliers (R, G, B), normalised so the largest is 1. */
    val wb = FloatArray(3)
    /** White-balanced camera RGB → Rec.2020, GL column-major. */
    val color = FloatArray(9)
    var extraBlack = 0f
        internal set
    /** Lens shading gains (R, G averaged, B, 1) on a [shadingCols] × [shadingRows] grid over the sensor; empty = none. */
    var shading = FloatArray(0)
        internal set
    var shadingCols = 0
        internal set
    var shadingRows = 0
        internal set
    var timestampNs = 0L
        internal set
}

/**
 * Hands raw frames from the camera thread to the GL thread: [offer] copies a frame into a free buffer of a small pool
 * (a frame is dropped when all are in use, rather than blocking the camera thread), the renderer [take]s the newest and
 * gives it back with [recycle] once uploaded. The camera's own Image is closed as soon as it is copied, so the raw
 * reader never runs out of buffers for a still.
 */
class RawPreviewFrames(private val poolSize: Int = 3) {
    private val free = ArrayBlockingQueue<RawPreviewFrame>(poolSize)
    private val latest = AtomicReference<RawPreviewFrame?>(null)
    private var capacity = 0

    /** Called after each new frame (the renderer asks for a draw). */
    @Volatile
    var onFrame: (() -> Unit)? = null

    /** While true, incoming frames are ignored without copying and any waiting frame is recycled. */
    @Volatile
    var paused: Boolean = false
        set(value) {
            field = value
            if (value) clear()
        }

    @Volatile
    var copied = 0L
        private set
    @Volatile
    var dropped = 0L
        private set

    /**
     * Copies one frame. [plane] is the Image's plane 0 (16-bit samples, pixel stride 2); the rest as [RawPreviewFrame].
     * [colorRowMajor]: white-balanced camera RGB → linear sRGB (LibRaw's rgb_cam), row-major. Camera thread.
     */
    @Synchronized
    fun offer(
        plane: ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        cfa: Int,
        black: FloatArray,
        white: Float,
        neutral: FloatArray,
        colorRowMajor: DoubleArray,
        extraBlack: Float,
        shading: FloatArray?,
        shadingCols: Int,
        shadingRows: Int,
        timestampNs: Long,
    ) {
        if (paused) return
        val bytes = rowStride * height
        if (bytes != capacity) {
            // A new size (another lens): a new pool. Frames still out are dropped when they come back.
            free.clear()
            capacity = bytes
            repeat(poolSize) { free.offer(RawPreviewFrame(ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder()))) }
        }
        val frame = free.poll() ?: run { dropped++; return }
        val src = plane.duplicate()
        src.rewind()
        val dst = frame.data
        dst.clear()
        // The last row may be short of rowStride in the Image's buffer.
        if (src.remaining() > dst.remaining()) src.limit(src.position() + dst.remaining())
        dst.put(src)
        dst.rewind()
        frame.width = width
        frame.height = height
        frame.rowStride = rowStride
        frame.cfa = cfa
        black.copyInto(frame.black, endIndex = 4)
        frame.white = white
        val mul = FloatArray(3) { 1f / neutral[it] }
        val maxMul = mul.max()
        for (c in 0 until 3) frame.wb[c] = mul[c] / maxMul
        // sRGB → Rec.2020 × camera → sRGB, column-major.
        val s = SRGB_TO_REC2020_ROW_MAJOR
        for (row in 0 until 3) for (col in 0 until 3) {
            var sum = 0.0
            for (k in 0 until 3) sum += s[row * 3 + k] * colorRowMajor[k * 3 + col]
            frame.color[col * 3 + row] = sum.toFloat()
        }
        frame.extraBlack = extraBlack
        frame.shading = shading ?: FloatArray(0)
        frame.shadingCols = if (shading != null) shadingCols else 0
        frame.shadingRows = if (shading != null) shadingRows else 0
        frame.timestampNs = timestampNs
        copied++
        latest.getAndSet(frame)?.let(::recycle)
        onFrame?.invoke()
    }

    /** The newest frame not yet taken, or null. GL thread; give it back with [recycle]. */
    fun take(): RawPreviewFrame? = latest.getAndSet(null)

    /** Returns a frame to the pool (dropped if the pool has moved on to another size). */
    @Synchronized
    fun recycle(frame: RawPreviewFrame) {
        if (frame.data.capacity() == capacity) free.offer(frame)
    }

    /** Forgets the frame waiting, e.g. when the lens changes. */
    fun clear() {
        latest.getAndSet(null)?.let(::recycle)
    }

    private companion object {
        /** Linear sRGB → Rec.2020 primaries, row-major (the viewfinder's SRGB_TO_REC2020, transposed). */
        val SRGB_TO_REC2020_ROW_MAJOR = doubleArrayOf(
            0.6274040, 0.3292820, 0.0433136,
            0.0690970, 0.9195400, 0.0113612,
            0.0163916, 0.0880132, 0.8955950,
        )
    }
}

/**
 * Pass 1 from a raw frame: the sensor data as an R16UI texture, binned 2×2 and decoded as [RawPreviewFrame] describes,
 * rotated upright (and mirrored, zoomed) exactly as [ViewfinderRenderer]'s preview pass does, into its linear target.
 */
internal class RawLinearizeProgram {
    private val id = GlUtil.createProgram(VERTEX, FRAGMENT)
    private val uRaw = GLES30.glGetUniformLocation(id, "uRaw")
    private val uShading = GLES30.glGetUniformLocation(id, "uShadingMap")
    private val uHasShading = GLES30.glGetUniformLocation(id, "uHasShading")
    private val uRotation = GLES30.glGetUniformLocation(id, "uRotation")
    private val uMirror = GLES30.glGetUniformLocation(id, "uMirror")
    private val uZoom = GLES30.glGetUniformLocation(id, "uZoom")
    private val uCrop = GLES30.glGetUniformLocation(id, "uCrop")
    private val uBlocks = GLES30.glGetUniformLocation(id, "uBlocks")
    private val uColourAt = GLES30.glGetUniformLocation(id, "uColourAt")
    private val uBlack = GLES30.glGetUniformLocation(id, "uBlack")
    private val uRange = GLES30.glGetUniformLocation(id, "uRange")
    private val uExtraBlack = GLES30.glGetUniformLocation(id, "uExtraBlack")
    private val uWb = GLES30.glGetUniformLocation(id, "uWb")
    private val uColor = GLES30.glGetUniformLocation(id, "uColor")
    private val uScale = GLES30.glGetUniformLocation(id, "uScale")

    private var rawTexture = 0
    private var rawWidth = 0
    private var rawHeight = 0
    private var shadingTexture = 0
    private var shadingCols = 0
    private var shadingRows = 0
    private var shadingUploaded: FloatArray? = null
    private val levels = FloatArray(4)

    /** Uploads [frame]'s sensor data and shading map. GL thread. */
    fun upload(frame: RawPreviewFrame) {
        if (rawTexture == 0 || rawWidth != frame.width || rawHeight != frame.height) {
            if (rawTexture != 0) GLES30.glDeleteTextures(1, intArrayOf(rawTexture), 0)
            val ids = IntArray(1)
            GLES30.glGenTextures(1, ids, 0)
            rawTexture = ids[0]
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, rawTexture)
            GLES30.glTexStorage2D(GLES30.GL_TEXTURE_2D, 1, GLES30.GL_R16UI, frame.width, frame.height)
            // Integer textures can't be filtered; texelFetch only.
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST)
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST)
            rawWidth = frame.width
            rawHeight = frame.height
        }
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, rawTexture)
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 2)
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ROW_LENGTH, frame.rowStride / 2)
        frame.data.rewind()
        GLES30.glTexSubImage2D(
            GLES30.GL_TEXTURE_2D, 0, 0, 0, frame.width, frame.height, GLES30.GL_RED_INTEGER, GLES30.GL_UNSIGNED_SHORT, frame.data,
        )
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ROW_LENGTH, 0)
        GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 4)

        if (frame.shadingCols > 0 && !frame.shading.contentEquals(shadingUploaded)) {
            if (shadingTexture == 0 || shadingCols != frame.shadingCols || shadingRows != frame.shadingRows) {
                if (shadingTexture != 0) GLES30.glDeleteTextures(1, intArrayOf(shadingTexture), 0)
                val ids = IntArray(1)
                GLES30.glGenTextures(1, ids, 0)
                shadingTexture = ids[0]
                GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadingTexture)
                GLES30.glTexStorage2D(GLES30.GL_TEXTURE_2D, 1, GLES30.GL_RGBA16F, frame.shadingCols, frame.shadingRows)
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
                GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
                shadingCols = frame.shadingCols
                shadingRows = frame.shadingRows
            }
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadingTexture)
            GLES30.glTexSubImage2D(
                GLES30.GL_TEXTURE_2D, 0, 0, 0, shadingCols, shadingRows, GLES30.GL_RGBA, GLES30.GL_FLOAT,
                FloatBuffer.wrap(frame.shading),
            )
            shadingUploaded = frame.shading.copyOf()
        }
    }

    /** True once a frame has been uploaded. */
    val ready get() = rawTexture != 0

    /**
     * Draws the last uploaded frame (its levels in [frame]) into the bound target. [cropX]/[cropY]: share of the
     * sensor's width/height shown (the preview's aspect, as the ISP's preview would show it); [scale]: gain to the
     * shot's raw units.
     */
    fun draw(
        quad: FullscreenQuad, frame: RawPreviewFrame, rotation: Int, mirror: Boolean, zoom: Float,
        cropX: Float, cropY: Float, scale: Float,
    ) {
        GLES30.glUseProgram(id)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, rawTexture)
        GLES30.glUniform1i(uRaw, 0)
        val shaded = shadingTexture != 0 && frame.shadingCols > 0
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, if (shaded) shadingTexture else 0)
        GLES30.glUniform1i(uShading, 1)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glUniform1f(uHasShading, if (shaded) 1f else 0f)
        GLES30.glUniform1i(uRotation, ((rotation / 90) % 4 + 4) % 4)
        GLES30.glUniform1f(uMirror, if (mirror) 1f else 0f)
        GLES30.glUniform1f(uZoom, zoom)
        GLES30.glUniform2f(uCrop, cropX, cropY)
        GLES30.glUniform2i(uBlocks, frame.width / 2, frame.height / 2)
        val colours = colourOf(frame.cfa)
        GLES30.glUniform4i(uColourAt, colours[0], colours[1], colours[2], colours[3])
        GLES30.glUniform4fv(uBlack, 1, frame.black, 0)
        for (i in 0 until 4) levels[i] = 1f / (frame.white - frame.black[i]).coerceAtLeast(1f)
        GLES30.glUniform4fv(uRange, 1, levels, 0)
        GLES30.glUniform1f(uExtraBlack, frame.extraBlack)
        GLES30.glUniform3fv(uWb, 1, frame.wb, 0)
        GLES30.glUniformMatrix3fv(uColor, 1, false, frame.color, 0)
        GLES30.glUniform1f(uScale, scale)
        quad.draw()
    }

    companion object {
        /** Colour (0 R, 1 G, 2 B) at each 2×2 position, row-major, as `RawMeter`. */
        fun colourOf(cfa: Int): IntArray = when (cfa) {
            1 -> intArrayOf(1, 0, 2, 1) // GRBG
            2 -> intArrayOf(1, 2, 0, 1) // GBRG
            3 -> intArrayOf(2, 1, 1, 0) // BGGR
            else -> intArrayOf(0, 1, 1, 2) // RGGB
        }

        private const val VERTEX = """#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUp; // upright image coordinates, y = 0 at the top
void main() {
    vUp = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
"""

        private const val FRAGMENT = """#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uRaw;
uniform sampler2D uShadingMap; // (R, G, B, 1) gains over the whole sensor
uniform float uHasShading;
uniform int uRotation;   // clockwise quarter turns from sensor to upright
uniform float uMirror;   // 1: show a mirror image
uniform float uZoom;     // digital zoom: the centre 1/uZoom of the frame
uniform vec2 uCrop;      // share of the sensor's width / height shown (centred)
uniform ivec2 uBlocks;   // 2x2 CFA blocks across / down
uniform ivec4 uColourAt; // colour (0 R, 1 G, 2 B) at each 2x2 position, row-major
uniform vec4 uBlack;     // per 2x2 position, DN
uniform vec4 uRange;     // 1 / (white - black) per position
uniform float uExtraBlack;
uniform vec3 uWb;        // white balance multipliers, largest 1
uniform mat3 uColor;     // white-balanced camera RGB -> Rec.2020
uniform float uScale;
in vec2 vUp;
out vec4 fragColor;

void main() {
    vec2 zoomed = 0.5 + (vUp - 0.5) / uZoom;
    float u = mix(zoomed.x, 1.0 - zoomed.x, uMirror);
    float v = zoomed.y;
    // Sensor position (y = 0 at the sensor's top row) that lands at (u, v) after rotating clockwise.
    vec2 b;
    if (uRotation == 1) b = vec2(v, 1.0 - u);
    else if (uRotation == 2) b = vec2(1.0 - u, 1.0 - v);
    else if (uRotation == 3) b = vec2(1.0 - v, u);
    else b = vec2(u, v);
    b = 0.5 + (b - 0.5) * uCrop;
    ivec2 block = clamp(ivec2(b * vec2(uBlocks)), ivec2(0), uBlocks - 1);
    ivec2 p = block * 2;
    vec4 raw = vec4(
        float(texelFetch(uRaw, p, 0).r),
        float(texelFetch(uRaw, p + ivec2(1, 0), 0).r),
        float(texelFetch(uRaw, p + ivec2(0, 1), 0).r),
        float(texelFetch(uRaw, p + ivec2(1, 1), 0).r));
    vec4 n = (raw - uBlack) * uRange - uExtraBlack;
    vec3 cam = vec3(0.0);
    vec3 count = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        int c = uColourAt[i];
        cam[c] += n[i];
        count[c] += 1.0;
    }
    cam /= max(count, vec3(1.0));
    // Nearest clip before shading and white balance, for the highlight blend below.
    float peak = max(max(cam.r, cam.g), cam.b);
    if (uHasShading > 0.5) {
        vec2 grid = vec2(textureSize(uShadingMap, 0));
        vec2 st = (b * (grid - 1.0) + 0.5) / grid;
        cam *= texture(uShadingMap, st).rgb;
    }
    cam *= uWb;
    // Blown channels to neutral, as the decoder blends clipped pixels (a simple stand-in for blendClipped).
    float hi = max(max(cam.r, cam.g), cam.b);
    cam = mix(cam, vec3(hi), smoothstep(0.9, 1.0, peak));
    fragColor = vec4(uColor * max(cam, vec3(0.0)) * uScale, 1.0);
}
"""
    }
}
