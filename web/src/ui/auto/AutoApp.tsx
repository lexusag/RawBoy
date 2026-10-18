import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ALL_LOOKS, type Look } from '../../engine/auto/looks/Look';
import { DEFAULT_STRENGTH, type Adjustments } from '../../engine/auto/looks/LookApplier';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import type { PreviewImage } from '../../engine/gl/PreviewImage';
import type { ShaderParams } from '../../engine/gl/ShaderParams';
import { canPickOutputFolder, PHOTO_ACCEPT, pickFiles, pickOutputFolder } from '../common/files';
import { isTabShown } from '../common/tabs';
import { ParamSlider, formatPlain, formatSigned } from '../common/ParamSlider';
import { isPressedSlider } from '../common/sliderFocus';
import { Preview, PreviewLabel } from '../common/Preview';
import { useTabScroll } from '../common/useTabScroll';
import { ALL_FILM_LOOKS } from '../../engine/auto/looks/FilmLooks';
import type { Preset } from '../../engine/develop/Presets';
import { groupSummary } from '../pro/PresetsPanel';
import { PresetStore } from '../pro/PresetStore';
import { PresetsIcon } from '../common/PresetsIcon';
import { DeleteIcon } from '../common/DeleteIcon';
import { UndoIcon } from '../common/UndoIcon';
import { AppSwitcher, HelpButton } from '../common/AppNav';
import { activeLook, EXPORT_SIZES, lookName, paramsOf, SETTINGS, type AutoPhoto, type AutoStore, type LookMode } from './AutoStore';

/** The frame around the photo in the fit view, CSS pixels, as RawBoy's (grey, white or black: click outside the photo). */
const FRAME_WIDTH = 12;

/** RawBoy Auto: grid of the batch, or one photo in detail (port of app-auto's AutoApp/GridScreen/DetailScreen). */
export function AutoApp({ store, onEditInRawBoy }: { store: AutoStore; onEditInRawBoy: (id: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  // The grid unmounts while a photo is open: it comes back at the same scroll position, with the last photo viewed in view.
  const gridScroll = useRef(0);
  const lastViewed = useRef<string | null>(null);
  if (state.selected) lastViewed.current = state.selected;
  return state.selected
    ? <DetailView store={store} id={state.selected} onEditInRawBoy={onEditInRawBoy} />
    : <GridView store={store} scroll={gridScroll} lastViewed={lastViewed} />;
}

/** Asks where to save when the browser can write to a folder; null = downloads / ZIP. */
async function outputFolder(): Promise<FileSystemDirectoryHandle | null | undefined> {
  if (!canPickOutputFolder()) return null;
  try {
    return await pickOutputFolder();
  } catch {
    return undefined; // cancelled
  }
}

function GridView({ store, scroll, lastViewed }: {
  store: AutoStore;
  scroll: React.MutableRefObject<number>;
  lastViewed: React.MutableRefObject<string | null>;
}) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const gridRef = useRef<HTMLDivElement>(null);
  // Before paint, so the top of the grid never flashes. Arrow keys / swipes may have moved on in the detail view.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.scrollTop = scroll.current;
    const id = lastViewed.current;
    lastViewed.current = null;
    const cell = id ? el.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
    if (!cell) return;
    // Scrolled by hand rather than scrollIntoView, which would also move the page's hidden-overflow ancestors.
    const g = el.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    if (c.top < g.top) el.scrollTop += c.top - g.top - 8;
    else if (c.bottom > g.bottom) el.scrollTop += c.bottom - g.bottom + 8;
  }, []);
  const { photos } = state;
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const exporting = state.export != null;
  const exportable = photos.filter((p) => p.analysis).length;
  // Long-press (or Ctrl/Cmd-click) a photo to start selecting; click then toggles, Shift-click adds the range from the
  // photo last toggled, Ctrl/Cmd+A selects all. Selection is for rotating, removing, exporting and giving photos (one
  // scene) their own RawBoy preset.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  // The preset picker: for the whole batch ('all') or the selection as it was when Preset was pressed.
  const [choosingPreset, setChoosingPreset] = useState<'all' | ReadonlySet<string> | null>(null);
  // The export sheet: for every photo ('all') or the selection as it was when Export was pressed.
  const [exportSheet, setExportSheet] = useState<'all' | ReadonlySet<string> | null>(null);
  const selecting = selection.size > 0;
  const exportableSelected = photos.filter((p) => p.analysis && selection.has(p.id)).length;
  useEffect(() => {
    const ids = new Set(photos.map((p) => p.id));
    if ([...selection].some((id) => !ids.has(id))) setSelection(new Set([...selection].filter((id) => ids.has(id))));
  }, [photos, selection]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTabShown('auto')) return;
      if (e.key === 'Escape') setSelection(new Set());
      else if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !isTextEntry(e.target)) {
        e.preventDefault();
        setSelection(new Set(photosRef.current.map((p) => p.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const add = async () => store.add(await pickFiles(true, PHOTO_ACCEPT));
  const toggle = (id: string) => {
    const s = new Set(selection);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    anchor.current = id;
    setSelection(s);
  };
  const selectRange = (id: string) => {
    const from = photos.findIndex((p) => p.id === anchor.current);
    const to = photos.findIndex((p) => p.id === id);
    if (from < 0 || to < 0 || selection.size === 0) return toggle(id);
    const s = new Set(selection);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) s.add(photos[i].id);
    anchor.current = id;
    setSelection(s);
    window.getSelection()?.removeAllRanges(); // Shift-click also extends the page's text selection
  };

  return (
    <div className="editor">
      <header className={`toolbar${selecting ? ' selection-bar' : ''}`}>
        {selecting ? (
          <>
            <button type="button" className="icon" title="Cancel selection" onClick={() => setSelection(new Set())}>✕</button>
            <div className="title"><div className="name">{selection.size}<span className="wide-only"> selected</span></div></div>
            <button type="button" className="text" onClick={() => setSelection(new Set(photos.map((p) => p.id)))}>All</button>
            <button type="button" className="icon" title="Rotate left" disabled={exporting} onClick={() => store.rotate(selection, -1)}>↺</button>
            <button type="button" className="icon" title="Rotate right" disabled={exporting} onClick={() => store.rotate(selection, 1)}>↻</button>
            <button
              type="button"
              className="icon"
              title="RawBoy preset for these photos (one per scene)"
              aria-label="Preset"
              disabled={exporting}
              onClick={() => setChoosingPreset(new Set(selection))}
            >
              <PresetsIcon />
            </button>
            <button
              type="button"
              className="icon"
              title="Remove from the batch"
              aria-label="Remove"
              disabled={exporting}
              onClick={() => {
                store.remove(selection);
                setSelection(new Set());
              }}
            >
              <DeleteIcon />
            </button>
            <button
              type="button"
              className="primary"
              disabled={exporting || exportableSelected === 0}
              title={exportableSelected < selection.size ? 'Photos still being analysed are left out' : undefined}
              onClick={() => setExportSheet(new Set(selection))}
            >
              Export{exportableSelected > 1 && <span className="wide-only"> ({exportableSelected})</span>}
            </button>
          </>
        ) : (
          <>
            <AppSwitcher />
            <div className="title" />
            <button type="button" className="text" onClick={add} disabled={exporting}>Add</button>
            <button
              type="button"
              className="primary"
              disabled={exporting || exportable === 0}
              onClick={() => setExportSheet('all')}
            >
              {exportable > 1 ? `Export all (${exportable})` : 'Export'}
            </button>
            <HelpButton />
          </>
        )}
      </header>
      {!selecting && (
        // One line: the mode for photos added next (each can switch in its detail view) and the batch's RawBoy
        // preset. Export format and size are asked for when exporting, so the grid keeps the screen.
        <div className="import-mode">
          <div className="import-mode-row batch-bar">
            <span className="import-mode-label">Import as</span>
            <ModeSwitch mode={state.importMode} onChange={(m) => store.setImportMode(m)} disabled={exporting} title={importModeHint(state.importMode)} />
            {state.preset ? (
              <span
                className="preset-chip"
                title={`${groupSummary(state.preset)}. Every photo, and those you add next, is developed with this preset (lens corrections included) instead of its look.`}
              >
                <span className="batch-preset">Preset: {state.preset.name}</span>
                <button type="button" className="icon" title="Remove preset" aria-label="Remove preset" disabled={exporting} onClick={() => store.removePreset()}>✕</button>
              </span>
            ) : (
              <button type="button" className="text" disabled={exporting} onClick={() => setChoosingPreset('all')}>Apply RawBoy preset…</button>
            )}
          </div>
        </div>
      )}
      {state.export && (
        <div className="batch-progress">
          <span>Exporting {Math.min(state.export.done + 1, state.export.total)} of {state.export.total}</span>
          <progress value={Math.min(1, (state.export.done + state.export.current) / state.export.total)} max={1} />
        </div>
      )}
      {photos.length === 0 ? (
        <div className="center empty">
          <p>
            {state.importMode === 'film'
              ? 'Pick RAW photos. Each is developed automatically as film, on a suggested stock.'
              : 'Pick RAW photos. Each is developed automatically and gets a suggested film look.'}
            {' JPEG, HEIC, PNG and TIFF work too, at lower quality.'}
          </p>
          <button type="button" className="primary" onClick={add}>Choose photos</button>
          <p>or drop them here.</p>
        </div>
      ) : (
        <div className="grid auto-grid" ref={gridRef} onScroll={(e) => (scroll.current = e.currentTarget.scrollTop)}>
          {photos.map((p) => (
            <PhotoCell
              key={p.id}
              photo={p}
              selected={selection.has(p.id)}
              disabled={exporting}
              onClick={(e) => {
                if (e.shiftKey) selectRange(p.id);
                else if (selecting || e.metaKey || e.ctrlKey) toggle(p.id);
                else if (p.analysis) store.openDetail(p.id);
              }}
              onLongPress={() => toggle(p.id)}
            />
          ))}
        </div>
      )}
      {exportSheet && (
        <ExportSheet
          store={store}
          count={exportSheet === 'all' ? exportable : photos.filter((p) => p.analysis && exportSheet.has(p.id)).length}
          onDismiss={() => setExportSheet(null)}
          onExport={async () => {
            const ids = exportSheet === 'all' ? undefined : exportSheet;
            setExportSheet(null);
            const folder = await outputFolder();
            if (folder === undefined) return;
            if (ids) setSelection(new Set()); // the grid's badges then show each photo's export
            void store.exportAll(folder, ids);
          }}
        />
      )}
      {choosingPreset && (
        <PresetPicker
          store={store}
          count={choosingPreset === 'all' ? null : choosingPreset.size}
          onPick={(p) => {
            const ids = choosingPreset;
            setChoosingPreset(null);
            if (ids === 'all') store.applyPresetToAll(p);
            else {
              store.applyPresetTo(p, ids);
              setSelection(new Set());
            }
          }}
          onDismiss={() => setChoosingPreset(null)}
        />
      )}
    </div>
  );
}

/**
 * Picks the preset to apply to the batch, or to [count] selected photos: one saved in the RawBoy tab, or one from a preset file (.rawboy.json, as
 * RawBoy exports them on the web or Android). A file with several presets lists them.
 */
function PresetPicker({ store, count, onPick, onDismiss }: {
  store: AutoStore;
  count: number | null;
  onPick: (p: Preset) => void;
  onDismiss: () => void;
}) {
  const [saved] = useState(() => PresetStore.load());
  const [fromFile, setFromFile] = useState<Preset[] | null>(null);
  const list = fromFile ?? saved;
  const openFile = async () => {
    const [file] = await pickFiles(false, '.json,application/json');
    const presets = file ? await store.readPresetFile(file) : null;
    if (!presets) return;
    if (presets.length === 1) onPick(presets[0]);
    else setFromFile(presets);
  };
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Apply a RawBoy preset">
        <h2>{count == null ? 'Apply a RawBoy preset' : `RawBoy preset for ${count === 1 ? '1 photo' : `${count} photos`}`}</h2>
        <div className="note">
          {fromFile
            ? 'Presets in the file:'
            : list.length
              ? 'Your presets from the RawBoy tab, or a preset file:'
              : 'No presets saved in the RawBoy tab yet. Open a preset file (.rawboy.json) exported from RawBoy.'}
        </div>
        {list.length > 0 && (
          <div className="preset-list">
            {list.map((p) => (
              <div key={p.id} className="preset-row">
                <button type="button" className="preset-apply" onClick={() => onPick(p)}>
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-groups">{groupSummary(p)}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" onClick={openFile}>From file…</button>
        </div>
      </div>
    </div>
  );
}

/** True for elements where Ctrl/Cmd+A should keep selecting text. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(target.type);
}

function PhotoCell({ photo, selected, disabled, onClick, onLongPress }: {
  photo: AutoPhoto;
  selected: boolean;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
  onLongPress: () => void;
}) {
  const timer = useRef(0);
  const longPressed = useRef(false);
  // The thumbnail's own width / height: rows are justified, each photo at its aspect (3:2 until it has loaded).
  const [aspect, setAspect] = useState(1.5);
  return (
    <button
      type="button"
      data-id={photo.id}
      className={`cell${selected ? ' selected' : ''}`}
      style={{ '--a': aspect } as React.CSSProperties}
      disabled={disabled}
      onPointerDown={() => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          onLongPress();
        }, 500);
      }}
      onPointerUp={() => clearTimeout(timer.current)}
      onPointerLeave={() => clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (!longPressed.current) onClick(e);
      }}
    >
      <div className="thumb">
        {photo.thumbnail && (
          <img
            src={photo.thumbnail}
            alt={photo.name}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
            }}
          />
        )}
        {photo.status === 'queued' && <span className="badge">Waiting</span>}
        {(photo.status === 'analyzing' || photo.status === 'exporting') && <span className="spinner" />}
        {photo.status === 'failed' && <span className="badge error">{photo.error ?? 'Failed'}</span>}
        {photo.status === 'exported' && <span className="badge corner">Saved</span>}
        {selected && <span className="check">✓</span>}
        <div className="cell-caption">
          <div className="cell-name">{photo.name}</div>
          {photo.analysis && <div className="cell-look">{lookName(photo)}</div>}
        </div>
      </div>
    </button>
  );
}

function DetailView({ store, id, onEditInRawBoy }: { store: AutoStore; id: string; onEditInRawBoy: (id: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  const session = useSyncExternalStore(store.session.subscribe, () => store.session.state);
  const [showAuto, setShowAuto] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Look: the look and the two everyday controls; Adjust: every adjustment (those two again, then the offsets from the auto develop).
  const [tab, setTab] = useState<'Look' | 'Adjust'>('Look');
  const scroll = useTabScroll(tab);
  const photo = state.photos.find((p) => p.id === id);
  const analysis = photo?.analysis;
  const loaded = state.sessionReady === id;
  // Photos that can be opened, in grid order.
  const pages = useMemo(() => state.photos.filter((p) => p.analysis), [state.photos]);
  const index = pages.findIndex((p) => p.id === id);
  const skinMask = session.skin.kind === 'ready' ? session.skin.mask : null;
  const params = useMemo(() => (photo ? paramsOf(photo) : null), [photo]);
  // Press and hold shows the auto develop without the look.
  const shown = showAuto ? analysis?.autoBase : params ?? analysis?.autoBase;
  const shaderParams = useMemo(
    () => (loaded && shown && analysis && session.preview
      ? store.session.shaderParams(shown, analysis.defaults, shown.lut != null ? session.lutData : null, null, shown.film != null ? session.filmData : null)
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, shown, analysis, session.lutData, session.filmData, session.lensInfo, session.base, session.bloomSources, skinMask, session.preview],
  );
  // Until the raw is decoded, the photo's cached preview shows its develop (no 100% view yet).
  const cached = !loaded && state.cachedPreview?.id === id ? state.cachedPreview.image : null;
  const [cachedParams, setCachedParams] = useState<{ image: PreviewImage; params: ShaderParams } | null>(null);
  useEffect(() => {
    if (!cached || !params) return;
    let live = true;
    void store.cachedShaderParams(id, params).then((p) => {
      if (live && p) setCachedParams({ image: cached, params: p });
    });
    return () => {
      live = false;
    };
  }, [store, id, cached, params]);
  const quick = cached && cachedParams?.image === cached ? cachedParams : null;
  const previewSession = useMemo(
    () => (loaded || !quick ? session : { ...session, preview: quick.image, zoomCenter: null, detail: null }),
    [loaded, quick, session],
  );
  const zoomed = session.zoomCenter != null;
  const go = (delta: number) => {
    if (zoomed || state.export) return;
    const next = pages[index + delta];
    if (next) store.openDetail(next.id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTabShown('auto')) return;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
        // Undo, or Redo with Shift (or Ctrl+Y), also while a slider has focus.
        const t = e.target;
        if (t instanceof HTMLInputElement && t.type !== 'range') return;
        e.preventDefault();
        if (key === 'z' && !e.shiftKey) store.undo(id);
        else store.redo(id);
        return;
      }
      if (isTextEntry(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.dialog')) return;
      // Space / Backspace as in darktable, also while a slider or button has focus (Enter still presses a button).
      if (e.key === ' ' || e.key === 'Backspace') {
        e.preventDefault();
        go(e.key === ' ' ? 1 : -1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // A slider reached with Tab keeps its arrows; one just dragged gives them back to the photos.
        const t = e.target;
        if (t instanceof HTMLInputElement && !isPressedSlider(t)) return;
        e.preventDefault();
        go(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === 'Escape') store.closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Swipe left/right on touch screens, when not zoomed.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  if (!photo || !analysis) return null;
  const adjustSlider = (label: string, key: keyof Adjustments, range: number) => (
    <ParamSlider label={label} value={photo.adjust[key]} min={-range} max={range} defaultValue={0} format={formatSigned} onChange={(v) => store.setAdjust(id, { [key]: v })} />
  );

  return (
    <div className="editor">
      <header className="toolbar">
        <button type="button" className="icon" title="Back" onClick={() => store.closeDetail()}>←</button>
        <div className="title">
          <div className="name">{photo.name}</div>
          {pages.length > 1 && index >= 0 && <div className="info">{index + 1} / {pages.length}</div>}
        </div>
        <button type="button" className="icon" title="Undo (Ctrl/⌘ Z)" aria-label="Undo" disabled={state.export != null || !store.canUndo(id)} onClick={() => store.undo(id)}>
          <UndoIcon />
        </button>
        <button type="button" className="icon" title="Redo (Shift Ctrl/⌘ Z)" aria-label="Redo" disabled={state.export != null || !store.canRedo(id)} onClick={() => store.redo(id)}>
          <UndoIcon redo />
        </button>
        <button type="button" className="text" disabled={state.export != null || state.photos.length < 2} onClick={() => store.applyLookToAll(id)}>Apply to all</button>
        <button type="button" className="text" disabled={state.export != null} title="Open in the RawBoy tab with these settings" onClick={() => onEditInRawBoy(id)}>Edit<span className="wide-only"> in RawBoy</span></button>
        <button
          type="button"
          className="primary"
          disabled={!loaded || state.export != null}
          onClick={() => setExportOpen(true)}
        >
          Export
        </button>
        <HelpButton wideOnly />
      </header>
      {exportOpen && (
        <ExportSheet
          store={store}
          count={1}
          onDismiss={() => setExportOpen(false)}
          onExport={async () => {
            setExportOpen(false);
            const folder = await outputFolder();
            if (folder !== undefined) void store.exportSelected(folder);
          }}
        />
      )}
      <div className="workspace auto">
        <div
          className="preview-wrap"
          onTouchStart={(e) => (swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
          onTouchEnd={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (!s || zoomed) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
          }}
        >
          <Preview
            session={previewSession}
            params={shaderParams ?? quick?.params ?? null}
            frame={FRAME_WIDTH}
            frameGrey={FrameColors[state.frameColor].level}
            onViewSize={(w, h, f) => store.setViewSize(w, h, f)}
            onToggleZoom={(x, y) => loaded && store.toggleZoom(x, y)}
            onClick={(x, y) => loaded && store.onPreviewClick(x, y)}
            onPan={(dx, dy) => store.session.pan(dx, dy)}
            onCompare={setShowAuto}
            zoomHint={loaded}
          >
            {!loaded && quick && <span className="spinner corner" />}
            {!loaded && !quick && (
              <>
                {/* Inset by the frame so the photo doesn't move when the decoded preview replaces it. */}
                {photo.thumbnail && <img className="placeholder" src={photo.thumbnail} alt="" style={{ padding: FRAME_WIDTH, boxSizing: 'border-box' }} />}
                <div className="center"><span className="spinner" /></div>
              </>
            )}
            {loaded && (showAuto || zoomed) && <PreviewLabel>{showAuto ? (photo.preset ? 'Without preset' : 'Without look') : '100%'}</PreviewLabel>}
            {state.export && <progress className="export-progress" value={state.export.current} max={1} />}
          </Preview>
          {index > 0 && !zoomed && <button type="button" className="nav prev" onClick={() => go(-1)} title="Previous (← or Backspace)">‹</button>}
          {index < pages.length - 1 && !zoomed && <button type="button" className="nav next" onClick={() => go(1)} title="Next (→ or Space)">›</button>}
        </div>
        <aside className="sidebar auto-controls">
          {photo.preset ? (
            <div className="photo-preset">
              <div className="title">
                <div className="name">{photo.preset.name}</div>
                <div className="info">RawBoy preset · {groupSummary(photo.preset)}</div>
              </div>
              <button type="button" className="text" disabled={state.export != null} onClick={() => store.removePhotoPreset(photo.id)}>Use a look</button>
            </div>
          ) : (
            <>
              <ModeSwitch mode={photo.mode} onChange={(m) => store.setMode(photo.id, m)} className="look-mode" />
              <LookStrip store={store} photo={photo} />
            </>
          )}
          <div className="controls-body" ref={scroll.ref} onScroll={scroll.onScroll}>
            <nav className="tabs small">
              {(['Look', 'Adjust'] as const).map((t) => (
                <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
              {/* By the controls it changes; the top bar is full on phones. */}
              <button
                type="button"
                className="text copy-previous"
                disabled={state.export != null || index < 1}
                title={index > 0 ? `Copy the look and settings of ${pages[index - 1].name}` : 'Copy the look and settings of the photo before this one'}
                onClick={() => store.copyPrevious(id)}
              >
                Copy previous
              </button>
            </nav>
            {tab === 'Look' ? (
              <>
                {!photo.preset && <ParamSlider label="Strength" value={photo.strength} min={0} max={100} defaultValue={DEFAULT_STRENGTH} format={formatPlain} onChange={(v) => store.setStrength(id, v)} />}
                {adjustSlider('Brightness', 'brightness', 100)}
                {adjustSlider('Warmth', 'warmth', 100)}
              </>
            ) : (
              <>
                {/* Light and colour in pairs, side by side. */}
                <div className="slider-pair">
                  {adjustSlider('Brightness', 'brightness', 100)}
                  {adjustSlider('Contrast', 'contrast', 50)}
                </div>
                <div className="slider-pair">
                  {adjustSlider('Warmth', 'warmth', 100)}
                  {adjustSlider('Tint', 'tint', 50)}
                </div>
                {adjustSlider('Saturation', 'saturation', 100)}
                {adjustSlider('Grain', 'grain', 50)}
                {adjustSlider('Denoise', 'denoise', 100)}
              </>
            )}
            <div className="note">Double-click the photo for 100%. Press and hold it to see it without the {photo.preset ? 'preset' : 'look'}. Space / Backspace (or ← / →) move through the batch.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** What importing in [mode] does, under the "Import as" switch. */
function importModeHint(mode: LookMode): string {
  return mode === 'film'
    ? 'Auto develop as film on a suggested stock, with grain and halation. For photos you add next; each can switch later.'
    : 'Auto develop + a suggested colour look. For photos you add next; each can switch later.';
}

/**
 * Looks (LUTs on the AgX develop) or Film (stocks rendered as negative + print): a segmented switch, as in the apps,
 * so it doesn't read as another row of tabs.
 */
function ModeSwitch({ mode, onChange, disabled, className, title }: {
  mode: LookMode;
  onChange: (m: LookMode) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const modes: [LookMode, string][] = [['looks', 'Looks'], ['film', 'Film']];
  return (
    <div className={className ? `segmented ${className}` : 'segmented'} title={title}>
      {modes.map(([m, text]) => (
        <button key={m} type="button" className={mode === m ? 'active' : ''} aria-pressed={mode === m} disabled={disabled} onClick={() => onChange(m)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Asked on Export all and the photo view's Export: format, quality or bit depth, and size, kept for the next
 * exports (as RawBoy's export dialog).
 */
function ExportSheet({ store, count, onDismiss, onExport }: { store: AutoStore; count: number; onDismiss: () => void; onExport: () => void }) {
  const where = canPickOutputFolder()
    ? 'You pick the folder next.'
    : count > 1
      ? 'Saved as one ZIP download.'
      : 'Saved as a download.';
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog auto-export" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
        <h2>{count > 1 ? `Export ${count} photos` : 'Export'}</h2>
        <ExportOptions store={store} disabled={false} />
        <small className="muted">{where}</small>
        <div className="dialog-actions">
          <button type="button" className="text" onClick={onDismiss}>Cancel</button>
          <button type="button" className="primary" onClick={onExport}>Export</button>
        </div>
      </div>
    </div>
  );
}

/** Format, JPEG quality or TIFF bit depth, and size of exports (in ExportSheet). */
function ExportOptions({ store, disabled }: { store: AutoStore; disabled: boolean }) {
  const s = useSyncExternalStore(store.subscribe, () => store.state.exportSettings);
  return (
    <>
      <div className="import-mode-row export-options">
        <span className="import-mode-label">Format</span>
        <div className="segmented">
          {(['jpeg', 'tiff'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={s.format === f ? 'active' : ''}
              aria-pressed={s.format === f}
              disabled={disabled}
              onClick={() => store.setExportSettings({ ...s, format: f })}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <select
          aria-label="Export size"
          value={s.maxLongSide ?? ''}
          disabled={disabled}
          onChange={(e) => store.setExportSettings({ ...s, maxLongSide: e.target.value ? Number(e.target.value) : null })}
        >
          {EXPORT_SIZES.map((v) => (
            <option key={v ?? 'full'} value={v ?? ''}>{v ? `${v} px` : 'Original size'}</option>
          ))}
        </select>
      </div>
      <div className="import-mode-row export-options">
        <span className="import-mode-label" />
        {s.format === 'jpeg' ? (
          <div className="export-quality">
            <ParamSlider
              label="Quality"
              value={s.jpegQuality}
              min={1}
              max={100}
              step={1}
              defaultValue={SETTINGS.jpegQuality}
              format={formatPlain}
              disabled={disabled}
              onChange={(v) => store.setExportSettings({ ...s, jpegQuality: v })}
            />
          </div>
        ) : (
          <div className="segmented">
            {([8, 16] as const).map((b) => (
              <button
                key={b}
                type="button"
                className={s.tiffBits === b ? 'active' : ''}
                aria-pressed={s.tiffBits === b}
                disabled={disabled}
                onClick={() => store.setExportSettings({ ...s, tiffBits: b })}
              >
                {b}-bit
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The looks: a grid in the desktop sidebar (all visible); a row on narrow screens, where a mouse wheel scrolls it
 * sideways and the selected look is kept in view.
 */
function LookStrip({ store, photo }: { store: AutoStore; photo: AutoPhoto }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    // Not React's onWheel: that listener is passive, so it couldn't stop the vertical scroll.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const el = ref.current!;
    if (el.scrollWidth <= el.clientWidth) return;
    el.querySelector<HTMLElement>('.look.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [photo.id, photo.mode, activeLook(photo).id]);
  return (
    <div className="look-strip" ref={ref}>
      {(photo.mode === 'film' ? ALL_FILM_LOOKS : ALL_LOOKS).map((look) => (
        <LookChip key={look.id} store={store} photo={photo} look={look} />
      ))}
    </div>
  );
}

function LookChip({ store, photo, look }: { store: AutoStore; photo: AutoPhoto; look: Look }) {
  const [thumb, setThumb] = useState<string | null>(null);
  // Keeps showing the previous thumbnail while a slider moves; re-renders once it rests.
  useEffect(() => {
    let alive = true;
    const current = store.hasCurrentLookThumbnail(photo.id, look);
    const t = window.setTimeout(async () => {
      const url = await store.lookThumbnail(photo.id, look);
      if (alive) setThumb(url);
    }, current ? 0 : 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [store, photo.id, look, photo.adjust]);
  const selected = activeLook(photo).id === look.id;
  const suggested = photo.mode === 'film' ? photo.suggestedFilm : photo.suggested;
  return (
    <button type="button" className={`look${selected ? ' selected' : ''}`} onClick={() => store.setLook(photo.id, look)}>
      <div className="look-thumb">
        {thumb && <img src={thumb} alt={look.name} />}
        {suggested.id === look.id && <span className="suggested">Suggested</span>}
      </div>
      <span className="look-name">{look.name}</span>
    </button>
  );
}
