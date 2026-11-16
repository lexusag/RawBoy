package app.rawboy.camera.platform.oem.oneplus

import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch

/**
 * OnePlus phones: the camera HAL's behaviour, measured on a OnePlus 11 (CPH2447, Snapdragon 8 Gen 2, Android 16,
 * 2026-11-15/16). Other Snapdragon phones keep the neutral values: nothing here is known to come from the chip.
 *
 * Lenses: the back cameras are logical camera 0 (main + ultrawide) and the stand-alone main (2) and ultrawide (3).
 * RAW through logical camera 0 doesn't work: with the still's AE range differing from the preview's (a session key
 * there) the preview froze ("Can't idle device"), and a burst never got its first result even with equal ranges.
 * Camera 2 on its own streams, meters, merges bursts and saves. The Qualcomm layer (when there is one) stays on the
 * logical camera.
 */
val onePlusLayer = PlatformLayer(
    name = "oneplus",
    title = "OnePlus",
    level = LayerLevel.MANUFACTURER,
    matches = { it.madeBy("oneplus") },
    patch = PlatformPatch { p ->
        p.copy(lenses = p.lenses.copy(standaloneOverLogical = true))
    },
)
