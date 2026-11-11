import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type { DevelopParams } from '../../engine/develop/DevelopParams';
import { renderRegion, renderThumbnail } from '../../engine/gl/ThumbnailRenderer';
import { ZoomMath, rect } from '../../engine/gl/Zoom';
import type { LutData } from '../../engine/lut/LutData';
import { loadLut } from '../../engine/lut/LutLoader';
import { LutRepository } from '../../engine/lut/LutRepository';
import { FILM_STOCKS } from '../../engine/auto/looks/FilmLooks';
import { FilmStocks, type FilmData } from '../../engine/film/FilmStocks';
import type { PhotoSession, SessionState } from '../../engine/session/PhotoSession';

/**
 * Look selector (prototype): click the photo and the area there is shown through every LUT and film stock at once, as
 * vertical stripes of one continuous picture, each labelled; click a stripe to make that the photo's look.
 * Drag the panel (its bar or the stripes) and the stripes follow the area under it.
 *
 * The stripes are the fit view's pixels, developed by the same shader and parameters as the preview (one stripe is
 * `renderRegion` of the shared off-screen developer with `lut` swapped), then drawn onto one 2D canvas.
 */

/** Narrowest a stripe may be (CSS px) before the looks are split over pages. */
const MIN_STRIPE = 176;
/** Most looks on one page. */
const MAX_PER_PAGE = 8;
/** Widest and tallest the panel grows (CSS px). */
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 360;
const MIN_HEIGHT = 140;
/** Smallest the user may drag the window to: two stripes wide. */
const MIN_USER_WIDTH = MIN_STRIPE * 2;
/** Tallest the user may drag it (CSS px); the visible part of the photo limits it first. */
const MAX_USER_HEIGHT = 1600;
/** The dragged size is remembered between sessions. */
const SIZE_KEY = 'rawboy.pro.lookWindow';

interface Size { w: number; h: number }
function loadSize(): Size | null {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as Partial<Size> | null;
    return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? { w: v.w!, h: v.h! } : null;
  } catch {
    return null;
  }
}
function saveSize(size: Size | null) {
  try {
    if (size) localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    else localStorage.removeItem(SIZE_KEY);
  } catch {
    /* storage unavailable: the size just isn't remembered */
  }
}
/** Pointer travel (CSS px) before a press is a drag, not a click on a stripe. */
const DRAG_SLOP = 5;
/** How much of the window (CSS px) stays inside the preview when it is dragged out. */
const KEEP_IN = 96;
/** Each look is developed once at this long edge (px) for moving the window; the exact pixels follow when it rests. */
const THUMB_LONG = 640;
/** How long the window must rest (ms) before its stripes are developed at full resolution. */
const REFINE_MS = 150;

/** LUTs parsed for the stripes, by id (the session's own cache holds six, a page of stripes needs more). */
const parsed = new Map<string, Promise<LutData>>();
const PARSED_LIMIT = 48;
function parsedLut(id: string): Promise<LutData> {
  let p = parsed.get(id);
  if (!p) {
    p = LutRepository.open(id).then((blob) => loadLut(id, blob));
    parsed.set(id, p);
    p.catch(() => parsed.delete(id));
    while (parsed.size > PARSED_LIMIT) parsed.delete(parsed.keys().next().value!);
  }
  return p;
}

interface Item {
  /** A LUT (DevelopParams.lut, null = no LUT) or a film stock (DevelopParams.film). */
  kind: 'lut' | 'film';
  id: string | null;
  name: string;
}

/** Film stocks loaded for the stripes (each is two cubes, fetched when its page is first shown). */
const readyFilms = new Map<string, FilmData>();

/** The photo's parameters showing [item]: a LUT turns Film off, a stock turns it on (full strength if it was off). */
export function withLook(p: DevelopParams, item: Item): DevelopParams {
  return item.kind === 'film'
    ? { ...p, film: item.id, filmAmount: p.film ? p.filmAmount : 100 }
    : { ...p, film: null, lut: item.id };
}
const isCurrent = (p: DevelopParams, item: Item) => (item.kind === 'film' ? p.film === item.id : p.film == null && p.lut === item.id);

export interface LookSelectorProps {
  session: PhotoSession;
  state: SessionState;
  /** The photo's current parameters (what the preview shows) and its as-shot defaults. */
  params: DevelopParams;
  defaults: DevelopParams;
  /** Width of the frame around the photo in the fit view, CSS px. */
  frame: number;
  /** Where the panel opens: the clicked point, CSS px in the preview. */
  at: { x: number; y: number };
  onPick: (params: DevelopParams) => void;
  onClose: () => void;
}

export function LookSelector({ session, state, params, defaults, frame, at, onPick, onClose }: LookSelectorProps) {
  const lib = useSyncExternalStore(LutRepository.subscribe, LutRepository.library);
  const items = useMemo<Item[]>(
    () => [
      { kind: 'lut', id: null, name: 'No LUT' },
      ...lib.bundled.map((e): Item => ({ kind: 'lut', id: e.id, name: e.name })),
      ...lib.user.map((e): Item => ({ kind: 'lut', id: e.id, name: e.name })),
      ...FILM_STOCKS.map((l): Item => ({ kind: 'film', id: l.id, name: l.name })),
    ],
    [lib],
  );

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current!;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const dpr = window.devicePixelRatio || 1;

  // The picture inside the preview, CSS px: the fit rectangle, or the zoomed view's (bigger than the preview).
  const lens = state.preview ? session.lensFor(params) : null;
  const outW = lens?.outputWidth ?? 1;
  const outH = lens?.outputHeight ?? 1;
  const picture = useMemo(() => {
    if (!lens || box.w <= 0) return null;
    const vw = Math.round(box.w * dpr);
    const vh = Math.round(box.h * dpr);
    const fw = Math.round(frame * dpr);
    const c = state.zoomCenter;
    const r = c ? ZoomMath.zoomedRect(c[0], c[1], vw, vh, outW, outH, state.zoomScale, fw) : ZoomMath.fitRect(vw, vh, outW, outH, fw);
    return { left: r[0] / dpr, top: r[1] / dpr, width: r[2] / dpr, height: r[3] / dpr };
  }, [lens, box.w, box.h, dpr, frame, state.zoomCenter, state.zoomScale, outW, outH]);

  // The part of the picture on screen is where the panel may go.
  const visible = useMemo(() => {
    if (!picture) return null;
    const l = Math.max(0, picture.left);
    const t = Math.max(0, picture.top);
    const r = Math.min(box.w, picture.left + picture.width);
    const b = Math.min(box.h, picture.top + picture.height);
    return r - l >= 40 && b - t >= 40 ? { l, t, w: r - l, h: b - t } : null;
  }, [picture, box.w, box.h]);

  // null = the default size; a size dragged with the resize handle (mouse) replaces it, clamped to what fits.
  const [userSize, setUserSize] = useState<Size | null>(loadSize);
  const clampW = (w: number) => (visible ? Math.floor(Math.min(Math.max(w, Math.min(MIN_USER_WIDTH, visible.w)), Math.min(visible.w, MAX_WIDTH))) : 0);
  const clampH = (h: number) => (visible ? Math.floor(Math.min(Math.max(h, Math.min(MIN_HEIGHT, visible.h)), Math.min(visible.h, MAX_USER_HEIGHT))) : 0);
  const zoneW = visible ? (userSize ? clampW(userSize.w) : Math.floor(Math.min(visible.w, MAX_WIDTH))) : 0;
  const zoneH = visible
    ? userSize ? clampH(userSize.h) : Math.floor(Math.max(Math.min(visible.h, MIN_HEIGHT), Math.min(visible.h * 0.6, MAX_HEIGHT)))
    : 0;
  const perPage = Math.max(1, Math.min(items.length, MAX_PER_PAGE, Math.floor(zoneW / MIN_STRIPE)));
  const pages = Math.ceil(items.length / perPage);
  const currentIndex = Math.max(0, items.findIndex((i) => isCurrent(params, i)));
  const [pageChoice, setPage] = useState<number | null>(null);
  const page = Math.min(pageChoice ?? Math.floor(currentIndex / perPage), pages - 1);
  const shown = useMemo(() => items.slice(page * perPage, (page + 1) * perPage), [items, page, perPage]);

  // Top-left of the panel, CSS px; opens centred on the click. Clamped at use, so a resize or zoom never loses it.
  const [pos, setPos] = useState({ x: at.x - 1e4, y: at.y - 1e4 });
  const [centred, setCentred] = useState(false);
  useEffect(() => {
    if (centred || !visible || zoneW <= 0) return;
    setPos({ x: at.x - zoneW / 2, y: at.y - zoneH / 2 });
    setCentred(true);
  }, [centred, visible, zoneW, zoneH, at.x, at.y]);
  // The window may hang over the photo's edges (and off the preview's), so any stripe can sit over any spot: it keeps
  // KEEP_IN px of itself in view, and its bar stays at the top.
  const left = visible ? Math.min(Math.max(pos.x, KEEP_IN - zoneW), box.w - KEEP_IN) : 0;
  const top = visible ? Math.min(Math.max(pos.y, 0), box.h - KEEP_IN) : 0;
  // How far it hangs out right and bottom: the bar's buttons and the labels slide back into view.
  const hangRight = Math.max(0, left + zoneW - box.w);
  const hangBottom = Math.max(0, top + zoneH - box.h);

  // The area under the panel, in output pixels.
  const region = useMemo(() => {
    if (!picture || zoneW <= 0) return null;
    const sx = outW / picture.width;
    const sy = outH / picture.height;
    return rect((left - picture.left) * sx, (top - picture.top) * sy, zoneW * sx, zoneH * sy);
  }, [picture, left, top, zoneW, zoneH, outW, outH]);

  // Drawing: every stripe of the page developed with its LUT, on a frame of its own once the move settles.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(0);
  const failed = useRef(new Set<string>());
  const paramsKey = JSON.stringify({ ...params, lut: null, film: null });
  const pw = Math.round(zoneW * dpr);
  const ph = Math.round(zoneH * dpr);

  // Each look of the page developed once, whole, at THUMB_LONG px: moving the window only copies pixels from these
  // (instant on a phone), and a full-resolution pass replaces them once the window rests. Redone when the edit,
  // the photo or its textures change.
  const thumbs = useMemo(
    () => new Map<string, HTMLCanvasElement>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.preview, state.base, state.bloomSources, state.bokehSource, state.flareSource, state.lensInfo, defaults, paramsKey],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const preview = state.preview;
    if (!canvas || !preview || !region || !picture || pw <= 0 || shown.length === 0) return;
    let cancelled = false;
    let timer = 0;
    const ctx = canvas.getContext('2d')!;
    const n = shown.length;
    // Where the picture and the preview sit in the window's pixels: only their overlap is drawn, the rest of the
    // window (over the grey frame, past the preview) stays empty.
    const sx = outW / picture.width;
    const sy = outH / picture.height;
    const clipL = Math.max(picture.left, 0);
    const clipT = Math.max(picture.top, 0);
    const clipR = Math.min(picture.left + picture.width, box.w);
    const clipB = Math.min(picture.top + picture.height, box.h);
    const px0 = Math.max(0, Math.round((clipL - left) * dpr));
    const px1 = Math.min(pw, Math.round((clipR - left) * dpr));
    const py0 = Math.max(0, Math.round((clipT - top) * dpr));
    const py1 = Math.min(ph, Math.round((clipB - top) * dpr));
    /** Stripe [i]'s pixels in the window and the part of the picture (output pixels) they show. */
    const geometry = (i: number) => {
      const x0 = Math.max(px0, Math.round((i * pw) / n));
      const x1 = Math.min(px1, Math.round(((i + 1) * pw) / n));
      if (x1 <= x0 || py1 <= py0) return null;
      const slice = rect(
        (left + x0 / dpr - picture.left) * sx, (top + py0 / dpr - picture.top) * sy,
        ((x1 - x0) / dpr) * sx, ((py1 - py0) / dpr) * sy,
      );
      return { x0, x1, slice };
    };
    const looksOf = (item: Item) => ({
      lut: item.kind === 'lut' && item.id != null ? readyLuts.get(item.id) ?? null : null,
      film: item.kind === 'film' ? readyFilms.get(item.id!) ?? null : null,
    });
    const keyOf = (item: Item) => `${item.kind}:${item.id ?? 'none'}`;
    const loadedLook = (item: Item): Promise<unknown> =>
      item.kind === 'film'
        ? FilmStocks.load(item.id!).then((f) => readyFilms.set(item.id!, f))
        : item.id == null ? Promise.resolve() : parsedLut(item.id).then((l) => readyLuts.set(item.id!, l));

    /** From the cached thumbnails: a copy per stripe. */
    const paintCached = () => {
      ctx.clearRect(0, 0, pw, ph);
      ctx.imageSmoothingEnabled = true;
      shown.forEach((item, i) => {
        const t = thumbs.get(keyOf(item));
        const g = geometry(i);
        if (!t || !g) return;
        const k = t.width / outW;
        ctx.drawImage(t, g.slice.x * k, g.slice.y * (t.height / outH), g.slice.width * k, g.slice.height * (t.height / outH), g.x0, py0, g.x1 - g.x0, py1 - py0);
      });
    };
    /** Full resolution, as the preview would show it. */
    const paintFull = () => {
      shown.forEach((item, i) => {
        const g = geometry(i);
        if (!g) return;
        const { lut, film } = looksOf(item);
        if ((item.kind === 'film' && !film) || (item.kind === 'lut' && item.id != null && !lut)) return;
        const sp = session.shaderParams(withLook(params, item), defaults, lut, null, film);
        ctx.putImageData(renderRegion(sp, preview, g.slice, g.x1 - g.x0, py1 - py0), g.x0, py0);
      });
    };
    const buildThumb = async (item: Item) => {
      await loadedLook(item);
      if (cancelled) return;
      const { lut, film } = looksOf(item);
      const sp = session.shaderParams(withLook(params, item), defaults, lut, null, film);
      const img = renderThumbnail(sp, preview, THUMB_LONG);
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
      thumbs.set(keyOf(item), c);
    };

    const frame = requestAnimationFrame(async () => {
      if (cancelled) return;
      paintCached();
      const missing = shown.filter((item) => !thumbs.has(keyOf(item)) && !failed.current.has(keyOf(item)));
      if (missing.length > 0) {
        setLoading((c) => c + 1);
        for (const item of missing) {
          try {
            await buildThumb(item);
          } catch {
            failed.current.add(keyOf(item));
          }
          if (cancelled) break;
          paintCached();
        }
        setLoading((c) => c - 1);
        if (cancelled) return;
      }
      if (dragging) return;
      // At rest: the exact pixels for this spot.
      timer = window.setTimeout(() => {
        if (!cancelled) paintFull();
      }, REFINE_MS);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // params themselves are covered by paramsKey (and so by thumbs); session is stable for one photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, state.preview, region, box.w, box.h, pw, ph, shown, defaults, dragging]);

  // Escape closes, arrows turn the page.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setPage(Math.max(0, page - 1));
      else if (e.key === 'ArrowRight') setPage(Math.min(pages - 1, page + 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [onClose, page, pages]);

  // The wheel over the panel must not zoom the photo under it.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop, { passive: true });
    return () => el.removeEventListener('wheel', stop);
  }, [visible]);

  // Pointer: a press that stays put picks the stripe under it; one that travels moves the panel.
  const press = useRef<{ id: number; x: number; y: number; px: number; py: number; moved: boolean; onBar: boolean } | null>(null);
  const resize = useRef<{ id: number; x: number; y: number; w: number; h: number; size: Size } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the photo underneath must not pan, compare or take the click
    if ((e.target as Element).closest('button') || e.button !== 0) return;
    if ((e.target as Element).closest('.look-resize')) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      resize.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: zoneW, h: zoneH, size: { w: zoneW, h: zoneH } };
      setDragging(true);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: left, py: top, moved: false, onBar: (e.target as Element).closest('.look-bar') != null };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const r = resize.current;
    if (r && r.id === e.pointerId) {
      r.size = { w: clampW(r.w + e.clientX - r.x), h: clampH(r.h + e.clientY - r.y) };
      setUserSize(r.size);
      return;
    }
    const g = press.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
    }
    setPos({ x: g.px + dx, y: g.py + dy });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rz = resize.current;
    if (rz && rz.id === e.pointerId) {
      resize.current = null;
      setDragging(false);
      saveSize(rz.size);
      return;
    }
    const g = press.current;
    if (!g || g.id !== e.pointerId) return;
    press.current = null;
    setDragging(false);
    if (g.moved || g.onBar) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.min(shown.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * shown.length)));
    onPick(withLook(params, shown[i]));
  };
  const onCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    press.current = null;
    if (resize.current) saveSize(resize.current.size);
    resize.current = null;
    setDragging(false);
  };

  return (
    <div ref={boxRef} className="look-selector-layer">
      {visible && region && (
        <div
          ref={panelRef}
          className={`look-selector${dragging ? ' dragging' : ''}`}
          style={{ left, top, width: zoneW, height: zoneH }}
          role="group"
          aria-label="Look selector"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <canvas ref={canvasRef} width={pw} height={ph} style={{ width: zoneW, height: zoneH }} />
          <div className="look-stripes" style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)`, paddingBottom: hangBottom }}>
            {shown.map((item) => (
              <div key={`${item.kind}:${item.id ?? 'none'}`} className={`look-stripe${isCurrent(params, item) ? ' current' : ''}${item.kind === 'film' ? ' film' : ''}`} title={item.kind === 'film' ? `${item.name} (film)` : item.name} role="button" aria-label={`Use ${item.name}`}>
                {item.kind === 'film' && <span className="look-kind">Film</span>}
                <span className="look-stripe-name">{item.name}</span>
              </div>
            ))}
          </div>
          <div
            className="look-resize"
            role="separator"
            aria-label="Resize the Looks window (double-click for the default size)"
            title="Drag to resize; double-click for the default size"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setUserSize(null);
              saveSize(null);
            }}
          />
          <div className="look-bar" style={{ left: Math.max(0, -left), right: hangRight }}>
            <span className="look-title">Looks{loading > 0 ? ' …' : ''}</span>
            {pages > 1 && (
              <>
                <button type="button" aria-label="Previous looks" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
                <span className="look-page">{page + 1}/{pages}</span>
                <button type="button" aria-label="Next looks" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
              </>
            )}
            <button type="button" className="look-close" aria-label="Close" onClick={onClose}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Parsed LUTs by id, for drawing a stripe the moment its LUT is known. */
const readyLuts = new Map<string, LutData>();
