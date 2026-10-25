import { useState } from 'react';
import { driveConfigured } from '../../drive/Drive';

/** Where exports go: this device (download, a picked folder, or Photos on iOS) or a Google Drive folder. */
export type ExportDestination = 'device' | 'drive';

const KEY = 'rawboy.exportDestination';

/** The last choice, kept for the next export; always 'device' when Drive isn't set up for the site. */
export function savedDestination(): ExportDestination {
  if (!driveConfigured()) return 'device';
  try {
    return localStorage.getItem(KEY) === 'drive' ? 'drive' : 'device';
  } catch {
    return 'device';
  }
}

function saveDestination(d: ExportDestination) {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    // not remembered
  }
}

/** The export dialogs' Save to row and its value; no row without Drive. [field]: RawBoy's dialog layout, else Auto's. */
export function useExportDestination(field: boolean): [ExportDestination, JSX.Element | null] {
  const [d, setD] = useState(savedDestination);
  if (!driveConfigured()) return [d, null];
  const choose = (v: ExportDestination) => {
    setD(v);
    saveDestination(v);
  };
  const row = (
    <div className={field ? 'field' : 'import-mode-row export-options'}>
      <span className={field ? undefined : 'import-mode-label'}>Save to</span>
      <div className="segmented">
        {([['device', 'This device'], ['drive', 'Google Drive']] as const).map(([v, text]) => (
          <button key={v} type="button" className={d === v ? 'active' : ''} aria-pressed={d === v} onClick={() => choose(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return [d, row];
}
