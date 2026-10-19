/** Half-float bits -> number (as android.util.Half.toFloat). */
const table = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    t[h] = e === 0 ? sign * f * 2 ** -24 : e === 31 ? (f ? NaN : sign * Infinity) : sign * 2 ** (e - 15) * (1 + f / 1024);
  }
  return t;
})();

export const halfToFloat = (h: number): number => table[h];

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Number -> half-float bits, rounded to nearest even (as android.util.Half.toHalf). */
export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  let m = x & 0x7fffff;
  if (e >= 31) return sign | ((x & 0x7f800000) === 0x7f800000 && m ? 0x7e00 : 0x7c00);
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000;
    const shift = 14 - e;
    let h = m >> shift;
    const rem = m & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (m >> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++; // a carry into the exponent is still right
  return sign | h;
}
