package app.rawboy.camera.platform.generic

import app.rawboy.camera.platform.BlackOffsets
import app.rawboy.camera.platform.CameraPlatform
import app.rawboy.camera.platform.FlashProfile
import app.rawboy.camera.platform.LensProfile
import app.rawboy.camera.platform.NoiseProfile
import app.rawboy.camera.platform.PreviewLevel
import app.rawboy.camera.platform.PreviewProfile
import app.rawboy.camera.platform.SrgbPreviewColor
import app.rawboy.camera.platform.StillProfile

/**
 * The base of every profile, and all a phone without its own layers gets: no workarounds for any one ISP. Where no
 * phone-independent value exists, the number measured on the Pixel 9 Pro stays as the best guess (the flash starting
 * points are learned per lens anyway).
 */
val neutralPlatform = CameraPlatform(
    layers = listOf("neutral"),
    calibrationSlot = "",
    lenses = LensProfile(
        standaloneOverLogical = false,
    ),
    preview = PreviewProfile(
        // The result's colour matrix is only trusted where a layer says so: the OnePlus 11 reports identity.
        color = SrgbPreviewColor,
        curveAtEvenPoints = false,
        level = PreviewLevel.BOOSTED,
        liftsShadows = true,
    ),
    still = StillProfile(
        // What Pro and Auto decode with.
        extraBlack = 0f,
        // Pixel 9 Pro's AE, the only one measured: in low light the still goes to 1/15 s (its 15-30 fps range).
        // The OnePlus 11 stopped at 60 ms with [10, 30], so the range can't predict it.
        maxStillExposureNs = 66_666_667L,
        lookContrast = 0f,
        lookSaturation = 0f,
        // LibRaw's own black handling, what Pro and Auto decode with.
        exactBlack = false,
        blackPedestal = 0f,
        blackOffsets = BlackOffsets.NONE,
        // The viewfinder's frames first, as on the Pixel 9 Pro.
        lowPriorityDevelop = true,
    ),
    noise = NoiseProfile(
        // Phone sensors are roughly as noisy as the camera raws the ISO table was tuned on at ~4x (2 stops more) the
        // ISO; tuned on Pixel 9 Pro shots. Selfie: a first guess.
        backIsoScale = 4f,
        frontIsoScale = 8f,
        // Denoise floors for non-Film colour looks (2026-11-07, Pixel night and stage DNGs through the web develop).
        lutLumaFloor = 12f,
        lutColorFloor = 70f,
        experimentalLumaFloor = 22f,
        experimentalColorFloor = 70f,
    ),
    flash = FlashProfile(
        // Pixel 9 Pro W (f/1.68) exposed a desk at ~0.4 m well at about 2.5 (first tries).
        defaultGuide = 16f,
        referenceFNumber = 1.7f,
        // As for 0.5 m at the guide above.
        defaultGainNoDistance = 4f,
    ),
)
