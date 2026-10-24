import { useState, useSyncExternalStore } from 'react';
import { downloadExports, pendingPhotos } from './files';

/**
 * iOS: exported photos wait here for the tap that opens the share sheet (Safari opens it only from a tap, and an
 * export outlasts the one that started it). Its Save Image puts them in Photos; Download instead keeps the old
 * behaviour (Files).
 */
export function SaveToPhotosSheet() {
  const files = useSyncExternalStore(pendingPhotos.subscribe, pendingPhotos.get);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  if (!files) return null;
  const n = files.length;
  const close = () => {
    setError(null);
    pendingPhotos.set(null);
  };
  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      await navigator.share({ files });
      close();
    } catch (e) {
      // Closing the share sheet without picking anything keeps the photos here for another try.
      if ((e as Error)?.name !== 'AbortError') setError(`Couldn't open the share sheet: ${(e as Error)?.message ?? e}`);
    } finally {
      setSharing(false);
    }
  };
  const download = async () => {
    await downloadExports(files.map((f) => ({ name: f.name, blob: f })), 'RawBoy.zip');
    close();
  };
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Save to Photos">
        <h2>{n === 1 ? 'Photo ready' : `${n} photos ready`}</h2>
        <small className="muted">
          Tap Save to Photos, then {n === 1 ? 'Save Image' : `Save ${n} Images`} in the share sheet.
        </small>
        {error && <small className="error">{error}</small>}
        <div className="dialog-actions">
          <button type="button" className="text" onClick={close} disabled={sharing}>Discard</button>
          <button type="button" className="text" onClick={download} disabled={sharing}>Download instead</button>
          <button type="button" className="primary" onClick={share} disabled={sharing}>Save to Photos</button>
        </div>
      </div>
    </div>
  );
}
