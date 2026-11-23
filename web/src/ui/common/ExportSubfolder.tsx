import { useState } from 'react';
import { cleanSubfolder } from '../../engine/export/Subfolder';
import { canPickOutputFolder, savesToPhotos } from './files';
import type { ExportDestination } from './ExportDestination';

/**
 * Whether an export can go into a subfolder: where the browser writes into a folder you pick (File System Access API)
 * or into a Google Drive folder. Plain downloads (and Save to Photos on iOS) have no folder to put one in.
 */
export const canUseSubfolder = (destination: ExportDestination) =>
  destination === 'drive' || (canPickOutputFolder() && !savesToPhotos());

/** The last subfolder typed, kept for the next export ("" = none). */
export function savedSubfolder(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function keepSubfolder(key: string, text: string) {
  try {
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // not remembered
  }
}

/** The export dialogs' Subfolder row (hidden where [available] is false) and the name typed, as typed. */
export function useExportSubfolder(key: string, available: boolean, field: boolean): [string, JSX.Element | null] {
  const [text, setText] = useState(() => savedSubfolder(key));
  if (!available) return [text, null];
  const change = (v: string) => {
    setText(v);
    keepSubfolder(key, v);
  };
  const clean = cleanSubfolder(text);
  const note = clean ? `Saved in a folder named “${clean}”, made if it isn’t there yet. {date} is today’s date.` : 'Empty: saved in the folder you pick. {date} is today’s date.';
  const input = (
    <input
      id={`export-subfolder-${key}`}
      type="text"
      value={text}
      spellCheck={false}
      autoComplete="off"
      maxLength={100}
      placeholder="None"
      onChange={(e) => change(e.target.value)}
    />
  );
  const row = field ? (
    <label className="field">
      <span>Subfolder</span>
      {input}
      <small>{note}</small>
    </label>
  ) : (
    <div className="export-name">
      <label className="import-mode-label" htmlFor={`export-subfolder-${key}`}>Subfolder</label>
      {input}
      <small className="muted">{note}</small>
    </div>
  );
  return [text, row];
}
