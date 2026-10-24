import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ALL_LOOKS, type Look } from '../../engine/auto/looks/Look';
import { DEFAULT_STRENGTH, type Adjustments } from '../../engine/auto/looks/LookApplier';
import { FrameColors } from '../../engine/gl/DevelopRenderer';
import type { PreviewImage } from '../../engine/gl/PreviewImage';
import type { ShaderParams } from '../../engine/gl/ShaderParams';
import { canPickOutputFolder, PHOTO_ACCEPT, pickFiles, pickOutputFolder, savesToPhotos } from '../common/files';
import { isTabShown } from '../common/tabs';
import { ParamSlider, formatPlain, formatSigned } from '../common/ParamSlider';
import { isPressedSlider } from '../common/sliderFocus';
import { Preview, PreviewLabel } from '../common/Preview';
import { useTabScroll } from '../common/useTabScroll';
import { ALL_FILM_LOOKS } from '../../engine/auto/looks/FilmLooks';
import { isLensPreset, NO_LENS_PRESET, replacesLook, type Preset } from '../../engine/develop/Presets';
import { groupSummary } from '../pro/PresetsPanel';
import { PresetStore } from '../pro/PresetStore';
import { PresetsIcon } from '../common/PresetsIcon';
import { DeleteIcon } from '../common/DeleteIcon';
import { UndoIcon } from '../common/UndoIcon';
import { AppSwitcher, HelpButton } from '../common/AppNav';
import { activeLook, EDITS_NAME, EXPORT_SIZES, lookName, paramsOf, SETTINGS, type AutoPhoto, type AutoStore, type ImportMode, type LookMode } from './AutoStore';
import { shortcutKey } from '../common/shortcutKey';

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
  const [managingLensPresets, setManagingLensPresets] = useState(false);
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
      else if (shortcutKey(e) === 'a' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !isTextEntry(e.target)) {
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
            {state.lensPresets.length > 0 && (
              // A lens preset for these photos: manual lenses record no lens name to match by.
              <LensPresetSelect
                presets={state.lensPresets}
                choice={selectionLensChoice(photos, selection)}
                disabled={exporting}
                title="Lens preset for these photos (manual lenses record no lens to match by)"
                onChange={(c) => {
                  store.chooseLensPreset(c, new Set(selection));
                  setSelection(new Set());
                }}
              />
            )}
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
            <ModeSwitch modes={IMPORT_MODES} mode={state.importMode} onChange={(m) => store.setImportMode(m)} disabled={exporting} title={importModeHint(state.importMode)} />
            {state.preset ? (
              <span
                className="preset-chip"
                title={replacesLook(state.preset)
                  ? `${groupSummary(state.preset)}. Every photo, and those you add next, is developed with this preset (lens corrections included) instead of its look.`
                  : `${groupSummary(state.preset)}. Every photo you add next gets only these settings from the preset, on top of its look.`}
              >
                <span className="batch-preset">Preset: {state.preset.name}</span>
                <button type="button" className="icon" title="Remove preset" aria-label="Remove preset" disabled={exporting} onClick={() => store.removePreset()}>✕</button>
              </span>
            ) : (
              <button type="button" className="text" disabled={exporting} onClick={() => setChoosingPreset('all')}>Apply RawBoy preset…</button>
            )}
            {state.photos.length > 0 && (
              // The batch's order: by shoot date (photos without one by their file's date), or by file name.
              <button
                type="button"
                className="text"
                title={state.sort === 'date' ? 'Photos in the order they were shot. Click to sort by file name.' : 'Photos by file name. Click to sort by shoot date.'}
                onClick={() => store.setSort(state.sort === 'date' ? 'name' : 'date')}
              >
                Sort: {state.sort === 'date' ? 'Shoot date' : 'File name'}
              </button>
            )}
            {state.lensPresets.length > 0 && (
              // Lens presets saved in the RawBoy tab's Lens tab: by lens they correct every photo taken with their lens,
              // whatever its look; a named one (manual lenses) is picked for the batch here or for a selection.
              <LensPresetSelect
                presets={state.lensPresets}
                choice={state.lensChoice}
                disabled={exporting}
                title="Lens preset for every photo and those you add next: by lens, none, or a named one (manual lenses). Manage them in the RawBoy tab's presets."
                onChange={(c) => store.chooseLensPreset(c)}
              />
            )}
            {state.lensPresets.length > 0 && (
              <button type="button" className="text" disabled={exporting} onClick={() => setManagingLensPresets(true)}>Manage…</button>
            )}
          </div>
        </div>
      )}
      {state.export && (
        <div className="batch-progress">
          <div className="batch-progress-row">
            <span>
              {state.export.stopping
                ? `Stopping after photo ${Math.min(state.export.done + 1, state.export.total)}…`
                : `Exporting ${Math.min(state.export.done + 1, state.export.total)} of ${state.export.total}`}
            </span>
            {state.export.total > 1 && (
              <button type="button" className="text" disabled={state.export.stopping} onClick={() => store.stopExport()}>Stop</button>
            )}
          </div>
          <progress value={Math.min(1, (state.export.done + state.export.current) / state.export.total)} max={1} />
        </div>
      )}
      {photos.length === 0 ? (
        <div className="center empty">
          <p>
            {state.importMode === 'plain'
              ? 'Pick photos, e.g. TIFFs finished elsewhere. Each is added as it is, with no automatic edits: apply a preset (just grain, say) or a look yourself.'
              : state.importMode === 'film'
                ? 'Pick RAW photos. Each is developed automatically as film, on a suggested stock.'
                : 'Pick RAW photos. Each is developed automatically and gets a suggested film look.'}
            {state.importMode !== 'plain' && ' JPEG, HEIC, PNG and TIFF work too, at lower quality.'}
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
              next={state.opening === p.id}
              waiting={state.export?.waiting?.has(p.id) ?? false}
              selected={selection.has(p.id)}
              disabled={exporting}
              onClick={(e) => {
                if (e.shiftKey) selectRange(p.id);
                else if (selecting || e.metaKey || e.ctrlKey) toggle(p.id);
                else store.openFromGrid(p.id);
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
      {managingLensPresets && state.lensPresets.length > 0 && (
        <LensPresetsDialog store={store} presets={state.lensPresets} onDismiss={() => setManagingLensPresets(false)} />
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
 * Esc closes an Auto dialog. Capture on window runs before the page's own window listeners, which then don't see
 * the key: it doesn't also clear the selection or leave the photo.
 */
function useEscToDismiss(onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTabShown('auto')) return;
      e.preventDefault();
      e.stopPropagation();
      dismiss.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
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
  // Lens presets aren't listed: they already apply to the photos taken with their lens.
  const [saved] = useState(() => PresetStore.load().filter((p) => !isLensPreset(p)));
  const [fromFile, setFromFile] = useState<Preset[] | null>(null);
  const list = fromFile ?? saved;
  useEscToDismiss(onDismiss);
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

/** The lens presets (saved in the RawBoy tab's Lens tab, or opened from files), each with the lens it corrects and Remove. */
function LensPresetsDialog({ store, presets, onDismiss }: { store: AutoStore; presets: readonly Preset[]; onDismiss: () => void }) {
  useEscToDismiss(onDismiss);
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lens presets">
        <h2>Lens presets</h2>
        <div className="note">Removing one takes its corrections off the photos that use it.</div>
        <div className="preset-list">
          {presets.map((p) => (
            <div key={p.id} className="preset-row">
              <span className="preset-apply">
                <span className="preset-name">{p.name}</span>
                <span className="preset-groups">{p.lens?.trim() ? `Photos taken with ${p.lens.trim()}` : 'Manual lens: picked by name'}</span>
              </span>
              <button type="button" className="text" onClick={() => store.removeLensPreset(p.id)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onDismiss}>Done</button>
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

function PhotoCell({ photo, next, waiting, selected, disabled, onClick, onLongPress }: {
  photo: AutoPhoto;
  /** Clicked while waiting: analysed next, then opened. */
  next: boolean;
  /** Still to be saved by the running "Export all": shown desaturated. */
  waiting: boolean;
  selected: boolean;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
  onLongPress: () => void;
}) {
  const timer = useRef(0);
  const longPressed = useRef(false);
  // The thumbnail's own width / height: rows are justified, each photo at its aspect (3:2 until it has loaded).
  const [aspect, setAspect] = useState(1.5);
  const iso = isoLabel(photo);
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
            className={waiting ? 'export-waiting' : undefined}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
            }}
          />
        )}
        {photo.status === 'queued' && <span className="badge">{next ? 'Next' : 'Waiting'}</span>}
        {(photo.status === 'analyzing' || photo.status === 'exporting') && <span className="spinner" />}
        {photo.status === 'failed' && <span className="badge error">{photo.error ?? 'Failed'}</span>}
        {photo.status === 'exported' && <span className="badge corner">Saved</span>}
        {selected && <span className="check">✓</span>}
        <div className="cell-caption">
          <div className="cell-name-row">
            <div className="cell-name">{photo.name}</div>
            {iso && <span className="cell-iso">{iso}</span>}
          </div>
          {photo.analysis && <div className="cell-look">{lookName(photo)}</div>}
        </div>
      </div>
    </button>
  );
}

/** "ISO 6400" from the photo's EXIF, to judge its noise without zooming in; null until analysed or when unknown. */
function isoLabel(photo: AutoPhoto): string | null {
  const iso = photo.analysis?.stats.iso ?? 0;
  return iso > 0 ? `ISO ${Math.round(iso)}` : null;
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
      const key = shortcutKey(e);
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
      // Delete: out of the batch, on to the next photo.
      if (e.key === 'Delete') {
        e.preventDefault();
        store.removeOpened(id);
        return;
      }
      // C: Copy previous. By key position (code), so it works on any layout (e.g. Ukrainian).
      if (e.code === 'KeyC' && !e.shiftKey) {
        e.preventDefault();
        store.copyPrevious(id);
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
  // What the look strip's place holds and what press-and-hold takes away: RawBoy edits, a preset or the look.
  const develop = photo.edits ? 'RawBoy edits' : photo.preset ? 'preset' : 'look';
  const adjustSlider = (label: string, key: keyof Adjustments, range: number) => (
    <ParamSlider label={label} value={photo.adjust[key]} min={-range} max={range} defaultValue={0} format={formatSigned} onChange={(v) => store.setAdjust(id, { [key]: v })} />
  );

  return (
    <div className="editor">
      <header className="toolbar">
        <AppSwitcher />
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
        <button type="button" className="icon" title="Remove from the batch (Delete); the file stays" aria-label="Remove from batch" disabled={state.export != null} onClick={() => store.removeOpened(id)}>
          <DeleteIcon />
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
            {isoLabel(photo) && <div className="preview-iso">{isoLabel(photo)}</div>}
            {loaded && (showAuto || zoomed) && <PreviewLabel>{showAuto ? `Without ${develop}` : '100%'}</PreviewLabel>}
            {state.export && <progress className="export-progress" value={state.export.current} max={1} />}
          </Preview>
          {index > 0 && !zoomed && <button type="button" className="nav prev" onClick={() => go(-1)} title="Previous (← or Backspace)">‹</button>}
          {index < pages.length - 1 && !zoomed && <button type="button" className="nav next" onClick={() => go(1)} title="Next (→ or Space)">›</button>}
        </div>
        <aside className="sidebar auto-controls">
          {photo.edits ? (
            <div className="photo-preset">
              <div className="title">
                <div className="name">{EDITS_NAME}</div>
                <div className="info">From the RawBoy tab · the sliders below adjust on top</div>
              </div>
              <button type="button" className="text" disabled={state.export != null} onClick={() => store.removeEdits(photo.id)}>
                Use {photo.preset ? 'the preset' : 'a look'}
              </button>
            </div>
          ) : photo.preset && replacesLook(photo.preset) ? (
            <div className="photo-preset">
              <div className="title">
                <div className="name">{photo.preset.name}</div>
                <div className="info">RawBoy preset · {groupSummary(photo.preset)}</div>
              </div>
              <button type="button" className="text" disabled={state.export != null} onClick={() => store.removePhotoPreset(photo.id)}>Use a look</button>
            </div>
          ) : (
            <>
              {photo.preset && (
                // A preset without Light changes only its groups, on top of the look below.
                <div className="photo-preset">
                  <div className="title">
                    <div className="name">{photo.preset.name}</div>
                    <div className="info">RawBoy preset · {groupSummary(photo.preset)} · on top of the look</div>
                  </div>
                  <button type="button" className="text" disabled={state.export != null} onClick={() => store.removePhotoPreset(photo.id)}>Remove</button>
                </div>
              )}
              <ModeSwitch modes={LOOK_MODES} mode={photo.mode} onChange={(m) => store.setMode(photo.id, m)} className="look-mode" />
              <LookStrip store={store} photo={photo} />
            </>
          )}
          {state.lensPresets.length > 0 && (
            // This photo's lens preset, to check or change it photo by photo.
            <div className="photo-lens">
              <LensPresetSelect
                presets={state.lensPresets}
                choice={photo.lensChoice}
                disabled={state.export != null}
                title={photo.lensPreset ? `Lens preset: ${photo.lensPreset.name}` : 'No lens preset on this photo'}
                onChange={(c) => store.chooseLensPreset(c, new Set([photo.id]))}
              />
              {photo.lensChoice === null && (
                <span className="muted">{photo.lensPreset ? photo.lensPreset.name : 'none for this lens'}</span>
              )}
            </div>
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
                title={index > 0 ? `Copy the look and settings of ${pages[index - 1].name} (C)` : 'Copy the look and settings of the photo before this one (C)'}
                onClick={() => store.copyPrevious(id)}
              >
                Copy previous
              </button>
            </nav>
            {tab === 'Look' ? (
              <>
                {!(photo.preset && replacesLook(photo.preset)) && !photo.edits && <ParamSlider label="Strength" value={photo.strength} min={0} max={100} defaultValue={DEFAULT_STRENGTH} format={formatPlain} onChange={(v) => store.setStrength(id, v)} />}
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
            <div className="note">Double-click the photo for 100%. Press and hold it to see it without the {develop}. Space / Backspace (or ← / →) move through the batch.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** What importing in [mode] does, under the "Import as" switch. */
const BY_LENS = '';
const MIXED = 'mixed';

/** The selected photos' common lens preset choice, else MIXED. */
function selectionLensChoice(photos: readonly AutoPhoto[], selection: ReadonlySet<string>): string | null {
  const choices = new Set(photos.filter((p) => selection.has(p.id)).map((p) => p.lensChoice));
  return choices.size === 1 ? [...choices][0] : MIXED;
}

/** Picks a lens preset choice (see chosenLensPreset): by lens, none, or one of presets by name. */
function LensPresetSelect({ presets, choice, disabled, title, onChange }: {
  presets: readonly Preset[];
  choice: string | null;
  disabled: boolean;
  title: string;
  onChange: (choice: string | null) => void;
}) {
  return (
    <select
      aria-label="Lens preset"
      title={title}
      value={choice ?? BY_LENS}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === BY_LENS ? null : e.target.value)}
    >
      {choice === MIXED && <option value={MIXED} disabled>Lens: mixed</option>}
      <option value={BY_LENS}>Lens: by lens</option>
      <option value={NO_LENS_PRESET}>Lens: none</option>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>Lens: {p.name}{p.lens?.trim() ? '' : ' (manual)'}</option>
      ))}
    </select>
  );
}

function importModeHint(mode: ImportMode): string {
  if (mode === 'plain') {
    return 'No automatic edits and no look: each photo stays as the file is, and imports faster. Apply a preset or pick a look yourself. For photos you add next.';
  }
  return mode === 'film'
    ? 'Auto develop as film on a suggested stock, with grain and halation. For photos you add next; each can switch later.'
    : 'Auto develop + a suggested colour look. For photos you add next; each can switch later.';
}

const LOOK_MODES: readonly [LookMode, string][] = [['looks', 'Looks'], ['film', 'Film']];
/** Import adds "As is": no auto develop, no look (finished files that only want a preset, e.g. grain). */
const IMPORT_MODES: readonly [ImportMode, string][] = [...LOOK_MODES, ['plain', 'As is']];

/**
 * Looks (LUTs on the AgX develop) or Film (stocks rendered as negative + print), plus As is when importing: a
 * segmented switch, as in the apps, so it doesn't read as another row of tabs.
 */
function ModeSwitch<M extends string>({ modes, mode, onChange, disabled, className, title }: {
  modes: readonly [M, string][];
  mode: M;
  onChange: (m: M) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
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
    : savesToPhotos()
      ? `When it’s done, tap Save to Photos to add ${count > 1 ? 'them' : 'it'} to your gallery.`
      : count > 1
      ? 'Saved as one ZIP download.'
      : 'Saved as a download.';
  useEscToDismiss(onDismiss);
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
