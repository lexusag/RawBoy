import { describe, expect, it } from 'vitest';
import { shortcutKey } from './shortcutKey';

const ev = (key: string, code: string) => ({ key, code }) as KeyboardEvent;

describe('shortcutKey', () => {
  it('maps non-Latin layouts to the physical key', () => {
    expect(shortcutKey(ev('я', 'KeyZ'))).toBe('z');
    expect(shortcutKey(ev('Я', 'KeyZ'))).toBe('z');
    expect(shortcutKey(ev('х', 'BracketLeft'))).toBe('[');
    expect(shortcutKey(ev('ї', 'BracketRight'))).toBe(']');
    expect(shortcutKey(ev('ґ', 'Backslash'))).toBe('\\');
    expect(shortcutKey(ev('з', 'KeyP'))).toBe('p');
  });
  it('keeps Latin layouts and named keys as they are', () => {
    expect(shortcutKey(ev('Z', 'KeyZ'))).toBe('z');
    expect(shortcutKey(ev('z', 'KeyW'))).toBe('z'); // AZERTY
    expect(shortcutKey(ev('3', 'Digit3'))).toBe('3');
    expect(shortcutKey(ev(' ', 'Space'))).toBe(' ');
    expect(shortcutKey(ev('Escape', 'Escape'))).toBe('Escape');
    expect(shortcutKey(ev('é', 'Digit2'))).toBe('2');
  });
});
