/** A 3D LUT ready for the GPU: size^3 RGB float nodes, red fastest (port of LutData.kt). */
export interface LutData {
  id: string;
  size: number;
  data: Float32Array;
}

/** A LUT the user can pick; [id] is what DevelopParams.lut stores. */
export interface LutEntry {
  id: string;
  name: string;
  bundled: boolean;
}
