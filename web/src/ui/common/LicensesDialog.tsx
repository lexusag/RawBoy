import { useEffect, useState } from 'react';

/** The patent notice the DNG specification's licence requires in the product's documentation. */
export const DNG_NOTICE = 'This product includes DNG technology under license by Adobe.';

/** Every third-party licence (<repo>/licenses/THIRD_PARTY_NOTICES.txt, copied into public/ by vite.config.ts). */
export function LicensesDialog({ onDismiss }: { onDismiss: () => void }) {
  const [text, setText] = useState('Loading…');
  useEffect(() => {
    fetch('third_party_notices.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setText, (e: unknown) => setText(`Could not load the licences: ${e instanceof Error ? e.message : String(e)}`));
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDismiss]);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog licenses" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Open-source licences">
        <h2>Open-source licences</h2>
        <p className="muted">RawBoy Web {__RAWBOY_VERSION__}. {DNG_NOTICE}</p>
        <pre>{text}</pre>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onDismiss}>Close</button>
        </div>
      </div>
    </div>
  );
}
