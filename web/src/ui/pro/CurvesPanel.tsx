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
 * Curves in Pro's Light tab (port of app-pro's CurvesPanel.kt): a channel picker and a point-curve editor, square in
 * the side panel and twice as wide as tall on phones (styles.css), so it leaves room for the rest of the panel.
 * Press on the curve box to add a point, drag a point to move it, double-click (double-tap) a point to remove it.
 * Touch only grabs near a point or the curve (adding the point on the curve); elsewhere it scrolls the panel.
 * On phones and touch screens the box has padding (styles.css), so the curve area and its end points sit inside it,
 * away from the panel's edges; the SVG draws into the content box, and presses map against it.
 */
export function CurvesPanel({ curves, onChange }: { curves: ToneCurves; onChange: (c: ToneCurves) => void }) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [selected, setSelected] = useState(-1);
  // The points being dragged, kept here so moves never act on a render that hasn't caught up with the last change.
  // `rect` is the curve area's position at the press: moves map against it, so a layout shift mid-drag can't make the point jump.
  const drag = useRef<{ id: number; index: number; points: readonly CurvePoint[]; rect: Area } | null>(null);
  const lastTap = useRef({ time: 0, index: -1 });
  const box = useRef<SVGSVGElement>(null);
  // Height / width of the curve area, so the points stay round in a box that isn't square.
  const [aspect, setAspect] = useState(1);

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
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(height / width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeEventListener('touchstart', hold);
      el.removeEventListener('touchmove', hold);
    };
  }, []);
  const points = curves[channel];
  const setPoints = (p: readonly CurvePoint[]) => onChange({ ...curves, [channel]: p });

  const toCurve = (e: React.PointerEvent<SVGSVGElement>, r: Area) => {
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height, width: r.width, height: r.height };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const rect = curveArea(e.currentTarget);
    const { x, y, width, height } = toCurve(e, rect);
    const touch = e.pointerType !== 'mouse';
    let next = points;
    let index = nearestCurvePoint(points, x, y, (touch ? TOUCH_GRAB_PX : GRAB_PX) / width, height / width);
    const now = performance.now();
    if (index >= 0 && lastTap.current.index === index && now - lastTap.current.time < DOUBLE_TAP_MS) {
      lastTap.current = { time: 0, index: -1 };
      setPoints(removeCurvePoint(points, index));
      setSelected(-1);
      return;
    }
    if (index < 0) {
      const onCurve = evaluateCurve(points, x);
      if (touch && Math.abs(onCurve - y) * height > TOUCH_GRAB_PX) return; // off the curve: let the touch scroll
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
        {/* Outlines the curve area when the box is padded (phones, touch screens); hidden otherwise. */}
        <rect className="curve-frame" x={0} y={0} width={1} height={1} />
        <path d={path} fill="none" stroke={CURVE_COLORS[channel]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {points.map(([px, py], i) => (
          <ellipse
            key={i}
            cx={px}
            cy={1 - py}
            rx={0.022}
            ry={0.022 / aspect}
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

type Area = { left: number; top: number; width: number; height: number };

/** The box's content box (inside its border and padding) on screen: the area the curve's 0..1 range covers. */
function curveArea(el: SVGSVGElement): Area {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
  const top = px(cs.borderTopWidth) + px(cs.paddingTop);
  const right = px(cs.borderRightWidth) + px(cs.paddingRight);
  const bottom = px(cs.borderBottomWidth) + px(cs.paddingBottom);
  return { left: r.left + left, top: r.top + top, width: Math.max(1, r.width - left - right), height: Math.max(1, r.height - top - bottom) };
}
