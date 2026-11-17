package app.rawboy.camera.platform.oem.oneplus

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
 */
val cph2447Layer = PlatformLayer(
    name = "cph2447",
    title = "OnePlus 11",
    level = LayerLevel.MODEL,
    matches = { it.madeBy("oneplus") && it.model.equals("CPH2447", ignoreCase = true) },
    patch = PlatformPatch { p ->
        p.copy(preview = p.preview.copy(color = CameraSaturation(p.preview.color, mapOf("3" to 1.25))))
    },
)
