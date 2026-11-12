import { useRef, useState } from 'react';
import type { HealSpot } from '../../engine/develop/HealSpots';
import { ZoomMath } from '../../engine/gl/Zoom';
import type { LensTransform } from '../../engine/lens/LensTransform';

type Pt = [number, number];

/** A press this close (CSS pixels) to a source circle's rim or middle grabs it. */
const GRAB = 12;
/** Fewest CSS pixels a spot is drawn with, so a tiny one stays visible and hittable. */
const MIN_DRAW = 5;
/** A second finger this soon after a spot was put down makes it the start of a pinch: the spot is dropped. */
const PINCH_GRACE_MS = 150;

interface Props {
  /** Geometry of the view the preview shows (with the crop). */
  lens: LensTransform;
  spots: readonly HealSpot[];
  selectedId: string | null;
  /** The brush for new spots: radius (fraction of the long side), shown as the cursor. */
  radius: number;
  /** New spots start with a draggable source (otherwise the engine picks the texture donor). */
  chooseSource: boolean;
  /** Frame (plus margin) around the photo in the fit view, CSS pixels. */
  frame: number;
  /** Frame alone, CSS pixels: the zoomed view keeps it around the photo. */
  zoomFrame: number;
  zoomCenter: [number, number] | null;
  zoomScale: number;
  /** Space held: presses go to the preview (pan). */
  passThrough: boolean;
  onSelect: (id: string | null) => void;
  /** A press on empty photo: a new spot at image fractions (x, y) with [source] (null: the engine picks the texture donor); returns its id, or null when no more fit. */
  onAdd: (x: number, y: number, source: [number, number] | null) => string | null;
  /** The spot just added is dropped (a second finger came down to pinch), with no redo step. */
  onCancelAdd: () => void;
  /** A spot is dragged to image fractions (x, y); its source goes along (the offset stays). */
  onMove: (id: string, x: number, y: number) => void;
  /** A spot's source is dragged to image fractions (x, y). */
  onSource: (id: string, x: number, y: number) => void;
}

/**
 * Healing brush over the preview (fit or 100% view): a press on the photo puts a spot there (and keeps following the
 * pointer until it lifts, so it can be placed exactly); a press inside a spot selects and moves it. A spot with a chosen
 * source shows a dashed circle where its texture comes from, with a line to it; drag that circle to move the source.
 * The healing itself runs in the full-resolution image shortly after the edits rest (PhotoSession), so the circles are
 * the only feedback while dragging. Presses outside the photo, with Space held or with a second finger are the preview's
 * own (pan, pinch).
 */
export function HealOverlay(props: Props) {
  const { lens, spots, selectedId, radius, chooseSource, frame, zoomFrame, zoomCenter, zoomScale, passThrough } = props;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [cursorAt, setCursorAt] = useState<Pt | null>(null);
  const drag = useRef<{ id: string; what: 'spot' | 'source'; from: Pt; start: HealSpot; created: boolean; at: number } | null>(null);
  const down = useRef(new Set<number>());
  const dpr = window.devicePixelRatio || 1;

  let r: number[] | null = null;
  if (box) {
    if (zoomCenter) {
      const z = ZoomMath.zoomedRect(zoomCenter[0], zoomCenter[1], box.w * dpr, box.h * dpr, lens.outputWidth, lens.outputHeight, zoomScale, Math.round(zoomFrame * dpr));
      r = z.map((v) => v / dpr);
    } else {
      r = ZoomMath.fitRect(box.w, box.h, lens.outputWidth, lens.outputHeight, frame);
    }
  }
  const W = lens.width;
  const H = lens.height;
  const long = Math.max(W, H);

  /** Image pixel -> overlay (CSS) pixel. */
  const toScreen = (x: number, y: number): Pt => {
    const o = lens.output(x, y);
    return [r![0] + (o[0] / lens.outputWidth) * r![2], r![1] + (o[1] / lens.outputHeight) * r![3]];
  };
  /** Overlay (CSS) pixel -> image pixel. */
  const toImage = (sx: number, sy: number): Pt => {
    const s = lens.source(((sx - r![0]) / r![2]) * lens.outputWidth, ((sy - r![1]) / r![3]) * lens.outputHeight);
    return [s[0], s[1]];
  };
  const local = (e: React.PointerEvent<SVGSVGElement>): Pt => {
    const b = e.currentTarget.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  /** The circle of a spot of [rad] (fraction of the long side) at image fractions (x, y), in overlay pixels. */
  const circle = (x: number, y: number, rad: number) => {
    const c = toScreen(x * W, y * H);
    const e = toScreen(x * W + rad * long, y * H);
    return { c, rad: Math.max(MIN_DRAW, Math.hypot(e[0] - c[0], e[1] - c[1])) };
  };
  /** Whether [p] lies on the photo (spots are only put there; the frame and margin belong to the preview). */
  const onPhoto = (p: Pt) => {
    const ix = (p[0] - r![0]) / r![2];
    const iy = (p[1] - r![1]) / r![3];
    return ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1;
  };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const fraction = (img: Pt): Pt => [clamp01(img[0] / W), clamp01(img[1] / H)];

  /** The grabbable thing under [p]: the selected spot's source, else the topmost spot containing it. */
  const hit = (p: Pt): { id: string; what: 'spot' | 'source' } | null => {
    const sel = spots.find((s) => s.id === selectedId);
    if (sel?.source) {
      const k = circle(sel.source[0], sel.source[1], sel.radius);
      if (Math.hypot(p[0] - k.c[0], p[1] - k.c[1]) < k.rad + GRAB * 0.5) return { id: sel.id, what: 'source' };
    }
    for (let i = spots.length - 1; i >= 0; i--) {
      const k = circle(spots[i].x, spots[i].y, spots[i].radius);
      if (Math.hypot(p[0] - k.c[0], p[1] - k.c[1]) < Math.max(k.rad, GRAB)) return { id: spots[i].id, what: 'spot' };
    }
    return null;
  };

  /** Where a new spot's source starts: beside it, on the side with room. */
  const defaultSource = (x: number, y: number): Pt => {
    const dx = (radius * long * 2.6) / W;
    return [x + dx <= 0.98 ? x + dx : Math.max(0.02, x - dx), y];
  };

  const stroke = (sel: boolean) => ({ stroke: sel ? '#fff' : 'rgba(255,255,255,0.7)', strokeWidth: sel ? 2 : 1.5 });
  const ring = (c: Pt, rad: number, sel: boolean, dashed = false) => (
    <>
      <circle cx={c[0]} cy={c[1]} r={rad} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={sel ? 4 : 3} strokeDasharray={dashed ? '6 5' : undefined} />
      <circle cx={c[0]} cy={c[1]} r={rad} fill={sel && !dashed ? 'rgba(255,255,255,0.08)' : 'none'} {...stroke(sel)} strokeDasharray={dashed ? '6 5' : undefined} />
    </>
  );

  let body: React.ReactNode = null;
  if (r) {
    body = (
      <>
        <g pointerEvents="none">
          {spots.map((s) => {
            const sel = s.id === selectedId;
            const k = circle(s.x, s.y, s.radius);
            const src = s.source ? circle(s.source[0], s.source[1], s.radius) : null;
            return (
              <g key={s.id}>
                {src && (
                  <>
                    <line x1={k.c[0]} y1={k.c[1]} x2={src.c[0]} y2={src.c[1]} stroke="rgba(0,0,0,0.55)" strokeWidth={sel ? 3.5 : 2.5} />
                    <line x1={k.c[0]} y1={k.c[1]} x2={src.c[0]} y2={src.c[1]} {...stroke(sel)} strokeWidth={sel ? 1.5 : 1} />
                    {ring(src.c, src.rad, sel, true)}
                  </>
                )}
                {ring(k.c, k.rad, sel)}
              </g>
            );
          })}
          {cursorAt && !drag.current && !passThrough && onPhoto(cursorAt) && !hit(cursorAt) && (
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={circle(0.5, 0.5, radius).rad} fill="none" stroke="#fff" strokeWidth={1.5} strokeOpacity={0.9} />
          )}
        </g>
      </>
    );
  }

  return (
    <svg
      className="overlay mask-overlay"
      style={{ cursor: 'crosshair', pointerEvents: passThrough ? 'none' : undefined }}
      ref={(el) => {
        if (!el) return;
        const b = el.getBoundingClientRect();
        if (!box || box.w !== b.width || box.h !== b.height) setBox({ w: b.width, h: b.height });
      }}
      onPointerDown={(e) => {
        if (e.isPrimary) down.current.clear();
        down.current.add(e.pointerId);
        if (down.current.size > 1) {
          // A second finger is a pinch for the preview: undo what the first one started.
          const d = drag.current;
          drag.current = null;
          if (d) {
            // A spot just put down is the pinch's first finger, not an edit; otherwise put the grabbed thing back.
            if (d.created && e.timeStamp - d.at < PINCH_GRACE_MS) props.onCancelAdd();
            else if (d.what === 'spot') props.onMove(d.id, d.start.x, d.start.y);
            else if (d.start.source) props.onSource(d.id, d.start.source[0], d.start.source[1]);
          }
          return;
        }
        if (e.button !== 0 || !r) return;
        const p = local(e);
        const h = hit(p);
        if (!h && !onPhoto(p)) return; // the frame: the preview's own
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setCursorAt(null);
        if (h) {
          const s = spots.find((x) => x.id === h.id)!;
          props.onSelect(h.id);
          drag.current = { id: h.id, what: h.what, from: toImage(p[0], p[1]), start: s, created: false, at: e.timeStamp };
          return;
        }
        const img = toImage(p[0], p[1]);
        const [fx, fy] = fraction(img);
        const source = chooseSource ? defaultSource(fx, fy) : null;
        const id = props.onAdd(fx, fy, source);
        if (!id) return;
        drag.current = {
          id,
          what: 'spot',
          from: img,
          start: { id, x: fx, y: fy, radius, source, feather: 0 },
          created: true,
          at: e.timeStamp,
        };
      }}
      onPointerMove={(e) => {
        const p = local(e);
        setCursorAt(p);
        const d = drag.current;
        if (!d || !r) return;
        e.stopPropagation();
        const img = toImage(p[0], p[1]);
        // The grabbed point keeps its offset from the pointer.
        const dx = (img[0] - d.from[0]) / W;
        const dy = (img[1] - d.from[1]) / H;
        if (d.what === 'spot') {
          // Moving a spot takes its source along, so the offset (what is cloned from where) stays.
          const nx = clamp01(d.start.x + dx);
          const ny = clamp01(d.start.y + dy);
          props.onMove(d.id, nx, ny);
        } else if (d.start.source) {
          props.onSource(d.id, clamp01(d.start.source[0] + dx), clamp01(d.start.source[1] + dy));
        }
      }}
      onPointerUp={(e) => {
        down.current.delete(e.pointerId);
        if (!drag.current) return;
        e.stopPropagation();
        drag.current = null;
      }}
      onPointerCancel={(e) => {
        down.current.delete(e.pointerId);
        drag.current = null;
      }}
      onPointerLeave={() => setCursorAt(null)}
      onDoubleClick={(e) => e.stopPropagation()} // Z zooms instead
    >
      {body}
    </svg>
  );
}
