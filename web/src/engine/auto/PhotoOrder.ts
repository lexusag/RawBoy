/** How Auto's grid and RawBoy Browser order photos: by when they were shot, or by file name. Remembered. */
export type PhotoSort = 'date' | 'name';

/** EXIF's date format, "YYYY:MM:DD HH:MM:SS", which sorts as text. */
const EXIF_DATE = /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/;

/** [text] as an EXIF date if it is one (cameras without a set clock write blanks or zeros), else null (port of PhotoOrder.kt). */
export function validDate(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t && EXIF_DATE.test(t) && !t.startsWith('0000') ? t.slice(0, 19) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A file's modified time [millis] as an EXIF date in local time: the date of photos with no capture date. */
export function fileDate(millis: number): string | null {
  if (!(millis > 0)) return null;
  const d = new Date(millis);
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** File names as people read them: case-insensitive, runs of digits by value ("IMG_9" before "IMG_10"). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

/**
 * [items] ordered by [sort]: 'date' by their date (oldest first; those without one after the rest, by name), then name
 * ([nameOf]); 'name' by name, then date. A new array.
 */
export function sortPhotos<T extends { date: string | null }>(
  items: readonly T[],
  sort: PhotoSort,
  nameOf: (item: T) => string = (item) => (item as unknown as { name: string }).name,
): T[] {
  return [...items].sort((a, b) => (sort === 'date'
    ? compareDates(a.date, b.date) || compareNames(nameOf(a), nameOf(b))
    : compareNames(nameOf(a), nameOf(b)) || compareDates(a.date, b.date)));
}

/** The sort remembered under [key] in this browser ('date' unless 'name' was chosen). */
export function savedSort(key: string): PhotoSort {
  try {
    return localStorage.getItem(key) === 'name' ? 'name' : 'date';
  } catch {
    return 'date';
  }
}

export function saveSort(key: string, sort: PhotoSort) {
  try {
    localStorage.setItem(key, sort);
  } catch {
    // not remembered (private window, blocked storage)
  }
}
