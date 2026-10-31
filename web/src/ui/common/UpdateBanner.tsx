import { useEffect, useState } from 'react';

/** How often a running app looks for a newer deploy, besides each time it comes back to the foreground. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * "New version available". An installed web app is resumed, not reloaded, so it can run an old build for days. The
 * build writes version.json (vite.config.ts); when it names another build than the one running, this offers a
 * reload. It never reloads by itself: photos open in the app would be closed.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stopped = false;
    const check = () => {
      fetch('version.json', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ build?: string }>) : null))
        .then((v) => {
          if (!stopped && v?.build && v.build !== __RAWBOY_BUILD__) setStale(true);
        })
        .catch(() => undefined); // offline, or a host without the file: try again later
    };
    const onVisible = () => !document.hidden && check();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    check();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);
  if (!stale || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span>New version available. Reloading closes the open photos.</span>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reload</button>
      <button type="button" className="text" onClick={() => setDismissed(true)}>Later</button>
    </div>
  );
}
