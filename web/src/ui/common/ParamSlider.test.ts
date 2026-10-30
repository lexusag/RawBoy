import { describe, expect, it } from 'vitest';
import { endSliderDrag, moveSliderDrag, startSliderDrag } from './ParamSlider';

describe('ParamSlider pointer gestures', () => {
  it('drags horizontally with a stylus (pen), including fine moves under touch slop', () => {
    let drag = startSliderDrag(null, { pointerId: 2, pointerType: 'pen', button: 0, clientX: 100, clientY: 50 }, 0, 200);
    expect(drag).not.toBeNull();

    // 4 px horizontal move: under touch slop (8 px), at/over pen slop (3 px).
    const small = moveSliderDrag(drag, { pointerId: 2, clientX: 104, clientY: 50 }, -100, 100, 1);
    drag = small.drag;
    expect(drag?.locked).toBe(true);
    expect(small.value).toBe(4);

    const wider = moveSliderDrag(drag, { pointerId: 2, clientX: 150, clientY: 62 }, -100, 100, 1);
    expect(wider.value).toBe(50);

    const end = endSliderDrag(wider.drag, 2, 100, -Infinity);
    expect(end.drag).toBeNull();
    expect(end.reset).toBe(false);
  });

  it('drops a vertical stylus or touch swipe so the panel can scroll', () => {
    const drag = startSliderDrag(null, { pointerId: 3, pointerType: 'pen', button: 0, clientX: 100, clientY: 50 }, 10, 200);
    const vertical = moveSliderDrag(drag, { pointerId: 3, clientX: 101, clientY: 56 }, -100, 100, 1);
    expect(vertical.drag).toBeNull();
    expect(vertical.release).toBe(true);
    expect(vertical.value).toBeUndefined();

    // Ending a scrolled gesture must not count as a tap toward double-tap reset.
    const end = endSliderDrag(vertical.drag, 3, 100, 50);
    expect(end.reset).toBe(false);
    expect(end.lastTap).toBe(50);
  });

  it('resets on a stylus double-tap and not on the first tap', () => {
    let lastTap = -Infinity;
    const tap1 = startSliderDrag(null, { pointerId: 5, pointerType: 'pen', button: 0, clientX: 80, clientY: 20 }, 25, 200);
    const end1 = endSliderDrag(tap1, 5, 100, lastTap);
    expect(end1.reset).toBe(false);
    lastTap = end1.lastTap;

    const tap2 = startSliderDrag(null, { pointerId: 6, pointerType: 'pen', button: 0, clientX: 81, clientY: 20 }, 25, 200);
    const end2 = endSliderDrag(tap2, 6, 280, lastTap);
    expect(end2.reset).toBe(true);
    expect(end2.lastTap).toBe(-Infinity);
  });

  it('leaves mouse presses to the range input and ignores stylus barrel buttons and disabled sliders', () => {
    expect(startSliderDrag(null, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 20 }, 0, 200)).toBeNull();
    expect(startSliderDrag(null, { pointerId: 1, pointerType: 'pen', button: 2, clientX: 50, clientY: 20 }, 0, 200)).toBeNull();
    expect(startSliderDrag(null, { pointerId: 1, pointerType: 'pen', button: 0, clientX: 50, clientY: 20 }, 0, 200, true)).toBeNull();
  });

  it('allows a stylus press to replace an unlocked palm touch without losing a locked drag', () => {
    const palm = startSliderDrag(null, { pointerId: 10, pointerType: 'touch', button: 0, clientX: 180, clientY: 40 }, 0, 200);
    const pen = startSliderDrag(palm, { pointerId: 11, pointerType: 'pen', button: 0, clientX: 60, clientY: 20 }, 0, 200);
    expect(pen?.id).toBe(11);

    const locked = moveSliderDrag(pen, { pointerId: 11, clientX: 80, clientY: 20 }, -100, 100, 1).drag;
    const strayTouch = startSliderDrag(locked, { pointerId: 12, pointerType: 'touch', button: 0, clientX: 190, clientY: 40 }, 0, 200);
    expect(strayTouch?.id).toBe(11);
  });
});
