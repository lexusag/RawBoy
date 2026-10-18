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
