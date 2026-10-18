/** Minimal row-major 3x3 matrix helpers (port of color/Mat3.kt). */
export type M3 = number[];

export const Mat3 = {
  multiply(a: M3, b: M3): M3 {
    const r = new Array<number>(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
        r[i * 3 + j] = s;
      }
    return r;
  },

  apply(m: M3, v: number[]): number[] {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  },

  diagonal: (a: number, b: number, c: number): M3 => [a, 0, 0, 0, b, 0, 0, 0, c],

  inverse(m: M3): M3 {
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (det === 0) throw new Error('singular matrix');
    const i = 1 / det;
    return [
      (m[4] * m[8] - m[5] * m[7]) * i, (m[2] * m[7] - m[1] * m[8]) * i, (m[1] * m[5] - m[2] * m[4]) * i,
      (m[5] * m[6] - m[3] * m[8]) * i, (m[0] * m[8] - m[2] * m[6]) * i, (m[2] * m[3] - m[0] * m[5]) * i,
      (m[3] * m[7] - m[4] * m[6]) * i, (m[1] * m[6] - m[0] * m[7]) * i, (m[0] * m[4] - m[1] * m[3]) * i,
    ];
  },

  /** Row-major -> column-major Float32Array, as uniformMatrix3fv expects. */
  toGlColumnMajor(m: M3): Float32Array {
    const out = new Float32Array(9);
    for (let idx = 0; idx < 9; idx++) out[idx] = m[(idx % 3) * 3 + Math.floor(idx / 3)];
    return out;
  },
};
