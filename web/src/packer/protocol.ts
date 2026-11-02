/** Messages to RawBoy Packer's worker (src/worker/packer.worker.ts) and what the native packer reports. */

export type PackFormat = 'small' | 'micro' | 'losslessJpeg' | 'losslessJxl';

/** dng_pack.h's PackOptions. */
export interface PackOptions {
  mode: PackFormat;
  distance: number;
  effort: number;
  maxSize: number;
  previewSize: number;
  lensCorrections: boolean;
  keepGps: boolean;
  threads: number;
}

/** dng_pack.h's PackInfo. */
export interface PackInfo {
  make: string;
  model: string;
  lens: string;
  format: string;
  width: number;
  height: number;
  dng: boolean;
  mosaic: boolean;
  bayer: boolean;
  /** "Sony", "Fujifilm": corrections stored by the camera; "DNG": the DNG's own opcodes; "": none. */
  lensData: string;
  lensDistortion: boolean;
  lensVignetting: boolean;
  lensCa: boolean;
  adobeHints: boolean;
  /** The raw data's bit depth, from its white level (0 = unknown). */
  bits: number;
  /** How the source stores its data: "lossless compressed", "lossy JPEG XL"...; "" when unknown. */
  compression: string;
  /** DNG sources: "1.7"; "" otherwise. */
  dngVersion: string;
  // Results of pack() only:
  modeUsed: PackFormat;
  linear: boolean;
  lensWritten: boolean;
  preview: '' | 'camera' | 'rendered' | 'none';
  outWidth: number;
  outHeight: number;
  seconds: number;
}

export type PackerRequest =
  | { op: 'init'; wasmBase: string }
  | { op: 'inspect'; bytes: ArrayBuffer }
  | { op: 'pack'; bytes: ArrayBuffer; options: PackOptions }
  | { op: 'decodeJxl'; bytes: ArrayBuffer };
