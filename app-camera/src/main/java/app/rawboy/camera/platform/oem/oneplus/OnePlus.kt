package app.rawboy.camera.platform.oem.oneplus

import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch

/**
 * OnePlus phones: the camera HAL's behaviour, measured on a OnePlus 11 (CPH2447, Snapdragon 8 Gen 2, Android 16,
 * 2026-11-15/16). Only one Snapdragon phone was measured, so other Snapdragon phones keep the neutral values.
 *
 * Lenses: the back cameras are logical camera 0 (main + ultrawide) and the stand-alone main (2) and ultrawide (3).
 * RAW through logical camera 0 doesn't work: with the still's AE range differing from the preview's (a session key
 * there) the preview froze ("Can't idle device"), and a burst never got its first result even with equal ranges.
 * Camera 2 on its own streams, meters, merges bursts and saves.
 *
 * Preview curve: the HAL applies TONEMAP_CURVE's points as if evenly spaced over its linear input, whatever their x.
 * Fitted on the viewfinder's 512 px copy against the raw of the same shot (8x8 cells, a room under ceiling light): with
 * the sRGB curve packed near black the viewfinder's log-log slope against the raw was 1.8-2.0 (chroma x2.1); with the
 * curve at even points 0.99, within 3% from -4 to 0 EV of the median, chroma x1.06-1.10 (main), on the ultrawide and
 * selfie cameras alike. A HAL that honours x would get a coarser toe from it, so the neutral profile keeps the packed one.
 */
val onePlusLayer = PlatformLayer(
    name = "oneplus",
    title = "OnePlus",
    level = LayerLevel.MANUFACTURER,
    matches = { it.madeBy("oneplus") },
    patch = PlatformPatch { p ->
        p.copy(
            lenses = p.lenses.copy(standaloneOverLogical = true),
            preview = p.preview.copy(curveAtEvenPoints = true),
        )
    },
)
