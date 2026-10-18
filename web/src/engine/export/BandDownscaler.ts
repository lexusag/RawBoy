import { rawWorker } from '../raw/RawWorker';

/**
 * Shrinks a developed image while it streams in, band by band, by exact area averaging (port of
 * BandDownscaler.kt; the work is native, band_ops.h in the decoder worker). Samples are interleaved RGB 16-bit.
 */
export class BandDownscaler {
  private outY = 0;

  private constructor(
    private readonly id: number,
    readonly outWidth: number,
    readonly outHeight: number,
    private readonly emit: (y: number, rows: number, band: Uint16Array) => Promise<void> | void,
  ) {}

  static async create(inW: number, inH: number, outW: number, outH: number, emit: (y: number, rows: number, band: Uint16Array) => Promise<void> | void) {
    if (!(outW >= 1 && outW <= inW && outH >= 1 && outH <= inH)) throw new Error('only downscaling');
    const id = await rawWorker().call<number>({ op: 'downscalerCreate', inW, inH, outW, outH });
    return new BandDownscaler(id, outW, outH, emit);
  }

  /** Adds [rows] input rows from [band] (interleaved RGB, input width pixels per row). */
  async push(rows: number, band: Uint16Array) {
    await this.emitRows(await rawWorker().call<Uint16Array>({ op: 'downscalerPush', id: this.id, rows: band, count: rows }));
  }

  /** Emits the remaining rows; call once after the last [push]. Frees the native downscaler. */
  async finish() {
    await this.emitRows(await rawWorker().call<Uint16Array>({ op: 'downscalerFinish', id: this.id }));
  }

  async abort() {
    await rawWorker().call({ op: 'release', id: this.id });
  }

  private async emitRows(out: Uint16Array) {
    const rows = out.length / (this.outWidth * 3);
    if (rows === 0) return;
    await this.emit(this.outY, rows, out);
    this.outY += rows;
  }

  /** Output size for a [width] x [height] image limited to [maxLongSide] (null or larger = unchanged). */
  static outputSize(width: number, height: number, maxLongSide: number | null): [number, number] {
    const long = Math.max(width, height);
    if (maxLongSide == null || maxLongSide <= 0 || long <= maxLongSide) return [width, height];
    const scale = maxLongSide / long;
    return [Math.min(width, Math.max(1, Math.round(width * scale))), Math.min(height, Math.max(1, Math.round(height * scale)))];
  }
}
