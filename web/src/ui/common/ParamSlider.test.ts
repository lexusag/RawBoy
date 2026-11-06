import { describe, expect, it } from 'vitest';
import { INITIAL_WHEEL_STATE, endSliderDrag, moveSliderDrag, startSliderDrag, stepWheel } from './ParamSlider';

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

describe('stepWheel discrete list stepping', () => {
  const wheel = (deltaY: number, timeStamp: number, deltaMode = 0, deltaX = 0, shiftKey = false) => ({
    deltaX,
    deltaY,
    deltaMode,
    shiftKey,
    timeStamp,
  });

  it('steps immediately on every macOS small-pixel mouse click (e.g. 4..35 px per click)', () => {
    let state = INITIAL_WHEEL_STATE;
    const c1 = stepWheel(state, wheel(4, 100));
    expect(c1.steps).toBe(1);
    state = c1.state;

    const c2 = stepWheel(state, wheel(12, 220));
    expect(c2.steps).toBe(1);
    state = c2.state;

    const c3 = stepWheel(state, wheel(-8, 350));
    expect(c3.steps).toBe(-1);
  });

  it('steps once per standard 100/120 px mouse notch without overshooting', () => {
    let state = INITIAL_WHEEL_STATE;
    const c1 = stepWheel(state, wheel(100, 100));
    expect(c1.steps).toBe(1);
    state = c1.state;

    const c2 = stepWheel(state, wheel(120, 140));
    expect(c2.steps).toBe(1);
    state = c2.state;

    const up = stepWheel(state, wheel(-100, 180));
    expect(up.steps).toBe(-1);
  });

  it('steps once on both 1-line (macOS Firefox) and 3-line (Windows/Linux Firefox) ticks', () => {
    const mac = stepWheel(INITIAL_WHEEL_STATE, wheel(1, 100, 1));
    expect(mac.steps).toBe(1);

    const win = stepWheel(mac.state, wheel(3, 130, 1));
    expect(win.steps).toBe(1);

    const up = stepWheel(win.state, wheel(-1, 160, 1));
    expect(up.steps).toBe(-1);
  });

  it('steps immediately on start of a trackpad gesture and every 30 px thereafter', () => {
    let state = INITIAL_WHEEL_STATE;
    // Gesture starts: immediate first step
    const f1 = stepWheel(state, wheel(6, 100));
    expect(f1.steps).toBe(1);
    state = f1.state;

    // 16 ms later: +18 px (under 30 px) -> still on that step
    const f2 = stepWheel(state, wheel(18, 116));
    expect(f2.steps).toBe(0);
    state = f2.state;

    // 16 ms later: +15 px (total 33 px >= 30 px) -> advances a second step
    const f3 = stepWheel(state, wheel(15, 132));
    expect(f3.steps).toBe(1);
    expect(f3.state.acc).toBe(3);
  });

  it('steps immediately when reversing direction mid-stream and ignores 0 deltas', () => {
    const down = stepWheel(INITIAL_WHEEL_STATE, wheel(10, 100));
    expect(down.steps).toBe(1);

    const noop = stepWheel(down.state, wheel(0, 110, 0, 5, false));
    expect(noop.steps).toBe(0);

    const reverse = stepWheel(noop.state, wheel(-6, 120));
    expect(reverse.steps).toBe(-1);
  });
});

