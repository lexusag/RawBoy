/// <reference lib="webworker" />
// Runs MediaPipe skin segmentation and face landmarks (SkinSegmenter.segmentHere) off the page's thread.
import type { PreviewImage } from '../engine/gl/PreviewImage';
import { segmentHere } from '../engine/retouch/SkinSegmenter';

// MediaPipe loads its WASM glue with importScripts, which module workers lack; the glue only defines a global
// ModuleFactory, so a synchronous fetch evaluated at global scope stands in for it.
(self as unknown as { importScripts: (...urls: string[]) => void }).importScripts = (...urls: string[]) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status !== 200) throw new Error(`Could not load ${url}`);
    (0, eval)(xhr.responseText);
  }
};

self.onmessage = async (ev: MessageEvent<{ id: number; image: PreviewImage; fullWidth: number; fullHeight: number; base: string }>) => {
  const { id, image, fullWidth, fullHeight, base } = ev.data;
  try {
    const mask = await segmentHere(image, fullWidth, fullHeight, base);
    self.postMessage({ id, mask }, [mask.data.buffer]);
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
