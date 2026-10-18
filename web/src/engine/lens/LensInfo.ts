/**
 * Lens data for one decoded image (port of lens/LensInfo.kt). Corrections come from DNG opcodes and are in
 * sensor coordinates (before orientation); [orientation] maps between the two.
 */
export interface Warp {
  planes: number;
  /** Per plane: kr0..kr3, kt0, kt1. */
  coefficients: number[];
  centerX: number;
  centerY: number;
}

export interface RadialVignette {
  k: number[];
  centerX: number;
  centerY: number;
}

/** Luminance part of the DNG gain maps (already applied), so it can be undone on the GPU. */
export interface ShadingMap {
  pointsV: number;
  pointsH: number;
  originV: number;
  originH: number;
  spacingV: number;
  spacingH: number;
  gains: Float32Array;
}

export class LensInfo {
  constructor(
    readonly lensName: string,
    /** Oriented (display) size of the decoded image. */
    readonly width: number,
    readonly height: number,
    readonly sensorWidth: number,
    readonly sensorHeight: number,
    /** TIFF orientation 1..8 that turned the sensor image into the displayed one. */
    readonly orientation: number,
    readonly warp: Warp | null,
    readonly vignette: RadialVignette | null,
    readonly shading: ShadingMap | null,
    /** Number of DNG GainMaps applied while decoding (colour + lens shading). */
    readonly gainMapsApplied: number,
  ) {}

  get hasProfile(): boolean {
    return this.warp != null || this.vignette != null || this.shading != null;
  }

  /** One line for the Lens tab, e.g. "vignetting & colour shading, distortion". */
  get profileSummary(): string | null {
    const parts: string[] = [];
    if (this.shading != null || this.gainMapsApplied > 0) parts.push('vignetting & colour shading');
    if (this.vignette != null) parts.push('vignetting');
    if (this.warp != null) parts.push(this.warp.planes === 3 ? 'distortion & chromatic aberration' : 'distortion');
    const unique = [...new Set(parts)];
    return unique.length ? unique.join(', ') : null;
  }

  /** Unpacks the bridge's lensInfo (layout documented in jni_bridge.cpp / wasm_bridge.cpp). */
  static fromNative(name: string, width: number, height: number, v: Float64Array, shadingGains: Float32Array): LensInfo {
    const warp = v[3] !== 0 ? { planes: v[4], coefficients: Array.from(v.subarray(5, 23)), centerX: v[23], centerY: v[24] } : null;
    const vignette = v[25] !== 0 ? { k: Array.from(v.subarray(26, 31)), centerX: v[31], centerY: v[32] } : null;
    const shading =
      v[33] !== 0 && shadingGains.length > 0
        ? { pointsV: v[34], pointsH: v[35], originV: v[36], originH: v[37], spacingV: v[38], spacingH: v[39], gains: shadingGains }
        : null;
    return new LensInfo(name, width, height, v[1], v[2], v[0], warp, vignette, shading, v[40]);
  }

  /** No image yet: identity geometry. */
  static none(width = 1, height = 1): LensInfo {
    return new LensInfo('', width, height, width, height, 1, null, null, null, 0);
  }
}
