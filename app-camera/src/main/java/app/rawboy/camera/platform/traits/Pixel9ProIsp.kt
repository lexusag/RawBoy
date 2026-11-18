package app.rawboy.camera.platform.traits

import app.rawboy.camera.platform.PlatformPatch

/**
 * The ISP renders the preview's black deeper than the DNG's BlackLevel (which is the frame's dynamic black): ~1.4 DN
 * of 959 on the Pixel 9 Pro, measured against the viewfinder at ISO 170-250, as a fraction of the white range.
 * Without it the photo's deepest shadows were lifted, and bluish after the white balance's blue gain.
 */
val ispBlackAsPixel9Pro = PlatformPatch { it.copy(still = it.still.copy(extraBlack = 1.46e-3f)) }

/** The result reports the colour matrix and gains the preview was really rendered with ([UndoIspPreviewColor]). */
val previewColorFromResult = PlatformPatch { it.copy(preview = it.preview.copy(color = UndoIspPreviewColor)) }
