/**
 * Which slider was last pressed with a mouse, pen or finger. A range input keeps focus after a drag, so the arrow
 * keys would keep moving it; for a slider focused that way they go back to the page (e.g. Auto's next photo). A
 * slider reached with Tab keeps its arrow keys, the only way to move it from the keyboard.
 */
let pressed: EventTarget | null = null;

const isRange = (t: EventTarget | null): t is HTMLInputElement => t instanceof HTMLInputElement && t.type === 'range';

window.addEventListener('pointerdown', (e) => { pressed = isRange(e.target) ? e.target : null; }, true);
// Focus moved by the keyboard (Tab) or by code: that slider wasn't pressed.
window.addEventListener('focusin', (e) => { if (e.target !== pressed) pressed = null; }, true);

/** True when `target` is a slider that has focus from a press, not from Tab. */
export function isPressedSlider(target: EventTarget | null): boolean {
  return isRange(target) && target === pressed;
}
