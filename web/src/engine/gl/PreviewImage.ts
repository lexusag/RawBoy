/** Linear Rec.2020 half-float RGB pixels, row 0 = top of the image (port of GlCommon.kt's PreviewImage). */
export interface PreviewImage {
  width: number;
  height: number;
  pixels: Uint16Array;
  /** Size of the full-resolution image this preview was made from. */
  fullWidth: number;
  fullHeight: number;
}

/** The two highlight-boosted, downscaled images bloom scatters light from. */
export interface BloomSources {
  halo: PreviewImage;
  tail: PreviewImage;
}
