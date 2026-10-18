/// <reference lib="webworker" />
// Hosts the WASM build of the engine's native code (web/native): decoding, previews, tiles, blemish healing,
// export downscaling and jpegli. Full-resolution pixels stay in this worker's WASM heap.
import type { OpenResult, Request } from './protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Module = any;
let module: Module = null;
let nextId = 1;
/** Downscalers and JPEG encoders by id (embind objects, deleted on finish/release). */
const objects = new Map<number, Module>();

async function init(wasmBase: string) {
  const candidates = ['rawboy-full.mjs', 'rawboy.mjs'];
  let lastError: unknown = null;
  for (const name of candidates) {
    const url = new URL(name, wasmBase).href;
    try {
      // The full variant (with the Adobe DNG SDK) is missing from local builds without the SDK; check before importing.
      if (name !== 'rawboy.mjs' && !(await fetch(url, { method: 'HEAD' })).ok) continue;
      const { default: create } = await import(/* @vite-ignore */ url);
      module = await create();
      return { dngSdk: module.hasDngSdk() as boolean, threads: typeof SharedArrayBuffer !== 'undefined' };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('Could not load the decoder');
}

function opened(handle: number): [OpenResult, Transferable[]] {
  const m = module;
  const result: OpenResult = {
    handle,
    width: m.width(handle),
    height: m.height(handle),
    description: m.describe(handle),
    camera: m.camera(handle),
    iso: m.iso(handle),
    baselineExposure: m.baselineExposure(handle),
    displayReferred: m.displayReferred(handle),
    asShotWhite: Array.from(m.asShotWhite(handle) as Float64Array),
    lensName: m.lensName(handle),
    lensInfo: m.lensInfo(handle),
    lensShading: m.lensShading(handle),
    metadata: m.metadata(handle),
  };
  return [result, [result.lensInfo.buffer, result.lensShading.buffer]];
}

function run(req: Request): [unknown, Transferable[]] {
  const m = module;
  switch (req.op) {
    case 'open': {
      const bytes = new Uint8Array(req.bytes);
      const handle = m.open(bytes, req.extraBlack) as number;
      if (!handle) {
        // DNG 1.7 (JPEG XL) and other DNGs LibRaw can't read need the Adobe DNG SDK (rawboy-full).
        const hint = !m.hasDngSdk() && looksLikeTiff(bytes) ? ' This DNG may need a build with the Adobe DNG SDK (e.g. JPEG XL compression).' : '';
        throw new Error(m.lastError() + hint);
      }
      return opened(handle);
    }
    case 'openPixels': {
      const handle = m.openPixels(new Uint8Array(req.rgba), req.width, req.height, req.p3, new Uint8Array(req.bytes)) as number;
      if (!handle) throw new Error(m.lastError());
      return opened(handle);
    }
    case 'close':
      m.close(req.handle);
      return [null, []];
    case 'downsample': {
      const px = m.downsample(req.handle, req.width, req.height, req.boost) as Uint16Array;
      return [px, [px.buffer]];
    }
    case 'copyTile': {
      const px = m.copyTile(req.handle, req.x, req.y, req.width, req.height) as Uint16Array;
      return [px, [px.buffer]];
    }
    case 'noiseLevel': {
      const n = m.noiseLevel(req.handle) as Float32Array;
      return [[n[0], n[1]], []];
    }
    case 'detectBlemishes': {
      const spots = m.detectBlemishes(req.handle, req.mask, req.maskW, req.maskH, req.faceDiameter) as Float32Array;
      return [spots, [spots.buffer]];
    }
    case 'healBlemishes':
      m.healBlemishes(req.handle, req.spots);
      return [null, []];
    case 'downscalerCreate': {
      const id = nextId++;
      objects.set(id, new m.Downscaler(req.inW, req.inH, req.outW, req.outH));
      return [id, []];
    }
    case 'downscalerPush': {
      const out = objects.get(req.id).push(req.rows, req.count) as Uint16Array;
      return [out, [out.buffer]];
    }
    case 'downscalerFinish': {
      const out = objects.get(req.id).finish() as Uint16Array;
      release(req.id);
      return [out, [out.buffer]];
    }
    case 'jpegBegin': {
      const id = nextId++;
      objects.set(id, new m.JpegEncoder(req.width, req.height, req.quality));
      return [id, []];
    }
    case 'jpegWrite':
      objects.get(req.id).writeRows(req.rows, req.count);
      return [null, []];
    case 'jpegFinish': {
      const bytes = objects.get(req.id).finish() as Uint8Array;
      release(req.id);
      return [bytes, [bytes.buffer]];
    }
    case 'release':
      release(req.id);
      return [null, []];
    default:
      throw new Error(`unknown op ${(req as Request).op}`);
  }
}

const looksLikeTiff = (d: Uint8Array) =>
  d.length > 8 && ((d[0] === 0x49 && d[1] === 0x49 && d[2] === 42 && d[3] === 0) || (d[0] === 0x4d && d[1] === 0x4d && d[2] === 0 && d[3] === 42));

function release(id: number) {
  objects.get(id)?.delete();
  objects.delete(id);
}

/** C++ exceptions surface as WebAssembly.Exception; turn them into readable messages. */
function message(e: unknown): string {
  const Exception = (WebAssembly as unknown as { Exception?: new () => object }).Exception;
  if (module && Exception && e instanceof Exception) {
    try {
      const [, msg] = module.getExceptionMessage(e);
      return msg || 'native error';
    } catch {
      return 'native error';
    }
  }
  return e instanceof Error ? e.message : String(e);
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = ev.data;
  try {
    if (req.op === 'init') {
      self.postMessage({ id, ok: true, result: await init(req.wasmBase) });
      return;
    }
    const [result, transfer] = run(req);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: message(e) });
  }
};
