import type { InitResult, Request } from '../../worker/protocol';

/** A decoder worker (WASM engine) and a promise-based call into it. */
export class RawWorker {
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
/** The page's decoder worker: open photos, export, previews. */
export const rawWorker = (): RawWorker => (instance ??= new RawWorker());

/**
 * How many photos RawBoy Auto analyses at once, each on its own decoder worker ([analysisWorker]): about one per three
 * cores on a computer, up to 3. A draft decode of a 50 MP raw holds about 0.5 GB in its worker's heap for good (WASM
 * memory doesn't shrink), so phones and devices reporting under 8 GB keep the one page worker.
 */
export function analysisLanes(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (phone || (memory !== undefined && memory < 8) || typeof Worker === 'undefined') return 1;
  return Math.max(1, Math.min(3, Math.floor(cores / 3)));
}

const analysisPool: RawWorker[] = [];
/**
 * Lane [lane]'s decoder worker ([analysisLanes]): undefined (the page worker) when there's one lane, else workers of
 * their own, so analyses run beside each other and beside the open photo's decode.
 */
export function analysisWorker(lane: number, lanes: number): RawWorker | undefined {
  if (lanes <= 1) return undefined;
  return (analysisPool[lane] ??= new RawWorker());
}
