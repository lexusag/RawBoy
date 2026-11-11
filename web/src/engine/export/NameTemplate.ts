/**
 * Auto's export file name template (web only): text with {keywords} and # counters, e.g. "{name}_{look}_##" →
 * "IMG_1234_Portra 400_01". The extension is added after it. Keywords are case-insensitive:
 *
 *   {name} original name without extension   {camera}  camera make and model   {lens}  lens name
 *   {iso}  ISO speed                          {look}    look, preset or "RawBoy edits"
 *   {date} 2026-11-11   {time} 14-30-05   {year} {yy} {month} {day} {hour} {minute} {second}  (shoot date, else the file's)
 *   #, ##, ###...  the photo's number in this export: # = 1, ## = 01, ### = 001 (a run of #s sets the width)
 *
 * Anything else is kept as typed. A keyword the photo has no value for (no lens name...) is left out. Characters file
 * systems refuse (/ \ : * ? " < > | and control characters) become "_".
 */

/** The template used until the user changes it: the original name plus "-auto", as before templates existed. */
export const DEFAULT_NAME_TEMPLATE = '{name}-auto';

/** What a template can use about one photo. */
export interface NameContext {
  /** The original file name, with or without extension. */
  fileName: string;
  camera?: string;
  lens?: string;
  iso?: number;
  look?: string;
  /** "YYYY:MM:DD HH:MM:SS" (EXIF), or null if unknown. */
  date?: string | null;
  /** 1-based position of the photo in this export, for #. */
  index: number;
}

/** The keywords, for the help text and the UI's list. */
export const NAME_KEYWORDS: readonly { token: string; text: string }[] = [
  { token: '{name}', text: 'original name' },
  { token: '{camera}', text: 'camera' },
  { token: '{lens}', text: 'lens' },
  { token: '{iso}', text: 'ISO' },
  { token: '{look}', text: 'look or preset' },
  { token: '{date}', text: '2026-11-11' },
  { token: '{time}', text: '14-30-05' },
  { token: '{year}', text: 'year' },
  { token: '{month}', text: 'month' },
  { token: '{day}', text: 'day' },
  { token: '{hour}', text: 'hour' },
  { token: '{minute}', text: 'minute' },
  { token: '{second}', text: 'second' },
  { token: '#', text: 'number: ## = 01' },
];

const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_STEM = 150;

/** Strips the extension from a file name. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

/** Replaces characters file systems refuse, trims the ends (Windows drops trailing dots and spaces) and caps the length. */
export function sanitizeName(text: string): string {
  let s = text.replace(ILLEGAL, '_').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  if (s.length > MAX_STEM) s = s.substring(0, MAX_STEM).replace(/[\s.]+$/, '');
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** The date parts of an EXIF date, or null if it isn't one. */
function dateParts(date: string | null | undefined): Record<string, string> | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(date ?? '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { year: y, yy: y.substring(2), month: mo, day: d, hour: h, minute: mi, second: s, date: `${y}-${mo}-${d}`, time: `${h}-${mi}-${s}` };
}

/** The file name (without extension) a template gives [ctx]; never empty. */
export function applyNameTemplate(template: string, ctx: NameContext): string {
  const dates = dateParts(ctx.date);
  const values: Record<string, string> = {
    name: stemOf(ctx.fileName),
    camera: ctx.camera ?? '',
    lens: ctx.lens ?? '',
    iso: ctx.iso && ctx.iso > 0 ? String(Math.round(ctx.iso)) : '',
    look: ctx.look ?? '',
    ...(dates ?? {}),
  };
  const text = (template.trim() || DEFAULT_NAME_TEMPLATE)
    .replace(/\{([a-z]+)\}|#+/gi, (m, key: string | undefined) => {
      if (key === undefined) return String(Math.max(0, Math.floor(ctx.index))).padStart(m.length, '0');
      const k = key.toLowerCase();
      // Unknown words stay as typed, so a typo shows in the preview.
      return k in values || DATE_KEYS.has(k) ? values[k] ?? '' : m;
    });
  return sanitizeName(text) || 'image';
}

const DATE_KEYS = new Set(['year', 'yy', 'month', 'day', 'hour', 'minute', 'second', 'date', 'time']);

/** "<stem>.<ext>", then "<stem>-001.<ext>", "-002"... for [counter] > 0 (two photos that got the same name). */
export function templateFileName(stem: string, extension: string, counter: number): string {
  return counter === 0 ? `${stem}.${extension}` : `${stem}-${String(counter).padStart(3, '0')}.${extension}`;
}
