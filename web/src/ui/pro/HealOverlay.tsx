import { useId, useRef, useState } from 'react';
import type { HealSpot } from '../../engine/develop/HealSpots';
import { ZoomMath } from '../../engine/gl/Zoom';
import type { LensTransform } from '../../engine/lens/LensTransform';

type Pt = [number, number];

/** A press this close (CSS pixels) to a source circle's rim or middle grabs it. */
const GRAB = 12;
/** Fewest CSS pixels a stroke is drawn with, so a tiny one stays visible. */
const MIN_DRAW = 5;
/** A second finger this soon after a stroke was started makes it the start of a pinch: the stroke is dropped. */
const PINCH_GRACE_MS = 150;
/** A new stroke point after the pointer moved this fraction of the brush radius. */
const POINT_STEP = 0.25;

interface Props {
  /** Geometry of the view the preview shows (with the crop). */
  lens: LensTransform;
  spots: readonly HealSpot[];
  selectedId: string | null;
  /** The brush for new strokes: radius (fraction of the long side), shown as the cursor. */
  radius: number;
  /** New strokes start with a draggable source (otherwise the engine picks the texture donor). */
  chooseSource: boolean;
  /** Where a new stroke's source lies relative to its start (image fractions), when [chooseSource]. */
  sourceOffset: readonly [number, number];
  /** Frame (plus margin) around the photo in the fit view, CSS pixels. */
  frame: number;
  /** Frame alone, CSS pixels: the zoomed view keeps it around the photo. */
  zoomFrame: number;
  zoomCenter: [number, number] | null;
  zoomScale: number;
  /** Space held: presses go to the preview (pan). */
  passThrough: boolean;
  /** A press on the photo starts a stroke at image fractions (x, y) with [source] (null: the engine picks the texture donor); returns its id, or null when no more fit. */
  onAdd: (x: number, y: number, source: [number, number] | null) => string | null;
  /** The stroke grows by a point (image fractions) as the pointer moves. */
  onExtend: (id: string, x: number, y: number) => void;
  /** The pointer lifted: the stroke is complete. */
  onEnd: () => void;
  /** The stroke just started is dropped (a second finger came down to pinch), with no redo step. */
  onCancelAdd: () => void;
  /** A stroke's source is dragged to image fractions (x, y): it is the new offset for the whole stroke. */
  onSource: (id: string, x: number, y: number) => void;
}

/**
 * Healing brush over the preview (fit or 100% view): press on the photo and drag to paint; a click is one spot. The
 * stroke heals in the full-resolution image shortly after the pointer rests (PhotoSession), so the outline is the only
 * feedback while painting. A stroke with a chosen source shows a dashed copy of itself where its texture comes from;
 * drag that (the selected stroke's) to move the source, for the whole stroke at once, and the next strokes keep the
 * offset. Presses outside the photo, with Space held or with a second finger are the preview's own (pan, pinch).
 */
export function HealOverlay(props: Props) {
  const { lens, spots, selectedId, radius, chooseSource, sourceOffset, frame, zoomFrame, zoomCenter, zoomScale, passThrough } = props;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [cursorAt, setCursorAt] = useState<Pt | null>(null);
  const painting = useRef<{ id: string; last: Pt; at: number; radiusPx: number } | null>(null);
  const draggingSource = useRef<{ id: string; from: Pt; start: readonly [number, number] } | null>(null);
  const down = useRef(new Set<number>());
  const dpr = window.devicePixelRatio || 1;
  const uid = useId().replace(/[^\w-]/g, '');

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
  /** A disk radius [rad] (fraction of the long side) in overlay pixels, measured at image fractions (x, y). */
  const radiusPx = (x: number, y: number, rad: number) => {
    const c = toScreen(x * W, y * H);
    const e = toScreen(x * W + rad * long, y * H);
    return Math.max(MIN_DRAW, Math.hypot(e[0] - c[0], e[1] - c[1]));
  };
  /** Whether [p] lies on the photo (strokes start only there; the frame and margin belong to the preview). */
  const onPhoto = (p: Pt) => {
    const ix = (p[0] - r![0]) / r![2];
    const iy = (p[1] - r![1]) / r![3];
    return ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1;
  };
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

  /** A stroke's points as overlay pixels, shifted by [shift] (image fractions). */
  const points = (s: HealSpot, shift: readonly [number, number] = [0, 0]): Pt[] => {
    const out: Pt[] = [toScreen((s.x + shift[0]) * W, (s.y + shift[1]) * H)];
    for (let i = 0; i + 1 < s.path.length; i += 2) out.push(toScreen((s.path[i] + shift[0]) * W, (s.path[i + 1] + shift[1]) * H));
    return out;
  };
  const pathOf = (pts: Pt[]) => (pts.length === 1 ? `M${pts[0][0]},${pts[0][1]} l0.01,0` : `M${pts.map((p) => `${p[0]},${p[1]}`).join(' L')}`);

  /** The selected stroke's source circle (at its start), when it has one. */
  const selected = spots.find((s) => s.id === selectedId) ?? null;
  const sourceCircle = (s: HealSpot): { c: Pt; rad: number } | null =>
    s.source ? { c: toScreen(s.source[0] * W, s.source[1] * H), rad: radiusPx(s.source[0], s.source[1], s.radius) } : null;

  /** A new stroke's source for a start at image fractions (x, y): the remembered offset, kept inside the photo. */
  const newSource = (x: number, y: number): [number, number] => [clamp01(x + sourceOffset[0]), clamp01(y + sourceOffset[1])];

  /** A stroke's outline: a thick round-capped path with its inside cut out, so only a ring of it shows. */
  const outline = (key: string, pts: Pt[], rad: number, sel: boolean, dashed: boolean) => {
    const id = `heal-${uid}-${key}`;
    const w = 2 * rad;
    const dash = dashed ? '7 6' : undefined;
    // The stroke being painted is shown as a red see-through band (one path, so overlaps don't darken) until the pointer lifts.
    const live = painting.current?.id === key;
    return (
      <g key={key}>
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x={-10000} y={-10000} width={20000} height={20000}>
            <rect x={-10000} y={-10000} width={20000} height={20000} fill="#fff" />
            <path d={pathOf(pts)} fill="none" stroke="#000" strokeWidth={Math.max(0, w - 2)} strokeLinecap="round" strokeLinejoin="round" />
          </mask>
        </defs>
        <path d={pathOf(pts)} fill="none" stroke={live ? 'rgba(255,40,40,0.45)' : sel ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)'} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
        <g mask={`url(#${id})`}>
          <path d={pathOf(pts)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={w + 3.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
          <path d={pathOf(pts)} fill="none" stroke={sel ? '#fff' : 'rgba(255,255,255,0.75)'} strokeWidth={w + 1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
        </g>
      </g>
    );
  };

  let body: React.ReactNode = null;
  if (r) {
    body = (
      <g pointerEvents="none">
        {spots.map((s) => {
          const sel = s.id === selectedId;
          const rad = radiusPx(s.x, s.y, s.radius);
          const src = s.source ? points(s, [s.source[0] - s.x, s.source[1] - s.y]) : null;
          return (
            <g key={s.id}>
              {src && (
                <>
                  <line x1={toScreen(s.x * W, s.y * H)[0]} y1={toScreen(s.x * W, s.y * H)[1]} x2={src[0][0]} y2={src[0][1]} stroke="rgba(0,0,0,0.55)" strokeWidth={sel ? 3.5 : 2.5} />
                  <line x1={toScreen(s.x * W, s.y * H)[0]} y1={toScreen(s.x * W, s.y * H)[1]} x2={src[0][0]} y2={src[0][1]} stroke={sel ? '#fff' : 'rgba(255,255,255,0.7)'} strokeWidth={sel ? 1.5 : 1} />
                  {outline(`${s.id}-src`, src, rad, sel, true)}
                </>
              )}
              {outline(s.id, points(s), rad, sel, false)}
            </g>
          );
        })}
        {cursorAt && !painting.current && !draggingSource.current && !passThrough && onPhoto(cursorAt) && (
          <>
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={radiusPx(0.5, 0.5, radius)} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={3.5} />
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={radiusPx(0.5, 0.5, radius)} fill="none" stroke="#fff" strokeWidth={1.5} />
          </>
        )}
      </g>
    );
  }

  return (
    <svg
      className="overlay mask-overlay"
      style={{ cursor: 'none', pointerEvents: passThrough ? 'none' : undefined }}
      ref={(el) => {
        if (!el) return;
        const b = el.getBoundingClientRect();
        if (!box || box.w !== b.width || box.h !== b.height) setBox({ w: b.width, h: b.height });
      }}
      onPointerDown={(e) => {
        if (e.isPrimary) down.current.clear();
        down.current.add(e.pointerId);
        if (down.current.size > 1) {
          // A second finger is a pinch for the preview: give up what the first one started. A stroke just begun is
          // dropped (the pinch's first finger), a longer one kept; a source drag goes back.
          const p = painting.current;
          const d = draggingSource.current;
          painting.current = null;
          draggingSource.current = null;
          if (p) {
            props.onEnd();
            if (e.timeStamp - p.at < PINCH_GRACE_MS) props.onCancelAdd();
          }
          if (d) props.onSource(d.id, d.start[0], d.start[1]);
          return;
        }
        if (e.button !== 0 || !r) return;
        const p = local(e);
        // The selected stroke's source circle is a handle.
        const sc = selected && sourceCircle(selected);
        if (selected && sc && Math.hypot(p[0] - sc.c[0], p[1] - sc.c[1]) < Math.max(sc.rad, GRAB)) {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setCursorAt(null);
          draggingSource.current = { id: selected.id, from: toImage(p[0], p[1]), start: selected.source! };
          return;
        }
        if (!onPhoto(p)) return; // the frame: the preview's own
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setCursorAt(null);
        const img = toImage(p[0], p[1]);
        const x = clamp01(img[0] / W);
        const y = clamp01(img[1] / H);
        const id = props.onAdd(x, y, chooseSource ? newSource(x, y) : null);
        if (id) painting.current = { id, last: img, at: e.timeStamp, radiusPx: radius * long };
      }}
      onPointerMove={(e) => {
        const p = local(e);
        setCursorAt(p);
        if (!r) return;
        const d = draggingSource.current;
        if (d) {
          e.stopPropagation();
          const img = toImage(p[0], p[1]);
          props.onSource(d.id, clamp01(d.start[0] + (img[0] - d.from[0]) / W), clamp01(d.start[1] + (img[1] - d.from[1]) / H));
          return;
        }
        const pt = painting.current;
        if (!pt) return;
        e.stopPropagation();
        const img = toImage(p[0], p[1]);
        if (Math.hypot(img[0] - pt.last[0], img[1] - pt.last[1]) < Math.max(1, pt.radiusPx * POINT_STEP)) return;
        pt.last = img;
        props.onExtend(pt.id, clamp01(img[0] / W), clamp01(img[1] / H));
      }}
      onPointerUp={(e) => {
        down.current.delete(e.pointerId);
        if (painting.current) {
          e.stopPropagation();
          painting.current = null;
          props.onEnd();
        } else if (draggingSource.current) {
          e.stopPropagation();
          draggingSource.current = null;
        }
      }}
      onPointerCancel={(e) => {
        down.current.delete(e.pointerId);
        if (painting.current) props.onEnd();
        painting.current = null;
        draggingSource.current = null;
      }}
      onPointerLeave={() => setCursorAt(null)}
      onDoubleClick={(e) => e.stopPropagation()} // Z zooms instead
    >
      {body}
    </svg>
  );
}
