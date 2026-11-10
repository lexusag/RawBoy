/// <reference lib="webworker" />
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { pickCodec, qualityOf, type ExportCodec, type QualityPreset } from './exportOptions';
import { VideoRenderer, type VideoGrade } from './render';

/**
 * Fast export: decodes the clip with WebCodecs, grades every frame with the same shader as the preview on an
 * OffscreenCanvas and encodes the result, as fast as the decoder and encoder go and without drawing anything on
 * screen. The clip's audio is copied over untouched.
 */
export interface ExportRequest { file: File; grade: VideoGrade; codec: ExportCodec; quality: QualityPreset }
export type ExportMessage =
  | { type: 'progress'; progress: number }
  | { type: 'done'; buffer: ArrayBuffer; codec: ExportCodec; fellBack: boolean }
  | { type: 'error'; message: string }
  | { type: 'canceled' };

let conversion: Conversion | null = null;
const post = (m: ExportMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ExportRequest | { cancel: true }>) => {
  if ('cancel' in e.data) {
    await conversion?.cancel();
    return;
  }
  const { file, grade, codec: wanted, quality } = e.data;
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track in this file.');
    const codec = await pickCodec(wanted, track.displayWidth, track.displayHeight);
    if (!codec) throw new Error('This browser cannot encode H.264 or HEVC video.');
    const canvas = new OffscreenCanvas(track.displayWidth, track.displayHeight);
    const renderer = new VideoRenderer(canvas);
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    let frame = 0;
    conversion = await Conversion.init({
      input,
      output,
      video: {
        codec,
        quality: qualityOf(quality),
        forceTranscode: true,
        processedWidth: track.displayWidth,
        processedHeight: track.displayHeight,
        process: (sample) => {
          const f = sample.toVideoFrame();
          renderer.draw(f, f.displayWidth, f.displayHeight, grade, frame++);
          f.close();
          return canvas;
        },
      },
    });
    if (!conversion.isValid) throw new Error('This browser cannot convert that clip (no decoder or encoder for it).');
    conversion.onProgress = (progress) => post({ type: 'progress', progress });
    await conversion.execute();
    const buffer = (output.target as BufferTarget).buffer!;
    post({ type: 'done', buffer, codec, fellBack: codec !== wanted }, [buffer]);
  } catch (err) {
    if (err instanceof Error && err.name === 'ConversionCanceledError') post({ type: 'canceled' });
    else post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    conversion = null;
  }
};
