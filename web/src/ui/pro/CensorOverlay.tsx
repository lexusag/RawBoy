import { useRef, useState } from 'react';
import { PRESSURE_MIN_RADIUS, type CensorEllipse, type CensorLayer, type CensorStroke } from '../../engine/develop/Censor';
import { newId } from '../../engine/develop/Masks';
import { ZoomMath } from '../../engine/gl/Zoom';
import type { LensTransform } from '../../engine/lens/LensTransform';

type Pt = [number, number];

/** What a press on the photo does. */
export type CensorTool = 'paint' | 'erase' | 'ellipse' | 'pick';

/** What new strokes start with (the panel's brush settings; never changes strokes already painted). */
export interface CensorBrush {
  /** Fraction of the long side. */
  radius: number;
  hardness: number;
  /** 0..100: how far the drawn line trails the pointer (a steadier line for a mouse or a shaky hand). */
  smoothing: number;
  /** Display sRGB "#rrggbb", or null: the area's own colours. */
  colour: string | null;
  colourMix: number;
}

/** A press this close (CSS pixels) to a handle grabs it. */
const GRAB = 12;
/** Fewest CSS pixels a brush ring is drawn with. */
const MIN_DRAW = 4;
/** A second finger this soon after a stroke started turns it into a pinch: the stroke is dropped. */
const PINCH_GRACE_MS = 150;
/** A new point once the (smoothed) pointer moved this fraction of the brush radius: the spline fills between. */
const POINT_STEP = 0.15;

interface Props {
  lens: LensTransform;
  layer: CensorLayer | null;
  tool: CensorTool;
  brush: CensorBrush;
  frame: number;
  zoomFrame: number;
  zoomCenter: [number, number] | null;
  zoomScale: number;
  /** Space held: presses go to the preview (pan). */
  passThrough: boolean;
  /** Starts [stroke] on the selected layer; false when it can't take more. */
  onBegin: (stroke: CensorStroke) => boolean;
  /** More points (image fractions, flat) and, for a pen stroke, one width each. */
  onExtend: (strokeId: string, points: number[], widths: number[]) => void;
  onEnd: () => void;
  /** Drops the stroke just begun (a pinch), no redo step. */
  onCancel: () => void;
  /** The layer's ellipse moved or was drawn; [force]: its own undo step (a new ellipse). */
  onEllipse: (e: CensorEllipse, force: boolean) => void;
  /** The eyedropper picked image fractions (x, y). */
  onPick: (x: number, y: number) => void;
}

/**
 * The censor brush over the preview (fit or 100% view). Paint drags lay a stroke on the selected layer, which the
 * censor pass draws live underneath; Erase (or Alt, or a pen's eraser end) takes coverage away. Built for smooth lines:
 * every coalesced pointer sample is used (a fast mouse or pen sends several per frame), a stabiliser ([brush.smoothing])
 * lets the line trail the pointer and drops the jitter, and the stroke is a spline through its points, so even a few
 * points give a round curve. A pen's pressure changes the radius only (PRESSURE_MIN_RADIUS..1), never the cover.
 * The ellipse tool drags out the layer's ellipse; its handles move, size and turn it. Presses outside the photo, with
 * Space or with a second finger are the preview's own (pan, pinch).
 */
export function CensorOverlay(props: Props) {
  const { lens, layer, tool, brush, frame, zoomFrame, zoomCenter, zoomScale, passThrough } = props;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [cursorAt, setCursorAt] = useState<Pt | null>(null);
  const [eraseHeld, setEraseHeld] = useState(false);
  const painting = useRef<{
    id: string;
    at: number;
    /** Stabilised position (image px) and the last point added. */
    s: Pt;
    last: Pt;
    raw: Pt;
    pen: boolean;
    pressure: number;
    stepPx: number;
  } | null>(null);
  const dragging = useRef<{ kind: 'new' | 'move' | 'rx' | 'ry' | 'turn'; from: Pt; start: CensorEllipse } | null>(null);
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

  const toScreen = (x: number, y: number): Pt => {
    const o = lens.output(x, y);
    return [r![0] + (o[0] / lens.outputWidth) * r![2], r![1] + (o[1] / lens.outputHeight) * r![3]];
  };
  const toImage = (sx: number, sy: number): Pt => {
    const s = lens.source(((sx - r![0]) / r![2]) * lens.outputWidth, ((sy - r![1]) / r![3]) * lens.outputHeight);
    return [s[0], s[1]];
  };
  const localOf = (el: Element, clientX: number, clientY: number): Pt => {
    const b = el.getBoundingClientRect();
    return [clientX - b.left, clientY - b.top];
  };
  const onPhoto = (p: Pt) => {
    const ix = (p[0] - r![0]) / r![2];
    const iy = (p[1] - r![1]) / r![3];
    return ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1;
  };
  /** Image px per CSS px around the view's middle (the brush ring's scale). */
  const pxScale = () => {
    const a = toImage(r![0] + r![2] / 2, r![1] + r![3] / 2);
    const b = toImage(r![0] + r![2] / 2 + 10, r![1] + r![3] / 2);
    return Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) / 10);
  };

  /** A point on [e] at (u, v) in its own unit frame, image px. */
  const ellipsePoint = (e: CensorEllipse, u: number, v: number): Pt => {
    const a = (e.angle * Math.PI) / 180;
    const x = u * e.rx * long;
    const y = v * e.ry * long;
    return [e.cx * W + Math.cos(a) * x - Math.sin(a) * y, e.cy * H + Math.sin(a) * x + Math.cos(a) * y];
  };
  const handles = (e: CensorEllipse) => ({
    move: toScreen(...ellipsePoint(e, 0, 0)),
    rx: toScreen(...ellipsePoint(e, 1, 0)),
    ry: toScreen(...ellipsePoint(e, 0, 1)),
    turn: toScreen(...ellipsePoint(e, 1 + 18 / (e.rx * long / pxScale()), 0)),
  });

  const widthOf = (pressure: number) => PRESSURE_MIN_RADIUS + (1 - PRESSURE_MIN_RADIUS) * Math.min(1, Math.max(0, pressure));
  const frac = (p: Pt): [number, number] => [p[0] / W, p[1] / H];

  /** Feeds raw pointer samples (image px, pressure) through the stabiliser; returns the points to add. */
  const advance = (samples: { p: Pt; pressure: number }[]) => {
    const pt = painting.current!;
    // Pull towards the pointer per sample: 1 = no smoothing, 0.12 at Smoothing 100 (a long, steady trail).
    const k = 1 - 0.88 * (brush.smoothing / 100);
    const pts: number[] = [];
    const ws: number[] = [];
    for (const { p, pressure } of samples) {
      pt.raw = p;
      pt.pressure = pressure;
      pt.s = [pt.s[0] + (p[0] - pt.s[0]) * k, pt.s[1] + (p[1] - pt.s[1]) * k];
      if (Math.hypot(pt.s[0] - pt.last[0], pt.s[1] - pt.last[1]) < pt.stepPx) continue;
      pt.last = pt.s;
      pts.push(...frac(pt.s));
      if (pt.pen) ws.push(widthOf(pressure));
    }
    if (pts.length) props.onExtend(pt.id, pts, ws);
  };

  const finish = () => {
    const pt = painting.current;
    if (!pt) return;
    // The stabilised line catches up with where the pointer lifted.
    if (Math.hypot(pt.raw[0] - pt.last[0], pt.raw[1] - pt.last[1]) > 0.5) props.onExtend(pt.id, [...frac(pt.raw)], pt.pen ? [widthOf(pt.pressure)] : []);
    painting.current = null;
    props.onEnd();
  };

  const erasing = (e: React.PointerEvent) => tool === 'erase' || e.altKey || (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0));

  let body: React.ReactNode = null;
  if (r) {
    const e = layer?.ellipse ?? null;
    const ringR = Math.max(MIN_DRAW, (brush.radius * long) / pxScale());
    const showRing = cursorAt && !painting.current && !dragging.current && !passThrough && (tool === 'paint' || tool === 'erase') && onPhoto(cursorAt);
    let ellipsePath: string | null = null;
    if (e) {
      const pts: Pt[] = [];
      for (let i = 0; i < 72; i++) {
        const t = (i / 72) * Math.PI * 2;
        pts.push(toScreen(...ellipsePoint(e, Math.cos(t), Math.sin(t))));
      }
      ellipsePath = `M${pts.map((p) => `${p[0]},${p[1]}`).join(' L')} Z`;
    }
    const h = e ? handles(e) : null;
    body = (
      <g pointerEvents="none">
        {ellipsePath && (
          <>
            <path d={ellipsePath} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={3.5} />
            <path d={ellipsePath} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="6 5" />
          </>
        )}
        {h &&
          (['move', 'rx', 'ry', 'turn'] as const).map((k) => (
            <circle key={k} cx={h[k][0]} cy={h[k][1]} r={k === 'move' ? 6 : 5} fill={k === 'turn' ? 'rgba(0,0,0,0.6)' : '#fff'} stroke={k === 'turn' ? '#fff' : 'rgba(0,0,0,0.6)'} strokeWidth={1.5} />
          ))}
        {showRing && (
          <>
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={ringR} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={3.5} />
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={ringR} fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray={tool === 'erase' || eraseHeld ? '4 4' : undefined} />
            {brush.hardness < 100 && <circle cx={cursorAt[0]} cy={cursorAt[1]} r={ringR * (0.5 + brush.hardness / 200)} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1} />}
          </>
        )}
        {cursorAt && !painting.current && tool === 'pick' && !passThrough && onPhoto(cursorAt) && (
          <circle cx={cursorAt[0]} cy={cursorAt[1]} r={6} fill="none" stroke="#fff" strokeWidth={1.5} />
        )}
      </g>
    );
  }

  return (
    <svg
      className="overlay mask-overlay"
      style={{ cursor: tool === 'pick' || tool === 'ellipse' ? 'crosshair' : 'none', pointerEvents: passThrough ? 'none' : undefined, touchAction: 'none' }}
      ref={(el) => {
        if (!el) return;
        const b = el.getBoundingClientRect();
        if (!box || box.w !== b.width || box.h !== b.height) setBox({ w: b.width, h: b.height });
      }}
      onPointerDown={(ev) => {
        if (ev.isPrimary) down.current.clear();
        down.current.add(ev.pointerId);
        if (down.current.size > 1) {
          const pt = painting.current;
          const d = dragging.current;
          if (pt) {
            painting.current = null;
            props.onEnd();
            if (ev.timeStamp - pt.at < PINCH_GRACE_MS) props.onCancel();
          }
          if (d) {
            dragging.current = null;
            props.onEllipse(d.start, false);
          }
          return;
        }
        const penEraser = ev.pointerType === 'pen' && ev.button === 5;
        if ((ev.button !== 0 && !penEraser) || !r || !layer) return;
        const p = localOf(ev.currentTarget, ev.clientX, ev.clientY);
        const img = toImage(p[0], p[1]);
        // The ellipse's handles, whatever the tool.
        const e = layer.ellipse;
        if (e) {
          const h = handles(e);
          const hit = (['turn', 'rx', 'ry', 'move'] as const).find((k) => Math.hypot(p[0] - h[k][0], p[1] - h[k][1]) < GRAB);
          if (hit) {
            ev.stopPropagation();
            ev.currentTarget.setPointerCapture(ev.pointerId);
            dragging.current = { kind: hit, from: img, start: e };
            return;
          }
        }
        if (!onPhoto(p)) return;
        ev.stopPropagation();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        setCursorAt(null);
        if (tool === 'pick') {
          props.onPick(img[0] / W, img[1] / H);
          return;
        }
        if (tool === 'ellipse') {
          const start: CensorEllipse = { cx: img[0] / W, cy: img[1] / H, rx: 0.004, ry: 0.004, angle: 0 };
          props.onEllipse(start, true);
          dragging.current = { kind: 'new', from: img, start };
          return;
        }
        const pen = ev.pointerType === 'pen';
        const stroke: CensorStroke = {
          id: newId(),
          erase: erasing(ev),
          radius: brush.radius,
          hardness: brush.hardness,
          points: [...frac(img)],
          ...(pen ? { widths: [widthOf(ev.pressure || 0.5)] } : {}),
          ...(brush.colour ? { colour: brush.colour, colourMix: brush.colourMix } : {}),
        };
        if (!props.onBegin(stroke)) return;
        painting.current = { id: stroke.id, at: ev.timeStamp, s: img, last: img, raw: img, pen, pressure: ev.pressure || 0.5, stepPx: Math.max(0.75, brush.radius * long * POINT_STEP) };
      }}
      onPointerMove={(ev) => {
        if (!r) return;
        const p = localOf(ev.currentTarget, ev.clientX, ev.clientY);
        setCursorAt(p);
        setEraseHeld(ev.altKey);
        const d = dragging.current;
        if (d) {
          ev.stopPropagation();
          const img = toImage(p[0], p[1]);
          const s = d.start;
          const c: Pt = [s.cx * W, s.cy * H];
          const a = (s.angle * Math.PI) / 180;
          // The pointer in the ellipse's own (unturned) frame, image px.
          const dx = img[0] - c[0];
          const dy = img[1] - c[1];
          const u = Math.cos(a) * dx + Math.sin(a) * dy;
          const v = -Math.sin(a) * dx + Math.cos(a) * dy;
          const min = 0.003;
          if (d.kind === 'move') props.onEllipse({ ...s, cx: s.cx + (img[0] - d.from[0]) / W, cy: s.cy + (img[1] - d.from[1]) / H }, false);
          else if (d.kind === 'rx') props.onEllipse({ ...s, rx: Math.max(min, Math.abs(u) / long) }, false);
          else if (d.kind === 'ry') props.onEllipse({ ...s, ry: Math.max(min, Math.abs(v) / long) }, false);
          else if (d.kind === 'turn') props.onEllipse({ ...s, angle: (Math.atan2(dy, dx) * 180) / Math.PI }, false);
          else {
            // A new ellipse grows from its centre; Shift keeps it round.
            const rx = Math.max(min, Math.abs(dx) / long);
            const ry = Math.max(min, Math.abs(dy) / long);
            const m = Math.max(rx, ry);
            props.onEllipse({ ...s, rx: ev.shiftKey ? m : rx, ry: ev.shiftKey ? m : ry }, false);
          }
          return;
        }
        if (!painting.current) return;
        ev.stopPropagation();
        // Every sample the browser coalesced into this event: a quick stroke keeps its curve.
        const native = ev.nativeEvent;
        const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        const list = events.length ? events : [native];
        advance(
          list.map((ce) => {
            const lp = localOf(ev.currentTarget, ce.clientX, ce.clientY);
            return { p: toImage(lp[0], lp[1]), pressure: ce.pressure || 0.5 };
          }),
        );
      }}
      onPointerUp={(ev) => {
        down.current.delete(ev.pointerId);
        if (painting.current) {
          ev.stopPropagation();
          finish();
        } else if (dragging.current) {
          ev.stopPropagation();
          dragging.current = null;
        }
      }}
      onPointerCancel={(ev) => {
        down.current.delete(ev.pointerId);
        if (painting.current) finish();
        dragging.current = null;
      }}
      onPointerLeave={() => setCursorAt(null)}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      {body}
    </svg>
  );
}
