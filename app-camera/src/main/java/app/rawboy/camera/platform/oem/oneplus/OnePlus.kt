package app.rawboy.camera.platform.oem.oneplus

import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch
import app.rawboy.camera.platform.PreviewLevel

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
 * Below the first point (1/63 of white) the HAL draws a straight line from black, which the viewfinder decodes along
 * the same line (`ViewfinderRenderer.Frame.linearToe`): read as sRGB, raws 9-10 stops under clip came out 27% dark.
 *
 * Preview level: on 20 shots (main, ultrawide, selfie; a room under LED light, a window at dawn, dim light; ISO
 * 150-6400, the result's post-raw boost 1-4.25, the still's exposure 1-2x the preview's) the raw's grey was the
 * preview's times the frame's smallest as-shot neutral component, within 0.97-1.04 ([PreviewLevel.STILL_WHITE_BALANCED]).
 * Under the Pixel's model the learned scale moved with the light instead: 0.37-0.47 by illuminant, and 0.95 for the
 * selfie camera at boost 4.25, which then left the next shot in normal light 0.3 EV off. The calibration under it is
 * 0.93-0.99 on every lens, so the default 1 needs no raw metering, which caught AE unsettled 0.3 s after a lens
 * started (0.36-0.6 on the main camera, 3.4 on the ultrawide, against ~0.95).
 *
 * Shadows: the preview's tone is global (the viewfinder copy over the raw was the same at equal raw level in every
 * third of a backlit frame), so the ISP's local lift the Pixel's preview carries isn't there, and a window shot's
 * foreground came out 0.3-0.8 EV brighter in the photo than in the viewfinder: the live develop adds the shot's lift.
 */
val onePlusLayer = PlatformLayer(
    name = "oneplus",
    title = "OnePlus",
    level = LayerLevel.MANUFACTURER,
    matches = { it.madeBy("oneplus") },
    patch = PlatformPatch { p ->
        p.copy(
            lenses = p.lenses.copy(standaloneOverLogical = true),
            preview = p.preview.copy(curveAtEvenPoints = true, level = PreviewLevel.STILL_WHITE_BALANCED, liftsShadows = false),
        )
    },
)
