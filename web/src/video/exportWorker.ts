/// <reference lib="webworker" />
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_VERY_HIGH } from 'mediabunny';
import { VideoRenderer, type VideoGrade } from './render';

/**
 * Fast export: decodes the clip with WebCodecs, grades every frame with the same shader as the preview on an
 * OffscreenCanvas and encodes the result, as fast as the decoder and encoder go and without drawing anything on
 * screen. The clip's audio is copied over untouched.
 */
export interface ExportRequest { file: File; grade: VideoGrade }
export type ExportMessage =
  | { type: 'progress'; progress: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'error'; message: string }
  | { type: 'canceled' };

let conversion: Conversion | null = null;
const post = (m: ExportMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ExportRequest | { cancel: true }>) => {
  if ('cancel' in e.data) {
    await conversion?.cancel();
    return;
  }
  const { file, grade } = e.data;
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track in this file.');
    const canvas = new OffscreenCanvas(track.displayWidth, track.displayHeight);
    const renderer = new VideoRenderer(canvas);
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    let frame = 0;
    conversion = await Conversion.init({
      input,
      output,
      video: {
        quality: QUALITY_VERY_HIGH,
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
    post({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    if (err instanceof Error && err.name === 'ConversionCanceledError') post({ type: 'canceled' });
    else post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    conversion = null;
  }
};
