package app.rawboy.export

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import app.rawboy.gl.OffscreenDeveloper
import app.rawboy.gl.PixelRect
import app.rawboy.gl.ScanScale
import app.rawboy.gl.ShaderParams
import app.rawboy.raw.RawImage
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ceil
import kotlin.math.floor

/**
 * A GL context for exports, kept between exports made on one thread (the camera develops shot after
 * shot): saves creating the context and compiling the develop shader each time. Create, use and close
 * it on the same thread.
 */
class ExportGpu(private val lowPriority: Boolean = false) : AutoCloseable {
    private var developer: OffscreenDeveloper? = null

    internal fun developer(imageWidth: Int, imageHeight: Int): OffscreenDeveloper =
        (developer ?: OffscreenDeveloper(imageWidth, imageHeight, lowPriority).also { developer = it })
            .also { it.setImageSize(imageWidth, imageHeight) }

    override fun close() {
        developer?.close()
        developer = null
    }
}

/**
 * Develops the full-resolution image on the GPU in tiles and writes JPEG or TIFF
 * to Pictures/<folder>/ (see [OutputNaming]). Blocking: call from a background thread and don't
 * suspend inside, because the EGL context is bound to the calling thread.
 */
class Exporter(private val context: Context) {
    private var gpu: ExportGpu? = null

    /** The export in progress is a film scan (see [ExportSettings.filmScan]). */
    private var scan = false

    /**
     * Returns the display name of the written file. [gpu] reuses a GL context across exports made on
     * the same thread (otherwise each export creates and compiles its own).
     */
    fun export(
        image: RawImage,
        source: Uri?,
        sourceName: String,
        params: ShaderParams,
        settings: ExportSettings,
        naming: OutputNaming = OutputNaming(),
        gpu: ExportGpu? = null,
        onProgress: (Float) -> Unit,
    ): String = exportFile(image, source, sourceName, params, settings, naming, gpu, onProgress).name

    /** The written file's display name and MediaStore item. */
    class Exported(val name: String, val uri: Uri)

    /** As [export], also returning the file's MediaStore item (saves the caller a query by name). */
    fun exportFile(
        image: RawImage,
        source: Uri?,
        sourceName: String,
        params: ShaderParams,
        settings: ExportSettings,
        naming: OutputNaming = OutputNaming(),
        gpu: ExportGpu? = null,
        onProgress: (Float) -> Unit,
    ): Exported {
        this.gpu = gpu
        // Film scan: Film mode rendered 1.5x larger (the size setting doesn't apply to it).
        scan = settings.filmScan && ScanScale.applies(params)
        val resolver = context.contentResolver
        val (uri, name) = MediaStoreOutput.create(resolver, MediaStoreOutput.baseNameOf(sourceName), settings.format, naming)
        val size = if (scan) ScanScale.size(params.lens.outputWidth, params.lens.outputHeight)
        else BandDownscaler.outputSize(params.lens.outputWidth, params.lens.outputHeight, settings.maxLongSide)
        try {
            when (settings.format) {
                ExportFormat.JPEG -> if (settings.jpegEncoder == JpegEncoder.JPEGLI) {
                    // jpegli writes the EXIF as it starts the file: no rewrite of the finished JPEG.
                    val exif = source?.let { readExif(it) ?: ExifMetadata() }
                        ?.let { if (settings.description.isBlank()) it else it.copy(description = settings.description) }
                    writeJpegli(image, uri, params, size, settings.jpegQuality, settings.downscaleSharpen, exif, settings.hdrGainMap, onProgress)
                } else {
                    writeJpeg(image, uri, params, size, settings.jpegQuality, settings.downscaleSharpen, onProgress)
                }
                ExportFormat.TIFF -> writeTiff(image, uri, params, size, settings.tiffBits, source?.let(::readExif)
                    ?.let { if (settings.description.isBlank()) it else it.copy(description = settings.description) }, settings.downscaleSharpen, onProgress)
            }
            val t = System.nanoTime()
            if (settings.format == ExportFormat.JPEG && settings.jpegEncoder != JpegEncoder.JPEGLI && source != null) copyExif(source, uri)
            MediaStoreOutput.publish(resolver, uri)
            Log.d(TAG, "EXIF + publish ${(System.nanoTime() - t) / 1_000_000} ms")
            return Exported(name, uri)
        } catch (t: Throwable) {
            resolver.delete(uri, null, null)
            throw t
        }
    }

    private fun writeJpeg(image: RawImage, uri: Uri, params: ShaderParams, size: Pair<Int, Int>, quality: Int, sharpen: Float, onProgress: (Float) -> Unit) {
        val w = size.first
        val bitmap = Bitmap.createBitmap(w, size.second, Bitmap.Config.ARGB_8888)
        try {
            var argb = IntArray(0)
            renderOutput(image, params, size, sharpen, onProgress) { y, rows, band ->
                val n = w * rows
                if (argb.size < n) argb = IntArray(n)
                for (i in 0 until n) {
                    argb[i] = (0xff shl 24) or
                        (to8(band[i * 3]) shl 16) or (to8(band[i * 3 + 1]) shl 8) or to8(band[i * 3 + 2])
                }
                bitmap.setPixels(argb, 0, w, 0, y, w, rows)
            }
            context.contentResolver.openOutputStream(uri, "w")?.use { out ->
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) throw IOException("JPEG encoding failed")
            } ?: throw IOException("Cannot write $uri")
        } finally {
            bitmap.recycle()
        }
    }

    /** jpegli streams each band as it is developed, at full 16-bit precision, so no full-size bitmap is held. */
    private fun writeJpegli(
        image: RawImage,
        uri: Uri,
        params: ShaderParams,
        size: Pair<Int, Int>,
        quality: Int,
        sharpen: Float,
        exif: ExifMetadata?,
        hdrGainMap: Boolean,
        onProgress: (Float) -> Unit,
    ) {
        // Laid out before the encoder starts; metadata is best effort, as copyExif's was.
        val app1 = exif?.let { runCatching { ExifWriter.jpegApp1Payload(it) }.getOrNull() }
        val pfd = context.contentResolver.openFileDescriptor(uri, "w") ?: throw IOException("Cannot write $uri")
        pfd.use {
            val handle = if (hdrGainMap) JpegNative.beginGainMap(it.fd, size.first, size.second, quality)
            else JpegNative.begin(it.fd, size.first, size.second, quality)
            try {
                app1?.let { bytes -> JpegNative.writeExif(handle, bytes) }
                renderOutput(image, params, size, sharpen, onProgress) { _, rows, band -> JpegNative.writeRows(handle, band, rows) }
            } catch (t: Throwable) {
                JpegNative.abort(handle)
                throw t
            }
            JpegNative.finish(handle)
        }
    }

    private fun writeTiff(
        image: RawImage,
        uri: Uri,
        params: ShaderParams,
        size: Pair<Int, Int>,
        bits: Int,
        exif: ExifMetadata?,
        sharpen: Float,
        onProgress: (Float) -> Unit,
    ) {
        // Read-write: the header goes in last, in front of the compressed strips.
        val pfd = context.contentResolver.openFileDescriptor(uri, "rw") ?: throw IOException("Cannot write $uri")
        pfd.use {
            // The stream doesn't own the descriptor; closing pfd closes it.
            val writer = TiffWriter(FileOutputStream(it.fileDescriptor).channel, size.first, size.second, bits, exif)
            renderOutput(image, params, size, sharpen, onProgress) { _, rows, band -> writer.writeRows(band, rows) }
            writer.finish()
        }
    }

    /**
     * Renders the image at [size] (the full output size, or smaller: then the full-resolution bands are
     * area-downscaled as they stream, then sharpened by [sharpen], and the grain is sized to the smaller output; or
     * a film scan, [scan]: [ScanScale.SCALE] times larger). Same callback as [renderBands].
     */
    private fun renderOutput(
        image: RawImage,
        params: ShaderParams,
        size: Pair<Int, Int>,
        sharpen: Float,
        onProgress: (Float) -> Unit,
        consume: (y: Int, rows: Int, band: ShortArray) -> Unit,
    ) {
        val w = params.lens.outputWidth
        val h = params.lens.outputHeight
        if (scan) return renderBands(image, params, 1f, ScanScale.SCALE, onProgress, consume)
        if (size.first == w && size.second == h) return renderBands(image, params, 1f, 1f, onProgress, consume)
        var encodeNs = 0L
        var scaleNs = 0L
        BandDownscaler(w, h, size.first, size.second, TILE_HEIGHT, sharpen) { y, rows, band ->
            val t = System.nanoTime()
            consume(y, rows, band)
            encodeNs += System.nanoTime() - t
        }.use { scaler ->
            // A grain cell at least one output pixel, as a full-size render of the smaller image would have.
            val minGrain = maxOf(w, h).toFloat() / maxOf(size.first, size.second)
            renderBands(image, params, minGrain, 1f, onProgress) { _, rows, band ->
                val t = System.nanoTime()
                scaler.push(rows, band)
                scaleNs += System.nanoTime() - t
            }
            val t = System.nanoTime()
            scaler.finish()
            scaleNs += System.nanoTime() - t
        }
        Log.d(TAG, "export to ${size.first}x${size.second}: downscale ${(scaleNs - encodeNs) / 1_000_000} ms, encode ${encodeNs / 1_000_000} ms")
    }

    /**
     * Renders the image top to bottom in bands of [TILE_HEIGHT] rows. [minGrainPx]: smallest grain cell
     * in full-resolution pixels (see [renderOutput]). [scale] > 1 (film scan): the tiles are in output pixels, [scale]
     * times the photo's; each one's source region is upscaled first.
     * [consume] receives (firstRow, rowCount, RGB samples as unsigned 16-bit in a ShortArray).
     */
    private fun renderBands(
        image: RawImage,
        params: ShaderParams,
        minGrainPx: Float,
        scale: Float,
        onProgress: (Float) -> Unit,
        consume: (y: Int, rows: Int, band: ShortArray) -> Unit,
    ) {
        // Output size: rotation by 90 degrees swaps width and height.
        val (w, h) = if (scale > 1f) ScanScale.size(params.lens.outputWidth, params.lens.outputHeight)
        else Pair(params.lens.outputWidth, params.lens.outputHeight)
        val tilesX = (w + TILE_WIDTH - 1) / TILE_WIDTH
        val tilesY = (h + TILE_HEIGHT - 1) / TILE_HEIGHT
        var input = ByteBuffer.allocateDirect((TILE_WIDTH + 2 * HALO) * (TILE_HEIGHT + 2 * HALO) * RawImage.BYTES_PER_PIXEL)
            .order(ByteOrder.nativeOrder())
        val output = ByteBuffer.allocateDirect(TILE_WIDTH * TILE_HEIGHT * 16).order(ByteOrder.nativeOrder())
        val band = ShortArray(w * TILE_HEIGHT * 3)
        var done = 0

        // The shader's image size is the source image's (display orientation), not the output's:
        // whole-image textures (high-pass base, bloom, skin mask) are sampled in source pixels.
        val shared = gpu?.developer(image.width, image.height)
        val developer = shared ?: OffscreenDeveloper(image.width, image.height)
        developer.minGrainPx = minGrainPx
        var renderNs = 0L
        var consumeNs = 0L
        try {
            for (ty in 0 until tilesY) {
                val y = ty * TILE_HEIGHT
                val rows = minOf(TILE_HEIGHT, h - y)
                for (tx in 0 until tilesX) {
                    val x = tx * TILE_WIDTH
                    val cols = minOf(TILE_WIDTH, w - x)
                    // Pad the tile so the denoise filter sees real neighbours at tile edges.
                    // Source pixels this tile needs: lens geometry plus the denoise neighbourhood.
                    val out = PixelRect(x, y, cols, rows)
                    val margin = params.spatialMargin + if (scale > 1f) ScanScale.MARGIN else 0
                    val src = if (scale > 1f) {
                        // The photo's pixels under this tile; a scan upscales them whole, so their edges are even.
                        val x0 = floor(x / scale).toInt()
                        val y0 = floor(y / scale).toInt()
                        val base = PixelRect(x0, y0, ceil((x + cols) / scale).toInt() - x0, ceil((y + rows) / scale).toInt() - y0)
                        evenRect(params.lens.sourceBounds(base, margin), image.width, image.height)
                    } else {
                        params.lens.sourceBounds(out, margin)
                    }
                    val bytes = src.width * src.height * RawImage.BYTES_PER_PIXEL
                    if (input.capacity() < bytes) input = ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())
                    val t0 = System.nanoTime()
                    image.copyTile(src.x, src.y, src.width, src.height, input)
                    developer.render(params, input, src, out, output, scale)
                    renderNs += System.nanoTime() - t0
                    BandNative.packTile(output, developer.bytesPerSample, cols, rows, band, w, x)
                    done++
                    onProgress(done.toFloat() / (tilesX * tilesY))
                }
                val t1 = System.nanoTime()
                consume(y, rows, band)
                consumeNs += System.nanoTime() - t1
            }
        } finally {
            if (shared == null) developer.close()
        }
        Log.d(TAG, "export ${w}x$h: develop ${renderNs / 1_000_000} ms, encode/write ${consumeNs / 1_000_000} ms")
    }

    /** The source's EXIF for TIFFs, which ExifInterface can't write: TiffWriter puts it in the header. Best effort. */
    private fun readExif(source: Uri): ExifMetadata? = runCatching {
        context.contentResolver.openFileDescriptor(source, "r")?.use { pfd ->
            val m = ExifMetadata.from(ExifInterface(pfd.fileDescriptor))
            readTiffEp(pfd)?.fill(m) ?: m
        }
    }.getOrNull()

    /** The source's IFD0 shooting tags (DngCreator's DNGs), which ExifInterface skips; null if it isn't a TIFF. */
    private fun readTiffEp(pfd: ParcelFileDescriptor): TiffEpTags? = runCatching {
        val channel = FileInputStream(pfd.fileDescriptor).channel
        TiffEpTags.read { offset, length ->
            val buf = ByteBuffer.allocate(length)
            while (buf.hasRemaining() && channel.read(buf, offset + buf.position()) > 0) Unit
            buf.array().copyOf(buf.position())
        }
    }.getOrNull()

    private fun copyExif(source: Uri, target: Uri) {
        runCatching {
            val input = context.contentResolver.openFileDescriptor(source, "r")?.use { pfd ->
                val exif = ExifInterface(pfd.fileDescriptor)
                val tags = EXIF_TAGS.associateWith { exif.getAttribute(it)?.takeIf(String::isNotBlank) }
                readTiffEp(pfd)?.let { ep ->
                    fun r(v: Pair<Long, Long>?) = v?.let { "${it.first}/${it.second}" }
                    val fallback = mapOf(
                        ExifInterface.TAG_EXPOSURE_TIME to r(ep.exposureTime),
                        ExifInterface.TAG_F_NUMBER to r(ep.fNumber),
                        ExifInterface.TAG_FOCAL_LENGTH to r(ep.focalLength),
                        ExifInterface.TAG_EXPOSURE_BIAS_VALUE to r(ep.exposureBias),
                        ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY to ep.iso?.toString(),
                        ExifInterface.TAG_DATETIME_ORIGINAL to ep.dateTimeOriginal,
                    )
                    tags.mapValues { (tag, value) -> value ?: fallback[tag] }
                } ?: tags
            } ?: return
            context.contentResolver.openFileDescriptor(target, "rw")?.use { pfd ->
                val exif = ExifInterface(pfd.fileDescriptor)
                input.forEach { (tag, value) -> if (value != null) exif.setAttribute(tag, value) }
                exif.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
                exif.setAttribute(ExifInterface.TAG_SOFTWARE, "RawBoy")
                exif.setAttribute(ExifInterface.TAG_COLOR_SPACE, ExifInterface.COLOR_SPACE_S_RGB.toString())
                exif.saveAttributes()
            }
        } // Metadata is best effort; the image is already written.
    }

    /** [r] grown to even x, y, width and height inside a [maxW] x [maxH] image (an odd last column or row is dropped). */
    private fun evenRect(r: PixelRect, maxW: Int, maxH: Int): PixelRect {
        val x0 = r.x - (r.x and 1)
        val y0 = r.y - (r.y and 1)
        val x1 = minOf(r.right + (r.right and 1), maxW - (maxW and 1))
        val y1 = minOf(r.bottom + (r.bottom and 1), maxH - (maxH and 1))
        return PixelRect(x0, y0, x1 - x0, y1 - y0)
    }

    private companion object {
        const val TAG = "RawBoy"
        const val TILE_WIDTH = 1024
        const val TILE_HEIGHT = 512
        const val HALO = 16 // >= the largest denoise radius (9 px)

        fun to8(v: Short): Int = ((v.toInt() and 0xffff) * 255 + 32767) / 65535

        val EXIF_TAGS = listOf(
            ExifInterface.TAG_MAKE,
            ExifInterface.TAG_MODEL,
            ExifInterface.TAG_DATETIME_ORIGINAL,
            ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
            ExifInterface.TAG_SUBSEC_TIME_ORIGINAL,
            ExifInterface.TAG_EXPOSURE_TIME,
            ExifInterface.TAG_F_NUMBER,
            ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
            ExifInterface.TAG_EXPOSURE_BIAS_VALUE,
            ExifInterface.TAG_FOCAL_LENGTH,
            ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM,
            ExifInterface.TAG_LENS_MAKE,
            ExifInterface.TAG_LENS_MODEL,
            ExifInterface.TAG_ARTIST,
            ExifInterface.TAG_COPYRIGHT,
            ExifInterface.TAG_GPS_LATITUDE,
            ExifInterface.TAG_GPS_LATITUDE_REF,
            ExifInterface.TAG_GPS_LONGITUDE,
            ExifInterface.TAG_GPS_LONGITUDE_REF,
            ExifInterface.TAG_GPS_ALTITUDE,
            ExifInterface.TAG_GPS_ALTITUDE_REF,
            ExifInterface.TAG_GPS_TIMESTAMP,
            ExifInterface.TAG_GPS_DATESTAMP,
        )
    }
}
