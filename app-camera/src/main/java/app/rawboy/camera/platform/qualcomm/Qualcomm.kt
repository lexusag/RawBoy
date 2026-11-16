package app.rawboy.camera.platform.qualcomm

import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch

/**
 * Qualcomm Snapdragon phones (and Pixels before the Pixel 6). Measured on a OnePlus 11 (SM8550, Android 16,
 * 2026-11-16) only, so a value goes here only where it is safe for a Snapdragon HAL that behaves otherwise.
 *
 * Preview curve: the OnePlus 11 HAL reads TONEMAP_CURVE's points as evenly spaced over its linear input. Fitted on the
 * viewfinder's 512 px copy against the raw of the same shot (8x8 cells): with the sRGB curve packed near black the
 * viewfinder's log-log slope against the raw was 1.8-2.0 (chroma x2.1); at even points 0.99, within 3% from -4 to 0 EV
 * of the median, chroma x1.06-1.10. A HAL that honours x gets the same sRGB curve with a coarser toe.
 */
val qualcommLayer = PlatformLayer(
    name = "qualcomm",
    title = "Qualcomm Snapdragon",
    level = LayerLevel.CHIP_VENDOR,
    matches = { it.chip == ChipVendor.QUALCOMM },
    patch = PlatformPatch { p ->
        p.copy(preview = p.preview.copy(curveAtEvenPoints = true))
    },
)
