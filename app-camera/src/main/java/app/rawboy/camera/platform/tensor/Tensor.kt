package app.rawboy.camera.platform.tensor

import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch
import app.rawboy.camera.platform.traits.ispBlackAsPixel9Pro
import app.rawboy.camera.platform.traits.previewColorFromResult

/**
 * Google Tensor (Pixel 6 and later): everything RawBoy Camera was tuned on, measured on a Pixel 9 Pro (2026-10 to
 * 2026-11). Older Pixels have Qualcomm chips and get the Qualcomm layer.
 *
 * The numbers that equal the neutral profile's are repeated on purpose: a later change to the neutral profile must
 * not move the Pixel's behaviour unnoticed.
 */
val tensorLayer = PlatformLayer(
    name = "tensor",
    level = LayerLevel.CHIP_VENDOR,
    matches = { it.chip == ChipVendor.TENSOR },
    patch = ispBlackAsPixel9Pro + previewColorFromResult + PlatformPatch { p ->
        p.copy(
            still = p.still.copy(
                // Preview 1/30 s, ISO 1410, boost 2.39 -> still 1/15 s, ISO 1410, boost 1.2.
                maxStillExposureNs = 66_666_667L,
            ),
            noise = p.noise.copy(
                backIsoScale = 4f,
                frontIsoScale = 8f,
                lutLumaFloor = 12f,
                lutColorFloor = 70f,
                experimentalLumaFloor = 22f,
                experimentalColorFloor = 70f,
            ),
            flash = p.flash.copy(
                // W (f/1.68): a desk at ~0.4 m exposed well at about 2.5.
                defaultGuide = 16f,
                referenceFNumber = 1.7f,
                defaultGainNoDistance = 4f,
            ),
        )
    },
)
