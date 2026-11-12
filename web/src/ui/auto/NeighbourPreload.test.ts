import { describe, expect, it } from 'vitest';
import { NeighbourPreloader, preloadWindow } from './NeighbourPreload';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('preloadWindow', () => {
  it('takes three ahead and two behind, nearest first', () => {
    expect(preloadWindow(ids, 'd')).toEqual(['e', 'c', 'f', 'b', 'g']);
  });
  it('clips at the ends and ignores unknown ids', () => {
    expect(preloadWindow(ids, 'a')).toEqual(['b', 'c', 'd']);
    expect(preloadWindow(ids, 'h')).toEqual(['g', 'f']);
    expect(preloadWindow(ids, 'zz')).toEqual([]);
    expect(preloadWindow(ids, null)).toEqual([]);
  });
});

describe('NeighbourPreloader', () => {
  it('loads the window and evicts photos that leave it', async () => {
    const p = new NeighbourPreloader<string>(async (id) => id.toUpperCase(), async () => {});
    p.start(ids, 'd');
    await tick();
    await tick();
    expect(p.size).toBe(5);
    p.start(ids, 'g');
    expect(p.get('b')).toBeUndefined();
    expect(p.get('f')).toBe('F');
    await tick();
    await tick();
    expect(p.size).toBeLessThanOrEqual(5);
  });
  it('stops a run when the user navigates, and waits for idle', async () => {
    const loaded: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = new NeighbourPreloader<string>(async (id) => (loaded.push(id), id), () => gate);
    p.start(ids, 'a');
    await tick();
    expect(loaded).toEqual([]); // current photo still busy
    p.start(ids, 'e');
    release();
    await tick();
    await tick();
    await tick();
    expect(loaded.every((id) => ['f', 'g', 'h', 'd', 'c'].includes(id))).toBe(true);
  });
});
