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
 * Black: lit frames sit off the DNG's black at high ISO, the ultrawide above it and the main camera below. Residual
 * against a frame of the same scene at ISO 100 (4 stops under, one exposure ratio for all four CFA sites, 16x16 blocks
 * at 0.5-2 DN where it is flat; a dim room and a daylit room, single frames and merged bursts alike, within +-0.15 DN
 * of each other, 2026-11-17), R / G / B DN: ultrawide +0.19 / +0.16 / +0.10 at ISO 1600, +0.72 / +0.60 / +0.42 at
 * 6400; main -0.17 / -0.15 / -0.11 at ISO 1600, -0.48 / -0.35 / -0.29 at 6400; both about 0 at ISO 400 and below.
 * Dark frames (lens covered, 33 ms) read differently (ultrawide +0.04..+0.24, main -0.4..-0.6 at 6400), so only lit
 * frames set it. Without it, merged shadows at 2^-8 of white came out R/G -10% (main) and +14% (ultrawide) at 6400
 * with the exact black.
 *
 * Noise: the engine's measured noise (luma std in the sqrt domain, `RawImage.measureNoise`) on a fixed scene at ISO
 * 100-6400 with time x ISO held (2026-11-17): main 0.0029 / 0.0053 / 0.0101 / 0.0205 at ISO 100 / 400 / 1600 / 6400,
 * the ultrawide 5% lower, the selfie camera 1.45-1.73x the main camera's at equal ISO (0.0042 / 0.0082 / 0.0174 at
 * 100 / 400 / 1600). Noise grows 1.39x per stop here, so the selfie camera is as noisy as the main one at ~2.6x its
 * ISO: back cameras keep 4 (nothing to hold them against a Pixel's raws), the selfie camera 10 (the neutral 8 was a
 * first guess, 2x the back's). Merged bursts measured 3.2-3.3x below single frames at ISO 1600-6400 (8 frames,
 * effective 7.3-8.0), cleaner than the frame count alone predicts, as on the Pixel.
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
            still = p.still.copy(
                blackOffsets = BlackOffsets(
                    mapOf(
                        // Main camera (stand-alone camera 2).
                        "2" to listOf(
                            BlackOffsets.Point(400f, listOf(0f, 0f, 0f)),
                            BlackOffsets.Point(1600f, listOf(-0.17f, -0.15f, -0.11f)),
                            BlackOffsets.Point(6400f, listOf(-0.48f, -0.35f, -0.29f)),
                        ),
                        // Ultrawide (stand-alone camera 3).
                        "3" to listOf(
                            BlackOffsets.Point(100f, listOf(0f, 0f, 0f)),
                            BlackOffsets.Point(400f, listOf(0.04f, 0.05f, 0.04f)),
                            BlackOffsets.Point(1600f, listOf(0.19f, 0.16f, 0.10f)),
                            BlackOffsets.Point(6400f, listOf(0.72f, 0.60f, 0.42f)),
                        ),
                    ),
                ),
            ),
        )
    },
)
