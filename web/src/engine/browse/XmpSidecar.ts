/**
 * Ratings in XMP sidecars, as Lightroom, Capture One and darktable read them: xmp:Rating 0-5 stars, -1 = rejected.
 * Picks have no standard XMP field, so RawBoy keeps them in its own namespace (rawboy:Pick="1").
 *
 * RawBoy's own edits (opt-in) go in rawboy:Develop and rawboy:Auto as escaped JSON, next to darktable's or Lightroom's.
 *
 * Existing sidecars usually hold another app's edits: only RawBoy's fields are changed, in place, and everything
 * else is kept byte for byte.
 */

export type Flag = 'pick' | 'reject' | null;

export interface Rating {
  /** 0-5. */
  stars: number;
  flag: Flag;
}

export const NO_RATING: Rating = Object.freeze({ stars: 0, flag: null });

export const isRated = (r: Rating) => r.stars > 0 || r.flag != null;

const XMP_NS = 'http://ns.adobe.com/xap/1.0/';
const RAWBOY_NS = 'http://ns.rawboy.app/1.0/';

/** The rating in a sidecar's text. */
export function readXmp(text: string): Rating {
  const rating = Number(fieldValue(text, 'xmp:Rating') ?? 0);
  const pick = fieldValue(text, 'rawboy:Pick') === '1';
  if (rating < 0) return { stars: 0, flag: 'reject' };
  return { stars: Math.max(0, Math.min(5, Math.round(rating) || 0)), flag: pick ? 'pick' : null };
}

/** [text] (null: a new sidecar) with [rating] written into it. */
export function writeXmp(text: string | null, rating: Rating): string {
  let out = text ?? EMPTY;
  out = setField(out, 'xmp:Rating', 'xmp', XMP_NS, String(rating.flag === 'reject' ? -1 : rating.stars));
  out = setField(out, 'rawboy:Pick', 'rawboy', RAWBOY_NS, rating.flag === 'pick' ? '1' : null);
  return out;
}

/**
 * RawBoy's own fields: Develop = RawBoy (Pro) edits (develop/Edits.ts JSON), Auto = a photo's RawBoy Auto settings
 * (look, strength, adjustments, preset, RawBoy edits; ui/auto/AutoSidecar.ts JSON).
 */
export type RawBoyField = 'Develop' | 'Auto';

/** RawBoy's [field] (JSON) in a sidecar's text, or null. */
export function readEdits(text: string, field: RawBoyField = 'Develop'): string | null {
  const v = fieldValue(text, `rawboy:${field}`);
  return v ? unescapeXml(v) : null;
}

/** [text] (null: a new sidecar) with RawBoy's [field] set to [edits]; null removes it. */
export const writeEdits = (text: string | null, edits: string | null, field: RawBoyField = 'Develop'): string =>
  setField(text ?? EMPTY, `rawboy:${field}`, 'rawboy', RAWBOY_NS, edits == null ? null : escapeXml(edits));

/**
 * One photo's sidecar as RawBoy and RawBoy Auto keep their edits there; RawBoy Browser hands it over with a photo of
 * a folder it can write to. Writes go through the Browser's queue, so they don't race its rating writes.
 */
export interface EditsSidecar {
  /** The sidecar's file name. */
  readonly name: string;
  read(field?: RawBoyField): Promise<string | null>;
  write(edits: string | null, field?: RawBoyField): Promise<void>;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]!;
  });

const EMPTY = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RawBoy">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An attribute (name="v") or simple element (<name>v</name>) form of [name]. */
const attributeRe = (name: string) => new RegExp(`(\\s${escapeRe(name)}\\s*=\\s*)(["'])((?:(?!\\2)[^<])*)\\2`);
const elementRe = (name: string) => new RegExp(`(<${escapeRe(name)}>)([^<]*)(</${escapeRe(name)}>)`);

function fieldValue(text: string, name: string): string | undefined {
  return (attributeRe(name).exec(text)?.[3] ?? elementRe(name).exec(text)?.[2])?.trim();
}

/**
 * Sets [name] to [value] where it already is (attribute or element), else adds it as an attribute of the first
 * rdf:Description, declaring [prefix] there if that element doesn't. A null value removes the field.
 */
function setField(text: string, name: string, prefix: string, ns: string, value: string | null): string {
  const attr = attributeRe(name);
  if (attr.test(text)) return value == null ? text.replace(attr, '') : text.replace(attr, (_, lead, q) => `${lead}${q}${value}${q}`);
  const element = elementRe(name);
  if (element.test(text)) {
    if (value != null) return text.replace(element, (_, open, _v, close) => `${open}${value}${close}`);
    return text.replace(new RegExp(`\\s*<${escapeRe(name)}>[^<]*</${escapeRe(name)}>`), '');
  }
  if (value == null) return text;
  const description = /<rdf:Description\b[^>]*?(?=\/?>)/.exec(text);
  if (!description) throw new Error('Not an XMP sidecar (no rdf:Description)');
  const declared = new RegExp(`\\sxmlns:${escapeRe(prefix)}\\s*=`).test(description[0]);
  const added = `${declared ? '' : `\n   xmlns:${prefix}="${ns}"`}\n   ${name}="${value}"`;
  const at = description.index + description[0].length;
  return text.slice(0, at) + added + text.slice(at);
}
