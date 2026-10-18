import { useRef, type CSSProperties } from 'react';

export const formatSigned = (v: number) => `${Math.round(v) > 0 ? '+' : ''}${Math.round(v)}`;
export const formatPlain = (v: number) => String(Math.round(v));
export const formatEv = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV`;
export const formatDegrees = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;

/** Touch movement (px) before a gesture is judged a horizontal drag or a vertical scroll. */
const SLOP = 8;

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
}

interface TouchDrag {
  id: number;
  x: number;
  y: number;
  value: number;
  width: number;
  locked: boolean;
  dropped: boolean;
}

/**
 * Port of the apps' ParamSlider: label, value (click to reset) and a range input (double-click to reset).
 * Touch is handled here rather than by the range input, so a vertical swipe that starts on the slider
 * scrolls the panel: only a mostly-horizontal drag moves the value, relative to where it started.
 */
export function ParamSlider({ label, value, min, max, defaultValue, step, format = formatSigned, onChange, disabled, trackGradient }: Props) {
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
  const lastTap = useRef(0);
  const drag = useRef<TouchDrag | null>(null);
  return (
    <div className="slider">
      <div className="slider-row">
        <span>{label}</span>
        <button type="button" className={`slider-value${changed ? ' changed' : ''}`} title="Reset" onClick={() => onChange(defaultValue)} disabled={disabled}>
          {format(value)}
        </button>
      </div>
      <div
        className={`slider-track${trackGradient ? ' gradient' : signed ? ' filled signed' : ' filled'}`}
        style={trackGradient ? ({ '--track': `linear-gradient(to right, ${trackGradient.join(', ')})` } as CSSProperties) : fill}
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch' || disabled) return;
          const width = e.currentTarget.getBoundingClientRect().width;
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, value, width, locked: false, dropped: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId || d.dropped) return;
          const dx = e.clientX - d.x;
          if (!d.locked) {
            const dy = e.clientY - d.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
            if (Math.abs(dy) >= Math.abs(dx)) {
              d.dropped = true; // the browser is scrolling
              return;
            }
            d.locked = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          const raw = d.value + (dx / d.width) * (max - min);
          const snapped = min + Math.round((raw - min) / s) * s;
          onChange(Math.min(max, Math.max(min, snapped)));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.locked || d.dropped) return;
          // A tap: two in a row reset (dblclick isn't fired for touch in every browser).
          const now = performance.now();
          if (now - lastTap.current < 300) {
            onChange(defaultValue);
            lastTap.current = 0;
          } else lastTap.current = now;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <input
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
