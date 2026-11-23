package app.rawboy.camera.capture

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.util.Log
import android.util.Size

/**
 * A lens's dual-pixel raw depth stream: the phase-detect autofocus data some sensors (Pixel 9 Pro: every lens) list
 * among `android.depth.availableDepthStreamConfigurations` as RAW10 or RAW16, even without the `DEPTH_OUTPUT`
 * capability. The framework calls those formats `ImageFormat.RAW_DEPTH10` / `RAW_DEPTH` (hidden constants, so the
 * values are written out here). The layout of the data is the sensor's own; [DualPixelDepth] reads it.
 *
 * On a logical multi-camera the stream is often listed only by the physical cameras behind it, so [cameraIds] names
 * the cameras the output may be configured for (`OutputConfiguration.setPhysicalCameraId`; null = the camera
 * itself), in the order to try: which one the phone accepts next to the raw is only known by asking (Pixel 9 Pro
 * selfie: not physical 8).
 */
data class DualPixelStream(val cameraIds: List<String?>, val size: Size, val format: Int) {
    companion object {
        /** `ImageFormat.RAW_DEPTH10` (hidden): a RAW10 depth-dataspace stream. */
        const val RAW_DEPTH10 = 0x1003

        /** `ImageFormat.RAW_DEPTH` (hidden): a RAW16 depth-dataspace stream. */
        const val RAW_DEPTH = 0x1002

        private const val TAG = "RawBoyCamera"

        /**
         * The dual-pixel stream of the lens [id] with characteristics [c]: its own, else (a logical camera) those of the
         * physical cameras with the same focal length, the one with the same pixel array first; or null.
         */
        fun find(manager: CameraManager, id: String, c: CameraCharacteristics): DualPixelStream? {
            own(c)?.let { (size, format) -> return DualPixelStream(listOf(null), size, format).also { log(id, it) } }
            val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: return null
            if (CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA !in caps) return null
            val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: return null
            val array = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
            val found = c.physicalCameraIds.mapNotNull { physical ->
                val pc = runCatching { manager.getCameraCharacteristics(physical) }.getOrNull() ?: return@mapNotNull null
                val pFocal = pc.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: return@mapNotNull null
                if (kotlin.math.abs(pFocal - focal) > 0.05f) return@mapNotNull null
                own(pc)?.let { physical to it }
            }.sortedBy { (physical, _) ->
                // The sensor with the logical camera's own pixel array first (another may be a cropped mode).
                if (array != null && runCatching { manager.getCameraCharacteristics(physical) }.getOrNull()
                        ?.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE) == array) 0 else 1
            }
            val (size, format) = found.firstOrNull()?.second ?: return null
            // Only cameras with the same stream: one reader serves them all.
            val ids = found.filter { it.second == size to format }.map { it.first }
            return DualPixelStream(ids, size, format).also { log(id, it) }
        }

        /** The largest raw depth size the camera itself lists, RAW10 first. */
        private fun own(c: CameraCharacteristics): Pair<Size, Int>? {
            val map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return null
            for (format in intArrayOf(RAW_DEPTH10, RAW_DEPTH)) {
                val size = runCatching { map.getOutputSizes(format) }.getOrNull()
                    ?.maxByOrNull { it.width.toLong() * it.height } ?: continue
                return size to format
            }
            return null
        }

        private fun log(id: String, s: DualPixelStream) =
            Log.d(TAG, "camera $id: dual-pixel stream ${s.size} format 0x${s.format.toString(16)}${s.cameraIds.filterNotNull().takeIf { it.isNotEmpty() }?.let { " on physical ${it.joinToString("/")}" } ?: ""}")
    }
}

/**
 * One dual-pixel frame as streamed, in sensor orientation: [bytes] rows of [rowStride] bytes (RAW10: 4 pixels in 5
 * bytes; RAW16: little-endian shorts). [exifOrientation] is the still's, for turning the depth upright.
 */
class DualPixelFrame(
    val width: Int,
    val height: Int,
    val rowStride: Int,
    val bytes: ByteArray,
    val exifOrientation: Int,
    val format: Int = DualPixelStream.RAW_DEPTH10,
)
