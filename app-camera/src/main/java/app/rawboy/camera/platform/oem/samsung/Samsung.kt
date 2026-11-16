package app.rawboy.camera.platform.oem.samsung

import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch
import app.rawboy.camera.platform.traits.ispBlackAsPixel9Pro
import app.rawboy.camera.platform.traits.previewColorFromResult

/**
 * Samsung phones, whatever their chip (Galaxy S25: Snapdragon, Galaxy Tab S11 Ultra: MediaTek).
 *
 * The look (2026-11-08, Galaxy S25 pair of viewfinder screenshot and saved JPEG, same Film look): the preview the
 * viewfinder shows is the ISP's own rendering and ignores the plain sRGB curve we ask for, so it can't be undone like
 * the Pixel's. It is an S-curve (darks x0.55-0.65, highlights x1.2 around display grey 0.33, in log-log slope ~1.14)
 * with ~+30% chroma in the midtones, while the raw decoded here has neither, so the saved photo came out flat next to
 * the viewfinder. Added to the shot's develop to match; first estimate from one pair, tune on more Samsung shots.
 *
 * The look was tuned on top of the Pixel 9 Pro's extra black, preview colour path and preview curve, so this layer keeps
 * them until someone checks them on a Samsung: these phones then develop as they did before chips were told apart.
 * The S-curve may be the Snapdragon HAL reading the curve's points as evenly spaced (see the Qualcomm layer): untested.
 */
val samsungLayer = PlatformLayer(
    name = "samsung",
    title = "Samsung",
    level = LayerLevel.MANUFACTURER,
    matches = { it.madeBy("samsung") },
    patch = ispBlackAsPixel9Pro + previewColorFromResult + PlatformPatch { p ->
        p.copy(
            still = p.still.copy(lookContrast = 25f, lookSaturation = 25f),
            // The look was tuned on the preview curve packed near black (the Galaxy S25 is a Snapdragon phone).
            preview = p.preview.copy(curveAtEvenPoints = false),
        )
    },
)
