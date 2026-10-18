import type { InitResult, Request } from '../../worker/protocol';

/** The one decoder worker (WASM engine) and a promise-based call into it. */
class RawWorker {
  private readonly worker = new Worker(new URL('../../worker/decoder.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<InitResult>;

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    const wasmBase = new URL('wasm/', document.baseURI).href;
    this.ready = this.send<InitResult>({ op: 'init', wasmBase });
  }

  private send<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, req }, transfer);
    });
  }

  async call<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
    await this.ready;
    return this.send<T>(req, transfer);
  }
}

let instance: RawWorker | null = null;
export const rawWorker = (): RawWorker => (instance ??= new RawWorker());
