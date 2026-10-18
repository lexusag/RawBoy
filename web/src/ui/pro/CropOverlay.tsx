import { useRef, useState } from 'react';
import { cropHandleAt, dragCrop, type CropHandle, type CropRect } from '../../engine/develop/CropMath';
import { ZoomMath } from '../../engine/gl/Zoom';

/** Grab distance around edges and corners, CSS pixels. */
const GRAB = 16;

interface Props {
  /** The whole (uncropped) frame the preview shows. */
  frameWidth: number;
  frameHeight: number;
  crop: CropRect;
  /** Width / height in pixels, null = free. */
  ratio: number | null;
  /** Frame around the photo, CSS pixels. */
  frame: number;
  onChange: (crop: CropRect) => void;
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
 * Crop frame over the aspect-fit picture (port of app-pro's CropOverlay.kt): dims what's cut, draws a grid for
 * straightening, and edits the crop by dragging corners, edges or the inside. Presses outside the crop fall
 * through to the preview (press and hold still compares).
 */
export function CropOverlay({ frameWidth, frameHeight, crop, ratio, frame, onChange }: Props) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<CropHandle | null>(null);
  const drag = useRef<{ handle: CropHandle; start: CropRect; x: number; y: number } | null>(null);
  const r = box ? ZoomMath.fitRect(box.w, box.h, frameWidth, frameHeight, frame) : null;

  const handleAt = (e: React.PointerEvent<SVGSVGElement>): CropHandle | null => {
    if (!r) return null;
    const b = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - b.left - r[0]) / r[2];
    const y = (e.clientY - b.top - r[1]) / r[3];
    return cropHandleAt(crop, x, y, GRAB / r[2], GRAB / r[3]);
  };

  let body = null;
  if (r) {
    const left = r[0] + crop.left * r[2];
    const top = r[1] + crop.top * r[3];
    const right = r[0] + crop.right * r[2];
    const bottom = r[1] + crop.bottom * r[3];
    const w = right - left;
    const h = bottom - top;
    const lines = 9;
    const len = Math.min(18, w / 3, h / 3);
    const corner = (cx: number, cy: number, dx: number, dy: number) => `M${cx + dx * len},${cy} L${cx},${cy} L${cx},${cy + dy * len}`;
    const mx = (left + right) / 2;
    const my = (top + bottom) / 2;
    body = (
      <>
        <path
          fill="rgba(0,0,0,0.55)"
          fillRule="evenodd"
          d={`M${r[0]},${r[1]} h${r[2]} v${r[3]} h${-r[2]} Z M${left},${top} v${h} h${w} v${-h} Z`}
        />
        {Array.from({ length: lines - 1 }, (_, k) => {
          const i = k + 1;
          const x = left + (w * i) / lines;
          const y = top + (h * i) / lines;
          return (
            <g key={i} stroke={i % 3 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.22)'} strokeWidth={1}>
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
      className="overlay crop-overlay"
      style={{ cursor: hover ? CURSORS[hover] : undefined }}
      ref={(el) => {
        if (!el) return;
        const b = el.getBoundingClientRect();
        if (!box || box.w !== b.width || box.h !== b.height) setBox({ w: b.width, h: b.height });
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const handle = handleAt(e);
        if (!handle) return; // outside the crop: the preview's own gestures
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { handle, start: crop, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) {
          setHover(handleAt(e));
          return;
        }
        if (!r) return;
        e.stopPropagation();
        onChange(dragCrop(d.start, d.handle, (e.clientX - d.x) / r[2], (e.clientY - d.y) / r[3], ratio, frameWidth, frameHeight));
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
