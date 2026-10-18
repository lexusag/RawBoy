/** Changes closer together than this belong to one step (a slider drag, a crop drag). */
const COALESCE_MS = 600;
const LIMIT = 100;

/**
 * Undo and redo for a photo's edits (port of EditHistory.kt). [record] is called with the state before each change;
 * a run of quick changes (one slider drag) is one step, a discrete action ([force]) always starts a new one.
 */
export class EditHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastAt = -Infinity;

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  record(before: T, force: boolean, now = performance.now()) {
    if (force || now - this.lastAt > COALESCE_MS) {
      this.past.push(before);
      if (this.past.length > LIMIT) this.past.shift();
    }
    this.future = [];
    // A slider moved right after a button is a step of its own.
    this.lastAt = force ? -Infinity : now;
  }

  /** The state to go back to from [current], or null when there is none. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    this.lastAt = -Infinity;
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastAt = -Infinity;
    return next;
  }

  /** Forgets the last step without redo (a cancelled brush stroke). */
  drop(): T | null {
    this.lastAt = -Infinity;
    return this.past.pop() ?? null;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastAt = -Infinity;
  }
}
