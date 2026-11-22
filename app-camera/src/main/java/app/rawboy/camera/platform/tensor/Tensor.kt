package app.rawboy.camera.platform.tensor

import app.rawboy.camera.platform.BlackOffsets
import app.rawboy.camera.platform.ChipVendor
import app.rawboy.camera.platform.FlashMetering
import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.MotionGain
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch
import app.rawboy.camera.platform.PreviewLevel
import app.rawboy.camera.platform.traits.ispBlackAsPixel9Pro
import app.rawboy.camera.platform.traits.previewColorFromResult

/**
 * Google Tensor (Pixel 6 and later): everything RawBoy Camera was tuned on, measured on a Pixel 9 Pro (2026-10 to
 * 2026-11). Older Pixels have Qualcomm chips: they get the Qualcomm layer (the neutral profile until there is one).
 *
 * The numbers that equal the neutral profile's are repeated on purpose: a later change to the neutral profile must
 * not move the Pixel's behaviour unnoticed.
 */
val tensorLayer = PlatformLayer(
    name = "tensor",
    title = "Google Tensor",
    level = LayerLevel.CHIP_VENDOR,
    matches = { it.chip == ChipVendor.TENSOR },
    patch = ispBlackAsPixel9Pro + previewColorFromResult + PlatformPatch { p ->
        p.copy(
            // The Pixel 9 Pro has one logical camera per side and no stand-alone duplicates: lens order as found.
            lenses = p.lenses.copy(
                standaloneOverLogical = false,
                // Pixel 9 Pro, 23 clips of 2026-11-21 fitted against KLT-measured motion: UW, W and T move 9-31% more
                // up and down than its intrinsics say (cause unknown; UW error 4.1 -> 2.1 px/frame with it). T2 fitted
                // on two OIS-off clips of 2026-11-22 (x 1.01-1.07, y 1.00-1.02, r² 0.99); the 1.15 guess over-corrected
                // up and down. T3 takes T2's until it has OIS-off clips of its own.
                motionGain = mapOf(
                    "UW" to MotionGain(1.0f, 1.31f),
                    "W" to MotionGain(0.98f, 1.20f),
                    "T" to MotionGain(1.04f, 1.09f),
                    "T2" to MotionGain(1.04f, 1.01f),
                    "T3" to MotionGain(1.04f, 1.01f),
                ),
            ),
            // Everything on the Pixel 9 Pro was tuned with the curve's points packed near black.
            preview = p.preview.copy(curveAtEvenPoints = false, level = PreviewLevel.BOOSTED, liftsShadows = true),
            still = p.still.copy(
                // Preview 1/30 s, ISO 1410, boost 2.39 -> still 1/15 s, ISO 1410, boost 1.2.
                maxStillExposureNs = 66_666_667L,
                // The Pixel's extra black (ispBlackAsPixel9Pro) was tuned on LibRaw's integer black and its clip.
                exactBlack = false,
                blackPedestal = 0f,
                blackOffsets = BlackOffsets.NONE,
                // Shots develop at low GPU priority, so the viewfinder doesn't stutter.
                lowPriorityDevelop = true,
            ),
            noise = p.noise.copy(
                // The Pixel's sensors are roughly as noisy as the camera raws the ISO table was tuned on at ~4x
                // (2 stops more) their ISO. Selfie sensors are smaller still: a first guess, to tune on photos.
                backIsoScale = 4f,
                frontIsoScale = 8f,
                // 2026-11-07: shadows of LUT and neutral shots were noisy, Redscale with blocky coarse colour
                // blotches (Pixel night and stage DNGs through the web develop); unverified on the phone itself.
                lutLumaFloor = 12f,
                // Reaches the coarse chroma stage (> 65): Natural's shadow colour mottle (σ10 chroma std) 3.95 ->
                // 2.55 (35 -> 70), 1.34 at 100 with colour fading at edges.
                lutColorFloor = 70f,
                experimentalLumaFloor = 22f,
                experimentalColorFloor = 70f,
            ),
            flash = p.flash.copy(
                // Gain (s x ISO) at 1 m: W (f/1.68) exposed a desk at ~0.4 m well at about 2.5 (first tries).
                defaultGuide = 16f,
                // The W's aperture, which the guide above was set at.
                referenceFNumber = 1.7f,
                // As for 0.5 m at the guide above; UW reports a focus distance of 0 on every frame, so it starts here.
                defaultGainNoDistance = 4f,
                // The Pixel 9 Pro's AE keeps the ambient exposure for a flash still (the raw clipped): exposed by hand.
                metering = FlashMetering.MANUAL_GUIDE,
                cameraAeCompensationEv = 0f,
                // Screen flash: the frame goes dark a fixed time after the request.
                screenFlashUntilExposed = false,
            ),
        )
    },
)
