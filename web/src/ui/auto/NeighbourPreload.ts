/** How many photos after / before the open one are warmed up. */
export const PRELOAD_AHEAD = 3;
export const PRELOAD_BEHIND = 2;

/**
 * The ids to preload around [current] in [ids] (the detail view's order): the next [PRELOAD_AHEAD] and the previous
 * [PRELOAD_BEHIND], nearest first, forward before backward at the same distance (people mostly step forward).
 * Empty if [current] isn't in the list.
 */
export function preloadWindow(ids: readonly string[], current: string | null): string[] {
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0) return [];
  const out: string[] = [];
  for (let d = 1; d <= Math.max(PRELOAD_AHEAD, PRELOAD_BEHIND); d++) {
    if (d <= PRELOAD_AHEAD && at + d < ids.length) out.push(ids[at + d]);
    if (d <= PRELOAD_BEHIND && at - d >= 0) out.push(ids[at - d]);
  }
  return out;
}

/**
 * Warms the photos around the open one in the background, one at a time, and holds at most the window's worth
 * (everything outside it is dropped). Work is cancelled by [start] being called again (the user moved on) and only
 * begins once [idle] says the open photo is done, so the current photo always goes first.
 */
export class NeighbourPreloader<T> {
  private readonly held = new Map<string, T>();
  private run = 0;

  /** [load] fetches one photo's data; [idle] resolves when the current photo needs nothing more. */
  constructor(
    private readonly load: (id: string) => Promise<T | null>,
    private readonly idle: () => Promise<void>,
  ) {}

  /** What is already warm for [id], if anything. */
  get(id: string): T | undefined {
    return this.held.get(id);
  }

  get size(): number {
    return this.held.size;
  }

  /** Restarts around [current]: evicts what left the window, then loads the rest, nearest first. */
  start(ids: readonly string[], current: string | null) {
    const mine = ++this.run;
    const window = preloadWindow(ids, current);
    const keep = new Set(window);
    for (const id of [...this.held.keys()]) if (!keep.has(id)) this.held.delete(id);
    const todo = window.filter((id) => !this.held.has(id));
    if (!todo.length) return;
    void (async () => {
      for (const id of todo) {
        await this.idle();
        if (this.run !== mine) return; // the user navigated: the new run takes over
        try {
          const data = await this.load(id);
          if (this.run !== mine) return;
          if (data) this.held.set(id, data);
        } catch {
          // A photo that can't be warmed is simply opened the normal way.
        }
      }
    })();
  }

  /** Drops one photo (removed from the batch). */
  forget(id: string) {
    this.held.delete(id);
  }

  clear() {
    this.run++;
    this.held.clear();
  }
}
