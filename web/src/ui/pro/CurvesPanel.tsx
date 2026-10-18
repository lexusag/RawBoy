import { useEffect, useRef, useState } from 'react';
import {
  CURVE_CHANNELS,
  IDENTITY_CURVE,
  addCurvePoint,
  evaluateCurve,
  isIdentityCurve,
  moveCurvePoint,
  nearestCurvePoint,
  removeCurvePoint,
  sampleCurve,
  type CurveChannel,
  type CurvePoint,
  type ToneCurves,
} from '../../engine/develop/ToneCurve';

/** Stroke colour of each channel's curve. */
const CURVE_COLORS: Record<CurveChannel, string> = { rgb: 'var(--text)', red: '#ff5a5a', green: '#5ad46a', blue: '#5a9cff' };

/** Pointer distance (CSS px) that grabs a point. */
const GRAB_PX = 16;
/** A finger's reach (CSS px) to a point or the curve; touches farther away scroll the panel instead. */
const TOUCH_GRAB_PX = 28;
const DOUBLE_TAP_MS = 350;

/**
 * Curves in Pro's Light tab (port of app-pro's CurvesPanel.kt): a channel picker and a square point-curve editor.
 * Press on the curve box to add a point, drag a point to move it, double-click (double-tap) a point to remove it.
 * Touch only grabs near a point or the curve (adding the point on the curve); elsewhere it scrolls the panel.
 */
export function CurvesPanel({ curves, onChange }: { curves: ToneCurves; onChange: (c: ToneCurves) => void }) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [selected, setSelected] = useState(-1);
  // The points being dragged, kept here so moves never act on a render that hasn't caught up with the last change.
  // `rect` is the box's position at the press: moves map against it, so a layout shift mid-drag can't make the point jump.
  const drag = useRef<{ id: number; index: number; points: readonly CurvePoint[]; rect: DOMRect } | null>(null);
  const lastTap = useRef({ time: 0, index: -1 });
  const box = useRef<SVGSVGElement>(null);

  // The box allows vertical panning (touch-action: pan-y) so touches off the curve scroll; once a press has grabbed
  // the curve, cancelling its touch events keeps the browser from scrolling. pointerdown runs before touchstart.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', hold, { passive: false });
    el.addEventListener('touchmove', hold, { passive: false });
    return () => {
      el.removeEventListener('touchstart', hold);
      el.removeEventListener('touchmove', hold);
    };
  }, []);
  const points = curves[channel];
  const setPoints = (p: readonly CurvePoint[]) => onChange({ ...curves, [channel]: p });

  const toCurve = (e: React.PointerEvent<SVGSVGElement>, r = e.currentTarget.getBoundingClientRect()) => {
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, size: r.width };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y, size } = toCurve(e, rect);
    const touch = e.pointerType !== 'mouse';
    let next = points;
    let index = nearestCurvePoint(points, x, y, (touch ? TOUCH_GRAB_PX : GRAB_PX) / size);
    const now = performance.now();
    if (index >= 0 && lastTap.current.index === index && now - lastTap.current.time < DOUBLE_TAP_MS) {
      lastTap.current = { time: 0, index: -1 };
      setPoints(removeCurvePoint(points, index));
      setSelected(-1);
      return;
    }
    if (index < 0) {
      const onCurve = evaluateCurve(points, x);
      if (touch && Math.abs(onCurve - y) * size > TOUCH_GRAB_PX) return; // off the curve: let the touch scroll
      const added = addCurvePoint(points, x, touch ? onCurve : y);
      if (!added) return;
      next = added.points;
      setPoints(next);
      index = added.index;
    }
    lastTap.current = { time: now, index };
    setSelected(index);
    drag.current = { id: e.pointerId, index, points: next, rect };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const { x, y } = toCurve(e, d.rect);
    d.points = moveCurvePoint(d.points, d.index, x, y);
    setPoints(d.points);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const samples = sampleCurve(points, 129);
  const path = samples.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / 128).toFixed(4)} ${(1 - v).toFixed(4)}`).join(' ');
  const shown = points[selected];

  return (
    <div className="curves">
      {/* One row whose buttons never change width (the edited mark only shows or hides), so the box never moves. */}
      <div className="chips curve-chips">
        {CURVE_CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={c.key === channel ? 'active' : ''}
            onClick={() => {
              setChannel(c.key);
              setSelected(-1);
            }}
          >
            {c.label}
            <span className="curve-mark" aria-hidden>
              {isIdentityCurve(curves[c.key]) ? '' : '•'}
            </span>
          </button>
        ))}
        <button type="button" disabled={isIdentityCurve(points)} onClick={() => setPoints(IDENTITY_CURVE)}>
          Reset
        </button>
      </div>
      <svg
        ref={box}
        className="curve-box"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curve-grid">
            <line x1={g} y1={0} x2={g} y2={1} />
            <line x1={0} y1={g} x2={1} y2={g} />
          </g>
        ))}
        <line className="curve-grid" x1={0} y1={1} x2={1} y2={0} />
        <path d={path} fill="none" stroke={CURVE_COLORS[channel]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {points.map(([px, py], i) => (
          <circle
            key={i}
            cx={px}
            cy={1 - py}
            r={0.022}
            className={i === selected ? 'curve-point selected' : 'curve-point'}
            stroke={CURVE_COLORS[channel]}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="note">
        {shown
          ? `Input ${Math.round(shown[0] * 255)} → output ${Math.round(shown[1] * 255)}`
          : 'Click the curve box (or touch the curve) to add a point and drag to shape it; double-click a point to remove it.'}
      </div>
    </div>
  );
}
