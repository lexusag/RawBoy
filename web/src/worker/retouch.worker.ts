/// <reference lib="webworker" />
// Builds Portrait retouch maps (PortraitRetouch.buildRetouchMap) off the page's thread.
import type { PreviewImage } from '../engine/gl/PreviewImage';
import { buildRetouchMap } from '../engine/retouch/PortraitRetouch';
import type { SkinMask } from '../engine/retouch/SkinMask';

self.onmessage = (ev: MessageEvent<{ id: number; preview: PreviewImage; skin: SkinMask; strength: number }>) => {
  const { id, preview, skin, strength } = ev.data;
  try {
    const map = buildRetouchMap(preview, skin, strength);
    self.postMessage({ id, map }, map ? [map.data.buffer] : []);
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
