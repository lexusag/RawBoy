import { useEffect, useRef, useState } from 'react';
import { cropHandleAt, dragCrop, type CropHandle, type CropRect } from '../../engine/develop/CropMath';
import { ZoomMath } from '../../engine/gl/Zoom';

/** Grab distance around edges and corners, CSS pixels. */
const GRAB = 16;

interface Props {
  /** The visible output picture dimensions shown in the preview. */
  frameWidth: number;
  frameHeight: number;
  rect: CropRect;
  /** Frame around the photo, CSS pixels. */
  frame: number;
  onChange: (rect: CropRect) => void;
}

const CURSORS: Record<CropHandle, string> = {
  move: 'move',
  left: 'ew-resize',
  right: 'ew-resize',
  top: 'ns-resize',
  bottom: 'ns-resize',
  topLeft: 'nwse-resize',
  bottomRight: 'nwse-resize',
  topRight: 'nesw-resize',
  bottomLeft: 'nesw-resize',
};

/**
 * Draggable and extendable selection rectangle over the aspect-fit picture for Auto White Balance
 * (port of app-pro's AutoWbOverlay.kt). Dragging corners or edges resizes it, dragging inside moves it,
 * and presses outside fall through to the preview (press and hold still compares).
 */
export function AutoWbOverlay({ frameWidth, frameHeight, rect, frame, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<CropHandle | null>(null);
  const drag = useRef<{ handle: CropHandle; start: CropRect; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      setBox((prev) => (prev && prev.w === b.width && prev.h === b.height ? prev : { w: b.width, h: b.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const r = box && box.w > 0 && box.h > 0 ? ZoomMath.fitRect(box.w, box.h, frameWidth, frameHeight, frame) : null;

  const handleAt = (e: React.PointerEvent<SVGSVGElement>): CropHandle | null => {
    if (!r) return null;
    const b = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - b.left - r[0]) / r[2];
    const y = (e.clientY - b.top - r[1]) / r[3];
    return cropHandleAt(rect, x, y, GRAB / r[2], GRAB / r[3]);
  };

  let body = null;
  if (r) {
    const left = r[0] + rect.left * r[2];
    const top = r[1] + rect.top * r[3];
    const right = r[0] + rect.right * r[2];
    const bottom = r[1] + rect.bottom * r[3];
    const w = right - left;
    const h = bottom - top;
    const lines = 3;
    const len = Math.min(20, w / 3, h / 3);
    const corner = (cx: number, cy: number, dx: number, dy: number) => `M${cx + dx * len},${cy} L${cx},${cy} L${cx},${cy + dy * len}`;
    const mx = (left + right) / 2;
    const my = (top + bottom) / 2;
    body = (
      <>
        <path
          fill="rgba(0,0,0,0.35)"
          fillRule="evenodd"
          d={`M${r[0]},${r[1]} h${r[2]} v${r[3]} h${-r[2]} Z M${left},${top} v${h} h${w} v${-h} Z`}
        />
        {Array.from({ length: lines - 1 }, (_, k) => {
          const i = k + 1;
          const x = left + (w * i) / lines;
          const y = top + (h * i) / lines;
          return (
            <g key={i} stroke="rgba(255,255,255,0.25)" strokeWidth={1}>
              <line x1={x} y1={top} x2={x} y2={bottom} />
              <line x1={left} y1={y} x2={right} y2={y} />
            </g>
          );
        })}
        <rect x={left} y={top} width={w} height={h} fill="none" stroke="#fff" strokeWidth={1.5} />
        <path
          fill="none"
          stroke="#fff"
          strokeWidth={3}
          d={[
            corner(left, top, 1, 1),
            corner(right, top, -1, 1),
            corner(left, bottom, 1, -1),
            corner(right, bottom, -1, -1),
            `M${mx - len / 2},${top} h${len} M${mx - len / 2},${bottom} h${len}`,
            `M${left},${my - len / 2} v${len} M${right},${my - len / 2} v${len}`,
          ].join(' ')}
        />
      </>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="overlay auto-wb-overlay"
      style={{ cursor: hover ? CURSORS[hover] : undefined }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const handle = handleAt(e);
        if (!handle) return; // outside the selection: the preview's own gestures
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { handle, start: rect, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) {
          setHover(handleAt(e));
          return;
        }
        if (!r) return;
        e.stopPropagation();
        onChange(dragCrop(d.start, d.handle, (e.clientX - d.x) / r[2], (e.clientY - d.y) / r[3], null, frameWidth, frameHeight));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {body}
    </svg>
  );
}
