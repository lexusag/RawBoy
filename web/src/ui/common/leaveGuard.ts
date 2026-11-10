/**
 * Asks the browser to confirm before the tab is closed, reloaded or navigated away while work would be lost.
 * The `beforeunload` listener is on the page only while [isActive] says so (call [refresh] after anything that
 * changes it), so an idle page leaves without a prompt and stays eligible for the back/forward cache. Browsers show
 * their own generic text; the message can't be customised.
 */
export function createLeaveGuard(isActive: () => boolean, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {
  let on = false;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = ''; // legacy browsers need a value
  };
  return {
    refresh() {
      const want = isActive();
      if (want === on) return;
      on = want;
      if (want) target.addEventListener('beforeunload', handler as EventListener);
      else target.removeEventListener('beforeunload', handler as EventListener);
    },
  };
}
