import type { PreviewImage } from '../gl/PreviewImage';
import { halfToFloat } from '../util/half';

/** Linear Rec.2020 half floats -> an ordinary-looking sRGB image for the model, plus its luminance. */
export function toDisplayImage(image: PreviewImage): { bitmap: ImageData; gray: Float32Array } {
  const n = image.width * image.height;
  const px = image.pixels;
  const rgb = new Float32Array(n * 3);
  let logSum = 0;
  for (let i = 0; i < n; i++) {
    const r = halfToFloat(px[i * 3]);
    const g = halfToFloat(px[i * 3 + 1]);
    const b = halfToFloat(px[i * 3 + 2]);
    // Rec.2020 -> Rec.709/sRGB primaries
    rgb[i * 3] = 1.6605 * r - 0.5876 * g - 0.0728 * b;
    rgb[i * 3 + 1] = -0.1246 * r + 1.1329 * g - 0.0083 * b;
    rgb[i * 3 + 2] = -0.0182 * r - 0.1006 * g + 1.1187 * b;
    logSum += Math.log(Math.max(0.2627 * r + 0.678 * g + 0.0593 * b, 1e-5));
  }
  // Auto exposure: put the log-average at middle grey, then a soft shoulder.
  const k = 0.18 / Math.exp(logSum / n);
  const rgba = new Uint8ClampedArray(n * 4);
  const gray = new Float32Array(n);
  const weights = [0.2126, 0.7152, 0.0722];
  for (let i = 0; i < n; i++) {
    let y = 0;
    for (let ch = 0; ch < 3; ch++) {
      const v = Math.max(rgb[i * 3 + ch], 0) * k;
      const t = (v / (1 + v)) * 1.6;
      const e = t <= 0.0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - 0.055;
      const e8 = Math.trunc(Math.min(1, Math.max(0, e)) * 255 + 0.5);
      y += e8 * weights[ch];
      rgba[i * 4 + ch] = e8;
    }
    rgba[i * 4 + 3] = 255;
    gray[i] = y / 255;
  }
  return { bitmap: new ImageData(rgba, image.width, image.height), gray };
}
