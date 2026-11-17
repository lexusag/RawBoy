package app.rawboy.camera.platform.qualcomm

import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch

/**
 * Qualcomm Snapdragon (Adreno GPUs): what the chip's GPU driver does, measured on a OnePlus 11 (SM8550, Android 16,
 * 2026-11-17). Its values must be safe on any Snapdragon phone; camera and ISP behaviour belongs to the phone maker's
 * layer.
 *
 * Develop priority: shots developed in a low-priority GL context starve on a hot phone. Once the phone heated up
 * (thermal status 3-4: severe/critical, from an hour of viewfinder and bursts), Adreno's clocks are cut and the
 * viewfinder's frames took the whole GPU: a 12 MP shot without Film (denoise 12 / colour 70) took 45.6 s to develop
 * and a 4 MP selfie 196 s, against 3.5 s cool; leaving the viewfinder (Home) finished the first in 11 s. At normal
 * priority, the same hot phone developed it in 3.0-3.1 s, the viewfinder dipping from 30 to 25 fps for those seconds.
 * Normal priority is what any GL context gets by default.
 */
val qualcommLayer = PlatformLayer(
    name = "qualcomm",
    title = "Qualcomm",
    level = LayerLevel.CHIP_VENDOR,
    matches = { it.chip == ChipVendor.QUALCOMM },
    patch = PlatformPatch { p -> p.copy(still = p.still.copy(lowPriorityDevelop = false)) },
)
