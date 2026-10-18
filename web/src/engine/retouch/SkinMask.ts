/** Where the skin is, as a 0..1 map over the whole image (display orientation), plus the smoothing scale. */
export interface SkinMask {
  width: number;
  height: number;
  data: Float32Array;
  /** Edge-aware smoothing sigma in full-resolution pixels, scaled to the face size. */
  sigmaPx: number;
  hasSkin: boolean;
  /** Estimated face diameter in full-resolution pixels (0 if no face). */
  faceDiameterPx: number;
}
