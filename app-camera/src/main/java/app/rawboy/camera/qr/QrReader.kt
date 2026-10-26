package app.rawboy.camera.qr

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/** Reads a QR code from the viewfinder's greyscale copies (ViewfinderRenderer.onLuma) with ZXing. */
object QrReader {
    /**
     * TRY_HARDER looks for the finder patterns on every row: without it codes under ~3 px per module (a twelfth of
     * the frame wide) were missed, and it cost under 5% more time on frames with no code.
     */
    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
    )

    /** The text of a QR code in the [width] x [height] grey image (one byte per pixel), or null when there is none. */
    fun read(width: Int, height: Int, grey: ByteArray): String? {
        val source = PlanarYUVLuminanceSource(grey, width, height, 0, 0, width, height, false)
        return try {
            // A reader per call: QRCodeReader keeps state between decodes.
            QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (e: ReaderException) {
            null
        }
    }
}

/**
 * Which code the viewfinder shows, from one read after another: a code stays up for [holdMs] after its last sighting,
 * so a missed frame or two doesn't make it blink, and a dismissed code stays away until it has been out of view for
 * [holdMs]. Times in ms, from any monotonic clock.
 */
class QrTracker(private val holdMs: Long = 1500) {
    /** The code shown, or null. */
    var shown: QrPayload? = null
        private set
    private var lastSeen = 0L
    private var dismissed: String? = null
    private var dismissedSeen = 0L

    /** A read at [now]: [text] or null for no code. Returns whether [shown] changed. */
    fun update(text: String?, now: Long): Boolean {
        val before = shown
        val code = text?.trim()?.takeIf { it.isNotEmpty() }
        if (code != null && code == dismissed) dismissedSeen = now
        if (dismissed != null && now - dismissedSeen > holdMs) dismissed = null
        when {
            code != null && code != dismissed -> {
                if (shown?.text != code) shown = QrPayload.parse(code)
                lastSeen = now
            }
            shown != null && now - lastSeen > holdMs -> shown = null
        }
        return shown !== before
    }

    /** The ✕ on the chip: hides the code shown until it leaves the view. */
    fun dismiss(now: Long) {
        val s = shown ?: return
        dismissed = s.text
        dismissedSeen = now
        shown = null
    }

    fun clear() {
        shown = null
        dismissed = null
    }
}
