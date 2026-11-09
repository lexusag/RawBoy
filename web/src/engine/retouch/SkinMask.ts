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
  /** Face-skin confidence alone (the model's face class, 0..1), same size as [data]; Portrait retouch. */
  face?: Float32Array;
  /** Face landmarks per face (MediaPipe's 478-point mesh): x, y pairs in fractions of the image; Portrait retouch. */
  faces?: Float32Array[];
}
