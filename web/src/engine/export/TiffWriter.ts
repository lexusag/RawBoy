import type { PhotoMetadata } from '../../worker/protocol';
import { ascii, long, rationals, short, tiffIfds, type Entry } from './ExifWriter';

/**
 * Builds an LZW-compressed RGB TIFF (8 or 16 bits per sample, little endian, horizontal differencing predictor),
 * port of TiffWriter.kt. Rows are compressed strip by strip as they arrive; the header, which needs the
 * compressed strip sizes, is put in front when the file is finished. With [metadata] the header carries the
 * photo's EXIF (ExifWriter's tags, in IFD0 and its Exif and GPS IFDs).
 */
const STRIP_TARGET_BYTES = 256 * 1024;
const SHORT = 3;
const LONG = 4;

export class TiffWriter {
  private readonly bytesPerRow: number;
  private readonly rowsPerStrip: number;
  private readonly stripCount: number;
  private readonly parts: BlobPart[] = [];
  private readonly stripSizes: number[] = [];
  private readonly strip: Uint8Array;
  private stripFill = 0;
  private rowsWritten = 0;
  private readonly lzw = new LzwEncoder();

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly bitsPerSample: 8 | 16,
    private readonly metadata: PhotoMetadata | null = null,
  ) {
    this.bytesPerRow = (width * 3 * bitsPerSample) / 8;
    this.rowsPerStrip = Math.min(height, Math.max(1, Math.floor(STRIP_TARGET_BYTES / this.bytesPerRow)));
    this.stripCount = Math.ceil(height / this.rowsPerStrip);
    if (this.bytesPerRow * height >= 2 ** 31 - 1) throw new Error('Image too large for classic TIFF');
    this.strip = new Uint8Array(this.rowsPerStrip * this.bytesPerRow);
  }

  private header(): ArrayBuffer {
    const { width, height, bitsPerSample, rowsPerStrip, stripCount, stripSizes } = this;
    const longs = (tag: number, values: () => number[]): Entry => ({
      tag, type: LONG, count: stripCount, write: (v, at) => values().forEach((n, i) => v.setUint32(at + i * 4, n, true)),
    });
    let dataOffset = 0;
    const own: Entry[] = [
      long(256, width), // ImageWidth
      long(257, height), // ImageLength
      { tag: 258, type: SHORT, count: 3, write: (v, at) => [0, 1, 2].forEach((i) => v.setUint16(at + i * 2, bitsPerSample, true)) }, // BitsPerSample
      short(259, 5), // Compression: LZW
      short(262, 2), // Photometric: RGB
      longs(273, () => stripSizes.map((_, i) => dataOffset + stripSizes.slice(0, i).reduce((a, b) => a + b, 0))), // StripOffsets
      short(274, 1), // Orientation: top-left
      short(277, 3), // SamplesPerPixel
      long(278, rowsPerStrip), // RowsPerStrip
      longs(279, () => stripSizes), // StripByteCounts
      rationals(282, [[300, 1]]), // XResolution
      rationals(283, [[300, 1]]), // YResolution
      short(284, 1), // PlanarConfiguration: chunky
      short(296, 2), // ResolutionUnit: inch
      ascii(305, 'RawBoy'), // Software
      short(317, 2), // Predictor: horizontal differencing
    ];
    const tiff = tiffIfds(this.metadata, own);
    dataOffset = tiff.size;
    const buf = new ArrayBuffer(dataOffset);
    tiff.write(new DataView(buf), 0);
    return buf;
  }

  /**
   * Appends [rows] rows of interleaved RGB 16-bit samples, converted to the file's depth and differenced
   * from the pixel to the left (the predictor: neighbours are similar, so LZW finds more repeats).
   */
  writeRows(band: Uint16Array, rows: number) {
    const n = this.width * 3;
    const s = this.strip;
    for (let r = 0; r < rows; r++) {
      const row = r * n;
      let p = this.stripFill;
      if (this.bitsPerSample === 16) {
        for (let i = 0; i < n; i++) {
          const d = (band[row + i] - (i >= 3 ? band[row + i - 3] : 0)) & 0xffff;
          s[p++] = d & 0xff;
          s[p++] = d >> 8;
        }
      } else {
        let a = 0, b = 0, c = 0;
        for (let i = 0; i < n; i += 3) {
          const r8 = to8(band[row + i]), g8 = to8(band[row + i + 1]), b8 = to8(band[row + i + 2]);
          s[p++] = (r8 - a) & 0xff; s[p++] = (g8 - b) & 0xff; s[p++] = (b8 - c) & 0xff;
          a = r8; b = g8; c = b8;
        }
      }
      this.stripFill = p;
      this.rowsWritten++;
      if (this.stripFill === s.length || this.rowsWritten === this.height) this.flushStrip();
    }
  }

  private flushStrip() {
    const data = this.lzw.encode(this.strip, this.stripFill);
    this.parts.push(data);
    this.stripSizes.push(data.length);
    this.stripFill = 0;
  }

  finish(): Blob {
    if (this.rowsWritten !== this.height) throw new Error(`TIFF size mismatch: wrote ${this.rowsWritten} rows`);
    return new Blob([this.header(), ...this.parts], { type: 'image/tiff' });
  }
}

const to8 = (v: number) => Math.trunc((v * 255 + 32767) / 65535);

const CLEAR = 256;
const EOI = 257;
const FIRST_CODE = 258;
/** libtiff resets the table when the next free code would be 4094. */
const TABLE_FULL = 4094;
const HASH_BITS = 13;

/**
 * TIFF's LZW (MSB-first codes of 9 to 12 bits, "early change" as libtiff writes it), one strip at a time.
 * The string table is a hash of (prefix code, next byte) → code.
 */
export class LzwEncoder {
  private readonly keys = new Int32Array(1 << HASH_BITS);
  private readonly codes = new Uint16Array(1 << HASH_BITS);
  private out = new Uint8Array(0);
  private pos = 0;
  private bits = 0;
  private bitCount = 0;

  encode(src: Uint8Array, length: number): Uint8Array {
    // Worst case: one 12-bit code per input byte, plus clear codes.
    const bound = length + (length >> 1) + (length >> 10) + 16;
    if (this.out.length < bound) this.out = new Uint8Array(bound);
    this.pos = 0;
    this.bits = 0;
    this.bitCount = 0;
    let width = 9;
    let next = FIRST_CODE;
    this.keys.fill(-1);
    this.put(CLEAR, width);
    if (length === 0) {
      this.put(EOI, width);
      return this.flush();
    }
    const mask = (1 << HASH_BITS) - 1;
    let w = src[0];
    for (let i = 1; i < length; i++) {
      const k = src[i];
      const key = (w << 8) | k;
      let h = Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS);
      let found = -1;
      while (this.keys[h] !== -1) {
        if (this.keys[h] === key) { found = this.codes[h]; break; }
        h = (h + 1) & mask;
      }
      if (found >= 0) {
        w = found;
        continue;
      }
      this.put(w, width);
      this.keys[h] = key;
      this.codes[h] = next++;
      if (next === TABLE_FULL) {
        this.put(CLEAR, width);
        this.keys.fill(-1);
        next = FIRST_CODE;
        width = 9;
      } else if (next > (1 << width) - 1) {
        width++;
      }
      w = k;
    }
    this.put(w, width);
    // The decoder adds one more entry on reading that code, which may widen the EOI code.
    next++;
    if (next === TABLE_FULL) {
      this.put(CLEAR, width);
      width = 9;
    } else if (next > (1 << width) - 1) {
      width++;
    }
    this.put(EOI, width);
    return this.flush();
  }

  private put(code: number, width: number) {
    this.bits = (this.bits << width) | code;
    this.bitCount += width;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      this.out[this.pos++] = (this.bits >>> this.bitCount) & 0xff;
    }
    this.bits &= (1 << this.bitCount) - 1;
  }

  private flush(): Uint8Array {
    if (this.bitCount > 0) this.out[this.pos++] = (this.bits << (8 - this.bitCount)) & 0xff;
    return this.out.slice(0, this.pos);
  }
}
