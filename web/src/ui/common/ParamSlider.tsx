import { useEffect, useRef, type CSSProperties } from 'react';

export const formatSigned = (v: number) => `${Math.round(v) > 0 ? '+' : ''}${Math.round(v)}`;
export const formatPlain = (v: number) => String(Math.round(v));
export const formatEv = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV`;
export const formatDegrees = (v: number) => {
  const rounded = Math.abs(v) < 0.05 ? 0 : v;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}°`;
};

/** Finger movement (px) before a gesture is judged a horizontal drag or a vertical scroll; finer for a stylus. */
const TOUCH_SLOP = 8;
const PEN_SLOP = 3;

/** A wheel turn within this long (ms) of the page scrolling keeps scrolling it, even over a slider. */
const SCROLL_GRACE = 400;
let lastPageScroll = -Infinity;
// Bubbles after the sliders' listeners: a wheel event no slider took scrolled the page (or a panel). Scroll events
// (captured: they don't bubble) keep it going while a smooth scroll is still moving the panel under the pointer.
if (typeof window !== 'undefined') {
  window.addEventListener('wheel', (e) => { if (!e.defaultPrevented) lastPageScroll = e.timeStamp; }, { passive: true });
  window.addEventListener('scroll', (e) => { lastPageScroll = e.timeStamp; }, { passive: true, capture: true });
}

/** Whether this wheel event continues a page (or panel) scroll, which other wheel gestures should leave alone. */
export const continuesPageScroll = (e: WheelEvent) => e.timeStamp - lastPageScroll < SCROLL_GRACE;

/**
 * Wheel notches in a wheel event, positive for up. A mouse wheel gives one per click (100 px in Chrome, ~50 in
 * Firefox, 3 lines in line mode); a trackpad gives fractions. Shift turns the wheel horizontal in most browsers.
 */
export function wheelNotches(e: WheelEvent): number {
  const d = e.deltaY !== 0 ? e.deltaY : e.shiftKey ? e.deltaX : 0;
  if (d === 0) return 0;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return -d / 3;
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return -d * 10;
  return Math.abs(d) >= 40 ? -Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 100)) : -d / 100;
}

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Reset target: double-click the slider or click the value. */
  defaultValue: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** CSS colours painted across the whole track instead of the accent fill (e.g. a colour gradient). */
  trackGradient?: string[];
  /** Makes the label a button (e.g. to show more controls under the slider). */
  onLabelClick?: () => void;
}

export interface SliderDrag {
  id: number;
  x: number;
  y: number;
  slop: number;
  value: number;
  width: number;
  locked: boolean;
}

/** Starts a non-mouse slider gesture (touch or pen), leaving mouse presses to the range input. */
export function startSliderDrag(
  current: SliderDrag | null,
  e: { pointerId: number; pointerType: string; button: number; clientX: number; clientY: number },
  value: number,
  width: number,
  disabled?: boolean,
): SliderDrag | null {
  if (e.pointerType === 'mouse' || e.button !== 0 || disabled || width <= 0 || current?.locked) return current;
  const slop = e.pointerType === 'pen' ? PEN_SLOP : TOUCH_SLOP;
  return { id: e.pointerId, x: e.clientX, y: e.clientY, slop, value, width, locked: false };
}

/** Updates an active gesture on pointermove: keeps waiting, drops for a vertical scroll, or emits a snapped value. */
export function moveSliderDrag(
  d: SliderDrag | null,
  e: { pointerId: number; clientX: number; clientY: number },
  min: number,
  max: number,
  step: number,
): { drag: SliderDrag | null; value?: number; release?: boolean } {
  if (!d || d.id !== e.pointerId) return { drag: d };
  const dx = e.clientX - d.x;
  if (!d.locked) {
    const dy = e.clientY - d.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < d.slop) return { drag: d };
    if (Math.abs(dy) >= Math.abs(dx)) return { drag: null, release: true }; // the browser is scrolling
    d = { ...d, locked: true };
  }
  const raw = d.value + (dx / d.width) * (max - min);
  const snapped = min + Math.round((raw - min) / step) * step;
  return { drag: d, value: Math.min(max, Math.max(min, snapped)) };
}

/** Finishes a gesture on pointerup; two taps within 300 ms reset to [defaultValue] (dblclick isn't reliable for touch or pen). */
export function endSliderDrag(
  d: SliderDrag | null,
  pointerId: number,
  now: number,
  lastTap: number,
): { drag: SliderDrag | null; lastTap: number; reset: boolean } {
  if (!d || d.id !== pointerId) return { drag: d, lastTap, reset: false };
  if (d.locked) return { drag: null, lastTap, reset: false };
  if (now - lastTap < 300) return { drag: null, lastTap: -Infinity, reset: true };
  return { drag: null, lastTap: now, reset: false };
}

/**
 * Port of the apps' ParamSlider: label, value (click to reset) and a range input (double-click to reset).
 * Touch and stylus are handled here rather than by the range input, so a vertical swipe that starts on the slider
 * scrolls the panel: only a mostly-horizontal drag moves the value, relative to where it started.
 * As in darktable, the mouse wheel over a slider moves it (no click needed): 1/200 of the range per notch, Shift
 * 10× coarser, Ctrl/⌘ 10× finer. A wheel that was just scrolling the panel keeps scrolling it.
 */
export function ParamSlider({ label, value, min, max, defaultValue, step, format = formatSigned, onChange, disabled, trackGradient, onLabelClick }: Props) {
  const changed = value !== defaultValue;
  const s = step ?? (max - min) / 1000;
  // The fill runs from 0 on signed ranges (−100…100 and the like), so a slider at 0 shows no fill; from the left
  // end otherwise.
  const signed = min < 0 && max > 0;
  const percent = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  const anchor = signed ? percent(0) : 0;
  const at = percent(value);
  const fill = {
    '--from': `${Math.min(anchor, at)}%`,
    '--to': `${Math.max(anchor, at)}%`,
    '--zero': `${anchor}%`,
  } as CSSProperties;
  const lastTap = useRef(-Infinity);
  const drag = useRef<SliderDrag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ value, min, max, s, disabled, onChange });
  live.current = { value, min, max, s, disabled, onChange };
  useEffect(() => {
    const el = root.current!;
    // The unsnapped value the wheel is at, so trackpad fractions add up. [seen] and [sent] tell a value set
    // elsewhere (a drag, a reset, undo) from the wheel's own, which may not have rendered yet.
    let raw = NaN;
    let seen = NaN;
    let sent = NaN;
    // Not React's onWheel: that listener is passive, so it couldn't stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      const { value, min, max, s, disabled, onChange } = live.current;
      if (disabled || continuesPageScroll(e)) return;
      const notches = wheelNotches(e);
      if (notches === 0) return;
      e.preventDefault(); // also keeps Ctrl+wheel from zooming the page
      const range = max - min;
      const perNotch = e.ctrlKey || e.metaKey ? Math.max(s, range / 2000) : e.shiftKey ? range / 20 : Math.max(s, range / 200);
      if (value !== seen && value !== sent) raw = value;
      seen = value;
      raw = Math.min(max, Math.max(min, raw + notches * perNotch));
      sent = Math.min(max, Math.max(min, min + Math.round((raw - min) / s) * s));
      if (sent !== value) onChange(sent);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return (
    <div className="slider" ref={root}>
      <div className="slider-row">
        {onLabelClick ? (
          <button type="button" className="slider-label" onClick={onLabelClick}>
            {label}
          </button>
        ) : (
          <span>{label}</span>
        )}
        <button type="button" className={`slider-value${changed ? ' changed' : ''}`} title="Reset" onClick={() => onChange(defaultValue)} disabled={disabled}>
          {format(value)}
        </button>
      </div>
      <div
        className={`slider-track${trackGradient ? ' gradient' : signed ? ' filled signed' : ' filled'}`}
        style={trackGradient ? ({ '--track': `linear-gradient(to right, ${trackGradient.join(', ')})` } as CSSProperties) : fill}
        onPointerEnter={(e) => {
          // Match the active pointer regardless of @media (pointer: coarse): stylus on desktop/DeX bypasses the range
          // input, and a Bluetooth mouse on a tablet still reaches it.
          if (input.current) input.current.style.pointerEvents = e.pointerType === 'mouse' ? 'auto' : 'none';
        }}
        onPointerLeave={() => {
          if (input.current) input.current.style.pointerEvents = '';
        }}
        onPointerDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          const next = startSliderDrag(drag.current, e, value, e.currentTarget.getBoundingClientRect().width, disabled);
          if (next !== drag.current) {
            drag.current = next;
            // Unlike touch, pen has no implicit pointer capture: keep events on the track until vertical scroll takes over.
            if (next) try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
          }
        }}
        onPointerMove={(e) => {
          const res = moveSliderDrag(drag.current, e, min, max, s);
          drag.current = res.drag;
          if (res.release && e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (res.value !== undefined && res.value !== value) onChange(res.value);
        }}
        onPointerUp={(e) => {
          const res = endSliderDrag(drag.current, e.pointerId, performance.now(), lastTap.current);
          drag.current = res.drag;
          lastTap.current = res.lastTap;
          if (res.reset) onChange(defaultValue);
        }}
        onPointerCancel={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null;
        }}
        onLostPointerCapture={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null;
        }}
      >
        <input
          ref={input}
          type="range"
          min={min}
          max={max}
          step={s}
          value={Math.min(max, Math.max(min, value))}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
        />
      </div>
    </div>
  );
}
