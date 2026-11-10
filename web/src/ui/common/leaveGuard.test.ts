import { describe, expect, it } from 'vitest';
import { createLeaveGuard } from './leaveGuard';

describe('createLeaveGuard', () => {
  it('listens only while work is in progress', () => {
    const target = new EventTarget() as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    let busy = false;
    const guard = createLeaveGuard(() => busy, target);
    const fire = () => {
      const e = new Event('beforeunload', { cancelable: true });
      (target as unknown as EventTarget).dispatchEvent(e);
      return e.defaultPrevented;
    };
    guard.refresh();
    expect(fire()).toBe(false);
    busy = true;
    guard.refresh();
    guard.refresh();
    expect(fire()).toBe(true);
    busy = false;
    guard.refresh();
    expect(fire()).toBe(false);
  });
});
