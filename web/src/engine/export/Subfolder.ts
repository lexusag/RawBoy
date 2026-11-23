/** Longest subfolder name kept. */
export const MAX_SUBFOLDER = 100;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The subfolder an export is written into, from what was typed: "" = none (the export folder itself). `{date}` is
 * today's date as YYYY-MM-DD; path separators and characters a file system refuses become "-" (one level only, no
 * nested paths and no ".."); blanks and dots around the name are dropped. Same rule in Swift (`ExportSubfolder`).
 */
export function cleanSubfolder(text: string, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const name = text
    .replace(/\{date\}/gi, date)
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .trim()
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return Array.from(name).slice(0, MAX_SUBFOLDER).join('').replace(/[\s.]+$/g, '');
}
