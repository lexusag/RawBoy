/// <reference lib="webworker" />
// RawBoy Packer's worker: the WASM engine with the Adobe DNG SDK (rawboy-full), which repackages raws and DNGs as DNGs
// (engine/src/main/cpp/dng_pack.cpp). One worker per file packed at once; each has its own WASM heap and threads.
import type { PackInfo, PackOptions, PackerRequest } from '../packer/protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let module: any = null;

async function init(wasmBase: string) {
  const { default: create } = await import(/* @vite-ignore */ new URL('rawboy-full.mjs', wasmBase).href);
  module = await create();
  if (!module.hasDngSdk()) throw new Error('This build has no Adobe DNG SDK');
}

function run(req: PackerRequest): [unknown, Transferable[]] {
  switch (req.op) {
    case 'inspect': {
      const info = module.packInspect(new Uint8Array(req.bytes)) as PackInfo | null;
      if (!info) throw new Error(module.lastError());
      return [info, []];
    }
    case 'pack': {
      const out = module.pack(new Uint8Array(req.bytes), req.options as PackOptions) as { dng: Uint8Array; info: PackInfo } | null;
      if (!out) throw new Error(module.lastError());
      return [out, [out.dng.buffer]];
    }
    default:
      throw new Error('unknown request');
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: PackerRequest }>) => {
  const { id, req } = ev.data;
  try {
    if (req.op === 'init') {
      await init(req.wasmBase);
      self.postMessage({ id, ok: true, result: null });
      return;
    }
    const [result, transfer] = run(req);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ id, ok: false, error: /out of bounds|Aborted|memory/i.test(message) ? `${message} (out of memory?)` : message });
  }
};
