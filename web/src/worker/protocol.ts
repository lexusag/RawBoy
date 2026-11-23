/** Messages between the main thread (engine/raw/RawImage.ts) and the decoder worker. */
/** The photo's EXIF essentials from the decoder (rawboy.h PhotoMetadata). Unknown: NaN / empty string. */
export interface PhotoMetadata {
  make: string;
  model: string;
  lensMake: string;
  lensModel: string;
  artist: string;
  copyright: string;
  /** "YYYY:MM:DD HH:MM:SS" */
  dateTimeOriginal: string;
  subSecTimeOriginal: string;
  offsetTimeOriginal: string;
  /** Seconds. */
  exposureTime: number;
  fNumber: number;
  /** EV. */
  exposureBias: number;
  focalLength: number;
  focalLength35mm: number;
  iso: number;
  gps: {
    /** Degrees, minutes, seconds. */
    latitude: Float64Array;
    longitude: Float64Array;
    latitudeRef: string;
    longitudeRef: string;
    /** Metres; NaN if unknown. */
    altitude: number;
    belowSeaLevel: boolean;
    /** The fix's UTC hours, minutes, seconds; absent if unknown. */
    timeStamp?: Float64Array;
    /** The fix's UTC date, "YYYY:MM:DD"; empty or absent if unknown. */
    dateStamp?: string;
  } | null;
}

/** Upright 8-bit normalized depth map (0 = near foreground, 255 = far background) embedded in a RawBoy Camera DNG. */
export interface DepthMapData {
  width: number;
  height: number;
  hardware: boolean;
  subjectDetected: boolean;
  /** Default normalized focus depth (0..1) on the detected subject. */
  focusDepth: number;
  /** width * height bytes (0..255 -> 0.0..1.0 depth). */
  data: Uint8Array;
  /** Distance per pixel in millimetres (0 = unknown, 65535 = farther), from a version 2 trailer (calibrated dual pixel). */
  millimetres?: Uint16Array;
}

export interface OpenResult {
  handle: number;
  /** Size of the decoded pixels: about half of fullWidth x fullHeight for a draft. */
  width: number;
  height: number;
  /** The photo's size at full resolution. */
  fullWidth: number;
  fullHeight: number;
  description: string;
  camera: string;
  iso: number;
  /** DNG BaselineExposure in EV, already applied to the pixels; NaN if the file has none. */
  baselineExposure: number;
  /** Pixel value of blown highlights, 0 if unknown (see DevelopParams.clipLevel). */
  clipLevel: number;
  /** A JPEG/HEIC, not a raw (see DevelopParams.displaySource). */
  displayReferred: boolean;
  asShotWhite: number[];
  lensName: string;
  lensInfo: Float64Array;
  lensShading: Float32Array;
  metadata: PhotoMetadata;
  /** Embedded RawBoy Camera depth map ("RBDP" trailer), or null when the file has none. */
  depthMap: DepthMapData | null;
}

export type Request =
  | { op: 'init'; wasmBase: string }
  | { op: 'open'; bytes: ArrayBuffer; extraBlack: number; draft: boolean }
  /** A HEIC or PNG decoded by the browser: canvas RGBA bytes (sRGB or Display P3) plus the file, for its EXIF. */
  | { op: 'openPixels'; rgba: ArrayBuffer; width: number; height: number; p3: boolean; bytes: ArrayBuffer }
  /** A JPEG XL image (a DNG's preview) to 8-bit sRGB RGBA: answers {@link JxlPixels}. */
  | { op: 'decodeJxl'; bytes: ArrayBuffer }
  | { op: 'close'; handle: number }
  | { op: 'downsample'; handle: number; width: number; height: number; boost: boolean }
  | { op: 'copyTile'; handle: number; x: number; y: number; width: number; height: number }
  | { op: 'noiseLevel'; handle: number }
  | { op: 'detectBlemishes'; handle: number; mask: Float32Array; maskW: number; maskH: number; faceDiameter: number }
  | { op: 'healBlemishes'; handle: number; spots: Float32Array; strokes: Float32Array }
  | { op: 'downscalerCreate'; inW: number; inH: number; outW: number; outH: number }
  | { op: 'downscalerPush'; id: number; rows: Uint16Array; count: number }
  | { op: 'downscalerFinish'; id: number }
  | { op: 'jpegBegin'; width: number; height: number; quality: number }
  | { op: 'jpegWrite'; id: number; rows: Uint16Array; count: number }
  | { op: 'jpegFinish'; id: number }
  | { op: 'release'; id: number };

export interface JxlPixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface InitResult {
  dngSdk: boolean;
  threads: boolean;
}
