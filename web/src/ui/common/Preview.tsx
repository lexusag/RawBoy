import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DevelopRenderer } from '../../engine/gl/DevelopRenderer';
import type { ShaderParams } from '../../engine/gl/ShaderParams';
import type { SessionState } from '../../engine/session/PhotoSession';
import { continuesPageScroll, wheelNotches } from './ParamSlider';

/** Delay before press-and-hold shows the comparison, so clicks and drags don't flash it. */
const COMPARE_DELAY_MS = 250;
/** How long the "double-click for 100%" hint stays up after a photo opens. */
const ZOOM_HINT_MS = 4000;
/** Wheel zoom per notch of a mouse wheel. */
const WHEEL_ZOOM_STEP = 1.25;
/** Set once the user has zoomed: the hint has done its job and stops showing. */
const ZOOM_HINT_KEY = 'rawboy.zoomHintSeen';

function zoomHintSeen(): boolean {
  try {
    return localStorage.getItem(ZOOM_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  session: SessionState;
  params: ShaderParams | null;
  /** Frame width in CSS pixels (0 = none) and its grey level. */
  frame: number;
  frameGrey: number;
  /** Empty space around the frame in the fit view, CSS pixels (the mask tool's room for handles). */
  margin?: number;
  onViewSize: (width: number, height: number, frameDevicePx: number) => void;
  /** Double click at a device-pixel position of the view. */
  onToggleZoom: (x: number, y: number) => void;
  /** Single click (device pixels), e.g. to cycle the frame colour. */
  onClick?: (x: number, y: number) => void;
  /** Drag in the zoomed view, in device pixels. */
  onPan: (dx: number, dy: number) => void;
  /**
   * Mouse wheel over the photo (desktop pointers only): zoom by [factor] around a device-pixel position. Left out,
   * the wheel does nothing here.
   */
  onZoomBy?: (x: number, y: number, factor: number) => void;
  /** Press and hold: true while held. */
  onCompare: (on: boolean) => void;
  /** Clipped highlights red, crushed shadows blue (Pro's histogram). */
  clipWarning?: boolean;
  /** Pointer position over the view (device pixels), null when it leaves (e.g. for zooming at the cursor by key). */
  onPointerAt?: (p: [number, number] | null) => void;
  /** Show the "double-click for 100%" hint when a photo opens (off while zoom is unavailable, e.g. cropping). */
  zoomHint?: boolean;
  children?: ReactNode;
}

/**
 * The develop preview (port of view/DevelopPreview.kt plus the editor's gestures): a canvas at device resolution, so
 * the 100% view shows one image pixel per screen pixel.
 */
export function Preview({ session, params, frame, frameGrey, margin = 0, clipWarning = false, onViewSize, onToggleZoom, onClick, onPan, onZoomBy, onCompare, onPointerAt, zoomHint = true, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DevelopRenderer | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onViewSize, onToggleZoom, onClick, onPan, onZoomBy, onCompare, onPointerAt, frame });
  callbacks.current = { onViewSize, onToggleZoom, onClick, onPan, onZoomBy, onCompare, onPointerAt, frame };

  useLayoutEffect(() => {
    const renderer = new DevelopRenderer(canvasRef.current!);
    rendererRef.current = renderer;
    const box = boxRef.current!;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const r = box.getBoundingClientRect();
      renderer.setViewSize(r.width * dpr, r.height * dpr);
      const framePx = Math.round(callbacks.current.frame * dpr);
      renderer.frameWidth = framePx;
      callbacks.current.onViewSize(renderer.viewWidth, renderer.viewHeight, framePx);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      renderer.release();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current!;
    r.params = params;
    r.frameWidth = Math.round(frame * (window.devicePixelRatio || 1));
    r.frameGrey = frameGrey;
    r.clipWarning = clipWarning;
    r.margin = Math.round(margin * (window.devicePixelRatio || 1));
    r.zoomCenter = session.zoomCenter;
    r.zoomScale = session.zoomScale;
    r.setImage(session.preview);
    r.setDetail(session.detail);
    r.invalidate();
  }, [params, frame, frameGrey, margin, clipWarning, session.zoomCenter, session.zoomScale, session.preview, session.detail]);

  // Mouse wheel zooms around the cursor, desktop only (a mouse or trackpad; Ctrl+wheel is a trackpad pinch). Not
  // React's onWheel: that listener is passive, so it couldn't keep the page from scrolling or zooming.
  useEffect(() => {
    const box = boxRef.current!;
    const onWheel = (e: WheelEvent) => {
      const zoomBy = callbacks.current.onZoomBy;
      // A slider over the photo took it, or the wheel is still scrolling the page past the photo.
      if (!zoomBy || e.defaultPrevented || continuesPageScroll(e) || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      const pinch = e.ctrlKey && e.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
      const factor = pinch ? Math.exp(-e.deltaY / 100) : WHEEL_ZOOM_STEP ** wheelNotches(e);
      e.preventDefault();
      if (factor === 1) return;
      const r = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      zoomBy((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, factor);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // Zoom hint: shown for a few seconds on each new photo until the user has zoomed once.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!session.preview || session.zoomCenter || !zoomHint || zoomHintSeen()) return;
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), ZOOM_HINT_MS);
    return () => {
      clearTimeout(timer);
      setHint(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.preview, zoomHint]);
  useEffect(() => {
    if (!session.zoomCenter) return;
    setHint(false);
    try {
      localStorage.setItem(ZOOM_HINT_KEY, '1');
    } catch {
      // Storage unavailable: the hint just keeps showing on new photos.
    }
  }, [session.zoomCenter]);
  const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

  // Pointer gestures: drag pans when zoomed; press and hold compares; double click toggles 100%; the wheel zooms. One
  // finger only: a second one (a pinch) ends the gesture, compare included, and nothing starts again until every
  // finger is up.
  // Before, the second finger replaced the first's gesture and left its compare timer running, so a pinch could
  // switch to the as-shot render with nothing left to switch it back.
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; timer: number; comparing: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const endGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.comparing) callbacks.current.onCompare(false);
  };
  const pointerGone = (id: number) => {
    pointers.current.delete(id);
    if (gesture.current?.id === id) endGesture();
  };
  useEffect(() => () => endGesture(), []);
  const toDevice = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr] as const;
  };

  return (
    <div
      ref={boxRef}
      className="preview"
      onPointerDown={(e) => {
        // A primary pointer means no other finger is down: forget any whose up we missed.
        if (e.isPrimary) pointers.current.clear();
        pointers.current.add(e.pointerId);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        if (pointers.current.size > 1) {
          endGesture();
          return;
        }
        if (e.button !== 0) return;
        const g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, comparing: false, timer: 0 };
        g.timer = window.setTimeout(() => {
          if (!g.moved && gesture.current === g) {
            g.comparing = true;
            callbacks.current.onCompare(true);
          }
        }, COMPARE_DELAY_MS);
        gesture.current = g;
      }}
      onPointerMove={(e) => {
        callbacks.current.onPointerAt?.([...toDevice(e)]);
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.moved && Math.hypot(dx, dy) < 4) return;
        if (!g.moved) {
          g.moved = true;
          clearTimeout(g.timer);
        }
        const dpr = window.devicePixelRatio || 1;
        callbacks.current.onPan(dx * dpr, dy * dpr);
        g.x = e.clientX;
        g.y = e.clientY;
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        gesture.current = null;
        clearTimeout(g.timer);
        if (g.comparing) callbacks.current.onCompare(false);
        else if (!g.moved) {
          const [x, y] = toDevice(e);
          callbacks.current.onClick?.(x, y);
        }
      }}
      onPointerCancel={(e) => pointerGone(e.pointerId)}
      onLostPointerCapture={(e) => pointerGone(e.pointerId)}
      onPointerLeave={() => callbacks.current.onPointerAt?.(null)}
      onDoubleClick={(e) => {
        const [x, y] = toDevice(e);
        callbacks.current.onToggleZoom(x, y);
      }}
    >
      <canvas ref={canvasRef} />
      {children}
      <div className={hint ? 'zoom-hint show' : 'zoom-hint'}>{touch ? 'Double-tap for 100%' : onZoomBy ? 'Double-click for 100% · scroll to zoom' : 'Double-click for 100%'} · drag to pan</div>
    </div>
  );
}

/** The zoomed view's label: "100%", or the wheel zoom's scale. */
export const zoomLabel = (scale: number) => `${Math.round(scale * 100)}%`;

/** Small label over the preview ("100%", "Original"). */
export function PreviewLabel({ children }: { children: ReactNode }) {
  return <div className="preview-label">{children}</div>;
}
