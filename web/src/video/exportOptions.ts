import { canEncodeVideo, Quality } from 'mediabunny';

/** How much the export is squeezed. Mediabunny scales the bitrate with the picture size and the codec. */
export type QualityPreset = 'compact' | 'optimal' | 'high';
export type ExportCodec = 'avc' | 'hevc';

export const QUALITY_PRESETS: { id: QualityPreset; label: string; level: 'low' | 'high' | 'very-high'; bitsPerPixel: number }[] = [
  { id: 'compact', label: 'Compact', level: 'low', bitsPerPixel: 0.06 },
  { id: 'optimal', label: 'Optimal', level: 'high', bitsPerPixel: 0.12 },
  { id: 'high', label: 'High quality', level: 'very-high', bitsPerPixel: 0.22 },
];
export const CODECS: { id: ExportCodec; label: string; mime: string }[] = [
  { id: 'avc', label: 'H.264', mime: 'video/mp4;codecs=avc1' },
  { id: 'hevc', label: 'HEVC (H.265)', mime: 'video/mp4;codecs=hvc1' },
];

export const qualityOf = (p: QualityPreset) => new Quality(QUALITY_PRESETS.find((q) => q.id === p)!.level);

/** Bitrate for the real-time (MediaRecorder) export, which has no quality levels: bits per pixel at 30 fps. HEVC needs about 60%. */
export function recorderBitrate(p: QualityPreset, codec: ExportCodec, w: number, h: number): number {
  const bpp = QUALITY_PRESETS.find((q) => q.id === p)!.bitsPerPixel;
  return Math.round(w * h * 30 * bpp * (codec === 'hevc' ? 0.6 : 1));
}

/** The codecs this browser can encode at the clip's size, in the list's order. */
export async function encodableCodecs(w: number, h: number): Promise<ExportCodec[]> {
  const out: ExportCodec[] = [];
  for (const c of CODECS) {
    try {
      if (await canEncodeVideo(c.id, { width: w, height: h })) out.push(c.id);
    } catch { /* treated as not encodable */ }
  }
  return out;
}

/** The wanted codec if it can be encoded, else the other one, else null (nothing can encode). */
export async function pickCodec(wanted: ExportCodec, w: number, h: number): Promise<ExportCodec | null> {
  const ok = await encodableCodecs(w, h);
  if (ok.includes(wanted)) return wanted;
  return ok[0] ?? null;
}

export const codecLabel = (c: ExportCodec) => CODECS.find((x) => x.id === c)!.label;
