/// <reference lib="webworker" />
// Runs the AI depth estimate (DepthEstimator.estimateHere) off the page's thread.
import type { PreviewImage } from '../engine/gl/PreviewImage';
import { estimateHere } from '../engine/retouch/DepthEstimator';

self.onmessage = async (ev: MessageEvent<{ id: number; base: PreviewImage; person: Float32Array | null; baseUrl: string }>) => {
  const { id, base, person, baseUrl } = ev.data;
  try {
    const depth = await estimateHere(base, person, baseUrl);
    self.postMessage({ id, depth }, [depth.data.buffer]);
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
