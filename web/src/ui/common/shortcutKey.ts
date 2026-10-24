/** Latin characters of the keys a shortcut can use, by physical key (`KeyboardEvent.code`). */
const LATIN: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/' };
for (let i = 0; i < 26; i++) LATIN[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) LATIN[`Digit${i}`] = String(i);

/**
 * The key a shortcut matches on, lower case. On a non-Latin layout (Ukrainian, Russian, Greek…) `key` is the
 * layout's own letter (Ctrl+Z gives "я"), so the physical key stands in, as in Lightroom and Photoshop. Latin layouts
 * keep `key`, so the shortcut follows the label on the key (Z on AZERTY is where QWERTY has W).
 */
export function shortcutKey(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key.length === 1 && key.charCodeAt(0) > 0x7f) return LATIN[e.code] ?? key;
  return key;
}
