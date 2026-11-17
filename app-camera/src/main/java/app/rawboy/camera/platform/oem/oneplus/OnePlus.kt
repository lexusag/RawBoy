package app.rawboy.camera.platform.oem.oneplus

import app.rawboy.camera.platform.CompensationModel
import app.rawboy.camera.platform.FlashMetering
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
 * foreground came out 0.3-0.8 EV brighter in the photo than in the viewfinder: the live develop adds the shot's lift
 * (a 6.3-stop window scene: 49 in both).
 *
 * Black: the HAL writes the frame's dynamic black into the DNG with a fraction that grows with ISO (64.0 at ISO 100,
 * 64.62 / 64.81 by CFA site at ISO 6400 on the main camera), which LibRaw truncates to 64, and LibRaw clips the noise
 * below black at zero. Against a frame of the same scene at ISO 100 (16x16 blocks, 4 stops under, 2026-11-17), the
 * main camera's shadows at 2^-8 / 2^-7 of white came out R/G up to +14% merged and +49% / +23% in a single ISO 6400
 * frame (the approved limit is 8% on merged shots). With the exact black, a 32 DN pedestal (the noise std at ISO 6400
 * is 6-7 DN) and the OnePlus 11's sensor offsets ([cph2447Layer]): main camera merged +1.8% / +2.3%, single +3.7% /
 * +3.0%; ultrawide merged +5.5% / +1.8% (single ISO 6400 still +21% / +10%). A night corridor without Film: deep
 * shadows from R/G/B 12 / 5 / 10 levels (magenta) to 5 / 7 / 6.
 *
 * Flash ([FlashMetering.CAMERA_AE]): a manual still (AE off, FLASH_MODE_SINGLE, the Pixel's way) reports the flash
 * fired (FLASH_STATE 3) but its raw gets almost none of the light: a white sheet at 1.45 m reported focus, gain (s x
 * ISO) 42, came out at 0.003 of clip (p98) against 0.009 for the ambient alone at gain 213, black in the JPEG
 * (2026-11-17, a dark room). The camera's flash AE works: always-flash AE mode + a precapture trigger fire a
 * pre-flash (AE in PRECAPTURE until 0.6-0.9 s after the trigger, then FLASH_REQUIRED), and the still (5-30 ms, ISO
 * 100-1600 at 0.3-3 m) put the sheet at 0.67-0.69 of clip on the main camera at 1 m; repeated shots within 3% (ISO
 * 421 / 433 / 433). The same with focus locked (no torch first). Its exposure
 * aims at the phone's JPEG, not the raw: the ultrawide clipped the sheet (0.5% of the frame), hence the model's
 * compensation ([cph2447Layer]).
 *
 * Screen flash: the HAL starts the still's exposure 0.36-0.38 s after the request is sent (the reconfiguration around
 * every still), after the frame had gone dark at 0.25 s: the selfie raw's key was 0.069-0.073 with the screen flash,
 * 0.112-0.119 with the frame kept lit to 0.7 s (a face-height subject at ~0.5 m, a lamp behind the phone), so it stays
 * lit until the still's result has come ([app.rawboy.camera.platform.FlashProfile.screenFlashUntilExposed]).
 *
 * Brightness ([CompensationModel.AE_GAIN_IN_RAW]): DngCreator writes the still's post-raw boost into the DNG as
 * BaselineExposure (0.99 EV at boost 2.0), which the decoder applies, so the developed raw gets AE's whole gain
 * (exposure x ISO x boost), digital part included. In a dark room (main camera, 2026-11-17) AE topped out at that gain
 * = 1/15 s x ISO 6400 (preview 1/30 s x ISO 6400 x boost 2.0-2.22; stills 1/15 s at boost 1 or 1/30 s at boost 2) and
 * Brightness +1 added nothing: the raw's key stayed 0.0173-0.0175 against 0.0173 at -0.17, while the develop took the
 * +1 EV back out, and the photo came out +0.36 EV brighter (+0.25 in session 11). Below the ceiling compensation
 * reached the raw in full (a lamp-lit room: +1 -> +0.90 EV, -1 -> -1.18 EV; merged -1 at the ceiling -0.96 EV). The
 * Pixel's rule ([CompensationModel.BOOST_STAYS_DIGITAL]) read the same frames as applied or not by which side of its
 * 0.9 x 1/30 s threshold the preview's exposure fell (33.3 ms x boost 2.0 or 30.0 ms x boost 2.22, the same gain):
 * two merged +1 shots of one scene came out +1.03 and +0.29 EV.
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
            still = p.still.copy(exactBlack = true, blackPedestal = 32f, compensation = CompensationModel.AE_GAIN_IN_RAW),
            flash = p.flash.copy(metering = FlashMetering.CAMERA_AE, screenFlashUntilExposed = true),
        )
    },
)
