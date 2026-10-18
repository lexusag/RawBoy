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
  } | null;
}

export interface OpenResult {
  handle: number;
  width: number;
  height: number;
  description: string;
  camera: string;
  iso: number;
  /** DNG BaselineExposure in EV, already applied to the pixels; NaN if the file has none. */
  baselineExposure: number;
  /** A JPEG/HEIC, not a raw (see DevelopParams.displaySource). */
  displayReferred: boolean;
  asShotWhite: number[];
  lensName: string;
  lensInfo: Float64Array;
  lensShading: Float32Array;
  metadata: PhotoMetadata;
}

export type Request =
  | { op: 'init'; wasmBase: string }
  | { op: 'open'; bytes: ArrayBuffer; extraBlack: number }
  /** A HEIC or PNG decoded by the browser: canvas RGBA bytes (sRGB or Display P3) plus the file, for its EXIF. */
  | { op: 'openPixels'; rgba: ArrayBuffer; width: number; height: number; p3: boolean; bytes: ArrayBuffer }
  | { op: 'close'; handle: number }
  | { op: 'downsample'; handle: number; width: number; height: number; boost: boolean }
  | { op: 'copyTile'; handle: number; x: number; y: number; width: number; height: number }
  | { op: 'noiseLevel'; handle: number }
  | { op: 'detectBlemishes'; handle: number; mask: Float32Array; maskW: number; maskH: number; faceDiameter: number }
  | { op: 'healBlemishes'; handle: number; spots: Float32Array }
  | { op: 'downscalerCreate'; inW: number; inH: number; outW: number; outH: number }
  | { op: 'downscalerPush'; id: number; rows: Uint16Array; count: number }
  | { op: 'downscalerFinish'; id: number }
  | { op: 'jpegBegin'; width: number; height: number; quality: number }
  | { op: 'jpegWrite'; id: number; rows: Uint16Array; count: number }
  | { op: 'jpegFinish'; id: number }
  | { op: 'release'; id: number };

export interface InitResult {
  dngSdk: boolean;
  threads: boolean;
}
