package app.rawboy.camera.platform.oem.oneplus

import app.rawboy.camera.platform.BlackOffsets
import app.rawboy.camera.platform.CameraSaturation
import app.rawboy.camera.platform.LayerLevel
import app.rawboy.camera.platform.PlatformLayer
import app.rawboy.camera.platform.PlatformPatch

/**
 * OnePlus 11 (CPH2447): its sensors' numbers, on top of [onePlusLayer].
 *
 * The ultrawide's preview (camera 3) is paler than its raw: chroma 0.82-0.85 of the raw's at ISO 360-3100, 0.71 at
 * ISO 6400, against the main camera's 1.02-1.13 and 0.87-0.95 (the slope of the viewfinder's log chroma on the raw's,
 * 8x8 cells of the 512 px copies between 1/32 and 0.6 of the preview's white, 2026-11-16/17: a room under LED light,
 * a window at dawn, books and toys in morning light). The ISP also fades both previews' chroma at high ISO, which a
 * fixed matrix can't follow, so only the ultrawide's lens-wise gap is taken out.
 *
 * Black: frames sit off the DNG's black at high ISO, the ultrawide above it and the main camera below. Residual
 * against a frame of the same scene at a low ISO (one exposure ratio for all four CFA sites, 16x16 blocks at 0.5-2 DN
 * where it is flat, single frames and merged bursts alike, 2026-11-17), R / G / B DN:
 * - main camera, lit frames of 0.3-11 ms (a dim and a daylit room, within +-0.15 DN): -0.17 / -0.15 / -0.11 at ISO
 *   1600, -0.48 / -0.35 / -0.29 at 6400; dark frames at 33 ms read -0.62 / -0.51 / -0.42 at 6400. A night corridor at
 *   ISO 6400, 1/30 s came out neutral with the lit numbers.
 * - ultrawide: the offset falls with exposure time. Lit frames of 0.3-11 ms read +0.72 / +0.60 / +0.42 at ISO 6400,
 *   but at 1/30 s, which is what AE gives at ISO 1600-6400, a dark corridor and dark frames agreed on +0.24..0.29 /
 *   +0.14 / +0.03..0.04 (and +0.21 / +0.18 / +0.15 at ISO 1600): the 1/30 s numbers are used. The short-exposure
 *   table had over-corrected a night shot's shadows to R/G -11%, B/G -13% at 2^-9.
 * Both about 0 at ISO 400 and below. Without them, merged shadows at 2^-8 came out R/G -10% (main) and +14%
 * (ultrawide) at ISO 6400 with the exact black. The selfie camera's offset (-0.1..-0.3 DN) is the same in every channel
 * and keeps none.
 *
 * Noise: the engine's measured noise (luma std in the sqrt domain, `RawImage.measureNoise`) on a fixed scene at ISO
 * 100-6400 with time x ISO held (2026-11-17): main 0.0029 / 0.0053 / 0.0101 / 0.0205 at ISO 100 / 400 / 1600 / 6400,
 * the ultrawide 5% lower, the selfie camera 1.45-1.73x the main camera's at equal ISO (0.0042 / 0.0082 / 0.0174 at
 * 100 / 400 / 1600). Noise grows 1.39x per stop here, so the selfie camera is as noisy as the main one at ~2.6x its
 * ISO: back cameras keep 4 (nothing to hold them against a Pixel's raws), the selfie camera 10 (the neutral 8 was a
 * first guess, 2x the back's). Merged bursts measured 3.2-3.3x below single frames at ISO 1600-6400 (8 frames,
 * effective 7.3-8.0), cleaner than the frame count alone predicts, as on the Pixel.
 *
 * Flash: the camera's flash AE ([onePlusLayer]) exposed a white sheet at 1 m to 0.67-0.69 of clip on the main camera
 * but 0.955 (p98, 0.5% of the frame clipped) on the ultrawide. With -1 EV of compensation the ultrawide's sheet sat at
 * 0.40 (0.002% clipped) and the main camera's at 0.29; at 0.3 m (a glossy mug nearer still) 0.07-0.09% clipped
 * (specular highlights; 0.32% at 0 EV), at 3 m 0.0004%. The develop takes the -1 EV back (its auto exposure +1.0 to
 * +1.8 EV): the JPEG's centre was within 0.1-0.2 EV of the uncompensated shot's at 1 m and equal at 3 m. Against a shot
 * without flash (merged, 3 m, a lamp behind the phone) the flash shot's centre came out -0.43 EV (2026-11-17).
 */
val cph2447Layer = PlatformLayer(
    name = "cph2447",
    title = "OnePlus 11",
    level = LayerLevel.MODEL,
    matches = { it.madeBy("oneplus") && it.model.equals("CPH2447", ignoreCase = true) },
    patch = PlatformPatch { p ->
        p.copy(
            preview = p.preview.copy(color = CameraSaturation(p.preview.color, mapOf("3" to 1.25))),
            noise = p.noise.copy(backIsoScale = 4f, frontIsoScale = 10f),
            flash = p.flash.copy(cameraAeCompensationEv = -1f),
            still = p.still.copy(
                // Selfie camera (1): AE tops out at 1/30 s x ISO 1600 x boost 5.0 (a dark room, Brightness 0 and +0.84
                // alike, 2026-11-17), above the default 1/15 s x ISO 1600 = 107; the back cameras meet the default.
                aeGainCeilings = mapOf("1" to 0.03f * 1600f * 5f),
                blackOffsets = BlackOffsets(
                    mapOf(
                        // Main camera (stand-alone camera 2).
                        "2" to listOf(
                            BlackOffsets.Point(400f, listOf(0f, 0f, 0f)),
                            BlackOffsets.Point(1600f, listOf(-0.17f, -0.15f, -0.11f)),
                            BlackOffsets.Point(6400f, listOf(-0.48f, -0.35f, -0.29f)),
                        ),
                        // Ultrawide (stand-alone camera 3), at 1/30 s: what AE gives at these ISOs.
                        "3" to listOf(
                            BlackOffsets.Point(100f, listOf(0f, 0f, 0f)),
                            BlackOffsets.Point(400f, listOf(0.02f, 0.03f, 0.04f)),
                            BlackOffsets.Point(1600f, listOf(0.21f, 0.18f, 0.15f)),
                            BlackOffsets.Point(6400f, listOf(0.27f, 0.14f, 0.04f)),
                        ),
                    ),
                ),
            ),
        )
    },
)
