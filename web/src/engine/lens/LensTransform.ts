import { Mat3, type M3 } from '../color/Mat3';
import { cropOf, isFullCrop } from '../develop/CropMath';
import type { DevelopParams } from '../develop/DevelopParams';
import { bottom, right, type PixelRect } from '../gl/Zoom';
import type { LensInfo, RadialVignette, Warp } from './LensInfo';

/**
 * Lens geometry for one image and one set of slider values (port of lens/LensTransform.kt): where each output
 * pixel samples the decoded image, and the gains to apply there.
 *
 * Output pixel p (full resolution, after rotation and crop) maps to its source by:
 *   0. add the user crop's origin (the crop only picks a window of the finished frame), then undo
 *      rotation (90 degree turns + straighten), with auto crop for the straighten angle, and the flips
 *   1. auto scale around the image centre (crop to valid pixels, like Lightroom's Constrain Crop)
 *   2. manual distortion (radial, around the image centre)
 *   3. embedded DNG WarpRectilinear, in sensor coordinates, per colour plane
 *
 * Lens correction always works on the whole frame: the auto scale, distortion, warp and vignettes use the
 * full image and sensor, never the user crop, so a cropped pixel equals the uncropped render's pixel.
 *
 * The GLSL in shaders/develop.glsl mirrors this exactly; this is used to size tiles and the auto scale.
 * knownZoom reuses the auto scale of a transform that differs only in crop (it doesn't depend on it).
 */
export class LensTransform {
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly halfDiagonal: number;
  /** Clockwise quarter turns, 0..3. */
  readonly quarterTurns: number;
  /** The photo is mirrored left-right / top-bottom (display orientation, before the turns). */
  readonly flipHorizontal: boolean;
  readonly flipVertical: boolean;
  /** The rotated + straightened frame, before the user crop. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** User crop in frame pixels; the whole frame when there is none. */
  readonly cropRect: PixelRect;
  readonly outputWidth: number;
  readonly outputHeight: number;
  private readonly straightenRadians: number;
  /** Output pixel -> image pixel (display orientation), row-major 3x3 affine. */
  readonly outToImage: M3;
  /** k in src_r = r * (1 - k r^2); +100 on the slider removes strong barrel distortion. */
  readonly manualK: number;
  readonly warp: Warp | null;
  readonly vignette: RadialVignette | null;
  /** The decode applied the shading gain maps; with the profile off, take the luminance part back out. */
  readonly undoShading: boolean;
  readonly manualVignette: number;
  readonly manualVignetteMidpoint: number;
  /** Oriented pixel -> sensor pixel (row-major 3x3 affine), and back. */
  readonly toSensor: M3;
  readonly fromSensor: M3;
  readonly warpCenterX: number;
  readonly warpCenterY: number;
  readonly warpNorm: number;
  readonly vignetteCenterX: number;
  readonly vignetteCenterY: number;
  readonly vignetteNorm: number;
  /** Planes with distinct warp coefficients (3 = lateral chromatic aberration correction). */
  readonly warpPlanes: number;
  /** Output scale >= the value at which every output pixel has real image data. */
  readonly zoom: number;

  constructor(readonly info: LensInfo, params: DevelopParams, knownZoom?: number) {
    this.width = info.width;
    this.height = info.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.halfDiagonal = Math.hypot(this.width / 2, this.height / 2);
    this.quarterTurns = ((params.rotation % 4) + 4) % 4;
    this.flipHorizontal = params.flipHorizontal;
    this.flipVertical = params.flipVertical;
    this.frameWidth = this.quarterTurns % 2 === 1 ? this.height : this.width;
    this.frameHeight = this.quarterTurns % 2 === 1 ? this.width : this.height;
    this.cropRect = this.cropPixels(params);
    this.outputWidth = this.cropRect.width;
    this.outputHeight = this.cropRect.height;
    this.straightenRadians = (Math.min(45, Math.max(-45, params.straighten)) * Math.PI) / 180;
    this.outToImage = this.rotationMatrix();
    const useProfile = params.lensProfile && info.hasProfile;
    this.manualK = (params.lensDistortion / 100) * 0.25;
    this.warp = useProfile ? info.warp : null;
    this.vignette = useProfile ? info.vignette : null;
    this.undoShading = !params.lensProfile && info.shading != null;
    this.manualVignette = params.vignetteAmount / 100;
    this.manualVignetteMidpoint = params.vignetteMidpoint / 100;
    this.toSensor = LensTransform.orientationMatrix(info.orientation, info.sensorWidth, info.sensorHeight);
    this.fromSensor = Mat3.inverse(this.toSensor);
    this.warpCenterX = (this.warp?.centerX ?? 0.5) * info.sensorWidth;
    this.warpCenterY = (this.warp?.centerY ?? 0.5) * info.sensorHeight;
    this.warpNorm = this.maxCornerDistance(this.warpCenterX, this.warpCenterY);
    this.vignetteCenterX = (this.vignette?.centerX ?? 0.5) * info.sensorWidth;
    this.vignetteCenterY = (this.vignette?.centerY ?? 0.5) * info.sensorHeight;
    this.vignetteNorm = this.maxCornerDistance(this.vignetteCenterX, this.vignetteCenterY);
    this.warpPlanes = this.warp?.planes ?? 1;
    this.zoom = knownZoom ?? (this.isGeometric ? this.autoZoom() : 1);
  }

  get isGeometric(): boolean {
    return this.warp != null || this.manualK !== 0;
  }

  /** Source position (image, display orientation) of output pixel (x, y) for colour plane 0..2. */
  source(x: number, y: number, plane = 1): number[] {
    const m = this.outToImage;
    return this.lensSource(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5], plane, this.zoom);
  }

  /**
   * Output pixel showing source position (x, y) (image, display orientation): the inverse of [source], for drawing
   * image-space shapes (mask gradients) over the preview. Newton steps from the lens-free guess; distortion is mild.
   */
  output(x: number, y: number): number[] {
    const inv = Mat3.inverse(this.outToImage);
    let ox = inv[0] * x + inv[1] * y + inv[2];
    let oy = inv[3] * x + inv[4] * y + inv[5];
    const h = 0.5;
    // Keep the best estimate: far outside the photo (overlay handles) the distortion polynomial can fold.
    let best = [ox, oy];
    let bestErr = Infinity;
    for (let i = 0; i < 6; i++) {
      const s = this.source(ox, oy);
      const ex = s[0] - x;
      const ey = s[1] - y;
      const err = Math.abs(ex) + Math.abs(ey);
      if (!(err < bestErr)) break;
      best = [ox, oy];
      bestErr = err;
      if (err < 0.02) break;
      const sx = this.source(ox + h, oy);
      const sy = this.source(ox, oy + h);
      const a = (sx[0] - s[0]) / h;
      const b = (sy[0] - s[0]) / h;
      const c = (sx[1] - s[1]) / h;
      const d = (sy[1] - s[1]) / h;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) break;
      ox -= (d * ex - b * ey) / det;
      oy -= (a * ey - c * ex) / det;
    }
    return best;
  }

  /** Steps 1-3 for an image position (x, y). */
  private lensSource(x: number, y: number, plane: number, zoomOverride: number): number[] {
    let dx = (x - this.centerX) / zoomOverride;
    let dy = (y - this.centerY) / zoomOverride;
    const rn2 = (dx * dx + dy * dy) / (this.halfDiagonal * this.halfDiagonal);
    const f = 1 - this.manualK * rn2;
    dx *= f;
    dy *= f;
    const qx = this.centerX + dx;
    const qy = this.centerY + dy;
    const w = this.warp;
    if (!w) return [qx, qy];

    const ts = this.toSensor;
    const sx = ts[0] * qx + ts[1] * qy + ts[2];
    const sy = ts[3] * qx + ts[4] * qy + ts[5];
    const c = w.coefficients;
    const o = (w.planes === 3 ? plane : 0) * 6;
    const ux = (sx - this.warpCenterX) / this.warpNorm;
    const uy = (sy - this.warpCenterY) / this.warpNorm;
    const r2 = ux * ux + uy * uy;
    const radial = c[o] + r2 * (c[o + 1] + r2 * (c[o + 2] + r2 * c[o + 3]));
    const tx = c[o + 4] * 2 * ux * uy + c[o + 5] * (r2 + 2 * ux * ux);
    const ty = c[o + 4] * (r2 + 2 * uy * uy) + c[o + 5] * 2 * ux * uy;
    const srcX = this.warpCenterX + this.warpNorm * (ux * radial + tx);
    const srcY = this.warpCenterY + this.warpNorm * (uy * radial + ty);
    const fs = this.fromSensor;
    return [fs[0] * srcX + fs[1] * srcY + fs[2], fs[3] * srcX + fs[4] * srcY + fs[5]];
  }

  /** Source pixels needed to render [out], plus [margin], clamped to the image. */
  sourceBounds(out: PixelRect, margin: number): PixelRect {
    if (!this.isGeometric && this.zoom === 1 && this.quarterTurns === 0 && !this.flipHorizontal && !this.flipVertical && this.straightenRadians === 0 && this.cropRect.x === 0 && this.cropRect.y === 0) {
      const x0 = Math.max(0, out.x - margin);
      const y0 = Math.max(0, out.y - margin);
      const x1 = Math.min(this.width, right(out) + margin);
      const y1 = Math.min(this.height, bottom(out) + margin);
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    let maxY = -Number.MAX_VALUE;
    const steps = 24;
    for (const plane of this.planesToCheck()) {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const xs = out.x + t * out.width;
        const ys = out.y + t * out.height;
        for (const [px, py] of [
          [xs, out.y],
          [xs, bottom(out)],
          [out.x, ys],
          [right(out), ys],
        ]) {
          const s = this.source(px, py, plane);
          minX = Math.min(minX, s[0]);
          maxX = Math.max(maxX, s[0]);
          minY = Math.min(minY, s[1]);
          maxY = Math.max(maxY, s[1]);
        }
      }
    }
    const coerce = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    const x0 = coerce(Math.floor(minX) - margin, 0, this.width - 1);
    const y0 = coerce(Math.floor(minY) - margin, 0, this.height - 1);
    const x1 = coerce(Math.ceil(maxX) + margin, x0 + 1, this.width);
    const y1 = coerce(Math.ceil(maxY) + margin, y0 + 1, this.height);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  private planesToCheck(): number[] {
    return this.warpPlanes === 3 ? [0, 1, 2] : [1];
  }

  private autoZoom(): number {
    const { width, height } = this;
    const inside = (z: number): boolean => {
      const steps = 48;
      for (const plane of this.planesToCheck()) {
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          for (const [px, py] of [
            [t * width, 0],
            [t * width, height],
            [0, t * height],
            [width, t * height],
          ]) {
            const s = this.lensSource(px, py, plane, z);
            if (s[0] < -0.5 || s[1] < -0.5 || s[0] > width + 0.5 || s[1] > height + 0.5) return false;
          }
        }
      }
      return true;
    };
    let lo = 0.7;
    let hi = 1.6;
    if (!inside(hi)) return hi;
    if (inside(lo)) return lo;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** Crop edges rounded to frame pixels, at least 16 px and inside the frame. */
  private cropPixels(params: DevelopParams): PixelRect {
    const c = cropOf(params);
    if (isFullCrop(c)) return { x: 0, y: 0, width: this.frameWidth, height: this.frameHeight };
    const edges = (a: number, b: number, size: number): [number, number] => {
      const minSize = Math.min(16, size);
      const lo = Math.min(size - minSize, Math.max(0, Math.round(Math.min(1, Math.max(0, a)) * size)));
      const hi = Math.min(size, Math.max(lo + minSize, Math.round(Math.min(1, Math.max(0, b)) * size)));
      return [lo, hi];
    };
    const [x0, x1] = edges(c.left, c.right, this.frameWidth);
    const [y0, y1] = edges(c.top, c.bottom, this.frameHeight);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /**
   * image = c_img + F R(-90k) R(-theta) (out + crop - c_frame) / s, in y-down coordinates where positive angles
   * turn the picture clockwise; F mirrors the image about its centre (the flips). s crops the straightened frame to
   * the largest same-aspect rectangle inside the image; it depends on the frame, not the user crop.
   */
  private rotationMatrix(): M3 {
    const t = this.straightenRadians;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const ow = this.frameWidth;
    const oh = this.frameHeight;
    const s = c + Math.max(ow / oh, oh / ow) * Math.abs(sn);
    const r = [c / s, sn / s, -sn / s, c / s];
    const q =
      this.quarterTurns === 1 ? [0, 1, -1, 0] : this.quarterTurns === 2 ? [-1, 0, 0, -1] : this.quarterTurns === 3 ? [0, -1, 1, 0] : [1, 0, 0, 1];
    const fx = this.flipHorizontal ? -1 : 1;
    const fy = this.flipVertical ? -1 : 1;
    const a = fx * (q[0] * r[0] + q[1] * r[2]);
    const b = fx * (q[0] * r[1] + q[1] * r[3]);
    const d = fy * (q[2] * r[0] + q[3] * r[2]);
    const e = fy * (q[2] * r[1] + q[3] * r[3]);
    // Frame centre in output (cropped) pixels.
    const cox = ow / 2 - this.cropRect.x;
    const coy = oh / 2 - this.cropRect.y;
    return [a, b, this.centerX - (a * cox + b * coy), d, e, this.centerY - (d * cox + e * coy), 0, 0, 1];
  }

  private maxCornerDistance(cx: number, cy: number): number {
    const w = this.info.sensorWidth;
    const h = this.info.sensorHeight;
    return Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  }

  /** Affine (continuous pixel coordinates) from display orientation to sensor orientation. */
  static orientationMatrix(o: number, w: number, h: number): M3 {
    switch (o) {
      case 2: return [-1, 0, w, 0, 1, 0, 0, 0, 1];
      case 3: return [-1, 0, w, 0, -1, h, 0, 0, 1];
      case 4: return [1, 0, 0, 0, -1, h, 0, 0, 1];
      case 5: return [0, 1, 0, 1, 0, 0, 0, 0, 1];
      case 6: return [0, 1, 0, -1, 0, h, 0, 0, 1];
      case 7: return [0, -1, w, -1, 0, h, 0, 0, 1];
      case 8: return [0, -1, w, 1, 0, 0, 0, 0, 1];
      default: return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
  }
}
