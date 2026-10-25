import { useId, useRef, useState } from 'react';
import { CURVE_SCALE, curveOffset, newId, type BrushStroke, type MaskLayer, type MaskShape } from '../../engine/develop/Masks';
import { ZoomMath } from '../../engine/gl/Zoom';
import type { LensTransform } from '../../engine/lens/LensTransform';

/** Grab distance around lines and handles, CSS pixels. */
const GRAB = 14;
/** Points per drawn line or ellipse (they bend with the lens correction, as in the shader). */
const STEPS = 48;
/** Rotation knob distance beyond the ellipse, as a fraction of its vertical radius. */
const KNOB = 1.3;
/** Curvature handle on a linear mask's centre line: this fraction of the long side from the middle. */
const CURVE_HANDLE = 0.22;
/** A new stroke point after the pointer moved this fraction of the brush radius. */
const POINT_STEP = 0.15;

type Handle =
  | 'move' // linear centre line, radial centre
  | 'start' // linear full-effect line
  | 'end' // linear no-effect line
  | 'rx'
  | 'ry'
  | 'rotate'
  | 'curve'; // linear centre line's bend

export type MaskTool = 'move' | 'brush' | 'erase';

/** Brush settings for new strokes (radius: fraction of the long side). */
export interface BrushSettings {
  radius: number;
  hardness: number;
  flow: number;
  auto: boolean;
}

/**
 * What the overlay draws of a layer: also light leaks, as radial shapes (LeaksPanel). [band]: a radial shape drawn and
 * hit-tested as a straight band (rectangle) instead of an ellipse: a streak leak, rx = half length, ry = half width.
 */
export type OverlayLayer = Pick<MaskLayer, 'id' | 'enabled' | 'shape' | 'strokes'> & { band?: boolean };

interface Props {
  /** Geometry of the view the preview shows (with the crop). */
  lens: LensTransform;
  layers: readonly OverlayLayer[];
  selectedId: string | null;
  /** Frame (plus margin) around the photo in the fit view, CSS pixels. */
  frame: number;
  /** Frame alone, CSS pixels: the zoomed view keeps it around the photo (ZoomMath's frame). */
  zoomFrame: number;
  /** Centre of the 100% view (output pixels), or null for the fit view. */
  zoomCenter: [number, number] | null;
  /** Device pixels per image pixel while zoomed. */
  zoomScale: number;
  tool: MaskTool;
  brush: BrushSettings;
  /** Space held: presses go to the preview (pan). */
  passThrough: boolean;
  /** A press anywhere inside a radial shape grabs it (light leaks), not only its centre pin. */
  grabInside?: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, shape: MaskShape) => void;
  onStrokeBegin: (layerId: string, stroke: BrushStroke) => void;
  onStrokeExtend: (layerId: string, strokeId: string, points: number[]) => void;
  onStrokeEnd: () => void;
  /** The stroke being painted is dropped: a second finger came down to pinch-zoom. */
  onStrokeCancel?: (layerId: string) => void;
}

type Pt = [number, number];

/** A second finger this soon after a stroke began makes it the start of a pinch, not paint. */
const PINCH_GRACE_MS = 150;

const dist2ToSegment = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
};

const nearPolyline = (p: Pt, line: Pt[], d: number) => line.some((a, i) => i > 0 && dist2ToSegment(p, line[i - 1], a) < d * d);
const near = (p: Pt, q: Pt, d: number) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < d * d;
const path = (pts: Pt[], close = false) => (pts.length ? `M${pts.map((p) => `${p[0]},${p[1]}`).join(' L')}${close ? ' Z' : ''}` : '');

/**
 * Mask tools over the preview (fit or 100% view), Capture One style.
 *
 * Move: gradient handles. Linear: the full-effect, centre and no-effect lines; drag the centre to move, an outer line
 * to change the width and angle, the square to bend them (curvature). Radial: the ellipse, its feather ring, a centre
 * pin, radius handles and a rotation knob. Other layers show a pin that selects them.
 *
 * Brush / Erase: paint on the selected layer (Alt erases while brushing); a circle shows the brush and its hard core.
 *
 * Lines and ellipses are clipped to the photo; the handles are drawn over the whole preview, also beyond the photo, so
 * they stay reachable when a shape extends past its edges. Presses that hit nothing (Move) fall through to the preview: pan at 100%, press and hold compares.
 */
export function MaskOverlay(props: Props) {
  const { lens, layers, selectedId, frame, zoomFrame, zoomCenter, zoomScale, tool, brush, passThrough, onSelect, onChange } = props;
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [hover, setHover] = useState<Handle | 'pin' | null>(null);
  const [cursorAt, setCursorAt] = useState<Pt | null>(null);
  const drag = useRef<{ id: string; handle: Handle; start: MaskShape; from: Pt } | null>(null);
  const painting = useRef<{ layerId: string; strokeId: string; last: Pt; at: number } | null>(null);
  /** Pointers down over the overlay: a second one is a pinch for the preview, never a handle or a stroke. */
  const down = useRef(new Set<number>());
  const pointerUp = (id: number) => down.current.delete(id);
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
  const painter = tool !== 'move';
  const clipId = `mask-clip${useId().replace(/[^\w-]/g, '')}`; // useId's colons don't survive url(#…)

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

  /** Unit vectors along a linear gradient (p0 -> p1) and across it, in image pixels. */
  const axes = (s: Extract<MaskShape, { kind: 'linear' }>) => {
    const dx = (s.x1 - s.x0) * W;
    const dy = (s.y1 - s.y0) * H;
    const len = Math.max(Math.hypot(dx, dy), 1e-6);
    return { p0: [s.x0 * W, s.y0 * H] as Pt, mid: [((s.x0 + s.x1) / 2) * W, ((s.y0 + s.y1) / 2) * H] as Pt, dir: [dx / len, dy / len] as Pt, perp: [-dy / len, dx / len] as Pt };
  };

  /** Image-pixel corners of the whole overlay (photo, frame and the space around), without lens distortion. */
  const viewCorners = (): Pt[] => {
    const m = lens.outToImage;
    return [[0, 0], [box!.w, 0], [0, box!.h], [box!.w, box!.h]].map(([sx, sy]) => {
      const ox = ((sx - r![0]) / r![2]) * lens.outputWidth;
      const oy = ((sy - r![1]) / r![3]) * lens.outputHeight;
      return [m[0] * ox + m[1] * oy + m[2], m[3] * ox + m[4] * oy + m[5]];
    });
  };

  /** Lines (linear), ellipses (radial) or just a pin (brush) of one layer, in overlay pixels. */
  const geometry = (l: OverlayLayer) => {
    const s = l.shape;
    if (s.kind === 'brush') {
      const p = l.strokes[0]?.points;
      return { kind: 'brush' as const, pin: p && p.length >= 2 ? toScreen(p[0] * W, p[1] * H) : null };
    }
    if (s.kind === 'linear') {
      const { p0, mid, dir, perp } = axes(s);
      const at = (along: number, across: number): Pt => {
        const a = along - curveOffset(s.curve, across, long);
        return toScreen(p0[0] + dir[0] * a + perp[0] * across, p0[1] + dir[1] * a + perp[1] * across);
      };
      // Across the whole overlay: the perpendicular extent of its corners.
      const across = viewCorners().map((c) => (c[0] - p0[0]) * perp[0] + (c[1] - p0[1]) * perp[1]);
      const lo = Math.min(...across);
      const hi = Math.max(...across);
      const n = STEPS * 2;
      const line = (along: number): Pt[] => Array.from({ length: n + 1 }, (_, i) => at(along, lo + ((hi - lo) * i) / n));
      const len = Math.hypot((s.x1 - s.x0) * W, (s.y1 - s.y0) * H);
      return {
        kind: 'linear' as const,
        start: line(0),
        centre: line(len / 2),
        end: line(len),
        pin: toScreen(mid[0], mid[1]) as Pt | null,
        curve: at(len / 2, CURVE_HANDLE * long),
      };
    }
    const a = (s.angle * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const rx = s.rx * long;
    const ry = s.ry * long;
    const cx = s.cx * W;
    const cy = s.cy * H;
    const at = (u: number, v: number): Pt => toScreen(cx + c * u - sn * v, cy + sn * u + c * v);
    const ellipse = (k: number): Pt[] =>
      l.band
        ? // The band's two long edges at k x its half width, as one closed outline (bent by the lens like the shader).
          [-1, 1].flatMap((side) =>
            Array.from({ length: STEPS + 1 }, (_, i) => at(side * rx * (1 - (2 * i) / STEPS), side * k * ry)),
          )
        : Array.from({ length: STEPS }, (_, i) => {
            const t = (i / STEPS) * 2 * Math.PI;
            return at(k * rx * Math.cos(t), k * ry * Math.sin(t));
          });
    return {
      kind: 'radial' as const,
      outer: ellipse(1),
      inner: ellipse(1 - Math.max(0.01, s.feather / 100)),
      pin: at(0, 0) as Pt | null,
      rx: [at(rx, 0), at(-rx, 0)],
      ry: [at(0, ry), at(0, -ry)],
      // A thin band's knob keeps clear of its width handles.
      knob: at(0, -(l.band ? Math.max(ry * KNOB, ry + 0.06 * long) : ry * KNOB)),
      knobBase: at(0, -ry),
    };
  };

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  /** Overlay point [p] lies inside a radial shape's outer ellipse (a band: its rectangle). */
  const inside = (l: OverlayLayer, p: Pt): boolean => {
    const s = l.shape;
    if (s.kind !== 'radial') return false;
    const [x, y] = toImage(p[0], p[1]);
    const a = (s.angle * Math.PI) / 180;
    const dx = x - s.cx * W;
    const dy = y - s.cy * H;
    const u = (Math.cos(a) * dx + Math.sin(a) * dy) / (s.rx * long);
    const v = (-Math.sin(a) * dx + Math.cos(a) * dy) / (s.ry * long);
    return l.band ? Math.abs(u) < 1 && Math.abs(v) < 1 : u * u + v * v < 1;
  };

  const hit = (p: Pt): { id: string; handle: Handle | 'pin' } | null => {
    if (!r) return null;
    if (selected) {
      const g = geometry(selected);
      if (g.kind === 'radial') {
        if (near(p, g.knob, GRAB)) return { id: selected.id, handle: 'rotate' };
        if (g.rx.some((q) => near(p, q, GRAB))) return { id: selected.id, handle: 'rx' };
        if (g.ry.some((q) => near(p, q, GRAB))) return { id: selected.id, handle: 'ry' };
        if (near(p, g.pin!, GRAB * 1.5)) return { id: selected.id, handle: 'move' };
        if (props.grabInside && inside(selected, p)) return { id: selected.id, handle: 'move' };
      } else if (g.kind === 'linear') {
        if (near(p, g.curve, GRAB)) return { id: selected.id, handle: 'curve' };
        if (nearPolyline(p, g.start, GRAB)) return { id: selected.id, handle: 'start' };
        if (nearPolyline(p, g.end, GRAB)) return { id: selected.id, handle: 'end' };
        if (nearPolyline(p, g.centre, GRAB)) return { id: selected.id, handle: 'move' };
      }
    }
    for (const l of layers) {
      if (l.id === selectedId) continue;
      const pin = geometry(l).pin;
      if (pin && near(p, pin, GRAB)) return { id: l.id, handle: 'pin' };
    }
    if (props.grabInside) {
      // Topmost (last drawn in the shader) first; a press inside another shape selects it and starts moving it.
      for (const l of [...layers].reverse()) if (l.id !== selectedId && inside(l, p)) return { id: l.id, handle: 'move' };
    }
    return null;
  };

  /** The shape after dragging [handle] from image point [from] to [to]. */
  const dragShape = (s: MaskShape, handle: Handle, from: Pt, to: Pt): MaskShape => {
    const dx = (to[0] - from[0]) / W;
    const dy = (to[1] - from[1]) / H;
    if (s.kind === 'brush') return s;
    if (s.kind === 'linear') {
      if (handle === 'curve') {
        // The bend that puts the centre line through the pointer.
        const { mid, dir, perp } = axes(s);
        const vx = to[0] - mid[0];
        const vy = to[1] - mid[1];
        const across = vx * perp[0] + vy * perp[1];
        if (Math.abs(across) < long * 0.02) return s;
        const along = vx * dir[0] + vy * dir[1];
        const curve = (-along * long * 100) / (CURVE_SCALE * 4 * across * across);
        return { ...s, curve: Math.round(Math.min(100, Math.max(-100, curve)) * 10) / 10 };
      }
      if (handle === 'start') return { ...s, x0: s.x0 + dx, y0: s.y0 + dy };
      if (handle === 'end') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy };
      return { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
    }
    if (handle === 'move') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    const vx = to[0] - s.cx * W;
    const vy = to[1] - s.cy * H;
    const a = (s.angle * Math.PI) / 180;
    if (handle === 'rotate') {
      let deg = (Math.atan2(vy, vx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      return { ...s, angle: Math.round(deg * 10) / 10 };
    }
    // Radius along the ellipse's own (rotated) axis.
    const u = Math.abs(Math.cos(a) * vx + Math.sin(a) * vy);
    const v = Math.abs(-Math.sin(a) * vx + Math.cos(a) * vy);
    return handle === 'rx' ? { ...s, rx: Math.max(0.01, u / long) } : { ...s, ry: Math.max(0.01, v / long) };
  };

  let body = null;
  if (r) {
    const stroke = { fill: 'none', stroke: '#fff', vectorEffect: 'non-scaling-stroke' as const };
    const shadow = { fill: 'none', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 3 };
    const line = (d: string, width: number, dash?: string) => (
      <>
        <path d={d} {...shadow} strokeDasharray={dash} />
        <path d={d} {...stroke} strokeWidth={width} strokeDasharray={dash} />
      </>
    );
    const dot = (p: Pt, radius: number, filled: boolean) => (
      <circle cx={p[0]} cy={p[1]} r={radius} fill={filled ? '#fff' : 'rgba(0,0,0,0.35)'} stroke="#fff" strokeWidth={1.5} />
    );
    let cursor = null;
    if (painter && cursorAt) {
      // Brush size on screen: one radius along x from the image point under the cursor.
      const c = toImage(cursorAt[0], cursorAt[1]);
      const e = toScreen(c[0] + brush.radius * long, c[1]);
      const rs = Math.max(2, Math.hypot(e[0] - cursorAt[0], e[1] - cursorAt[1]));
      const erase = tool === 'erase';
      cursor = (
        <g pointerEvents="none">
          <circle cx={cursorAt[0]} cy={cursorAt[1]} r={rs} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={3} />
          <circle cx={cursorAt[0]} cy={cursorAt[1]} r={rs} fill="none" stroke="#fff" strokeWidth={1.2} />
          {brush.hardness > 0 && (
            <circle cx={cursorAt[0]} cy={cursorAt[1]} r={rs * (brush.hardness / 100) * 0.95} fill="none" stroke="#fff" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {erase ? (
            <path d={`M${cursorAt[0] - 4},${cursorAt[1]} h8`} stroke="#fff" strokeWidth={1.5} />
          ) : (
            <path d={`M${cursorAt[0] - 4},${cursorAt[1]} h8 M${cursorAt[0]},${cursorAt[1] - 4} v8`} stroke="#fff" strokeWidth={1.5} />
          )}
        </g>
      );
    }
    body = (
      <>
        <defs>
          <clipPath id={clipId}>
            <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} />
          </clipPath>
        </defs>
        <g opacity={painter ? 0.4 : 1}>
          {layers.map((l) => {
            const g = geometry(l);
            if (l.id !== selectedId) return g.pin ? <g key={l.id} opacity={l.enabled ? 1 : 0.5}>{dot(g.pin, 6, false)}</g> : null;
            if (g.kind === 'brush') return null;
            if (g.kind === 'linear') {
              return (
                <g key={l.id}>
                  <g clipPath={`url(#${clipId})`}>
                    {line(path(g.start), 1.5)}
                    {line(path(g.centre), 2.5)}
                    {line(path(g.end), 1.5, '6 5')}
                  </g>
                  {dot(g.pin!, 6, true)}
                  <rect x={g.curve[0] - 5} y={g.curve[1] - 5} width={10} height={10} fill="rgba(0,0,0,0.35)" stroke="#fff" strokeWidth={1.5} />
                </g>
              );
            }
            return (
              <g key={l.id}>
                <g clipPath={`url(#${clipId})`}>
                  {line(path(g.outer, true), 2)}
                  {line(path(g.inner, true), 1.2, '6 5')}
                </g>
                {line(`M${g.knobBase[0]},${g.knobBase[1]} L${g.knob[0]},${g.knob[1]}`, 1.2)}
                {dot(g.knob, 6, false)}
                {[...g.rx, ...g.ry].map((p, i) => <g key={i}>{dot(p, 5, true)}</g>)}
                {dot(g.pin!, 7, true)}
              </g>
            );
          })}
        </g>
        {cursor}
      </>
    );
  }

  const cursorStyle = painter
    ? 'none'
    : hover === 'rotate' || hover === 'curve'
      ? 'grab'
      : hover === 'pin'
        ? 'pointer'
        : hover
          ? 'move'
          : undefined;

  /** Image point -> stroke point (image fractions, rounded: strokes stay small in memory). */
  const fraction = (p: Pt): number[] => [Math.round((p[0] / W) * 1e5) / 1e5, Math.round((p[1] / H) * 1e5) / 1e5];

  return (
    <svg
      className="overlay mask-overlay"
      style={{ cursor: cursorStyle, pointerEvents: passThrough ? 'none' : undefined }}
      ref={(el) => {
        if (!el) return;
        const b = el.getBoundingClientRect();
        if (!box || box.w !== b.width || box.h !== b.height) setBox({ w: b.width, h: b.height });
      }}
      onPointerDown={(e) => {
        if (e.isPrimary) down.current.clear();
        down.current.add(e.pointerId);
        if (down.current.size > 1) {
          // Pinch: give up the first finger's stroke or drag and let the preview have both fingers. A stroke just
          // begun is dropped (the first finger of the pinch), a longer one kept (MaskOverlay.kt's PAN_GRACE_MS).
          const pt = painting.current;
          const d = drag.current;
          painting.current = null;
          drag.current = null;
          if (pt) {
            props.onStrokeEnd();
            if (e.timeStamp - pt.at < PINCH_GRACE_MS) props.onStrokeCancel?.(pt.layerId);
          }
          if (d) onChange(d.id, d.start);
          return;
        }
        if (e.button !== 0 || !r) return;
        const p = local(e);
        if (painter) {
          if (!selected) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          const img = toImage(p[0], p[1]);
          const s: BrushStroke = {
            id: newId(),
            erase: tool === 'erase' || e.altKey,
            auto: brush.auto,
            radius: brush.radius,
            hardness: brush.hardness,
            flow: brush.flow,
            points: fraction(img),
          };
          painting.current = { layerId: selected.id, strokeId: s.id, last: img, at: e.timeStamp };
          props.onStrokeBegin(selected.id, s);
          return;
        }
        const h = hit(p);
        if (!h) return; // elsewhere: the preview's own gestures
        e.stopPropagation();
        if (h.handle === 'pin') {
          onSelect(h.id);
          return;
        }
        const layer = layers.find((l) => l.id === h.id);
        if (!layer) return;
        if (h.id !== selectedId) onSelect(h.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: h.id, handle: h.handle, start: layer.shape, from: toImage(p[0], p[1]) };
      }}
      onPointerMove={(e) => {
        const p = local(e);
        if (painter) setCursorAt(p);
        if (!r) return;
        const pt = painting.current;
        if (pt) {
          e.stopPropagation();
          const img = toImage(p[0], p[1]);
          if (Math.hypot(img[0] - pt.last[0], img[1] - pt.last[1]) < Math.max(0.5, brush.radius * long * POINT_STEP)) return;
          pt.last = img;
          props.onStrokeExtend(pt.layerId, pt.strokeId, fraction(img));
          return;
        }
        const d = drag.current;
        if (!d) {
          if (!painter) setHover(hit(p)?.handle ?? null);
          return;
        }
        e.stopPropagation();
        onChange(d.id, dragShape(d.start, d.handle, d.from, toImage(p[0], p[1])));
      }}
      onPointerUp={(e) => {
        pointerUp(e.pointerId);
        if (painting.current) {
          e.stopPropagation();
          painting.current = null;
          props.onStrokeEnd();
          return;
        }
        if (!drag.current) return;
        e.stopPropagation();
        drag.current = null;
      }}
      onPointerCancel={(e) => {
        pointerUp(e.pointerId);
        if (painting.current) props.onStrokeEnd();
        painting.current = null;
        drag.current = null;
      }}
      onPointerLeave={() => setCursorAt(null)}
      onDoubleClick={(e) => {
        if (painter) e.stopPropagation(); // painting: Z zooms instead
      }}
    >
      {body}
    </svg>
  );
}
